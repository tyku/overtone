import { Module } from '@nestjs/common';
import { ObjectStorageModule } from '../object-storage/object-storage.module';
import { RecordingAudioEncoderService } from '../recording-audio-encoder.service';
import { RequestDatabase } from './request-database.service';
import { AudioUploadService } from './audio-upload.service';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
@Module({
  imports: [ObjectStorageModule],
  controllers: [RequestsController],
  providers: [
    RequestDatabase,
    AudioUploadService,
    RequestsService,
    RecordingAudioEncoderService,
  ],
})
export class RequestsModule {}
