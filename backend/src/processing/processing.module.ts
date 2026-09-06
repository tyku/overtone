import { Module } from '@nestjs/common';
import { ObjectStorageModule } from '../object-storage/object-storage.module';
import { RequestDatabase } from '../requests/request-database.service';
import { InferenceClient } from './inference-client';
import { ProcessingQueue } from './processing-queue';
import { ProcessingService } from './processing.service';
@Module({
  imports: [ObjectStorageModule],
  providers: [
    RequestDatabase,
    InferenceClient,
    ProcessingQueue,
    ProcessingService,
  ],
  exports: [RequestDatabase, ProcessingService],
})
export class ProcessingModule {}
