import { Injectable, Logger } from '@nestjs/common';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { RecordingCompleted, RecordingSession } from './recording.types';

@Injectable()
export class RecordingSessionService {
  private readonly logger = new Logger(RecordingSessionService.name);
  private readonly recordingsDir = join(process.cwd(), 'recordings');
  private readonly sessions = new Map<string, RecordingSession>();

  get activeSessionsCount() {
    return this.sessions.size;
  }

  async prepare() {
    this.logger.log(`Preparing recordings directory: ${this.recordingsDir}`);
    await mkdir(this.recordingsDir, { recursive: true });
  }

  create(id: string, mimeType?: string) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id) || this.sessions.has(id)) {
      throw new Error('Invalid or already active recordingSessionId.');
    }
    const extension = mimeType === 'audio/ogg' ? 'ogg' : 'webm';
    const temporaryPath = join(this.recordingsDir, `${id}.${extension}.part`);
    const session: RecordingSession = {
      id,
      temporaryPath,
      finalPath: join(this.recordingsDir, `${id}.${extension}`),
      stream: createWriteStream(temporaryPath, { flags: 'wx' }),
      chunks: 0,
      closed: false,
    };
    session.stream.on('error', (error) => {
      this.logger.error(
        `Recording file stream error: session=${id}`,
        error.stack,
      );
    });
    this.sessions.set(id, session);
    return session;
  }

  appendChunk(session: RecordingSession, payload: Buffer) {
    this.ensureActive(session);
    session.stream.write(payload);
    session.chunks += 1;
    this.logger.debug(
      `Audio chunk received: session=${session.id} chunk=${session.chunks} bytes=${payload.length}`,
    );
  }

  async finish(session: RecordingSession): Promise<RecordingCompleted> {
    this.ensureActive(session);
    await this.closeStream(session);
    if (session.chunks === 0) {
      await unlink(session.temporaryPath).catch(() => undefined);
      this.logger.warn(
        `Recording has no chunks; temporary file removed: session=${session.id}`,
      );
      throw new Error('No audio chunks were received from the browser.');
    }
    await rename(session.temporaryPath, session.finalPath);
    const { size } = await stat(session.finalPath);
    this.logger.log(
      `Recording saved: session=${session.id} chunks=${session.chunks} bytes=${size} path=${session.finalPath}`,
    );
    return {
      chunks: session.chunks,
      bytes: size,
      fileName: session.finalPath.split('/').pop(),
    };
  }

  async interrupt(session: RecordingSession) {
    if (session.closed) return;
    await this.closeStream(session);
    this.logger.warn(
      `Recording interrupted; temporary file retained: session=${session.id} path=${session.temporaryPath}`,
    );
  }

  private ensureActive(session: RecordingSession) {
    if (session.closed)
      throw new Error('The recording session is already closed.');
  }

  private async closeStream(session: RecordingSession) {
    session.closed = true;
    this.sessions.delete(session.id);
    this.logger.log(`Closing recording stream: session=${session.id}`);
    await new Promise<void>((resolve, reject) => {
      session.stream.once('error', reject);
      session.stream.end(resolve);
    });
  }
}
