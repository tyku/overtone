import { ConfigService } from '@nestjs/config';

export const S3_STORAGE_CONFIG = Symbol('S3_STORAGE_CONFIG');

export type S3StorageConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function loadS3StorageConfig(config: ConfigService): S3StorageConfig {
  return {
    bucket: required(config, 'S3_BUCKET'),
    region: config.get<string>('S3_REGION')?.trim() || 'us-east-1',
    endpoint: config.get<string>('S3_ENDPOINT')?.trim() || undefined,
    accessKeyId: required(config, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: required(config, 'S3_SECRET_ACCESS_KEY'),
  };
}

function required(config: ConfigService, name: string) {
  const value = config.get<string>(name)?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
