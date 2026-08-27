import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { RecordingStorageService } from './recording-storage.service';

describe('RecordingStorageService', () => {
  let temporaryDirectory: string;
  let service: RecordingStorageService;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'overtone-recordings-'));
    service = new RecordingStorageService();
    Object.defineProperty(service, 'recordingsDir', {
      value: temporaryDirectory,
    });
    await service.onModuleInit();
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it('saves a recording segment and makes a retry idempotent', async () => {
    const metadata = {
      sessionId: 'session-1',
      recordingId: 'recording-1',
      segmentNo: 1,
      mimeType: 'audio/webm;codecs=opus',
      recordingComplete: true,
    };

    const first = await service.save(
      Readable.from(Buffer.from('audio')),
      metadata,
    );
    const retry = await service.save(
      Readable.from(Buffer.from('other')),
      metadata,
    );

    expect(first).toMatchObject({
      bytes: 5,
      fileName: 'session-1/recording-1.segment-0001.webm',
      alreadyExisted: false,
    });
    expect(retry).toMatchObject({ bytes: 5, alreadyExisted: true });
    await expect(
      readFile(join(temporaryDirectory, first.fileName), 'utf8'),
    ).resolves.toBe('audio');
  });

  it('rejects unsupported audio types', () => {
    expect(() => service.validateMimeType('audio/wav')).toThrow(
      'Unsupported audio type',
    );
  });
});
