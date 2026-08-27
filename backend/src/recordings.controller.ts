import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  PayloadTooLargeException,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { RecordingStorageService } from './recording-storage.service';

@Controller('api/recordings')
export class RecordingsController {
  private readonly logger = new Logger(RecordingsController.name);

  constructor(private readonly recordings: RecordingStorageService) {}

  @Post()
  @HttpCode(201)
  upload(
    @Req() request: Request,
    @Headers('x-session-id') sessionIdHeader?: string,
    @Headers('x-recording-id') recordingIdHeader?: string,
    @Headers('x-segment-no') segmentNoHeader?: string,
    @Headers('x-recording-complete') completeHeader?: string,
  ) {
    const contentLength = Number(request.headers['content-length']);
    if (
      Number.isFinite(contentLength) &&
      contentLength > this.recordings.maxUploadBytes
    ) {
      throw new PayloadTooLargeException('Recording segment is too large');
    }
    const metadata = {
      sessionId: this.recordings.validateId(sessionIdHeader, 'session id'),
      recordingId: this.recordings.validateId(
        recordingIdHeader,
        'recording id',
      ),
      segmentNo: this.recordings.validateSegmentNo(segmentNoHeader),
      mimeType: this.recordings.validateMimeType(
        request.headers['content-type'],
      ),
      recordingComplete: completeHeader === 'true',
    };
    this.logger.log(
      `Recording upload started: session=${metadata.sessionId} recording=${metadata.recordingId} segment=${metadata.segmentNo}`,
    );
    return this.recordings.save(request, metadata);
  }
}
