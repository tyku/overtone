import { Injectable } from '@nestjs/common';
import { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { RecordingConnectionHandler } from './recording-connection-handler';
import { RecordingSessionService } from './recording-session.service';

@Injectable()
export class RecordingConnectionHandlerFactory {
  constructor(private readonly recordings: RecordingSessionService) {}

  create(socket: WebSocket, request: IncomingMessage) {
    return new RecordingConnectionHandler(socket, request, this.recordings);
  }
}
