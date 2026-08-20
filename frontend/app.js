import { AudioInputSelector } from './audio-input-selector.js';
import { AudioMeter } from './audio-meter.js';
import { RecordingClient } from './recording-client.js';

const recordButton = document.querySelector('#recordButton');
const status = document.querySelector('#status');
const timer = document.querySelector('#timer');
const hint = document.querySelector('.hint');
const audioInput = document.querySelector('#audioInput');

const selector = new AudioInputSelector(audioInput, 'overtone.audioInputId');
const meter = new AudioMeter(document.querySelector('#inputLevel'));
const client = new RecordingClient({
  websocketUrl: () => `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/recordings`,
  onCompleted: handleCompleted,
  onError: handleClientError,
  onTrackState: handleTrackState,
});

let startedAt;
let timerId;

function setState(nextStatus, nextHint, recording = false) {
  status.textContent = nextStatus;
  hint.textContent = nextHint;
  recordButton.classList.toggle('is-recording', recording);
  recordButton.setAttribute('aria-label', recording ? 'Остановить запись' : 'Начать запись');
}

function resetUi() {
  clearInterval(timerId);
  meter.stop();
  client.cleanup();
  recordButton.disabled = false;
}

function showError(message, nextHint = 'Проверьте устройство и попробуйте снова') {
  resetUi();
  setState(message, nextHint);
}

function updateTimer() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function startRecording() {
  if (client.state !== 'idle') return;
  recordButton.disabled = true;
  setState('Подключаем микрофон…', 'Запуск записи');

  try {
    if (!selector.selectedDeviceId) {
      await selector.requestPermissionAndRefresh();
      setState('Выберите микрофон', 'Выберите конкретное устройство в списке, затем начните запись');
      meter.showMessage('Системный input не используется — выберите физический микрофон', 'is-silent');
      recordButton.disabled = false;
      return;
    }
    const { stream, audioTrack } = await client.start(selector.selectedDeviceId);
    await selector.refresh();
    startedAt = Date.now();
    timerId = window.setInterval(updateTimer, 250);
    updateTimer();
    setState('Идёт запись', 'Нажмите, чтобы остановить и сохранить', true);
    await meter.start(stream, audioTrack, (level) => client.sendAudioLevel(level));
    recordButton.disabled = false;
  } catch (error) {
    showError(microphoneErrorMessage(error), 'Проверьте разрешение и устройство ввода');
  }
}

function stopRecording() {
  if (client.state !== 'recording') return;
  recordButton.disabled = true;
  setState('Сохраняем запись…', 'Отправляем последний чанк на сервер', true);
  client.stop();
}

function handleCompleted(message) {
  resetUi();
  setState(`Сохранено: ${message.fileName}`, `Получено ${message.chunks} чанков · ${(message.bytes / 1024).toFixed(1)} КБ`);
}

function handleClientError(error) {
  showError(`Ошибка: ${error.message}`, 'Попробуйте ещё раз');
}

function handleTrackState(state) {
  if (state === 'mute') meter.showMessage('Микрофон отключён системой или браузером', 'is-silent');
  if (state === 'ended') meter.showMessage('Микрофон перестал передавать данные', 'is-silent');
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

recordButton.addEventListener('click', () => client.state === 'recording' ? stopRecording() : startRecording());
void selector.refresh();
