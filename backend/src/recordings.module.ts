import { Module } from '@nestjs/common';
import { ObjectStorageModule } from './object-storage/object-storage.module';
import { RecordingRemuxService } from './recording-remux.service';
import { RecordingStorageService } from './recording-storage.service';
import { RecordingTransferService } from './recording-transfer.service';
import { RecordingUploadService } from './recording-upload.service';
import { RecordingsController } from './recordings.controller';

@Module({
  imports: [ObjectStorageModule],
  controllers: [RecordingsController],
  providers: [
    RecordingRemuxService,
    RecordingStorageService,
    RecordingTransferService,
    RecordingUploadService,
  ],
})
export class RecordingsModule {}
