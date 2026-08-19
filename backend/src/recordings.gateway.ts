import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { createWriteStream, WriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

type RecordingSession = {
  id: string;
  temporaryPath: string;
  finalPath: string;
  stream: WriteStream;
  chunks: number;
  closed: boolean;
};

@Injectable()
export class RecordingsGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecordingsGateway.name);
  private readonly recordingsDir = join(process.cwd(), 'recordings');
  private readonly sessions = new Map<string, RecordingSession>();
  private wss?: WebSocketServer;

  constructor(private readonly adapterHost: HttpAdapterHost) {}

  async onModuleInit() {
    this.logger.log(`Preparing recordings directory: ${this.recordingsDir}`);
    await mkdir(this.recordingsDir, { recursive: true });
    this.wss = new WebSocketServer({
      server: this.adapterHost.httpAdapter.getHttpServer(),
      path: '/ws/recordings',
    });
    this.wss.on('connection', (socket, request) => this.handleConnection(socket, request));
    this.wss.on('error', (error) => this.logger.error('WebSocket server error', error.stack));
    this.logger.log('WebSocket recording gateway is listening on /ws/recordings');
  }

  onModuleDestroy() {
    this.logger.log(`Stopping WebSocket recording gateway; activeSessions=${this.sessions.size}`);
    this.wss?.close();
  }

  private handleConnection(socket: WebSocket, request: IncomingMessage) {
    let session: RecordingSession | undefined;
    const client = `${request.socket.remoteAddress ?? 'unknown'}:${request.socket.remotePort ?? 'unknown'}`;
    this.logger.log(`WebSocket connected: client=${client} activeSessions=${this.sessions.size}`);

    socket.on('message', async (payload, isBinary) => {
      try {
        if (isBinary) {
          if (!session || session.closed) {
            throw new Error('Send a start message before audio chunks.');
          }
          session.stream.write(payload);
          session.chunks += 1;
          this.logger.log(
            `Audio chunk received: session=${session.id} chunk=${session.chunks} bytes=${payload.length}`,
          );
          return;
        }

        const message = JSON.parse(payload.toString()) as {
          type?: string;
          recordingSessionId?: string;
          mimeType?: string;
          inputLabel?: string;
          trackSettings?: Record<string, unknown>;
          rms?: number;
          muted?: boolean;
          state?: string;
        };
        this.logger.log(
          `WebSocket command received: client=${client} type=${message.type ?? 'missing'} session=${message.recordingSessionId ?? session?.id ?? 'none'}`,
        );

        if (message.type === 'start') {
          if (session) throw new Error('Recording has already started.');
          const id = message.recordingSessionId;
          if (!id || !/^[a-zA-Z0-9-]{1,100}$/.test(id) || this.sessions.has(id)) {
            throw new Error('Invalid or already active recordingSessionId.');
          }
          const extension = message.mimeType === 'audio/ogg' ? 'ogg' : 'webm';
          session = {
            id,
            temporaryPath: join(this.recordingsDir, `${id}.${extension}.part`),
            finalPath: join(this.recordingsDir, `${id}.${extension}`),
            stream: createWriteStream(join(this.recordingsDir, `${id}.${extension}.part`), { flags: 'wx' }),
            chunks: 0,
            closed: false,
          };
          this.sessions.set(id, session);
          session.stream.on('error', (error) => {
            this.logger.error(`Recording file stream error: session=${id}`, error.stack);
          });
          this.logger.log(
            `Recording started: session=${id} mimeType=${message.mimeType ?? 'unknown'} input=${message.inputLabel ?? 'unknown'} trackSettings=${JSON.stringify(message.trackSettings ?? {})} output=${session.finalPath}`,
          );
          this.send(socket, { type: 'started', recordingSessionId: id });
          return;
        }

        if (message.type === 'audio-level') {
          if (!session || message.recordingSessionId !== session.id) {
            throw new Error('Audio level does not match the active recording.');
          }
          const rms = typeof message.rms === 'number' ? message.rms : 0;
          const level = rms < 0.003 ? 'silent' : 'signal';
          this.logger.log(`Microphone level: session=${session.id} rms=${rms.toFixed(5)} state=${level} muted=${Boolean(message.muted)}`);
          return;
        }

        if (message.type === 'audio-track-state') {
          if (!session || message.recordingSessionId !== session.id) {
            throw new Error('Audio track state does not match the active recording.');
          }
          this.logger.warn(`Microphone track state changed: session=${session.id} state=${message.state ?? 'unknown'}`);
          return;
        }

        if (message.type === 'finish') {
          if (!session) throw new Error('No active recording.');
          this.logger.log(`Recording finish requested: session=${session.id} receivedChunks=${session.chunks}`);
          const completed = await this.closeSession(session, true);
          this.send(socket, { type: 'completed', recordingSessionId: session.id, ...completed });
          this.logger.log(`Recording completion sent to client: session=${session.id}`);
          socket.close(1000, 'Recording saved');
          return;
        }

        throw new Error('Unsupported message type.');
      } catch (error) {
        this.logger.error(
          `WebSocket message handling failed: client=${client} session=${session?.id ?? 'none'} error=${this.errorMessage(error)}`,
          error instanceof Error ? error.stack : undefined,
        );
        this.send(socket, { type: 'error', message: this.errorMessage(error) });
      }
    });

    socket.on('error', (error) => {
      this.logger.error(`WebSocket error: client=${client} session=${session?.id ?? 'none'}`, error.stack);
    });

    socket.on('close', (code, reason) => {
      this.logger.log(
        `WebSocket closed: client=${client} session=${session?.id ?? 'none'} code=${code} reason=${reason.toString() || 'none'}`,
      );
      if (session && !session.closed) {
        const interruptedSession = session;
        void this.closeSession(interruptedSession, false).catch((error: unknown) => {
          this.logger.error(
            `Failed to clean up interrupted recording: session=${interruptedSession.id}`,
            error instanceof Error ? error.stack : String(error),
          );
        });
      }
    });
  }

  private async closeSession(session: RecordingSession, completed: boolean) {
    if (session.closed) return {};
    session.closed = true;
    this.sessions.delete(session.id);
    this.logger.log(`Closing recording stream: session=${session.id} completed=${completed}`);
    await new Promise<void>((resolve, reject) => {
      session.stream.once('error', reject);
      session.stream.end(resolve);
    });
    if (!completed) {
      this.logger.warn(`Recording interrupted; temporary file retained: session=${session.id} path=${session.temporaryPath}`);
      return {};
    }
    if (session.chunks === 0) {
      await unlink(session.temporaryPath).catch(() => undefined);
      this.logger.warn(`Recording has no chunks; temporary file removed: session=${session.id}`);
      throw new Error('No audio chunks were received from the browser.');
    }
    await rename(session.temporaryPath, session.finalPath);
    const { size } = await stat(session.finalPath);
    this.logger.log(`Recording saved: session=${session.id} chunks=${session.chunks} bytes=${size} path=${session.finalPath}`);
    return { chunks: session.chunks, bytes: size, fileName: session.finalPath.split('/').pop() };
  }

  private send(socket: WebSocket, message: object) {
    if (socket.readyState !== WebSocket.OPEN) {
      this.logger.warn(`WebSocket response skipped because socket is not open: type=${this.messageType(message)}`);
      return;
    }
    this.logger.log(`WebSocket response sent: type=${this.messageType(message)}`);
    socket.send(JSON.stringify(message));
  }

  private messageType(message: object) {
    return 'type' in message && typeof message.type === 'string' ? message.type : 'unknown';
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown recording error';
  }
}
