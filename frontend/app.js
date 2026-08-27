import { AudioInputSelector } from './audio-input-selector.js';
import { AudioMeter } from './audio-meter.js';
import { RecordingClient } from './recording-client.js';

const recordButton = document.querySelector('#recordButton');
const status = document.querySelector('#status');
const timer = document.querySelector('#timer');
const hint = document.querySelector('.hint');
const audioInput = document.querySelector('#audioInput');
const recovery = document.querySelector('#recovery');
const recoveryMessage = document.querySelector('#recoveryMessage');
const continueButton = document.querySelector('#continueButton');
const uploadButton = document.querySelector('#uploadButton');
const discardButton = document.querySelector('#discardButton');

const selector = new AudioInputSelector(audioInput, 'overtone.audioInputId');
const meter = new AudioMeter(document.querySelector('#inputLevel'));
const client = new RecordingClient({
  uploadUrl: () => '/api/recordings',
  onCompleted: handleCompleted,
  onError: handleClientError,
  onTrackState: handleTrackState,
});

let startedAt;
let timerId;
let recoverableRecording;

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
  void refreshRecovery();
}

function updateTimer() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  timer.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function startRecording(recordingId) {
  if (client.state !== 'idle') return;
  recordButton.disabled = true;
  setState('Подключаем микрофон…', recordingId ? 'Восстанавливаем запись' : 'Запуск записи');

  try {
    if (!selector.selectedDeviceId) {
      await selector.requestPermissionAndRefresh();
      setState('Выберите микрофон', 'Выберите конкретное устройство в списке, затем начните запись');
      meter.showMessage('Системный input не используется — выберите физический микрофон', 'is-silent');
      recordButton.disabled = false;
      return;
    }
    const { stream, audioTrack } = await client.start(selector.selectedDeviceId, recordingId);
    await selector.refresh();
    startedAt = Date.now();
    timerId = window.setInterval(updateTimer, 250);
    updateTimer();
    hideRecovery();
    setState('Идёт запись', 'Аудио сохраняется на этом устройстве', true);
    await meter.start(stream, audioTrack, () => undefined);
    recordButton.disabled = false;
  } catch (error) {
    showError(microphoneErrorMessage(error), 'Проверьте разрешение и устройство ввода');
  }
}

function stopRecording() {
  if (client.state !== 'recording') return;
  recordButton.disabled = true;
  setState('Отправляем запись…', 'Сохранённое аудио загружается на сервер', true);
  client.stop();
}

function handleCompleted(message) {
  resetUi();
  const files = message.fileNames.join(', ');
  setState(`Сохранено: ${files}`, `${message.segments} сегм. · ${(message.bytes / 1024 / 1024).toFixed(1)} МБ`);
  void refreshRecovery();
}

function handleClientError(error) {
  showError(`Ошибка: ${error.message}`, 'Запись сохранена локально — загрузку можно повторить');
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
  return messages[error?.name] ?? error?.message ?? 'Не удалось включить микрофон';
}

async function refreshRecovery() {
  const recordings = await client.getRecoverableRecordings();
  recoverableRecording = recordings[0];
  if (!recoverableRecording) {
    hideRecovery();
    return;
  }
  const startedAt = new Date(recoverableRecording.startedAt).toLocaleString('ru-RU');
  recoveryMessage.textContent = `Незавершённая запись от ${startedAt}`;
  recovery.hidden = false;
}

function hideRecovery() {
  recovery.hidden = true;
}

async function uploadRecoveredRecording() {
  if (!recoverableRecording || client.state !== 'idle') return;
  setRecoveryButtonsDisabled(true);
  recordButton.disabled = true;
  setState('Отправляем сохранённую запись…', 'Не закрывайте страницу до завершения загрузки');
  try {
    await client.upload(recoverableRecording.id);
  } catch (error) {
    handleClientError(error);
  } finally {
    setRecoveryButtonsDisabled(false);
  }
}

async function discardRecoveredRecording() {
  if (!recoverableRecording || client.state !== 'idle') return;
  if (!window.confirm('Удалить сохранённую запись с этого устройства?')) return;
  setRecoveryButtonsDisabled(true);
  await client.discard(recoverableRecording.id);
  await refreshRecovery();
  setRecoveryButtonsDisabled(false);
}

function setRecoveryButtonsDisabled(disabled) {
  continueButton.disabled = disabled;
  uploadButton.disabled = disabled;
  discardButton.disabled = disabled;
}

recordButton.addEventListener('click', () =>
  client.state === 'recording' ? stopRecording() : void startRecording(),
);
continueButton.addEventListener('click', () => {
  if (recoverableRecording) void startRecording(recoverableRecording.id);
});
uploadButton.addEventListener('click', () => void uploadRecoveredRecording());
discardButton.addEventListener('click', () => void discardRecoveredRecording());

async function initialize() {
  recordButton.disabled = true;
  try {
    await Promise.all([selector.refresh(), client.initialize()]);
    await refreshRecovery();
    recordButton.disabled = false;
  } catch (error) {
    showError(`Ошибка локального хранилища: ${error.message}`, 'Запись не будет начата без надёжного локального сохранения');
    recordButton.disabled = true;
  }
}

void initialize();
