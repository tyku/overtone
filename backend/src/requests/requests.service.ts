import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, rename, rm, stat, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';
import { OBJECT_STORAGE } from '../object-storage/object-storage.types';
import type { DurableObjectStorage } from '../object-storage/object-storage.types';
import { RecordingAudioEncoderService } from '../recording-audio-encoder.service';
import { DatabaseService } from '../database/database.service';
import { AudioUploadService, fileHash } from './audio-upload.service';
import type { ReceivedAudio } from './audio-upload.service';
import { isClosed, RequestError } from './request.types';
import type { RequestRow, ApiError } from './request.types';
import { ProcessingService } from '../processing/processing.service';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);
  constructor(
    private readonly db: DatabaseService,
    private readonly uploads: AudioUploadService,
    private readonly encoder: RecordingAudioEncoderService,
    @Inject(OBJECT_STORAGE) private readonly storage: DurableObjectStorage,
    private readonly processing: ProcessingService,
  ) {}
  validateId(id: string) {
    if (!uuid.test(id))
      throw new RequestError(400, 'INVALID_REQUEST_ID', 'Invalid request ID');
  }
  async create(ownerId: string) {
    const client = await this.db.pool.connect();
    try {
      return await this.db.transaction(client, async () => {
        const result = await client.query<RequestRow>(
          "INSERT INTO requests(id,owner_id,status) VALUES($1,$2,'created') ON CONFLICT DO NOTHING RETURNING *",
          [randomUUID(), ownerId],
        );
        if (!result.rows[0]) {
          const active = await client.query<RequestRow>(
            'SELECT * FROM requests WHERE owner_id=$1 AND closed_at IS NULL',
            [ownerId],
          );
          if (!active.rows[0]) throw this.unknown();
          throw new RequestError(
            409,
            'ACTIVE_REQUEST_EXISTS',
            'An unfinished request already exists',
            'none',
            active.rows[0].id,
          );
        }
        const row = result.rows[0];
        await this.event(client, row.id, 'created');
        return this.view(row);
      });
    } finally {
      client.release();
    }
  }
  async list(ownerId: string, limitValue?: string, cursor?: string) {
    const limit = limitValue === undefined ? 20 : Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new RequestError(
        400,
        'INVALID_PAGINATION',
        'limit must be between 1 and 100',
      );
    let after: { createdAt: string; requestId: string } | undefined;
    if (cursor) {
      try {
        after = JSON.parse(
          Buffer.from(cursor, 'base64url').toString(),
        ) as typeof after;
        if (
          !after ||
          !uuid.test(after.requestId) ||
          !Number.isFinite(Date.parse(after.createdAt))
        )
          throw new Error();
      } catch {
        throw new RequestError(400, 'INVALID_CURSOR', 'Invalid cursor');
      }
    }
    // PostgreSQL timestamp text retains microseconds; JS Date would lose the cursor tie-break precision.
    const result = await this.db.pool.query<
      RequestRow & { cursor_time: string }
    >(
      `SELECT *, created_at::text AS cursor_time FROM requests WHERE owner_id=$1 ${after ? 'AND (created_at,id) < ($3::timestamptz,$4::uuid)' : ''} ORDER BY created_at DESC,id DESC LIMIT $2`,
      after
        ? [ownerId, limit + 1, after.createdAt, after.requestId]
        : [ownerId, limit + 1],
    );
    const rows = result.rows.slice(0, limit);
    const last = rows.at(-1);
    return {
      items: rows.map((row) => ({
        requestId: row.id,
        status: row.status,
        createdAt: row.created_at,
      })),
      nextCursor:
        result.rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({
                createdAt: last.cursor_time,
                requestId: last.id,
              }),
            ).toString('base64url')
          : null,
    };
  }
  async get(ownerId: string, id: string) {
    const row = await this.row(ownerId, id);
    const commands = await this.processing.history(id);
    if (!row.fingerprint || row.audio_stored)
      return { ...this.view(row), commands };
    let stored: boolean | null = null;
    try {
      stored = await this.confirmAudio(row);
    } catch {
      /* Unknown is distinct from missing. */
    }
    return { ...this.view(row, stored), commands };
  }
  async retryProcessing(ownerId: string, id: string, body: unknown) {
    await this.row(ownerId, id);
    if (
      !body ||
      typeof body !== 'object' ||
      !('commandId' in body) ||
      typeof body.commandId !== 'string' ||
      !uuid.test(body.commandId)
    )
      throw new RequestError(
        400,
        'INVALID_COMMAND_ID',
        'Expected commandId of the previous attempt',
      );
    await this.processing.retry(id, body.commandId);
    return this.get(ownerId, id);
  }
  async complete(ownerId: string, id: string, audio?: ReceivedAudio) {
    try {
      return await this.locked(ownerId, id, async (client, row) => {
        if (audio && row.fingerprint && audio.fingerprint !== row.fingerprint)
          throw new RequestError(
            409,
            'AUDIO_CONTENT_CONFLICT',
            'Audio differs from the finalized recording',
            'none',
            id,
          );
        if (row.status === 'abandoned')
          throw new RequestError(
            409,
            'REQUEST_ALREADY_CLOSED',
            'Request was closed without processing',
            'none',
            id,
          );
        if (isClosed(row)) return { httpStatus: 200, body: this.view(row) };
        if (!row.fingerprint && !audio) throw this.uploadRequired(id);
        if (audio && !row.fingerprint) {
          row = await this.db.transaction(client, async () => {
            const result = await client.query<RequestRow>(
              "UPDATE requests SET manifest=$2, fingerprint=$3, audio_key=$4, status='saving', error=NULL, updated_at=now() WHERE id=$1 AND closed_at IS NULL RETURNING *",
              [
                id,
                JSON.stringify(audio.manifest),
                audio.fingerprint,
                `requests/${id}/input/audio.m4a`,
              ],
            );
            await this.event(client, id, 'audio_frozen', {
              fingerprint: audio.fingerprint,
            });
            return result.rows[0];
          });
        } else {
          await client.query(
            "UPDATE requests SET status='saving',error=NULL,updated_at=now() WHERE id=$1",
            [id],
          );
          row.status = 'saving';
          row.error = null;
        }
        await this.event(client, id, 'save_attempt');
        let stored = false;
        try {
          stored = await this.confirmAudio(row);
          if (!stored) {
            const sourcePath = await this.assemble(row, audio);
            await this.storage.uploadImmutable({
              sourcePath,
              objectKey: row.audio_key!,
              contentType: 'audio/mp4',
              metadata: {
                'request-id': id,
                'input-fingerprint': row.fingerprint!,
                'output-sha256': await fileHash(sourcePath),
              },
            });
            stored = await this.confirmAudio(row);
            if (!stored) throw this.unknown(id);
          }
          const completed = await this.db.transaction(client, async () => {
            const result = await client.query<RequestRow>(
              "UPDATE requests SET status='processing',audio_stored=true,closed_at=now(),updated_at=now(),error=NULL WHERE id=$1 AND closed_at IS NULL RETURNING *",
              [id],
            );
            if (!result.rows[0]) throw this.unknown(id);
            await client.query(
              'INSERT INTO processing_intents(request_id,source_audio_key) VALUES($1,$2) ON CONFLICT DO NOTHING',
              [id, row.audio_key],
            );
            await this.processing.create(client, id, row.audio_key!);
            await this.event(client, id, 'closed', { audioKey: row.audio_key });
            return result.rows[0];
          });
          await this.processing
            .kick(id)
            .catch(() => this.logger.warn(`Queue wakeup deferred: ${id}`));
          await rm(join(this.uploads.root, id), {
            recursive: true,
            force: true,
          }).catch(() =>
            this.logger.warn(`Temporary audio cleanup failed: ${id}`),
          );
          return { httpStatus: 200, body: this.view(completed) };
        } catch (error) {
          // A commit may have succeeded despite losing its response. Resolve through a fresh DB connection.
          let current: RequestRow;
          try {
            current = await this.row(ownerId, id);
          } catch {
            throw this.unknown(id);
          }
          if (isClosed(current))
            return { httpStatus: 200, body: this.view(current) };
          if (!stored) {
            try {
              stored = await this.confirmAudio(row);
            } catch {
              throw this.unknown(id);
            }
          }
          const apiError = stored
            ? new RequestError(
                503,
                'REQUEST_FINALIZATION_FAILED',
                'Audio is saved; retry closing without files',
                'complete_without_audio',
                id,
              )
            : error instanceof RequestError
              ? error
              : error instanceof HttpException && error.getStatus() === 422
                ? new RequestError(
                    422,
                    'AUDIO_DECODE_FAILED',
                    'Audio could not be decoded',
                    'none',
                    id,
                  )
                : new RequestError(
                    503,
                    'AUDIO_SAVE_FAILED',
                    'Audio save failed; retry using server staging',
                    'complete_without_audio',
                    id,
                  );
          const detail = (apiError.getResponse() as { error: ApiError }).error;
          try {
            await client.query(
              "UPDATE requests SET status='save_failed',audio_stored=$2,error=$3,updated_at=now() WHERE id=$1 AND closed_at IS NULL",
              [id, stored, JSON.stringify(detail)],
            );
            await this.event(client, id, 'save_failed', detail);
          } catch {
            throw this.unknown(id);
          }
          throw apiError;
        }
      });
    } finally {
      if (audio)
        await rm(audio.directory, { recursive: true, force: true }).catch(
          () => undefined,
        );
    }
  }
  async abandon(ownerId: string, id: string, reason?: string) {
    if (
      reason !== undefined &&
      (typeof reason !== 'string' || reason.length > 1000)
    )
      throw new RequestError(
        400,
        'INVALID_REASON',
        'Reason must contain at most 1000 characters',
      );
    return this.locked(ownerId, id, async (client, row) => {
      if (row.status === 'abandoned')
        return { httpStatus: 200, body: this.view(row) };
      if (isClosed(row))
        throw new RequestError(
          409,
          'REQUEST_ALREADY_CLOSED',
          'Request already closed successfully',
          'none',
          id,
        );
      const result = await this.db.transaction(client, async () => {
        const updated = await client.query<RequestRow>(
          "UPDATE requests SET status='abandoned',closed_at=now(),updated_at=now(),abandon_reason=$2 WHERE id=$1 AND closed_at IS NULL RETURNING *",
          [id, reason ?? null],
        );
        await this.event(client, id, 'abandoned', { reason: reason ?? null });
        return updated.rows[0];
      });
      return { httpStatus: 200, body: this.view(result) };
    });
  }
  async report(ownerId: string, id: string) {
    const row = await this.row(ownerId, id);
    if (row.status === 'processing_failed')
      throw new RequestError(
        409,
        'REPORT_FAILED',
        'Report processing failed',
        'none',
        id,
      );
    if (row.status !== 'completed' || !row.report_key || !row.report_sha256)
      throw new RequestError(
        409,
        'REPORT_NOT_READY',
        'Report is not ready',
        'check_status',
        id,
      );
    if (
      !row.report_key.startsWith(`requests/${id}/full-pipeline/`) ||
      !row.report_key.endsWith('/clinical_document.md')
    )
      throw this.unknown(id);
    const content = await this.storage.readText(
      row.report_key,
      16 * 1024 * 1024,
    );
    if (
      createHash('sha256').update(content).digest('hex') !== row.report_sha256
    )
      throw new RequestError(
        502,
        'REPORT_INTEGRITY_FAILED',
        'Report checksum does not match',
        'none',
        id,
      );
    return { requestId: id, format: 'markdown', schemaVersion: 1, content };
  }
  private async assemble(row: RequestRow, audio?: ReceivedAudio) {
    const directory = join(this.uploads.root, row.id);
    await mkdir(directory, { recursive: true });
    const output = join(directory, 'audio.m4a');
    if ((await stat(output).catch(() => undefined))?.size) return output;
    if (!row.manifest) throw this.uploadRequired(row.id);
    const parts: string[] = [];
    for (const [index, part] of row.manifest.parts.entries()) {
      const path = join(directory, `part-${part.partNo}`);
      if (audio) {
        const temporary = `${path}.${randomUUID()}.part`;
        await copyFile(audio.paths[index], temporary, constants.COPYFILE_EXCL);
        await rename(temporary, path);
      }
      if (
        !(await stat(path).catch(() => undefined)) ||
        (await fileHash(path)) !== part.sha256
      )
        throw this.uploadRequired(row.id);
      parts.push(path);
    }
    const temporary = join(directory, `${randomUUID()}.part.m4a`);
    try {
      await this.encoder.encodeToM4a(parts, temporary);
      await rename(temporary, output);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return output;
  }
  private async confirmAudio(row: RequestRow) {
    if (!row.audio_key || !row.fingerprint) return false;
    const object = await this.storage.headObject(row.audio_key);
    if (!object) return false;
    if (
      object.metadata['input-fingerprint'] !== row.fingerprint ||
      object.metadata['request-id'] !== row.id ||
      !/^[a-f0-9]{64}$/.test(object.metadata['output-sha256'] ?? '') ||
      object.bytes < 1
    )
      throw new RequestError(
        409,
        'AUDIO_CONTENT_CONFLICT',
        'Stored audio does not match request',
        'none',
        row.id,
      );
    return true;
  }
  private async locked<T>(
    ownerId: string,
    id: string,
    work: (client: PoolClient, row: RequestRow) => Promise<T>,
  ): Promise<
    T | { httpStatus: number; body: ReturnType<RequestsService['view']> }
  > {
    this.validateId(id);
    const client = await this.db.pool.connect();
    let acquired = false;
    let broken = false;
    const onError = () => {
      broken = true;
    };
    client.on('error', onError);
    try {
      acquired = (
        await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired',
          [`request:${id}`],
        )
      ).rows[0].acquired;
      const row = await this.row(ownerId, id, client);
      if (!acquired) return { httpStatus: 202, body: this.view(row) };
      return await work(client, row);
    } finally {
      if (acquired && !broken)
        await client
          .query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
            `request:${id}`,
          ])
          .catch(() => {
            broken = true;
          });
      client.removeListener('error', onError);
      client.release(broken);
    }
  }
  private async row(
    ownerId: string,
    id: string,
    client?: PoolClient,
  ): Promise<RequestRow> {
    this.validateId(id);
    const result = await (client ?? this.db.pool).query<RequestRow>(
      'SELECT * FROM requests WHERE id=$1 AND owner_id=$2',
      [id, ownerId],
    );
    if (!result.rows[0])
      throw new RequestError(
        404,
        'REQUEST_NOT_FOUND',
        'Request not found',
        'none',
        id,
      );
    return result.rows[0];
  }
  private view(
    row: RequestRow,
    audioStored: boolean | null = row.audio_stored,
  ) {
    return {
      requestId: row.id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      audioStored,
      error: row.error,
      closedAt: row.closed_at,
      abandonReason: row.abandon_reason,
    };
  }
  private event(
    client: PoolClient,
    id: string,
    type: string,
    details: object = {},
  ) {
    return client.query(
      'INSERT INTO request_events(request_id,type,details) VALUES($1,$2,$3)',
      [id, type, JSON.stringify(details)],
    );
  }
  private uploadRequired(id: string) {
    return new RequestError(
      409,
      'AUDIO_UPLOAD_REQUIRED',
      'Original audio files are required',
      'upload_audio',
      id,
    );
  }
  private unknown(id?: string) {
    return new RequestError(
      503,
      'REQUEST_STATE_UNKNOWN',
      'Request state is temporarily unknown; check status',
      'check_status',
      id,
    );
  }
}
