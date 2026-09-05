import { ConfigService } from '@nestjs/config';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RecordingAudioEncoderService } from './recording-audio-encoder.service';
const run = promisify(execFile);
const describeFfmpeg = process.env.TEST_FFMPEG ? describe : describe.skip;
describeFfmpeg('real FFmpeg concatenation', () => {
  it('combines two independent browser-like containers into one valid AAC recording', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'overtone-ffmpeg-'));
    try {
      const parts = [join(directory, 'part-1'), join(directory, 'part-2')];
      for (const path of parts)
        await run(process.env.TEST_FFMPEG!, [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:duration=1',
          '-c:a',
          'libopus',
          '-f',
          'webm',
          path,
        ]);
      const output = join(directory, 'audio.m4a');
      await new RecordingAudioEncoderService(
        new ConfigService({ FFMPEG_PATH: process.env.TEST_FFMPEG }),
      ).encodeToM4a(parts, output);
      const { stdout } = await run(process.env.TEST_FFPROBE ?? 'ffprobe', [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_name',
        '-of',
        'json',
        output,
      ]);
      const probe = JSON.parse(stdout) as {
        streams: { codec_name: string }[];
        format: { duration: string };
      };
      expect(probe.streams[0].codec_name).toBe('aac');
      expect(Number(probe.format.duration)).toBeGreaterThanOrEqual(1.9);
      expect(Number(probe.format.duration)).toBeLessThan(2.2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
