import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { RequestDatabase } from '../requests/request-database.service';
import { RequestError } from '../requests/request.types';
import { OBJECT_STORAGE } from '../object-storage/object-storage.types';
import type { DurableObjectStorage } from '../object-storage/object-storage.types';
import { InferenceClient } from './inference-client';
import { ProcessingQueue } from './processing-queue';
import { POLL_MS, PROCESS_TIMEOUT_MS } from './processing.types';
import type { CommandRow, ProcessSnapshot } from './processing.types';

@Injectable()
export class ProcessingService {
  private readonly logger = new Logger(ProcessingService.name);
  constructor(
    private readonly db: RequestDatabase,
    private readonly config: ConfigService,
    private readonly inference: InferenceClient,
    private readonly queue: ProcessingQueue,
    @Inject(OBJECT_STORAGE) private readonly storage: DurableObjectStorage,
  ) {}
  // Called inside the transaction that closes a visit. Redis is never part of that transaction.
  async create(
    client: PoolClient,
    requestId: string,
    audioKey: string,
    parameters?: CommandRow['parameters'],
  ) {
    const commandId = randomUUID();
    const result = await client.query<CommandRow>(
      `INSERT INTO processing_commands(command_id,request_id,source_audio_key,parameters,status,next_action_at)
       VALUES($1,$2,$3,$4,'pending',now()) RETURNING *`,
      [
        commandId,
        requestId,
        audioKey,
        JSON.stringify(
          parameters ?? {
            encounterId: requestId,
            specialty: this.config.get<string>('INFERENCE_SPECIALTY', ''),
            llmBackend: this.config.get<string>(
              'INFERENCE_LLM_BACKEND',
              'LOCAL',
            ),
          },
        ),
      ],
    );
    await client.query(
      "UPDATE processing_intents SET command_id=$2,status='pending' WHERE request_id=$1",
      [requestId, commandId],
    );
    await this.event(client, result.rows[0], 'processing_command_created');
    return result.rows[0];
  }
  async kick(requestId: string) {
    const command = (
      await this.db.pool.query<CommandRow>(
        'SELECT c.* FROM processing_commands c JOIN processing_intents i ON i.command_id=c.command_id WHERE i.request_id=$1',
        [requestId],
      )
    ).rows[0];
    if (command) await this.queue.publish(command);
  }
  async history(requestId: string) {
    const rows = (
      await this.db.pool.query<CommandRow>(
        'SELECT * FROM processing_commands WHERE request_id=$1 ORDER BY created_at DESC,command_id DESC',
        [requestId],
      )
    ).rows;
    return rows.map((c) => ({
      commandId: c.command_id,
      status: c.status,
      remoteStatus: c.remote_status,
      currentStage: c.snapshot?.currentStage ?? null,
      stages: c.snapshot?.stages ?? [],
      error: c.error,
      createdAt: c.created_at,
      firstSentAt: c.first_sent_at,
      deadlineAt: c.deadline_at,
      finishedAt: c.finished_at,
    }));
  }
  // Runs on startup and every minute. An absent Redis database cannot lose the durable work.
  async reconcile() {
    const client = await this.db.pool.connect();
    try {
      await this.db.transaction(client, async () => {
        const legacy = await client.query<{
          request_id: string;
          source_audio_key: string;
        }>(
          `SELECT i.request_id,i.source_audio_key FROM processing_intents i JOIN requests r ON r.id=i.request_id
           WHERE i.command_id IS NULL AND r.status='processing' FOR UPDATE OF i SKIP LOCKED LIMIT 100`,
        );
        for (const row of legacy.rows)
          await this.create(client, row.request_id, row.source_audio_key);
      });
    } finally {
      client.release();
    }
    // Page by ID so one unavailable queue cannot starve later commands.
    let cursor = '00000000-0000-0000-0000-000000000000';
    while (true) {
      const rows = (
        await this.db.pool.query<CommandRow>(
          `SELECT * FROM processing_commands WHERE next_action_at IS NOT NULL AND command_id>$1
         ORDER BY command_id LIMIT 100`,
          [cursor],
        )
      ).rows;
      for (const row of rows) await this.queue.publish(row);
      if (rows.length < 100) return;
      cursor = rows[rows.length - 1].command_id;
    }
  }
  async advance(commandId: string) {
    await this.locked(commandId, async (client, command) => {
      if (!['pending', 'polling'].includes(command.status)) return;
      if (
        command.next_action_at &&
        command.next_action_at.getTime() > Date.now() + 50
      ) {
        await this.queue.publish(command);
        return;
      }
      if (command.deadline_at && Date.now() >= command.deadline_at.getTime()) {
        await this.fail(
          client,
          command,
          'PROCESSING_TIMEOUT',
          'Не удалось получить отчёт за 5 минут. Выполнение GPU могло продолжиться.',
          true,
        );
        return;
      }
      if (!command.first_sent_at) {
        command = (
          await client.query<CommandRow>(
            `UPDATE processing_commands SET first_sent_at=clock_timestamp(),
           deadline_at=clock_timestamp()+($2 * interval '1 millisecond') WHERE command_id=$1 RETURNING *`,
            [commandId, PROCESS_TIMEOUT_MS],
          )
        ).rows[0];
      }
      const deadline = new Date(
        Math.min(Date.now() + 10000, command.deadline_at!.getTime()),
      );
      try {
        if (command.status === 'pending') {
          await this.inference.start(command, deadline);
          command.status = 'polling';
          command.error = null;
          await this.reschedule(client, command, 'processing_command_accepted');
        } else {
          const snapshot = await this.inference.get(commandId, deadline);
          this.validateSnapshot(command, snapshot);
          command.error = null;
          const changed =
            snapshot.status !== command.remote_status ||
            snapshot.currentStage !== command.snapshot?.currentStage;
          command.remote_status = snapshot.status;
          command.snapshot = snapshot;
          if (snapshot.status === 'PROCESS_SUCCEEDED') {
            await this.finish(client, command, snapshot);
            return;
          }
          if (['PROCESS_FAILED', 'PROCESS_LOST'].includes(snapshot.status)) {
            await this.fail(
              client,
              command,
              snapshot.error?.code || snapshot.status,
              snapshot.error?.message || 'Обработка завершилась с ошибкой',
            );
            return;
          }
          await this.reschedule(
            client,
            command,
            changed ? 'processing_progress' : undefined,
          );
        }
      } catch (error) {
        if (error instanceof RequestError) {
          await this.fail(
            client,
            command,
            'REPORT_INTEGRITY_FAILED',
            'Не удалось подтвердить целостность результата',
          );
        } else if (
          command.status === 'pending' &&
          [3, 6, 9].includes((error as { code?: number }).code ?? -1)
        ) {
          await this.fail(
            client,
            command,
            'COMMAND_REJECTED',
            'GPU-сервис отклонил параметры команды',
          );
        } else {
          const transportError = error as {
            code?: number;
            details?: string;
            message?: string;
          };
          this.logger.warn(
            `processing_transport_error: requestId=${command.request_id} commandId=${command.command_id} code=${transportError.code ?? 'unknown'} reason=${transportError.details ?? transportError.message ?? 'unknown'}`,
          );
          const outageStarted =
            command.error?.code !== 'PROCESSING_STATE_UNKNOWN';
          command.error = {
            code: 'PROCESSING_STATE_UNKNOWN',
            message: 'Сервис обработки или хранилище временно недоступны',
          };
          await this.reschedule(
            client,
            command,
            outageStarted ? 'processing_state_unknown' : undefined,
          );
        }
      }
      await this.queue.publish(command);
    });
  }
  // The HTTP caller must specify the command it saw, making duplicate retry requests harmless.
  async retry(requestId: string, expectedCommandId: string) {
    const active = (
      await this.db.pool.query<{ command_id: string }>(
        'SELECT command_id FROM processing_intents WHERE request_id=$1',
        [requestId],
      )
    ).rows[0];
    if (!active?.command_id)
      throw new RequestError(
        409,
        'PROCESSING_NOT_STARTED',
        'Нет команды для повтора',
      );
    if (active.command_id !== expectedCommandId) return;
    await this.locked(expectedCommandId, async (client, command) => {
      if (command.request_id !== requestId)
        throw new RequestError(
          409,
          'COMMAND_CONFLICT',
          'Команда не относится к приёму',
        );
      if (['pending', 'polling', 'succeeded'].includes(command.status)) return;
      let snapshot: ProcessSnapshot;
      try {
        snapshot = await this.inference.get(
          command.command_id,
          new Date(Date.now() + 10000),
        );
        this.validateSnapshot(command, snapshot);
      } catch {
        throw new RequestError(
          503,
          'PROCESSING_STATE_UNKNOWN',
          'Состояние прежней команды неизвестно. Новый запуск пока запрещён.',
        );
      }
      command.remote_status = snapshot.status;
      command.snapshot = snapshot;
      // Persist the last observed state even when retry is refused.
      await client.query(
        'UPDATE processing_commands SET snapshot=$2,remote_status=$3 WHERE command_id=$1',
        [command.command_id, JSON.stringify(snapshot), snapshot.status],
      );
      if (snapshot.status === 'PROCESS_SUCCEEDED') {
        await this.finish(client, command, snapshot);
        return;
      }
      if (snapshot.status !== 'PROCESS_FAILED') {
        throw new RequestError(
          409,
          snapshot.status === 'PROCESS_LOST'
            ? 'PROCESS_LOST_UNCONFIRMED'
            : 'PROCESS_STILL_RUNNING',
          snapshot.status === 'PROCESS_LOST'
            ? 'Потеря heartbeat не подтверждает остановку GPU. Новый запуск требует проверки.'
            : 'Прежняя команда ещё выполняется. Повторите проверку позже.',
        );
      }
      const created = await this.db.transaction(client, async () => {
        const intent = (
          await client.query<{ command_id: string }>(
            'SELECT command_id FROM processing_intents WHERE request_id=$1 FOR UPDATE',
            [requestId],
          )
        ).rows[0];
        if (intent.command_id !== command.command_id) return;
        const next = await this.create(
          client,
          requestId,
          command.source_audio_key,
          command.parameters,
        );
        await client.query(
          "UPDATE requests SET status='processing',error=NULL,updated_at=now() WHERE id=$1",
          [requestId],
        );
        return next;
      });
      if (created) await this.queue.publish(created);
    });
  }
  private validateSnapshot(command: CommandRow, value: ProcessSnapshot) {
    if (
      value.commandId !== command.command_id ||
      value.requestId !== command.request_id ||
      ![
        'PROCESS_QUEUED',
        'PROCESS_RUNNING',
        'PROCESS_SUCCEEDED',
        'PROCESS_FAILED',
        'PROCESS_LOST',
      ].includes(value.status)
    )
      throw new Error('Invalid inference status response');
  }
  private async reschedule(
    client: PoolClient,
    command: CommandRow,
    event?: string,
  ) {
    command.next_action_at = new Date(
      Math.min(Date.now() + POLL_MS, command.deadline_at!.getTime()),
    );
    command.revision += 1;
    await this.db.transaction(client, async () => {
      await client.query(
        `UPDATE processing_commands SET status=$2,next_action_at=$3,revision=$4,
        remote_status=$5,snapshot=$6,error=$7 WHERE command_id=$1`,
        [
          command.command_id,
          command.status,
          command.next_action_at,
          command.revision,
          command.remote_status,
          JSON.stringify(command.snapshot),
          JSON.stringify(command.error),
        ],
      );
      if (event) await this.event(client, command, event);
    });
  }
  private async fail(
    client: PoolClient,
    command: CommandRow,
    code: string,
    message: string,
    timeout = false,
  ) {
    await this.db.transaction(client, async () => {
      await client.query(
        `UPDATE processing_commands SET status=$2,error=$3,snapshot=$4,remote_status=$5,
        next_action_at=NULL,finished_at=now() WHERE command_id=$1`,
        [
          command.command_id,
          timeout ? 'timed_out' : 'failed',
          JSON.stringify({ code, message }),
          JSON.stringify(command.snapshot),
          command.remote_status,
        ],
      );
      await client.query(
        `UPDATE requests SET status='processing_failed',error=$3,updated_at=now()
        WHERE id=$1 AND EXISTS(SELECT 1 FROM processing_intents WHERE request_id=$1 AND command_id=$2)`,
        [
          command.request_id,
          command.command_id,
          JSON.stringify({ code, message, retryAction: 'none' }),
        ],
      );
      await client.query(
        "UPDATE processing_intents SET status='failed' WHERE command_id=$1",
        [command.command_id],
      );
      await this.event(client, command, code);
    });
  }
  private async finish(
    client: PoolClient,
    command: CommandRow,
    snapshot: ProcessSnapshot,
  ) {
    const prefix = `requests/${command.request_id}/full-pipeline/${command.command_id}/`;
    const invalid = () =>
      new RequestError(
        502,
        'REPORT_INTEGRITY_FAILED',
        'Invalid report manifest',
      );
    if (snapshot.resultKey !== `${prefix}stage-result.json`) throw invalid();
    const manifest = JSON.parse(
      await this.storage.readText(snapshot.resultKey, 1024 * 1024),
    ) as {
      schemaVersion?: string;
      artifacts?: { name: string; key: string; sha256: string }[];
    };
    if (
      manifest.schemaVersion !== 'stage-result-v1' ||
      !Array.isArray(manifest.artifacts)
    )
      throw invalid();
    const reports = manifest.artifacts.filter(
      (a) => a.name === 'clinical_document.md',
    );
    if (reports.length !== 1) throw invalid();
    const artifact = reports[0];
    if (
      artifact.key !== `${prefix}clinical_document.md` ||
      !/^[a-f0-9]{64}$/.test(artifact.sha256)
    )
      throw invalid();
    const document = await this.storage.readText(
      artifact.key,
      16 * 1024 * 1024,
    );
    if (
      !document.trim() ||
      createHash('sha256').update(document).digest('hex') !== artifact.sha256
    )
      throw invalid();
    await this.db.transaction(client, async () => {
      await client.query(
        `UPDATE processing_commands SET status='succeeded',snapshot=$2,remote_status='PROCESS_SUCCEEDED',
        error=NULL,next_action_at=NULL,finished_at=now() WHERE command_id=$1`,
        [command.command_id, JSON.stringify(snapshot)],
      );
      await client.query(
        `UPDATE requests SET status='completed',report_key=$3,report_sha256=$4,error=NULL,updated_at=now()
        WHERE id=$1 AND EXISTS(SELECT 1 FROM processing_intents WHERE request_id=$1 AND command_id=$2)`,
        [command.request_id, command.command_id, artifact.key, artifact.sha256],
      );
      await client.query(
        "UPDATE processing_intents SET status='completed' WHERE command_id=$1",
        [command.command_id],
      );
      await this.event(client, command, 'report_completed');
    });
  }
  private async event(client: PoolClient, command: CommandRow, type: string) {
    await client.query(
      'INSERT INTO request_events(request_id,type,details) VALUES($1,$2,$3)',
      [
        command.request_id,
        type,
        JSON.stringify({
          commandId: command.command_id,
          remoteStatus: command.remote_status,
          currentStage: command.snapshot?.currentStage,
        }),
      ],
    );
    this.logger.log(
      `${type}: requestId=${command.request_id} commandId=${command.command_id}`,
    );
  }
  private async locked(
    id: string,
    work: (client: PoolClient, command: CommandRow) => Promise<void>,
  ) {
    const client = await this.db.pool.connect();
    let locked = false;
    let broken = false;
    const onError = () => {
      broken = true;
    };
    client.on('error', onError);
    try {
      locked = (
        await client.query<{ locked: boolean }>(
          'SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',
          [`command:${id}`],
        )
      ).rows[0].locked;
      if (!locked) return;
      const command = (
        await client.query<CommandRow>(
          'SELECT * FROM processing_commands WHERE command_id=$1',
          [id],
        )
      ).rows[0];
      if (command) await work(client, command);
    } finally {
      if (locked && !broken)
        await client
          .query('SELECT pg_advisory_unlock(hashtextextended($1,0))', [
            `command:${id}`,
          ])
          .catch(() => {
            broken = true;
          });
      client.removeListener('error', onError);
      client.release(broken);
    }
  }
}
