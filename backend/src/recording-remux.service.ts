import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

@Injectable()
export class RecordingRemuxService {
  private readonly logger = new Logger(RecordingRemuxService.name);
  private readonly ffmpegPath: string;

  constructor(config: ConfigService) {
    this.ffmpegPath = config.get<string>('FFMPEG_PATH', 'ffmpeg');
  }

  async remux(inputPaths: string[], outputPath: string) {
    const manifestPath = join(
      dirname(outputPath),
      `.ffconcat-${randomUUID()}.txt`,
    );
    const manifest = [
      'ffconcat version 1.0',
      ...inputPaths.map((path) => `file '${this.escapePath(path)}'`),
      '',
    ].join('\n');
    await writeFile(manifestPath, manifest, { flag: 'wx' });
    try {
      await this.run([
        '-nostdin',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        manifestPath,
        '-map',
        '0:a:0',
        '-c:a',
        'copy',
        '-y',
        outputPath,
      ]);
    } finally {
      await unlink(manifestPath).catch(() => undefined);
    }
  }

  private run(args: string[]) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(this.ffmpegPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      let settled = false;
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        finish(new UnprocessableEntityException('FFmpeg remux timed out'));
      }, 120_000);
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };

      child.stderr.on('data', (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
      });
      child.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          finish(
            new ServiceUnavailableException(
              `FFmpeg executable not found: ${this.ffmpegPath}`,
            ),
          );
          return;
        }
        finish(error);
      });
      child.once('close', (code) => {
        if (code === 0) {
          finish();
          return;
        }
        this.logger.error(`FFmpeg remux failed: ${stderr || `exit ${code}`}`);
        finish(new UnprocessableEntityException('Audio remux failed'));
      });
    });
  }

  private escapePath(path: string) {
    return path.replaceAll('\\', '\\\\').replaceAll("'", "'\\''");
  }
}
