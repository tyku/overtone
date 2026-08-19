import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RecordingsGateway } from './recordings.gateway';

@Module({
  imports: [],
  controllers: [AppController],
  providers: [AppService, RecordingsGateway],
})
export class AppModule {}
