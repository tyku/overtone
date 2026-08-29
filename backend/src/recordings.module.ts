import { Module } from '@nestjs/common';
import { ObjectStorageModule } from './object-storage/object-storage.module';
import { RecordingAudioEncoderService } from './recording-audio-encoder.service';
import { RecordingStorageService } from './recording-storage.service';
import { RecordingTransferService } from './recording-transfer.service';
import { RecordingUploadService } from './recording-upload.service';
import { RecordingsController } from './recordings.controller';

@Module({
  imports: [ObjectStorageModule],
  controllers: [RecordingsController],
  providers: [
    RecordingAudioEncoderService,
    RecordingStorageService,
    RecordingTransferService,
    RecordingUploadService,
  ],
})
export class RecordingsModule {}
