import { Module } from '@nestjs/common';
import { ObjectStorageModule } from '../object-storage/object-storage.module';
import { RecordingAudioEncoderService } from '../recording-audio-encoder.service';
import { AudioUploadService } from './audio-upload.service';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { ProcessingModule } from '../processing/processing.module';
import { AuthModule } from '../auth/auth.module';
@Module({
  imports: [ObjectStorageModule, ProcessingModule, AuthModule],
  controllers: [RequestsController],
  providers: [
    AudioUploadService,
    RequestsService,
    RecordingAudioEncoderService,
  ],
})
export class RequestsModule {}
