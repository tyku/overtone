const recordButton = document.querySelector('#recordButton');
const status = document.querySelector('#status');
const timer = document.querySelector('#timer');
const hint = document.querySelector('.hint');
const audioInput = document.querySelector('#audioInput');
const inputLevel = document.querySelector('#inputLevel');

let recorder;
let socket;
let mediaStream;
let startedAt;
let timerId;
let connectionTimeout;
let stopping = false;
let chunkSendQueue = Promise.resolve();
let recordingState = 'idle';
let recordingSessionId;
let audioContext;
let analyser;
let levelBuffer;
let meterFrame;
let lastLevelReportAt = 0;
const audioInputStorageKey = 'overtone.audioInputId';

const websocketUrl = () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/recordings`;

function setState(nextStatus, nextHint, recording = false) {
  status.textContent = nextStatus;
  hint.textContent = nextHint;
  recordButton.classList.toggle('is-recording', recording);
  recordButton.setAttribute('aria-label', recording ? 'Остановить запись' : 'Начать запись');
}

function resetRecorder() {
  clearInterval(timerId);
  clearTimeout(connectionTimeout);
  stopTracks();
  recorder = undefined;
  socket = undefined;
  recordingSessionId = undefined;
  stopping = false;
  recordingState = 'idle';
  recordButton.disabled = false;
  stopAudioMeter();
}

function showError(message, hint = 'Проверьте устройство и попробуйте снова') {
  resetRecorder();
  setState(message, hint);
}

function updateTimer() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function stopTracks() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = undefined;
}

async function refreshAudioInputs() {
  const previousValue = audioInput.value || localStorage.getItem(audioInputStorageKey) || '';
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((device) => device.kind === 'audioinput');
  audioInput.replaceChildren(new Option('Выберите микрофон', ''));
  inputs.forEach((device, index) => {
    audioInput.add(new Option(device.label || `Микрофон ${index + 1}`, device.deviceId));
  });
  audioInput.value = [...audioInput.options].some((option) => option.value === previousValue) ? previousValue : '';
}

async function requestMicrophoneList() {
  const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  permissionStream.getTracks().forEach((track) => track.stop());
  await refreshAudioInputs();
}

function setInputLevel(text, state = '') {
  inputLevel.textContent = text;
  inputLevel.className = `input-level ${state}`;
}

function sendControl(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function stopAudioMeter() {
  if (meterFrame) cancelAnimationFrame(meterFrame);
  meterFrame = undefined;
  analyser = undefined;
  levelBuffer = undefined;
  if (audioContext && audioContext.state !== 'closed') void audioContext.close();
  audioContext = undefined;
}

async function startAudioMeter(audioTrack) {
  audioContext = new AudioContext();
  await audioContext.resume();
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  levelBuffer = new Uint8Array(analyser.fftSize);
  audioContext.createMediaStreamSource(mediaStream).connect(analyser);

  const update = () => {
    if (!analyser || !levelBuffer || recordingState !== 'recording') return;
    analyser.getByteTimeDomainData(levelBuffer);
    let sum = 0;
    for (const value of levelBuffer) {
      const normalized = (value - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / levelBuffer.length);
    const percent = Math.min(100, Math.round(rms * 400));
    const silent = rms < 0.003;
    setInputLevel(
      audioTrack.muted ? 'Микрофон отключён системой или браузером' : `Уровень микрофона: ${percent}%`,
      audioTrack.muted || silent ? 'is-silent' : 'is-active',
    );
    const now = Date.now();
    if (now - lastLevelReportAt >= 1000 && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'audio-level', recordingSessionId, rms, muted: audioTrack.muted }));
      lastLevelReportAt = now;
    }
    meterFrame = requestAnimationFrame(update);
  };
  update();
}

function microphoneErrorMessage(error) {
  const messages = {
    NotAllowedError: 'Доступ к микрофону запрещён',
    NotFoundError: 'Микрофон не найден',
    NotReadableError: 'Микрофон занят другим приложением или недоступен',
    AbortError: 'Не удалось запустить микрофон',
    SecurityError: 'Браузер заблокировал доступ к микрофону',
  };
  return messages[error?.name] ?? `Не удалось включить микрофон: ${error?.message ?? 'неизвестная ошибка'}`;
}

async function startRecording() {
  if (recordingState !== 'idle') return;
  recordingState = 'starting';
  recordButton.disabled = true;
  setState('Подключаем микрофон…', 'Запуск записи');

  try {
    const selectedDeviceId = audioInput.value;
    if (!selectedDeviceId) {
      await requestMicrophoneList();
      setState('Выберите микрофон', 'Выберите конкретное устройство в списке, затем начните запись');
      setInputLevel('Системный input не используется — выберите физический микрофон', 'is-silent');
      recordingState = 'idle';
      recordButton.disabled = false;
      return;
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: selectedDeviceId } },
    });
    await refreshAudioInputs();
    const audioTrack = mediaStream.getAudioTracks()[0];
    if (!audioTrack || audioTrack.readyState !== 'live') {
      throw new Error('Микрофон не передаёт аудиоданные');
    }
    socket = new WebSocket(websocketUrl());
    socket.addEventListener('open', () => {
      clearTimeout(connectionTimeout);
      try {
        const options = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 }
          : undefined;
        recorder = new MediaRecorder(mediaStream, options);
        recordingSessionId = crypto.randomUUID();
        socket.send(JSON.stringify({
          type: 'start',
          recordingSessionId,
          mimeType: recorder.mimeType.split(';', 1)[0] || 'audio/webm',
          inputLabel: audioTrack.label,
          trackSettings: audioTrack.getSettings(),
        }));
        audioTrack.addEventListener('mute', () => {
          setInputLevel('Микрофон отключён системой или браузером', 'is-silent');
          sendControl({ type: 'audio-track-state', recordingSessionId, state: 'mute' });
        });
        audioTrack.addEventListener('unmute', () => {
          sendControl({ type: 'audio-track-state', recordingSessionId, state: 'unmute' });
        });
        audioTrack.addEventListener('ended', () => {
          setInputLevel('Микрофон перестал передавать данные', 'is-silent');
          sendControl({ type: 'audio-track-state', recordingSessionId, state: 'ended' });
        });
        recorder.addEventListener('dataavailable', ({ data }) => {
          // `data.arrayBuffer()` is asynchronous. Queue every send so that the
          // final `finish` message cannot overtake the last audio chunk.
          if (!data.size) return;
          chunkSendQueue = chunkSendQueue.then(async () => {
            if (socket.readyState === WebSocket.OPEN) socket.send(await data.arrayBuffer());
          });
        });
        recorder.addEventListener('stop', async () => {
          try {
            await chunkSendQueue;
            if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'finish' }));
          } catch (error) {
            showError(`Ошибка отправки: ${error.message}`);
          }
        }, { once: true });
        chunkSendQueue = Promise.resolve();
        recorder.start(1000);
        recordingState = 'recording';
        lastLevelReportAt = 0;
        void startAudioMeter(audioTrack).catch((error) => {
          setInputLevel(`Не удалось измерить уровень: ${error.message}`, 'is-silent');
        });
        recordButton.disabled = false;
        startedAt = Date.now();
        timerId = window.setInterval(updateTimer, 250);
        updateTimer();
        setState('Идёт запись', 'Нажмите, чтобы остановить и сохранить', true);
      } catch (error) {
        showError(`Не удалось начать запись: ${error.message}`);
      }
    }, { once: true });
    socket.addEventListener('error', () => showError('Не удалось подключиться к серверу'), { once: true });
    connectionTimeout = window.setTimeout(() => {
      if (recordingState === 'starting') {
        socket.close();
        showError('Сервер не ответил за 5 секунд');
      }
    }, 5000);
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.type === 'completed') {
        resetRecorder();
        setState(`Сохранено: ${message.fileName}`, `Получено ${message.chunks} чанков · ${(message.bytes / 1024).toFixed(1)} КБ`);
      } else if (message.type === 'error') {
        showError(`Ошибка: ${message.message}`, 'Попробуйте ещё раз');
      }
    });
  } catch (error) {
    showError(microphoneErrorMessage(error), 'Проверьте разрешение и устройство ввода');
  }
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive' || stopping) return;
  stopping = true;
  recordingState = 'stopping';
  recordButton.disabled = true;
  setState('Сохраняем запись…', 'Отправляем последний чанк на сервер', true);
  recorder.stop();
}

recordButton.addEventListener('click', () => recordingState === 'recording' ? stopRecording() : startRecording());
audioInput.addEventListener('change', () => {
  if (audioInput.value) localStorage.setItem(audioInputStorageKey, audioInput.value);
  else localStorage.removeItem(audioInputStorageKey);
});
void refreshAudioInputs();
