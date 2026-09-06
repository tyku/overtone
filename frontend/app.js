import { AudioInputSelector } from './audio-input-selector.js';
import { AudioMeter } from './audio-meter.js';
import { RequestStore } from './request-store.js';
import { RequestApi, ApiFailure } from './request-api.js';
import { VisitRecorder } from './visit-recorder.js';
import { marked } from './vendor/marked.js';
import DOMPurify from './vendor/dompurify.js';

const $ = (id) => document.getElementById(id);
const store = new RequestStore();
const api = new RequestApi();
const selector = new AudioInputSelector(
  $('audioInput'),
  'overtone.audioInputId',
);
const meter = new AudioMeter($('inputLevel'));
const recorder = new VisitRecorder(store, (error) => {
  showError(error.message);
  void render();
});
const labels = {
  created: 'Создан',
  saving: 'Сохранение аудио',
  save_failed: 'Ошибка сохранения',
  processing: 'Отчёт в обработке',
  completed: 'Завершён',
  processing_failed: 'Ошибка обработки',
  abandoned: 'Закрыт без сохранения',
};
let current = null,
  local = null,
  busy = false,
  lastError = null,
  cursor = null,
  pollTimer,
  routeVersion = 0;
let report = null;
let reportLoading = false;
let objectUrls = [];
const date = (value) =>
  new Date(value).toLocaleString('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
function visible(id, show) {
  $(id).hidden = !show;
}
function notice(message) {
  $('notice').textContent = message;
  visible('notice', Boolean(message));
}
function showError(message) {
  lastError = message;
  $('requestError').textContent = message;
  visible('requestError', true);
}
function clearError() {
  lastError = null;
  visible('requestError', false);
}
function navigate(id) {
  location.hash = id ? `/requests/${id}` : '/requests';
}
function errorMessage(error) {
  const messages = {
    NotAllowedError: 'Разрешите доступ к микрофону',
    NotFoundError: 'Микрофон не найден',
    NotReadableError: 'Микрофон занят другим приложением',
    AUDIO_UPLOAD_REQUIRED: 'Нужно повторно отправить сохранённое аудио',
    REQUEST_FINALIZATION_FAILED:
      'Аудио сохранено. Нужно повторить закрытие приёма.',
    REQUEST_STATE_UNKNOWN:
      'Нет достоверного ответа сервера. Запись сохранена; проверяем состояние.',
    AUDIO_CONTENT_CONFLICT:
      'Содержимое записи отличается от ранее отправленного. Изменять завершённую запись нельзя.',
  };
  return messages[error.code] ?? messages[error.name] ?? error.message;
}
async function applyServer(row) {
  current = row;
  local = await store.remember(row);
  if (
    ['processing', 'completed', 'abandoned', 'processing_failed'].includes(
      row.status,
    )
  )
    clearError();
  await render();
}
async function render() {
  if (!current) return;
  local = await store.get(current.requestId);
  $('requestDate').textContent = date(current.createdAt);
  $('requestId').textContent = current.requestId;
  const frozen = Boolean(local?.frozenAt);
  const recording = recorder.state === 'recording';
  const saving =
    ['saving', 'save_failed'].includes(current.status) ||
    (current.status === 'created' && frozen);
  $('requestStatus').textContent = saving
    ? lastError || current.status === 'save_failed'
      ? labels.save_failed
      : labels.saving
    : labels[current.status];
  visible('recorderPanel', current.status === 'created' && !frozen);
  visible('savingPanel', saving);
  visible('waitingPanel', current.status === 'processing');
  visible('failedPanel', current.status === 'processing_failed');
  visible('abandonedPanel', current.status === 'abandoned');
  visible('reportPanel', current.status === 'completed');
  const errorText =
    lastError ??
    local?.captureError ??
    (current.error ? errorMessage(current.error) : '');
  $('requestError').textContent = errorText;
  visible('requestError', Boolean(errorText));
  $('recordButton').textContent = recording
    ? 'Стоп записи'
    : local?.parts.length
      ? 'Продолжить запись'
      : 'Начать запись';
  $('recordButton').classList.toggle('recording', recording);
  $('recordButton').disabled =
    busy || recorder.state === 'starting' || recorder.state === 'stopping';
  $('finishButton').disabled = busy || !local?.parts.length;
  $('audioInput').disabled = recording || busy;
  $('permissionButton').disabled = recording || busy;
  $('retryButton').disabled = busy;
  $('retryProcessingButton').disabled = busy || !current.commands?.length;
  $('abandonButton').disabled = busy;
  visible(
    'abandonButton',
    Boolean(lastError || current.error || current.status === 'save_failed'),
  );
  $('savingHint').textContent = busy
    ? 'Сохраняем запись. Дозапись уже завершена.'
    : current.audioStored === true
      ? 'Аудио в хранилище. Повторная передача файлов не требуется.'
      : 'Запись зафиксирована на этом устройстве. Можно повторить сохранение.';
  if (current.status === 'abandoned') {
    $('abandonedHint').textContent = local?.audioStored
      ? 'Аудио сохранено на сервере; локальная копия удалена.'
      : local?.audioExpired
        ? 'Срок хранения локальной копии истёк.'
        : 'Локальная копия доступна для скачивания в течение 3 часов после закрытия.';
  }
  updateTimer();
  if (current.status === 'completed' && !report && !reportLoading)
    void loadReport(current.requestId, routeVersion);
}
function updateTimer() {
  const ms =
    recorder.state === 'recording'
      ? recorder.previousMs + Date.now() - recorder.startedAt
      : (local?.parts ?? []).reduce((sum, part) => sum + part.durationMs, 0);
  const seconds = Math.floor(ms / 1000);
  $('timer').textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function shouldPoll(status) {
  return status === 'saving' || status === 'processing';
}
async function poll(id, version) {
  clearTimeout(pollTimer);
  if (version !== routeVersion || current?.requestId !== id) return;
  try {
    const row = await api.get(id);
    if (version !== routeVersion) return;
    notice('');
    await applyServer(row);
  } catch (error) {
    if (version === routeVersion) notice(errorMessage(error));
  }
  if (version === routeVersion && shouldPoll(current?.status))
    pollTimer = setTimeout(() => void poll(id, version), 2000);
}
async function loadReport(id, version) {
  reportLoading = true;
  try {
    const value = await api.report(id);
    if (version !== routeVersion) return;
    if (
      value.format !== 'markdown' ||
      value.schemaVersion !== 1 ||
      typeof value.content !== 'string'
    )
      throw new Error('Формат отчёта пока не поддерживается');
    report = value;
    $('reportContent').innerHTML = DOMPurify.sanitize(
      marked.parse(value.content),
      { FORBID_TAGS: ['img', 'style', 'iframe'] },
    );
    for (const link of $('reportContent').querySelectorAll('a'))
      link.rel = 'noopener noreferrer';
  } catch (error) {
    if (version === routeVersion) {
      showError(errorMessage(error));
      pollTimer = setTimeout(() => {
        if (version === routeVersion) void loadReport(id, version);
      }, 5000);
    }
  } finally {
    reportLoading = false;
  }
}
async function loadList(append = false) {
  const page = await api.list(append ? cursor : null);
  if (!append) $('requestList').replaceChildren();
  for (const row of page.items) {
    const card = document.createElement('a');
    card.href = `#/requests/${row.requestId}`;
    card.className = 'request-card';
    const time = document.createElement('strong');
    time.textContent = date(row.createdAt);
    const status = document.createElement('span');
    status.className = 'badge';
    status.textContent = labels[row.status] ?? row.status;
    const open = document.createElement('span');
    open.className = 'open-label';
    open.textContent = 'Открыть →';
    card.append(time, status, open);
    $('requestList').append(card);
  }
  cursor = page.nextCursor;
  visible('moreButton', Boolean(cursor));
  $('historyHint').textContent = $('requestList').children.length
    ? 'Все приёмы, включая незавершённые и закрытые без сохранения'
    : 'Приёмов пока нет. Начните первый.';
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function recoveryLinks() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
  $('recoveryDownloads').replaceChildren();
  if (
    current?.status !== 'abandoned' ||
    local?.audioStored ||
    local?.audioExpired
  )
    return;
  for (const part of await store.parts(current.requestId)) {
    if (!part.blob.size) continue;
    const url = URL.createObjectURL(part.blob);
    objectUrls.push(url);
    const a = document.createElement('a');
    a.className = 'secondary';
    a.href = url;
    a.download = `part_${part.partNo}_${current.requestId}.${part.mimeType.includes('mp4') ? 'm4a' : part.mimeType.includes('ogg') ? 'ogg' : 'webm'}`;
    a.textContent = `Скачать часть ${part.partNo}`;
    $('recoveryDownloads').append(a);
  }
}
async function route() {
  if (busy && current) {
    history.replaceState(null, '', `#/requests/${current.requestId}`);
    return;
  }
  const version = ++routeVersion;
  clearTimeout(pollTimer);
  notice('');
  clearError();
  report = null;
  reportLoading = false;
  $('reportContent').replaceChildren();
  if (recorder.state === 'recording') {
    await recorder.stop();
    meter.stop();
  }
  const id = location.hash.match(/^#\/requests\/([a-f0-9-]+)$/i)?.[1];
  visible('historyView', !id);
  visible('requestView', Boolean(id));
  current = null;
  local = null;
  try {
    if (!id) {
      await loadList();
      return;
    }
    const row = await api.get(id);
    if (version !== routeVersion) return;
    await applyServer(row);
    await recoveryLinks();
    if (row.status === 'created')
      await selector.refresh().catch(() => undefined);
    if (shouldPoll(row.status))
      pollTimer = setTimeout(() => void poll(id, version), 2000);
  } catch (error) {
    if (version !== routeVersion) return;
    notice(errorMessage(error));
    if (id) {
      const saved = await store.get(id);
      if (saved) {
        current = {
          requestId: id,
          status: saved.status,
          createdAt: saved.createdAt,
          audioStored: null,
        };
        local = saved;
        await render();
      }
      // Always retry status after a transient load failure; never forget the saved visit.
      if (error.code !== 'REQUEST_NOT_FOUND')
        pollTimer = setTimeout(() => void route(), 3000);
    }
  }
}
async function perform(action) {
  if (busy) return;
  busy = true;
  await render();
  try {
    await action();
  } catch (error) {
    showError(errorMessage(error));
  } finally {
    busy = false;
    await render();
  }
}
async function save() {
  const id = current.requestId;
  clearError();
  await recorder.finalize(id);
  meter.stop();
  await render();
  // Learn whether S3 is already durable before choosing body/no-body retry.
  let row;
  try {
    row = await api.get(id);
  } catch (error) {
    throw error;
  }
  await applyServer(row);
  if (
    ['processing', 'completed', 'abandoned', 'processing_failed'].includes(
      row.status,
    )
  )
    return;
  if (local.captureError)
    throw new Error(
      'При записи произошла ошибка локального сохранения. Аудио оставлено для разбора; можно закрыть приём без сохранения.',
    );
  let parts;
  if (!row.audioStored && row.error?.retryAction !== 'complete_without_audio') {
    parts = await store.parts(id);
    if (!parts.length || parts.some((p) => !p.blob.size))
      throw new Error('Локальное аудио недоступно на этом устройстве');
  }
  try {
    const saved = await api.complete(id, parts);
    await applyServer(saved);
  } catch (error) {
    showError(errorMessage(error));
    try {
      await applyServer(await api.get(id));
    } catch {
      /* keep the original error and frozen audio */
    }
  }
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void poll(id, routeVersion), 2000);
}
$('newButton').onclick = async () => {
  $('newButton').disabled = true;
  try {
    await store.database();
    const value = await api.create();
    await store.remember(value);
    navigate(value.requestId);
  } catch (error) {
    if (error.code === 'ACTIVE_REQUEST_EXISTS') {
      notice('Сначала завершите текущий приём.');
      navigate(error.requestId);
    } else notice(errorMessage(error));
  } finally {
    $('newButton').disabled = false;
  }
};
$('permissionButton').onclick = () =>
  void perform(async () => {
    await selector.requestPermissionAndRefresh();
  });
$('recordButton').onclick = () =>
  void perform(async () => {
    clearError();
    if (recorder.state === 'recording') {
      await recorder.stop();
      meter.stop();
    } else {
      if (!selector.selectedDeviceId) {
        await selector.requestPermissionAndRefresh();
        if (!selector.selectedDeviceId)
          throw new Error('Выберите микрофон в списке');
      }
      const row = await api.get(current.requestId);
      await applyServer(row);
      if (row.status !== 'created')
        throw new Error('Запись этого приёма уже завершена');
      const capture = await recorder.start(
        current.requestId,
        selector.selectedDeviceId,
      );
      if (capture)
        await meter.start(capture.stream, capture.track, () => undefined);
    }
  });
$('finishButton').onclick = () => void perform(save);
$('retryButton').onclick = () => void perform(save);
$('retryProcessingButton').onclick = () => void perform(async () => {
  clearError();
  await applyServer(await api.retryProcessing(current.requestId, current.commands[0].commandId));
  if (shouldPoll(current.status)) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => void poll(current.requestId, routeVersion), 2000);
  }
});
$('abandonButton').onclick = () =>
  void perform(async () => {
    if (
      !confirm(
        'Закрыть приём без отчёта? Локальное аудио без копии на сервере сохранится на 3 часа.',
      )
    )
      return;
    const row = await api.abandon(current.requestId);
    await applyServer(row);
    await recoveryLinks();
    if (row.httpStatus === 202)
      notice('Сохранение ещё выполняется. Уточняем его результат.');
  });
