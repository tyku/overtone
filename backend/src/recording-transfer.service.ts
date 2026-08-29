import { Inject, Injectable, Logger } from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { OBJECT_STORAGE } from './object-storage/object-storage.types';
import type {
  ObjectStorage,
  StoredObject,
} from './object-storage/object-storage.types';
import { RecordingUploadMetadata } from './recording.types';

export type RecordingTransferInput = {
  localPath: string;
  extension: string;
  metadata: RecordingUploadMetadata;
};

@Injectable()
export class RecordingTransferService {
  private readonly logger = new Logger(RecordingTransferService.name);
  private readonly transfers = new Map<string, Promise<StoredObject>>();

  constructor(
    @Inject(OBJECT_STORAGE) private readonly objectStorage: ObjectStorage,
  ) {}

  async moveToObjectStorage(
    input: RecordingTransferInput,
  ): Promise<StoredObject> {
    const objectKey = this.objectKey(input);
    const active = this.transfers.get(objectKey);
    if (active) return active;

    const pending = this.performMove(input, objectKey).finally(() =>
      this.transfers.delete(objectKey),
    );
    this.transfers.set(objectKey, pending);
    return pending;
  }

  private async performMove(
    input: RecordingTransferInput,
    objectKey: string,
  ): Promise<StoredObject> {
    const stored = await this.objectStorage.uploadFile({
      sourcePath: input.localPath,
      objectKey,
      contentType: input.metadata.mimeType,
      metadata: {
        'session-id': input.metadata.sessionId,
        'recording-id': input.metadata.recordingId,
      },
    });

    await unlink(input.localPath);
    this.logger.log(
      `Recording moved to S3: bucket=${stored.bucket} key=${stored.objectKey} bytes=${stored.bytes}`,
    );
    return stored;
  }

  private objectKey(input: RecordingTransferInput) {
    return `requests/${input.metadata.sessionId}/input/${input.metadata.recordingId}.${input.extension}`;
  }
}
