import {
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S3ObjectStorageProvider } from './s3-object-storage.provider';
import { S3StorageConfig } from './s3-storage.config';

describe('S3ObjectStorageProvider', () => {
  const config: S3StorageConfig = {
    bucket: 'medical-scribe',
    region: 'us-east-1',
    endpoint: 'http://minio:9000',
    accessKeyId: 'access',
    secretAccessKey: 'secret',
  };

  it('verifies the bucket and uploads a local file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'overtone-s3-'));
    const sourcePath = join(directory, 'recording.webm');
    await writeFile(sourcePath, 'audio');
    const commands: unknown[] = [];
    const send = jest.fn((command: unknown) => {
      commands.push(command);
      return Promise.resolve(
        command instanceof PutObjectCommand ? { ETag: '"etag-value"' } : {},
      );
    });
    const provider = new S3ObjectStorageProvider(config, {
      send,
    } as unknown as S3Client);

    try {
      await provider.onModuleInit();
      const stored = await provider.uploadFile({
        sourcePath,
        objectKey: 'requests/session-1/input/recording-1.webm',
        contentType: 'audio/webm;codecs=opus',
      });

      expect(commands[0]).toBeInstanceOf(HeadBucketCommand);
      expect(commands[1]).toBeInstanceOf(PutObjectCommand);
      expect(stored).toEqual({
        bucket: 'medical-scribe',
        objectKey: 'requests/session-1/input/recording-1.webm',
        bytes: 5,
        etag: 'etag-value',
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects unsafe object keys before calling S3', async () => {
    const send = jest.fn();
    const provider = new S3ObjectStorageProvider(config, {
      send,
    } as unknown as S3Client);

    await expect(
      provider.uploadFile({
        sourcePath: '/not-used',
        objectKey: '../recording.webm',
        contentType: 'audio/webm',
      }),
    ).rejects.toThrow('safe relative key');
    expect(send).not.toHaveBeenCalled();
  });

  it('distinguishes missing objects from storage outages', async () => {
    const send = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
      .mockRejectedValueOnce({ $metadata: { httpStatusCode: 503 } });
    const provider = new S3ObjectStorageProvider(config, {
      send,
    } as unknown as S3Client);
    await expect(
      provider.headObject('requests/a/input/audio.m4a'),
    ).resolves.toBeUndefined();
    await expect(
      provider.headObject('requests/a/input/audio.m4a'),
    ).rejects.toMatchObject({ $metadata: { httpStatusCode: 503 } });
    expect(send.mock.calls[0][0]).toBeInstanceOf(HeadObjectCommand);
  });

  it('publishes immutable audio with a checksum and tolerates an existing object', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'overtone-immutable-'));
    const sourcePath = join(directory, 'audio');
    await writeFile(sourcePath, 'audio');
    const send = jest
      .fn<Promise<unknown>, [unknown]>()
      .mockRejectedValue({ $metadata: { httpStatusCode: 412 } });
    const provider = new S3ObjectStorageProvider(config, {
      send,
    } as unknown as S3Client);
    try {
      await provider.uploadImmutable({
        sourcePath,
        objectKey: 'requests/a/input/audio.m4a',
        contentType: 'audio/mp4',
        metadata: { 'output-sha256': 'ab'.repeat(32) },
      });
      const command = send.mock.calls[0][0] as PutObjectCommand;
      expect(command.input.IfNoneMatch).toBe('*');
      expect(command.input.ChecksumSHA256).toBe(
        Buffer.from('ab'.repeat(32), 'hex').toString('base64'),
      );
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