$('moreButton').onclick = async () => {
  $('moreButton').disabled = true;
  try {
    await loadList(true);
  } catch (error) {
    notice(errorMessage(error));
  } finally {
    $('moreButton').disabled = false;
  }
};
$('downloadButton').onclick = () => {
  if (report)
    download(
      new Blob([report.content], { type: 'text/markdown;charset=utf-8' }),
      `clinical_document_${report.requestId}.md`,
    );
};
window.addEventListener('hashchange', () => void route());
document.addEventListener('click', (event) => {
  if (busy && event.target.closest?.('a[href^="#/"]')) {
    event.preventDefault();
    notice('Дождитесь результата текущей операции.');
  }
});
window.addEventListener('beforeunload', (event) => {
  if (recorder.state === 'recording' || busy) {
    event.preventDefault();
    event.returnValue = '';
  }
});
setInterval(updateTimer, 250);
setInterval(() => {
  void store
    .cleanup()
    .then(async () => {
      if (current?.status === 'abandoned') {
        await render();
        await recoveryLinks();
      }
    })
    .catch((error) => notice(error.message));
}, 60000);
async function initialize() {
  await store.database();
  await store.cleanup();
  const legacy = await store.legacy();
  visible('legacyBox', Boolean(legacy.length));
  for (const old of legacy) {
    const button = document.createElement('button');
    button.className = 'secondary';
    button.textContent = `Скачать запись ${date(old.startedAt)}`;
    button.onclick = async () => {
      for (const part of await store.legacyParts(old.id))
        download(part.blob, `legacy_${old.id}_part_${part.number}.webm`);
    };
    $('legacyList').append(button);
  }
  await route();
}
void initialize().catch((error) => {
  notice(`Ошибка локального хранилища: ${error.message}`);
  $('newButton').disabled = true;
});
