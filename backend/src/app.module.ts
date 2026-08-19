import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RecordingConnectionHandlerFactory } from './recording-connection-handler.factory';
import { RecordingSessionService } from './recording-session.service';
import { RecordingsGateway } from './recordings.gateway';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' })],
  controllers: [AppController],
  providers: [
    AppService,
    RecordingsGateway,
    RecordingSessionService,
    RecordingConnectionHandlerFactory,
  ],
})
export class AppModule {}
