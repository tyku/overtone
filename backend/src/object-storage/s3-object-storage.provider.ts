import {
  HeadBucketCommand,
  HeadObjectCommand,
  GetObjectCommand,
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
    } catch {
      this.logger.warn(
        `Configured S3 bucket is unavailable: ${this.config.bucket}; request history and force-close remain available`,
      );
      return;
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

  async headObject(objectKey: string) {
    this.validateObjectKey(objectKey);
    try {
      const value = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
      );
      return {
        bucket: this.config.bucket,
        objectKey,
        bytes: value.ContentLength ?? 0,
        metadata: value.Metadata ?? {},
      };
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode === 404
      )
        return undefined;
      throw error;
    }
  }

  async uploadImmutable(upload: ObjectStorageUpload) {
    this.validateObjectKey(upload.objectKey);
    const source = await stat(upload.sourcePath);
    const body = createReadStream(upload.sourcePath);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucket,
          Key: upload.objectKey,
          Body: body,
          ContentLength: source.size,
          ContentType: upload.contentType,
          Metadata: upload.metadata,
          IfNoneMatch: '*',
          ChecksumSHA256: upload.metadata?.['output-sha256']
            ? Buffer.from(upload.metadata['output-sha256'], 'hex').toString(
                'base64',
              )
            : undefined,
        }),
      );
    } catch (error) {
      // A concurrent/crashed previous owner may already have published the input.
      // Caller verifies the winner's fingerprint through HEAD before committing.
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 412
      )
        throw error;
    } finally {
      body.destroy();
    }
  }

  async readText(objectKey: string, maxBytes: number) {
    this.validateObjectKey(objectKey);
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.bucket, Key: objectKey }),
    );
    if (!result.Body) throw new Error('Object body is missing');
    const body = result.Body as import('node:stream').Readable;
    try {
      if ((result.ContentLength ?? 0) > maxBytes)
        throw new Error('Object is too large');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        const buffer = Buffer.from(chunk as Buffer);
        size += buffer.length;
        if (size > maxBytes) throw new Error('Object is too large');
        chunks.push(buffer);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      body.destroy();
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
