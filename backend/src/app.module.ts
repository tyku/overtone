import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RecordingStorageService } from './recording-storage.service';
import { RecordingRemuxService } from './recording-remux.service';
import { RecordingsController } from './recordings.controller';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [AppController, RecordingsController],
  providers: [AppService, RecordingRemuxService, RecordingStorageService],
})
export class AppModule {}
