export class VisitRecorder {
  constructor(store, onError) {
    this.store = store;
    this.onError = onError;
    this.state = 'idle';
    this.writeQueue = Promise.resolve();
  }
  async acquire(id) {
    if (!navigator.locks)
      throw new Error('Для записи нужен браузер с поддержкой Web Locks');
    let resolveAcquire, rejectAcquire;
    const acquired = new Promise((resolve, reject) => {
      resolveAcquire = resolve;
      rejectAcquire = reject;
    });
    this.lockTask = navigator.locks
      .request(
        `overtone-recording:${id}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) {
            rejectAcquire(
              new Error('Приём открыт для записи в другой вкладке'),
            );
            return;
          }
          await new Promise((resolve) => {
            this.release = resolve;
            resolveAcquire();
          });
        },
      )
      .catch(rejectAcquire);
    await acquired;
  }
  async start(id, deviceId) {
    if (this.state !== 'idle') return;
    this.state = 'starting';
    try {
      await this.acquire(id);
      const row = await this.store.get(id);
      if (row.frozenAt || row.audioStored || row.abandonedAt)
        throw new Error('Дозапись завершённого приёма запрещена');
      await navigator.storage?.persist?.();
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.quota - estimate?.usage < 50 * 1024 * 1024)
        throw new Error('Недостаточно места на устройстве');
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      const mimeType = [
        'audio/webm;codecs=opus',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mimeType)
        throw new Error(
          'Браузер не поддерживает запись в доступных аудиоформатах',
        );
      this.recorder = new MediaRecorder(this.stream, {
        mimeType,
        audioBitsPerSecond: 32000,
      });
      const updated = await this.store.addPart(id, this.recorder.mimeType);
      this.requestId = id;
      this.partNo = updated.parts.at(-1).partNo;
      this.chunkNo = 0;
      this.captureError = null;
      this.writeQueue = Promise.resolve();
      this.startedAt = Date.now();
      this.previousMs = updated.parts.reduce(
        (sum, part) => sum + part.durationMs,
        0,
      );
      const partNo = this.partNo;
      this.recorder.addEventListener('dataavailable', ({ data }) => {
        if (!data.size) return;
        const number = ++this.chunkNo;
        this.writeQueue = this.writeQueue
          .then(() => this.store.addChunk(id, partNo, number, data))
          .catch(async (error) => {
            this.captureError ??= error;
            await this.store
              .captureFailed(id, error.message)
              .catch(() => undefined);
            this.onError(error);
            if (this.recorder.state !== 'inactive') this.recorder.stop();
          });
      });
      this.stopped = new Promise((resolve) => {
        this.recorder.addEventListener(
          'stop',
          async () => {
            await this.writeQueue;
            await this.store.finishPart(id, partNo).catch((error) => {
              this.captureError ??= error;
              this.onError(error);
            });
            this.stream?.getTracks().forEach((track) => track.stop());
            this.state = 'idle';
            this.release?.();
            this.release = null;
            resolve();
          },
          { once: true },
        );
      });
      this.recorder.addEventListener('error', () =>
        this.onError(new Error('Браузер прервал запись')),
      );
      this.stream.getAudioTracks()[0].addEventListener('ended', () => {
        if (this.recorder.state !== 'inactive') this.recorder.stop();
      });
      this.recorder.start(1000);
      this.state = 'recording';
      return { stream: this.stream, track: this.stream.getAudioTracks()[0] };
    } catch (error) {
      this.stream?.getTracks().forEach((track) => track.stop());
      this.release?.();
      this.release = null;
      this.state = 'idle';
      throw error;
    }
  }
  async stop() {
    if (this.recorder && this.recorder.state !== 'inactive') {
      this.state = 'stopping';
      this.recorder.stop();
    }
    await this.stopped;
  }
  async finalize(id) {
    if (this.state === 'recording' && this.requestId === id) {
      await this.store.freeze(id);
      await this.stop();
    } else {
      await this.acquire(id);
      try {
        await this.store.freeze(id);
      } finally {
        this.release?.();
        this.release = null;
      }
    }
  }
}
