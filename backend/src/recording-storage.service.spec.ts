import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { RecordingAudioEncoderService } from './recording-audio-encoder.service';
import { RecordingStorageService } from './recording-storage.service';

describe('RecordingStorageService', () => {
  let temporaryDirectory: string;
  let service: RecordingStorageService;
  let encoder: Pick<RecordingAudioEncoderService, 'encodeToM4a'>;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(join(tmpdir(), 'overtone-recordings-'));
    encoder = {
      encodeToM4a: jest.fn(async (inputPaths: string[], outputPath: string) => {
        const contents = await Promise.all(
          inputPaths.map((path) => readFile(path)),
        );
        await writeFile(outputPath, Buffer.concat(contents));
      }),
    };
    service = new RecordingStorageService(
      encoder as RecordingAudioEncoderService,
    );
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
      finalized: {
        fileName: 'session-1/recording-1.m4a',
        bytes: 5,
        extension: 'm4a',
        mimeType: 'audio/mp4',
      },
    });
    expect(retry).toMatchObject({
      bytes: 5,
      finalized: {
        fileName: 'session-1/recording-1.m4a',
        bytes: 5,
      },
    });
    await expect(readFile(first.finalized!.localPath, 'utf8')).resolves.toBe(
      'audio',
    );
  });

  it('encodes multiple segments into one M4A recording', async () => {
    const metadata = {
      sessionId: 'session-2',
      recordingId: 'recording-2',
      segmentNo: 1,
      mimeType: 'audio/webm;codecs=opus',
      recordingComplete: false,
    };

    await service.save(Readable.from(Buffer.from('first-')), metadata);
    const completed = await service.save(Readable.from(Buffer.from('second')), {
      ...metadata,
      segmentNo: 2,
      recordingComplete: true,
    });

    expect(encoder.encodeToM4a).toHaveBeenCalledTimes(1);
    expect(completed).toMatchObject({
      finalized: {
        fileName: 'session-2/recording-2.m4a',
        bytes: 12,
        extension: 'm4a',
        mimeType: 'audio/mp4',
      },
    });
    await expect(
      readFile(completed.finalized!.localPath, 'utf8'),
    ).resolves.toBe('first-second');
    await expect(
      readFile(
        join(temporaryDirectory, 'session-2/recording-2.segment-0001.webm'),
      ),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects unsupported audio types', () => {
    expect(() => service.validateMimeType('audio/wav')).toThrow(
      'Unsupported audio type',
    );
  });
});
