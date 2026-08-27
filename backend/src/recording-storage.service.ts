import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { link, mkdir, open, stat, unlink } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { RecordingSaved, RecordingUploadMetadata } from './recording.types';

@Injectable()
export class RecordingStorageService implements OnModuleInit {
  readonly maxUploadBytes = 100 * 1024 * 1024;
  private readonly logger = new Logger(RecordingStorageService.name);
  private readonly recordingsDir = join(process.cwd(), 'recordings');

  async onModuleInit() {
    await mkdir(this.recordingsDir, { recursive: true });
    this.logger.log(`Recording storage ready: ${this.recordingsDir}`);
  }

  async save(
    source: Readable,
    metadata: RecordingUploadMetadata,
  ): Promise<RecordingSaved> {
    const extension = this.extensionFor(metadata.mimeType);
    const sessionDir = join(this.recordingsDir, metadata.sessionId);
    const fileName = `${metadata.recordingId}.segment-${String(metadata.segmentNo).padStart(4, '0')}.${extension}`;
    const finalPath = join(sessionDir, fileName);
    const temporaryPath = join(sessionDir, `${fileName}.${randomUUID()}.part`);
    await mkdir(sessionDir, { recursive: true });

    const handle = await open(temporaryPath, 'wx');
    let bytes = 0;
    try {
      for await (const chunk of source) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > this.maxUploadBytes) {
          throw new PayloadTooLargeException(
            `Recording segment exceeds ${this.maxUploadBytes} bytes`,
          );
        }
        await handle.write(buffer);
      }
      if (bytes === 0) throw new BadRequestException('Audio payload is empty');
      await handle.sync();
      await handle.close();

      let alreadyExisted = false;
      try {
        await link(temporaryPath, finalPath);
      } catch (error) {
        if (!this.isFileExistsError(error)) throw error;
        alreadyExisted = true;
      }
      const saved = await stat(finalPath);
      this.logger.log(
        `Recording segment saved: session=${metadata.sessionId} recording=${metadata.recordingId} segment=${metadata.segmentNo} bytes=${saved.size} complete=${metadata.recordingComplete} existing=${alreadyExisted}`,
      );
      return {
        sessionId: metadata.sessionId,
        recordingId: metadata.recordingId,
        segmentNo: metadata.segmentNo,
        bytes: saved.size,
        fileName: relative(this.recordingsDir, finalPath),
        alreadyExisted,
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    } finally {
      await unlink(temporaryPath).catch(() => undefined);
    }
  }

  validateId(value: string | undefined, field: string) {
    if (!value || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) {
      throw new BadRequestException(`Invalid ${field}`);
    }
    return value;
  }

  validateSegmentNo(value: string | undefined) {
    const segmentNo = Number(value);
    if (
      !Number.isSafeInteger(segmentNo) ||
      segmentNo < 1 ||
      segmentNo > 10_000
    ) {
      throw new BadRequestException('Invalid segment number');
    }
    return segmentNo;
  }

  validateMimeType(value: string | undefined) {
    if (!value) throw new BadRequestException('Content-Type is required');
    this.extensionFor(value);
    return value;
  }

  private extensionFor(mimeType: string) {
    switch (mimeType.toLowerCase().split(';', 1)[0].trim()) {
      case 'audio/webm':
        return 'webm';
      case 'audio/ogg':
        return 'ogg';
      case 'audio/mp4':
        return 'm4a';
      default:
        throw new BadRequestException(`Unsupported audio type: ${mimeType}`);
    }
  }

  private isFileExistsError(error: unknown) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EEXIST'
    );
  }
}
