import {
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import {
  ObjectStorage,
  ObjectStorageUpload,
  StoredObject,
} from './object-storage.types';
import { S3_STORAGE_CONFIG } from './s3-storage.config';
import type { S3StorageConfig } from './s3-storage.config';

export type S3CommandClient = Pick<S3Client, 'send'>;

@Injectable()
export class S3ObjectStorageProvider implements ObjectStorage, OnModuleInit {
  private readonly logger = new Logger(S3ObjectStorageProvider.name);

  constructor(
    @Inject(S3_STORAGE_CONFIG) private readonly config: S3StorageConfig,
    private readonly client: S3Client,
  ) {}

  async onModuleInit() {
    try {
      await this.client.send(
        new HeadBucketCommand({ Bucket: this.config.bucket }),
      );
    } catch (error) {
      throw new Error(
        `Configured S3 bucket is unavailable: ${this.config.bucket}`,
        { cause: error },
      );
    }
    this.logger.log(`S3 storage ready: bucket=${this.config.bucket}`);
  }

  async uploadFile(upload: ObjectStorageUpload): Promise<StoredObject> {
    this.validateObjectKey(upload.objectKey);
    const source = await stat(upload.sourcePath);
    try {
      const result = await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: upload.objectKey,
          Body: createReadStream(upload.sourcePath),
          ContentLength: source.size,
          ContentType: upload.contentType,
          Metadata: upload.metadata,
        }),
      );
      return {
        bucket: this.config.bucket,
        objectKey: upload.objectKey,
        bytes: source.size,
        etag: result.ETag?.replaceAll('"', ''),
      };
    } catch (error) {
      throw new Error(`Cannot upload recording to S3: ${upload.objectKey}`, {
        cause: error,
      });
    }
  }

  private validateObjectKey(key: string) {
    if (
      !key ||
      key.startsWith('/') ||
      key.includes('\\') ||
      key.split('/').includes('..')
    ) {
      throw new Error('S3 object key must be a safe relative key');
    }
  }
}
