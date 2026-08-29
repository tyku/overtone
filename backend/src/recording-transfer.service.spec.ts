import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectStorage } from './object-storage/object-storage.types';
import { RecordingTransferService } from './recording-transfer.service';

describe('RecordingTransferService', () => {
  let directory: string;
  let localPath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'overtone-transfer-'));
    localPath = join(directory, 'recording.m4a');
    await writeFile(localPath, 'audio');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('uploads to the GPU contract key and then removes the local file', async () => {
    const uploadFile = jest.fn(({ objectKey }: { objectKey: string }) =>
      Promise.resolve({
        bucket: 'medical-scribe',
        objectKey,
        bytes: 5,
      }),
    );
    const objectStorage: ObjectStorage = {
      uploadFile,
    };
    const service = new RecordingTransferService(objectStorage);

    const stored = await service.moveToObjectStorage({
      localPath,
      extension: 'm4a',
      contentType: 'audio/mp4',
      metadata: {
        sessionId: 'visit-123',
        recordingId: 'recording-1',
        segmentNo: 1,
        mimeType: 'audio/webm;codecs=opus',
        recordingComplete: true,
      },
    });

    expect(uploadFile).toHaveBeenCalledWith(
      expect.objectContaining({
        objectKey: 'requests/visit-123/input/recording-1.m4a',
        contentType: 'audio/mp4',
      }),
    );
    expect(stored.objectKey).toBe('requests/visit-123/input/recording-1.m4a');
    await expect(access(localPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps the local file when S3 upload fails', async () => {
    const objectStorage: ObjectStorage = {
      uploadFile: jest.fn().mockRejectedValue(new Error('S3 unavailable')),
    };
    const service = new RecordingTransferService(objectStorage);

    await expect(
      service.moveToObjectStorage({
        localPath,
        extension: 'm4a',
        contentType: 'audio/mp4',
        metadata: {
          sessionId: 'visit-123',
          recordingId: 'recording-1',
          segmentNo: 1,
          mimeType: 'audio/webm',
          recordingComplete: true,
        },
      }),
    ).rejects.toThrow('S3 unavailable');
    await expect(access(localPath)).resolves.toBeUndefined();
  });

  it('deduplicates concurrent moves of the same recording', async () => {
    let finishUpload:
      | ((value: { bucket: string; objectKey: string; bytes: number }) => void)
      | undefined;
    const uploadFile = jest.fn(
      () =>
        new Promise<{
          bucket: string;
          objectKey: string;
          bytes: number;
        }>((resolve) => {
          finishUpload = resolve;
        }),
    );
    const service = new RecordingTransferService({ uploadFile });
    const input = {
      localPath,
      extension: 'm4a',
      contentType: 'audio/mp4',
      metadata: {
        sessionId: 'visit-123',
        recordingId: 'recording-1',
        segmentNo: 1,
        mimeType: 'audio/webm',
        recordingComplete: true,
      },
    };

    const first = service.moveToObjectStorage(input);
    const second = service.moveToObjectStorage(input);
    finishUpload?.({
      bucket: 'medical-scribe',
      objectKey: 'requests/visit-123/input/recording-1.m4a',
      bytes: 5,
    });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(uploadFile).toHaveBeenCalledTimes(1);
  });
});
