import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { OBJECT_STORAGE } from './object-storage.types';
import { S3ObjectStorageProvider } from './s3-object-storage.provider';
import {
  S3_STORAGE_CONFIG,
  S3StorageConfig,
  loadS3StorageConfig,
} from './s3-storage.config';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: S3_STORAGE_CONFIG,
      inject: [ConfigService],
      useFactory: loadS3StorageConfig,
    },
    {
      provide: S3Client,
      inject: [S3_STORAGE_CONFIG],
      useFactory: (config: S3StorageConfig) =>
        new S3Client({
          endpoint: config.endpoint,
          region: config.region,
          credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
          },
          forcePathStyle: true,
        }),
    },
    S3ObjectStorageProvider,
    {
      provide: OBJECT_STORAGE,
      useExisting: S3ObjectStorageProvider,
    },
  ],
  exports: [OBJECT_STORAGE],
})
export class ObjectStorageModule {}
