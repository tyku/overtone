import { Readable } from 'node:stream';
import { RecordingStorageService } from './recording-storage.service';
import { RecordingTransferService } from './recording-transfer.service';
import { RecordingUploadService } from './recording-upload.service';

describe('RecordingUploadService', () => {
  it('moves only a finalized recording and returns its S3 location', async () => {
    const localStorage = {
      save: jest.fn().mockResolvedValue({
        sessionId: 'visit-123',
        recordingId: 'recording-1',
        segmentNo: 2,
        bytes: 5,
        fileName: 'visit-123/recording-1.segment-0002.webm',
        alreadyExisted: false,
        finalized: {
          fileName: 'visit-123/recording-1.webm',
          localPath: '/recordings/visit-123/recording-1.webm',
          extension: 'webm',
          bytes: 10,
          alreadyExisted: false,
        },
      }),
    } as unknown as RecordingStorageService;
    const moveToObjectStorage = jest.fn().mockResolvedValue({
      bucket: 'medical-scribe',
      objectKey: 'requests/visit-123/input/recording-1.webm',
      bytes: 10,
    });
    const transfer = {
      moveToObjectStorage,
    } as unknown as RecordingTransferService;
    const service = new RecordingUploadService(localStorage, transfer);

    const result = await service.save(Readable.from('audio'), {
      sessionId: 'visit-123',
      recordingId: 'recording-1',
      segmentNo: 2,
      mimeType: 'audio/webm',
      recordingComplete: true,
    });

    expect(moveToObjectStorage).toHaveBeenCalledWith(
      expect.objectContaining({
        localPath: '/recordings/visit-123/recording-1.webm',
        extension: 'webm',
      }),
    );
    expect(result).toMatchObject({
      finalFileName: 'requests/visit-123/input/recording-1.webm',
      finalBytes: 10,
      s3Bucket: 'medical-scribe',
      s3ObjectKey: 'requests/visit-123/input/recording-1.webm',
    });
  });
});
