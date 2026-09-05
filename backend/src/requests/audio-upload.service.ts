import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import busboy from 'busboy';
import type { Request } from 'express';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { AudioManifest, RequestError } from './request.types';

export type ReceivedAudio = {
  directory: string;
  manifest: AudioManifest;
  fingerprint: string;
  paths: string[];
};
export async function fileHash(path: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return hash.digest('hex');
}
@Injectable()
export class AudioUploadService {
  readonly root: string;
  readonly maxBytes: number;
  readonly maxParts: number;
  constructor(config: ConfigService) {
    this.root = resolve(
      config.get<string>('RECORDINGS_DIR', 'recordings'),
      'requests',
    );
    this.maxBytes = Number(config.get('MAX_UPLOAD_BYTES', 1024 * 1024 * 1024));
    this.maxParts = Number(config.get('MAX_AUDIO_PARTS', 1000));
    if (
      !Number.isSafeInteger(this.maxBytes) ||
      this.maxBytes < 1 ||
      !Number.isSafeInteger(this.maxParts) ||
      this.maxParts < 1
    )
      throw new Error('Invalid upload limits');
  }
  async receive(request: Request): Promise<ReceivedAudio | undefined> {
    if (request.is('application/json')) {
      if (
        !request.body ||
        typeof request.body !== 'object' ||
        Array.isArray(request.body) ||
        Object.keys(request.body as object).length
      )
        throw new RequestError(
          400,
          'INVALID_REQUEST',
          'Expected an empty JSON object',
        );
      return undefined;
    }
    if (!request.is('multipart/form-data'))
      throw new RequestError(
        415,
        'UNSUPPORTED_CONTENT_TYPE',
        'Expected multipart/form-data or application/json',
      );
    await mkdir(this.root, { recursive: true });
    const directory = await mkdtemp(join(this.root, '.upload-'));
    const files = new Map<
      string,
      { path: string; bytes: number; sha256: string }
    >();
    const writes: Promise<void>[] = [];
    let manifestText = '';
    let failure: Error | undefined;
    let totalBytes = 0;
    const fail = (error: Error) => {
      failure ??= error;
    };
    try {
      const parser = busboy({
        headers: request.headers,
        limits: {
          files: this.maxParts,
          fields: 1,
          fieldSize: 1024 * 1024,
          fileSize: this.maxBytes,
          parts: this.maxParts + 1,
        },
      });
      parser.on('field', (name, value, info) => {
        if (name !== 'manifest' || manifestText || info.valueTruncated)
          fail(
            new RequestError(
              400,
              'INVALID_MANIFEST',
              'Expected one manifest field',
            ),
          );
        manifestText = value;
      });
      parser.on('file', (name, source) => {
        if (files.has(name) || !/^part_[1-9][0-9]*$/.test(name)) {
          fail(
            new RequestError(
              400,
              'INVALID_MANIFEST',
              'Invalid or duplicate audio field',
            ),
          );
          source.resume();
          return;
        }
        const file = {
          path: join(directory, String(files.size + 1)),
          bytes: 0,
          sha256: '',
        };
        files.set(name, file);
        const hash = createHash('sha256');
        source.on('limit', () =>
          fail(
            new RequestError(
              413,
              'UPLOAD_TOO_LARGE',
              'Audio upload exceeds configured limit',
            ),
          ),
        );
        const meter = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            file.bytes += chunk.length;
            totalBytes += chunk.length;
            hash.update(chunk);
            if (totalBytes > thisLimit) {
              fail(
                new RequestError(
                  413,
                  'UPLOAD_TOO_LARGE',
                  'Audio upload exceeds configured limit',
                ),
              );
              callback(null);
            } else callback(null, chunk);
          },
        });
        const thisLimit = this.maxBytes;
        const write = pipeline(
          source,
          meter,
          createWriteStream(file.path, { flags: 'wx' }),
        )
          .then(() => {
            file.sha256 = hash.digest('hex');
          })
          .catch((error: Error) => fail(error));
        writes.push(write);
      });
      for (const event of ['filesLimit', 'fieldsLimit', 'partsLimit'] as const)
        parser.on(event, () =>
          fail(
            new RequestError(
              413,
              'UPLOAD_TOO_LARGE',
              'Too many multipart fields',
            ),
          ),
        );
      // pipeline propagates disconnects and destroys the parser, then its file streams.
      await pipeline(request, parser);
      await Promise.all(writes);
      if (failure) throw failure;
      let parsed: unknown;
      try {
        parsed = JSON.parse(manifestText);
      } catch {
        throw new RequestError(
          400,
          'INVALID_MANIFEST',
          'Invalid JSON manifest',
        );
      }
      const manifest = validateManifest(parsed, this.maxParts);
      if (files.size !== manifest.parts.length)
        throw new RequestError(
          400,
          'INVALID_MANIFEST',
          'Manifest does not match uploaded files',
        );
      const paths = manifest.parts.map((part) => {
        const file = files.get(part.field);
        if (!file || file.bytes !== part.bytes || file.sha256 !== part.sha256)
          throw new RequestError(
            422,
            'AUDIO_INTEGRITY_FAILED',
            'Audio does not match manifest',
          );
        return file.path;
      });
      const fingerprint = createHash('sha256')
        .update(JSON.stringify(manifest))
        .digest('hex');
      return { directory, manifest, fingerprint, paths };
    } catch (error) {
      await Promise.allSettled(writes);
      await rm(directory, { recursive: true, force: true });
      throw error instanceof RequestError
        ? error
        : new RequestError(
            400,
            'UPLOAD_INTERRUPTED',
            'Audio upload was interrupted',
            'upload_audio',
          );
    }
  }
}
export function validateManifest(value: unknown, limit: number): AudioManifest {
  const invalid = () =>
    new RequestError(400, 'INVALID_MANIFEST', 'Invalid audio manifest');
  if (
    !value ||
    typeof value !== 'object' ||
    !('parts' in value) ||
    !Array.isArray(value.parts) ||
    !value.parts.length ||
    value.parts.length > limit
  )
    throw invalid();
  return {
    parts: value.parts.map((part: unknown, index: number) => {
      if (!part || typeof part !== 'object') throw invalid();
      const p = part as Record<string, unknown>;
      if (
        p.partNo !== index + 1 ||
        p.field !== `part_${index + 1}` ||
        typeof p.mimeType !== 'string' ||
        !['audio/webm', 'audio/ogg', 'audio/mp4'].includes(
          p.mimeType.toLowerCase().split(';')[0].trim(),
        ) ||
        !Number.isSafeInteger(p.bytes) ||
        (p.bytes as number) < 1 ||
        typeof p.sha256 !== 'string' ||
        !/^[a-f0-9]{64}$/.test(p.sha256)
      )
        throw invalid();
      return {
        partNo: index + 1,
        field: p.field,
        mimeType: p.mimeType.toLowerCase(),
        bytes: p.bytes as number,
        sha256: p.sha256,
      };
    }),
  };
}
