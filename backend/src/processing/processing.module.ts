import { Module } from '@nestjs/common';
import { ObjectStorageModule } from '../object-storage/object-storage.module';
import { DatabaseModule } from '../database/database.module';
import { InferenceClient } from './inference-client';
import { ProcessingQueue } from './processing-queue';
import { ProcessingService } from './processing.service';
@Module({
  imports: [DatabaseModule, ObjectStorageModule],
  providers: [InferenceClient, ProcessingQueue, ProcessingService],
  exports: [ProcessingService],
})
export class ProcessingModule {}
