import { Logger } from '@nestjs/common';
import { IncomingMessage } from 'node:http';
import { WebSocket } from 'ws';
import { RecordingSessionService } from './recording-session.service';
import { RecordingCommand, RecordingSession } from './recording.types';

export class RecordingConnectionHandler {
  private readonly logger = new Logger(RecordingConnectionHandler.name);
  private readonly client: string;
  private session?: RecordingSession;

  constructor(
    private readonly socket: WebSocket,
    request: IncomingMessage,
    private readonly recordings: RecordingSessionService,
  ) {
    this.client = `${request.socket.remoteAddress ?? 'unknown'}:${request.socket.remotePort ?? 'unknown'}`;
  }

  listen() {
    this.logger.log(
      `WebSocket connected: client=${this.client} activeSessions=${this.recordings.activeSessionsCount}`,
    );
    this.socket.on(
      'message',
      (payload, isBinary) => void this.handleMessage(payload, isBinary),
    );
    this.socket.on('error', (error) => this.handleSocketError(error));
    this.socket.on(
      'close',
      (code, reason) => void this.handleSocketClose(code, reason),
    );
  }

  private async handleMessage(payload: Buffer, isBinary: boolean) {
    try {
      if (isBinary) {
        this.recordings.appendChunk(this.requireSession(), payload);
        return;
      }
      const command = this.parseCommand(payload);
      this.logger.debug(
        `WebSocket command received: client=${this.client} type=${command.type ?? 'missing'} session=${command.recordingSessionId ?? this.session?.id ?? 'none'}`,
      );
      await this.handleCommand(command);
    } catch (error) {
      this.logger.error(
        `WebSocket message handling failed: client=${this.client} session=${this.session?.id ?? 'none'} error=${this.errorMessage(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      this.send({ type: 'error', message: this.errorMessage(error) });
    }
  }

  private async handleCommand(command: RecordingCommand) {
    switch (command.type) {
      case 'start':
        this.startRecording(command);
        return;
      case 'audio-level':
        this.logAudioLevel(command);
        return;
      case 'audio-track-state':
        this.logTrackState(command);
        return;
      case 'finish':
        await this.finishRecording();
        return;
      default:
        throw new Error('Unsupported message type.');
    }
  }

  private startRecording(command: RecordingCommand) {
    if (this.session) throw new Error('Recording has already started.');
    if (!command.recordingSessionId)
      throw new Error('Invalid or already active recordingSessionId.');
    this.session = this.recordings.create(
      command.recordingSessionId,
      command.mimeType,
    );
    this.logger.log(
      `Recording started: session=${this.session.id} mimeType=${command.mimeType ?? 'unknown'} input=${command.inputLabel ?? 'unknown'} trackSettings=${JSON.stringify(command.trackSettings ?? {})} output=${this.session.finalPath}`,
    );
    this.send({ type: 'started', recordingSessionId: this.session.id });
  }

  private logAudioLevel(command: RecordingCommand) {
    const session = this.requireMatchingSession(
      command.recordingSessionId,
      'Audio level',
    );
    const rms = typeof command.rms === 'number' ? command.rms : 0;
    const level = rms < 0.003 ? 'silent' : 'signal';
    this.logger.debug(
      `Microphone level: session=${session.id} rms=${rms.toFixed(5)} state=${level} muted=${Boolean(command.muted)}`,
    );
  }

  private logTrackState(command: RecordingCommand) {
    const session = this.requireMatchingSession(
      command.recordingSessionId,
      'Audio track state',
    );
    this.logger.warn(
      `Microphone track state changed: session=${session.id} state=${command.state ?? 'unknown'}`,
    );
  }

  private async finishRecording() {
    const session = this.requireSession();
    this.logger.log(
      `Recording finish requested: session=${session.id} receivedChunks=${session.chunks}`,
    );
    const completed = await this.recordings.finish(session);
    this.send({
      type: 'completed',
      recordingSessionId: session.id,
      ...completed,
    });
    this.logger.log(
      `Recording completion sent to client: session=${session.id}`,
    );
    this.socket.close(1000, 'Recording saved');
  }

  private handleSocketError(error: Error) {
    this.logger.error(
      `WebSocket error: client=${this.client} session=${this.session?.id ?? 'none'}`,
      error.stack,
    );
  }

  private async handleSocketClose(code: number, reason: Buffer) {
    this.logger.log(
      `WebSocket closed: client=${this.client} session=${this.session?.id ?? 'none'} code=${code} reason=${reason.toString() || 'none'}`,
    );
    if (!this.session || this.session.closed) return;
    try {
      await this.recordings.interrupt(this.session);
    } catch (error) {
      this.logger.error(
        `Failed to clean up interrupted recording: session=${this.session.id}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private parseCommand(payload: Buffer): RecordingCommand {
    return JSON.parse(payload.toString()) as RecordingCommand;
  }

  private requireSession() {
    if (!this.session || this.session.closed)
      throw new Error('No active recording.');
    return this.session;
  }

  private requireMatchingSession(id: string | undefined, commandName: string) {
    const session = this.requireSession();
    if (id !== session.id)
      throw new Error(`${commandName} does not match the active recording.`);
    return session;
  }

  private send(message: object) {
    if (this.socket.readyState !== WebSocket.OPEN) {
      this.logger.warn(
        `WebSocket response skipped because socket is not open: type=${this.messageType(message)}`,
      );
      return;
    }
    this.logger.debug(
      `WebSocket response sent: type=${this.messageType(message)}`,
    );
    this.socket.send(JSON.stringify(message));
  }

  private messageType(message: object) {
    return 'type' in message && typeof message.type === 'string'
      ? message.type
      : 'unknown';
  }

  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : 'Unknown recording error';
  }
}
