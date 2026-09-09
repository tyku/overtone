import { RequestStore } from './request-store';

export type RecorderState = 'idle' | 'starting' | 'recording' | 'stopping';

export interface RecordingCapture {
  stream: MediaStream;
  track: MediaStreamTrack;
}

export class VisitRecorder {
  state: RecorderState = 'idle';
  requestId?: string;
  startedAt = 0;
  previousMs = 0;

  private writeQueue: Promise<void> = Promise.resolve();
  private lockTask?: Promise<unknown>;
  private release?: () => void;
  private stream?: MediaStream;
  private recorder?: MediaRecorder;
  private stopped?: Promise<void>;
  private partNo = 0;
  private chunkNo = 0;
  private captureError?: Error;

  constructor(
    private readonly store: RequestStore,
    private readonly onError: (error: Error) => void,
  ) {}

  private async acquire(id: string): Promise<void> {
    if (!navigator.locks) {
      throw new Error('Для записи нужен браузер с поддержкой Web Locks');
    }
    let resolveAcquire!: () => void;
    let rejectAcquire!: (reason?: unknown) => void;
    const acquired = new Promise<void>((resolve, reject) => {
      resolveAcquire = resolve;
      rejectAcquire = reject;
    });
    this.lockTask = navigator.locks
      .request(`overtone-recording:${id}`, { ifAvailable: true }, async (lock) => {
        if (!lock) {
          rejectAcquire(new Error('Приём открыт для записи в другой вкладке'));
          return;
        }
        await new Promise<void>((resolve) => {
          this.release = resolve;
          resolveAcquire();
        });
      })
      .catch(rejectAcquire);
    await acquired;
  }

  async start(id: string, deviceId: string): Promise<RecordingCapture | undefined> {
    if (this.state !== 'idle') return undefined;
    this.state = 'starting';
    try {
      await this.acquire(id);
      const row = await this.store.get(id);
      if (!row) throw new Error('Локальная запись не найдена');
      if (row.frozenAt || row.audioStored || row.abandonedAt) {
        throw new Error('Дозапись завершённого приёма запрещена');
      }
      await navigator.storage?.persist?.();
      const estimate = await navigator.storage?.estimate?.();
      if (
        typeof estimate?.quota === 'number' &&
        typeof estimate.usage === 'number' &&
        estimate.quota - estimate.usage < 50 * 1024 * 1024
      ) {
        throw new Error('Недостаточно места на устройстве');
      }
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
      if (!mimeType) {
        throw new Error('Браузер не поддерживает запись в доступных аудиоформатах');
      }
      this.recorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 32_000,
      });
      const updated = await this.store.addPart(id, this.recorder.mimeType);
      this.requestId = id;
      this.partNo = updated.parts.at(-1)?.partNo ?? 0;
      this.chunkNo = 0;
      this.captureError = undefined;
      this.writeQueue = Promise.resolve();
      this.startedAt = Date.now();
      this.previousMs = updated.parts.reduce((sum, part) => sum + part.durationMs, 0);
      const partNo = this.partNo;

      this.recorder.addEventListener('dataavailable', ({ data }) => {
        if (!data.size) return;
        const chunkNo = ++this.chunkNo;
        this.writeQueue = this.writeQueue
          .then(() => this.store.addChunk(id, partNo, chunkNo, data))
          .catch(async (error: unknown) => {
            const failure = error instanceof Error ? error : new Error(String(error));
            this.captureError ??= failure;
            await this.store.captureFailed(id, failure.message).catch(() => undefined);
            this.onError(failure);
            if (this.recorder?.state !== 'inactive') this.recorder?.stop();
          });
      });

      this.stopped = new Promise((resolve) => {
        this.recorder?.addEventListener(
          'stop',
          async () => {
            await this.writeQueue;
            await this.store.finishPart(id, partNo).catch((error: unknown) => {
              const failure = error instanceof Error ? error : new Error(String(error));
              this.captureError ??= failure;
              this.onError(failure);
            });
            this.stream?.getTracks().forEach((track) => track.stop());
            this.state = 'idle';
            this.release?.();
            this.release = undefined;
            resolve();
          },
          { once: true },
        );
      });
      this.recorder.addEventListener('error', () =>
        this.onError(new Error('Браузер прервал запись')),
      );
      const track = this.stream.getAudioTracks()[0];
      if (!track) throw new Error('Микрофон не передаёт аудиоданные');
      track.addEventListener('ended', () => {
        if (this.recorder?.state !== 'inactive') this.recorder?.stop();
      });
      this.recorder.start(1000);
      this.state = 'recording';
      return { stream: this.stream, track };
    } catch (error) {
      this.stream?.getTracks().forEach((track) => track.stop());
      this.release?.();
      this.release = undefined;
      this.state = 'idle';
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.state = 'stopping';
      this.recorder.stop();
    }
    await this.stopped;
  }

  async finalize(id: string): Promise<void> {
    if (this.state === 'recording' && this.requestId === id) {
      await this.store.freeze(id);
      await this.stop();
      return;
    }
    await this.acquire(id);
    try {
      await this.store.freeze(id);
    } finally {
      this.release?.();
      this.release = undefined;
    }
  }
}
