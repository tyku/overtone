import { Injectable } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { RecordingStorageService } from './recording-storage.service';
import { RecordingTransferService } from './recording-transfer.service';
import { RecordingSaved, RecordingUploadMetadata } from './recording.types';

@Injectable()
export class RecordingUploadService {
  constructor(
    private readonly localStorage: RecordingStorageService,
    private readonly transfer: RecordingTransferService,
  ) {}

  get maxUploadBytes() {
    return this.localStorage.maxUploadBytes;
  }

  validateId(value: string | undefined, field: string) {
    return this.localStorage.validateId(value, field);
  }

  validateSegmentNo(value: string | undefined) {
    return this.localStorage.validateSegmentNo(value);
  }

  validateMimeType(value: string | undefined) {
    return this.localStorage.validateMimeType(value);
  }

  async save(
    source: Readable,
    metadata: RecordingUploadMetadata,
  ): Promise<RecordingSaved> {
    const local = await this.localStorage.save(source, metadata);
    if (!local.finalized) return local;

    const stored = await this.transfer.moveToObjectStorage({
      localPath: local.finalized.localPath,
      extension: local.finalized.extension,
      metadata,
    });
    return {
      sessionId: local.sessionId,
      recordingId: local.recordingId,
      segmentNo: local.segmentNo,
      bytes: local.bytes,
      fileName: local.fileName,
      alreadyExisted: local.alreadyExisted,
      finalFileName: stored.objectKey,
      finalBytes: stored.bytes,
      s3Bucket: stored.bucket,
      s3ObjectKey: stored.objectKey,
    };
  }
}
