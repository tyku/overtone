import { RecordingStore } from './recording-store.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const MINIMUM_FREE_STORAGE_BYTES = 50 * 1024 * 1024;

export class RecordingClient {
  constructor({ uploadUrl, onCompleted, onError, onTrackState }) {
    this.uploadUrl = uploadUrl;
    this.onCompleted = onCompleted;
    this.onError = onError;
    this.onTrackState = onTrackState;
    this.store = new RecordingStore();
    this.state = 'idle';
    this.chunkWriteQueue = Promise.resolve();
  }

  async initialize() {
    await this.store.initialize();
    this.cleanupTimer = window.setInterval(
      () => void this.store.cleanupExpired(),
      CLEANUP_INTERVAL_MS,
    );
    return this.store.getRecoverableRecordings();
  }

  getRecoverableRecordings() {
    return this.store.getRecoverableRecordings();
  }

  async start(deviceId, recordingId) {
    if (this.state !== 'idle') throw new Error('Запись уже запускается или идёт');
    this.state = 'starting';
    try {
      await this.store.cleanupExpired();
      await navigator.storage?.persist?.();
      const { quota, usage } = await this.store.storageEstimate();
      if (
        typeof quota === 'number' &&
        typeof usage === 'number' &&
        quota - usage < MINIMUM_FREE_STORAGE_BYTES
      ) {
        throw new Error('Недостаточно свободного места для новой записи');
      }
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      this.audioTrack = this.mediaStream.getAudioTracks()[0];
      if (!this.audioTrack || this.audioTrack.readyState !== 'live') {
        throw new Error('Микрофон не передаёт аудиоданные');
      }
      await this.startRecorder(recordingId);
      return {
        stream: this.mediaStream,
        audioTrack: this.audioTrack,
        recordingId: this.recordingId,
      };
    } catch (error) {
      this.cleanupMedia();
      this.state = 'idle';
      throw error;
    }
  }

  stop() {
    if (!this.recorder || this.recorder.state === 'inactive' || this.state !== 'recording') return;
    this.state = 'stopping';
    this.recorder.stop();
  }

  async upload(recordingId) {
    if (this.state !== 'idle' && this.state !== 'stopping') {
      throw new Error('Сначала завершите текущую операцию');
    }
    this.state = 'uploading';
    try {
      await this.store.markStatus(recordingId, 'uploading');
      const recording = await this.store.requireRecording(recordingId);
      const segments = await this.store.getSegments(recordingId);
      if (!segments.length) throw new Error('В записи нет сохранённых аудиоданных');

      const saved = [];
      for (const [index, segment] of segments.entries()) {
        const response = await fetch(this.uploadUrl(), {
          method: 'POST',
          headers: {
            'Content-Type': segment.mimeType,
            'X-Session-Id': recording.sessionId,
            'X-Recording-Id': recording.id,
            'X-Segment-No': String(segment.number),
            'X-Recording-Complete': String(index === segments.length - 1),
          },
          body: segment.blob,
        });
        if (!response.ok) {
          const error = await response.json().catch(() => undefined);
          throw new Error(error?.message ?? `Сервер ответил ${response.status}`);
        }
        saved.push(await response.json());
      }

      const finalized = saved.findLast(({ finalFileName }) => finalFileName);
      if (!finalized) throw new Error('Сервер не вернул итоговый файл');
      await this.store.markStatus(recordingId, 'uploaded');
      await this.store.deleteRecording(recordingId);
      this.state = 'idle';
      this.onCompleted({
        recordingId,
        segments: saved.length,
        bytes: finalized.finalBytes,
        fileNames: [finalized.finalFileName],
      });
    } catch (error) {
      await this.store.markStatus(recordingId, 'failed').catch(() => undefined);
      this.state = 'idle';
      throw error;
    }
  }

  discard(recordingId) {
    return this.store.deleteRecording(recordingId);
  }

  cleanup() {
    this.cleanupMedia();
    this.state = 'idle';
    this.recorder = undefined;
    this.recordingId = undefined;
    this.segmentNo = undefined;
    this.chunkWriteQueue = Promise.resolve();
  }

  async startRecorder(recordingId) {
    const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 }
      : undefined;
    this.recorder = new MediaRecorder(this.mediaStream, options);
    const metadata = {
      mimeType: this.recorder.mimeType || 'audio/webm',
      inputLabel: this.audioTrack.label,
      trackSettings: this.audioTrack.getSettings(),
    };
    const active = recordingId
      ? await this.store.resumeRecording(recordingId, metadata)
      : await this.store.createRecording(metadata);
    this.recordingId = active.recording.id;
    this.segmentNo = active.segmentNo;
    this.chunkNo = 0;
    this.chunkWriteQueue = Promise.resolve();
    this.bindTrackEvents();
    this.bindRecorderEvents();
    this.recorder.start(1000);
    this.state = 'recording';
  }

  bindTrackEvents() {
    this.audioTrack.addEventListener('mute', () => this.onTrackState('mute'));
    this.audioTrack.addEventListener('unmute', () => this.onTrackState('unmute'));
    this.audioTrack.addEventListener('ended', () => this.onTrackState('ended'));
  }

  bindRecorderEvents() {
    this.recorder.addEventListener('dataavailable', ({ data }) => {
      if (!data.size) return;
      const chunkNo = ++this.chunkNo;
      this.chunkWriteQueue = this.chunkWriteQueue.then(() =>
        this.store.addChunk({
          recordingId: this.recordingId,
          segmentNo: this.segmentNo,
          chunkNo,
          blob: data,
        }),
      );
    });
    this.recorder.addEventListener('stop', () => void this.finishRecording(), { once: true });
  }

  async finishRecording() {
    const recordingId = this.recordingId;
    const segmentNo = this.segmentNo;
    try {
      await this.chunkWriteQueue;
      await this.store.finishSegment(recordingId, segmentNo);
      this.cleanupMedia();
      await this.upload(recordingId);
    } catch (error) {
      this.cleanupMedia();
      this.state = 'idle';
      this.onError(new Error(`Ошибка сохранения: ${error.message}`));
    }
  }

  cleanupMedia() {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = undefined;
    this.audioTrack = undefined;
  }
}
