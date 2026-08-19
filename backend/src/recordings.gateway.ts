import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import { RecordingConnectionHandlerFactory } from './recording-connection-handler.factory';
import { RecordingSessionService } from './recording-session.service';

@Injectable()
export class RecordingsGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecordingsGateway.name);
  private wss?: WebSocketServer;

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly sessionService: RecordingSessionService,
    private readonly handlerFactory: RecordingConnectionHandlerFactory,
  ) {}

  async onModuleInit() {
    await this.sessionService.prepare();
    const httpServer = this.adapterHost.httpAdapter.getHttpServer() as Server;
    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws/recordings',
    });
    this.wss.on('connection', (socket, request) =>
      this.handlerFactory.create(socket, request).listen(),
    );
    this.wss.on('error', (error) =>
      this.logger.error('WebSocket server error', error.stack),
    );
    this.logger.log(
      'WebSocket recording gateway is listening on /ws/recordings',
    );
  }

  onModuleDestroy() {
    this.logger.log(
      `Stopping WebSocket recording gateway; activeSessions=${this.sessionService.activeSessionsCount}`,
    );
    this.wss?.close();
  }
}
