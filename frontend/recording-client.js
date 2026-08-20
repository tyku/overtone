export class RecordingClient {
  constructor({ websocketUrl, onCompleted, onError, onTrackState }) {
    this.websocketUrl = websocketUrl;
    this.onCompleted = onCompleted;
    this.onError = onError;
    this.onTrackState = onTrackState;
    this.state = 'idle';
    this.chunkSendQueue = Promise.resolve();
    this.lastLevelReportAt = 0;
  }

  async start(deviceId) {
    if (this.state !== 'idle') throw new Error('Запись уже запускается или идёт');
    this.state = 'starting';
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
      });
      this.audioTrack = this.mediaStream.getAudioTracks()[0];
      if (!this.audioTrack || this.audioTrack.readyState !== 'live') {
        throw new Error('Микрофон не передаёт аудиоданные');
      }
      await this.connect();
      return { stream: this.mediaStream, audioTrack: this.audioTrack };
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }

  stop() {
    if (!this.recorder || this.recorder.state === 'inactive' || this.state !== 'recording') return;
    this.state = 'stopping';
    this.recorder.stop();
  }

  sendAudioLevel({ rms, muted }) {
    const now = Date.now();
    if (now - this.lastLevelReportAt < 1000) return;
    this.sendJson({ type: 'audio-level', recordingSessionId: this.sessionId, rms, muted });
    this.lastLevelReportAt = now;
  }

  cleanup() {
    clearTimeout(this.connectionTimeout);
    this.state = 'idle';
    this.recorder = undefined;
    this.sessionId = undefined;
    this.chunkSendQueue = Promise.resolve();
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = undefined;
    this.audioTrack = undefined;
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      this.socket.close();
    }
    this.socket = undefined;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket = new WebSocket(this.websocketUrl());
      const timeout = window.setTimeout(() => reject(new Error('Сервер не ответил за 5 секунд')), 5000);
      this.connectionTimeout = timeout;

      this.socket.addEventListener('open', () => {
        clearTimeout(timeout);
        try {
          this.startRecorder();
          resolve();
        } catch (error) {
          reject(error);
        }
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timeout);
        const error = new Error('Не удалось подключиться к серверу');
        if (this.state === 'starting') reject(error);
        else this.onError(error);
      });
      this.socket.addEventListener('message', ({ data }) => this.handleServerMessage(data));
    });
  }

  startRecorder() {
    const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 }
      : undefined;
    this.recorder = new MediaRecorder(this.mediaStream, options);
    this.sessionId = crypto.randomUUID();
    this.sendJson({
      type: 'start',
      recordingSessionId: this.sessionId,
      mimeType: this.recorder.mimeType.split(';', 1)[0] || 'audio/webm',
      inputLabel: this.audioTrack.label,
      trackSettings: this.audioTrack.getSettings(),
    });
    this.bindTrackEvents();
    this.bindRecorderEvents();
    this.chunkSendQueue = Promise.resolve();
    this.recorder.start(1000);
    this.state = 'recording';
    this.lastLevelReportAt = 0;
  }

  bindTrackEvents() {
    this.audioTrack.addEventListener('mute', () => this.publishTrackState('mute'));
    this.audioTrack.addEventListener('unmute', () => this.publishTrackState('unmute'));
    this.audioTrack.addEventListener('ended', () => this.publishTrackState('ended'));
  }

  bindRecorderEvents() {
    this.recorder.addEventListener('dataavailable', ({ data }) => {
      if (!data.size) return;
      this.chunkSendQueue = this.chunkSendQueue.then(async () => {
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(await data.arrayBuffer());
      });
    });
    this.recorder.addEventListener('stop', () => void this.finishUpload(), { once: true });
  }

  async finishUpload() {
    try {
      await this.chunkSendQueue;
      this.sendJson({ type: 'finish' });
    } catch (error) {
      this.onError(new Error(`Ошибка отправки: ${error.message}`));
    }
  }

  handleServerMessage(data) {
    const message = JSON.parse(data);
    if (message.type === 'completed') this.onCompleted(message);
    if (message.type === 'error') this.onError(new Error(message.message));
  }

  publishTrackState(state) {
    this.onTrackState(state);
    this.sendJson({ type: 'audio-track-state', recordingSessionId: this.sessionId, state });
  }

  sendJson(message) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
