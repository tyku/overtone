import DOMPurify from 'dompurify';
import { marked } from 'marked';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { AudioMeter } from './audio-meter';
import { ApiFailure, RequestApi } from './request-api';
import { RequestStore } from './request-store';
import type {
  LegacyRecording,
  LocalRequest,
  Report,
  RequestRow,
  RequestStatus,
} from './types';
import { VisitRecorder } from './visit-recorder';

const store = new RequestStore();
const api = new RequestApi();
const AUDIO_INPUT_KEY = 'overtone.audioInputId';

const labels: Record<RequestStatus, string> = {
  created: 'Создан',
  saving: 'Сохранение аудио',
  save_failed: 'Ошибка сохранения',
  processing: 'Отчёт в обработке',
  completed: 'Завершён',
  processing_failed: 'Ошибка обработки',
  abandoned: 'Закрыт без сохранения',
};

function date(value: string | number): string {
  return new Date(value).toLocaleString('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function errorMessage(error: unknown): string {
  const messages: Record<string, string> = {
    NotAllowedError: 'Разрешите доступ к микрофону',
    NotFoundError: 'Микрофон не найден',
    NotReadableError: 'Микрофон занят другим приложением',
    AUDIO_UPLOAD_REQUIRED: 'Нужно повторно отправить сохранённое аудио',
    REQUEST_FINALIZATION_FAILED: 'Аудио сохранено. Нужно повторить закрытие приёма.',
    REQUEST_STATE_UNKNOWN:
      'Нет достоверного ответа сервера. Запись сохранена; проверяем состояние.',
    AUDIO_CONTENT_CONFLICT:
      'Содержимое записи отличается от ранее отправленного. Изменять завершённую запись нельзя.',
  };
  if (error instanceof ApiFailure) return messages[error.code] ?? error.message;
  if (error instanceof Error) return messages[error.name] ?? error.message;
  return String(error);
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function requestIdFromHash(hash: string): string | null {
  return hash.match(/^#\/requests\/([a-f0-9-]+)$/i)?.[1] ?? null;
}

function HistoryPage({ setNotice }: { setNotice: (message: string) => void }) {
  const [items, setItems] = useState<RequestRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [legacy, setLegacy] = useState<LegacyRecording[]>([]);

  const load = useCallback(
    async (append = false) => {
      try {
        const page = await api.list(append ? cursor : null);
        setItems((current) => (append ? [...current, ...page.items] : page.items));
        setCursor(page.nextCursor);
      } catch (error) {
        setNotice(errorMessage(error));
      }
    },
    [cursor, setNotice],
  );

  useEffect(() => {
    void load(false);
    void store.legacy().then(setLegacy).catch((error) => setNotice(errorMessage(error)));
    // The route remounts when returning from a request, which refreshes the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRequest = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await store.database();
      const value = await api.create();
      await store.remember(value);
      location.hash = `/requests/${value.requestId}`;
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'ACTIVE_REQUEST_EXISTS') {
        setNotice('Сначала завершите текущий приём.');
        if (error.requestId) location.hash = `/requests/${error.requestId}`;
      } else {
        setNotice(errorMessage(error));
      }
    } finally {
      setCreating(false);
    }
  };

  const showMore = async () => {
    setLoadingMore(true);
    await load(true);
    setLoadingMore(false);
  };

  const downloadLegacy = async (recording: LegacyRecording) => {
    try {
      for (const part of await store.legacyParts(recording.id)) {
        download(part.blob, `legacy_${recording.id}_part_${part.number}.webm`);
      }
    } catch (error) {
      setNotice(errorMessage(error));
    }
  };

  return (
    <section id="historyView">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Рабочее пространство</p>
          <h1>Приёмы</h1>
        </div>
        <button id="newButton" className="primary" disabled={creating} onClick={createRequest}>
          Начать новый приём
        </button>
      </div>
      <p id="historyHint" className="muted">
        {items.length
          ? 'Все приёмы, включая незавершённые и закрытые без сохранения'
          : 'Приёмов пока нет. Начните первый.'}
      </p>
      <div id="requestList" className="request-list">
        {items.map((row) => (
          <a key={row.requestId} href={`#/requests/${row.requestId}`} className="request-card">
            <strong>{date(row.createdAt)}</strong>
            <span className="badge">{labels[row.status] ?? row.status}</span>
            <span className="open-label">Открыть →</span>
          </a>
        ))}
      </div>
      {cursor && (
        <button id="moreButton" className="secondary" disabled={loadingMore} onClick={showMore}>
          Показать ещё
        </button>
      )}
      {legacy.length > 0 && (
        <details id="legacyBox">
          <summary>Аудио из предыдущей версии</summary>
          <p className="muted">
            Исходные записи сохранены на этом устройстве. Их можно скачать для разбора.
          </p>
          <div id="legacyList">
            {legacy.map((recording) => (
              <button
                key={recording.id}
                className="secondary"
                onClick={() => void downloadLegacy(recording)}
              >
                Скачать запись {date(recording.startedAt)}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

interface RequestPageProps {
  requestId: string;
  setNotice: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}

function RequestPage({ requestId, setNotice, onBusyChange }: RequestPageProps) {
  const [current, setCurrent] = useState<RequestRow | null>(null);
  const [local, setLocal] = useState<LocalRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [reportHtml, setReportHtml] = useState('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState(
    () => localStorage.getItem(AUDIO_INPUT_KEY) ?? '',
  );
  const [elapsedMs, setElapsedMs] = useState(0);
  const [, refreshRecorderState] = useReducer((value: number) => value + 1, 0);
  const inputLevelRef = useRef<HTMLParagraphElement>(null);
  const reportRef = useRef<HTMLElement>(null);
  const meterRef = useRef<AudioMeter | undefined>(undefined);
  const recorderRef = useRef<VisitRecorder | undefined>(undefined);
  if (!recorderRef.current) {
    recorderRef.current = new VisitRecorder(store, (error) => {
      setLastError(error.message);
      refreshRecorderState();
    });
  }
  const recorder = recorderRef.current;

  const applyServer = useCallback(async (row: RequestRow): Promise<LocalRequest> => {
    const remembered = await store.remember(row);
    setCurrent(row);
    setLocal(remembered);
    if (['processing', 'completed', 'abandoned', 'processing_failed'].includes(row.status)) {
      setLastError(null);
    }
    return remembered;
  }, []);

  const refreshLocal = useCallback(async () => {
    const saved = await store.get(requestId);
    setLocal(saved ?? null);
    return saved;
  }, [requestId]);

  const refreshDevices = useCallback(async () => {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
      (device) => device.kind === 'audioinput',
    );
    setDevices(inputs);
    const remembered = localStorage.getItem(AUDIO_INPUT_KEY) ?? '';
    if (inputs.some((input) => input.deviceId === selectedDeviceId)) return;
    setSelectedDeviceId(inputs.some((input) => input.deviceId === remembered) ? remembered : '');
  }, [selectedDeviceId]);

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;
    const load = async () => {
      try {
        const row = await api.get(requestId);
        if (!active) return;
        setNotice('');
        await applyServer(row);
      } catch (error) {
        if (!active) return;
        setNotice(errorMessage(error));
        const saved = await store.get(requestId);
        if (!active) return;
        if (saved) {
          setCurrent({
            requestId,
            status: saved.status,
            createdAt: saved.createdAt,
            audioStored: null,
          });
          setLocal(saved);
        }
        if (!(error instanceof ApiFailure) || error.code !== 'REQUEST_NOT_FOUND') {
          retryTimer = window.setTimeout(() => void load(), 3000);
        }
      }
    };
    void load();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [applyServer, requestId, setNotice]);

  useEffect(() => {
    if (current?.status === 'created') void refreshDevices().catch(() => undefined);
  }, [current?.status, refreshDevices]);

  useEffect(() => {
    if (current?.status !== 'saving' && current?.status !== 'processing') return;
    let active = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const row = await api.get(requestId);
        if (active) {
          setNotice('');
          await applyServer(row);
          if (row.status === 'saving' || row.status === 'processing') {
            timer = window.setTimeout(() => void poll(), 2000);
          }
        }
      } catch (error) {
        if (active) {
          setNotice(errorMessage(error));
          timer = window.setTimeout(() => void poll(), 2000);
        }
      }
    };
    timer = window.setTimeout(() => void poll(), 2000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [applyServer, current?.status, requestId, setNotice]);

  useEffect(() => {
    if (current?.status !== 'completed') {
      setReport(null);
      setReportHtml('');
      return;
    }
    let active = true;
    let retryTimer: number | undefined;
    const loadReport = async () => {
      try {
        const value = await api.report(requestId);
        if (
          value.format !== 'markdown' ||
          value.schemaVersion !== 1 ||
          typeof value.content !== 'string'
        ) {
          throw new Error('Формат отчёта пока не поддерживается');
        }
        const parsed = await marked.parse(value.content);
        if (!active) return;
        setReport(value);
        setReportHtml(DOMPurify.sanitize(parsed, { FORBID_TAGS: ['img', 'style', 'iframe'] }));
      } catch (error) {
        if (!active) return;
        setLastError(errorMessage(error));
        retryTimer = window.setTimeout(() => void loadReport(), 5000);
      }
    };
    void loadReport();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [current?.status, requestId]);

  useEffect(() => {
    for (const link of reportRef.current?.querySelectorAll('a') ?? []) {
      link.rel = 'noopener noreferrer';
    }
  }, [reportHtml]);

  useEffect(() => {
    if (recorder.state !== 'recording') {
      setElapsedMs(local?.parts.reduce((sum, part) => sum + part.durationMs, 0) ?? 0);
      return;
    }
    const update = () => setElapsedMs(recorder.previousMs + Date.now() - recorder.startedAt);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [local, recorder, recorder.state]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void store.cleanup().then(refreshLocal).catch((error) => setNotice(errorMessage(error)));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshLocal, setNotice]);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (recorder.state === 'recording' || busy) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [busy, recorder, recorder.state]);

  useEffect(
    () => () => {
      meterRef.current?.stop();
      if (recorder.state === 'recording') void recorder.stop();
    },
    [recorder],
  );

  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setLastError(errorMessage(error));
    } finally {
      setBusy(false);
      await refreshLocal();
      refreshRecorderState();
    }
  };

  const requestPermission = async () => {
    const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    permissionStream.getTracks().forEach((track) => track.stop());
    await refreshDevices();
  };

  const toggleRecording = async () => {
    setLastError(null);
    if (recorder.state === 'recording') {
      await recorder.stop();
      meterRef.current?.stop();
      return;
    }
    let deviceId = selectedDeviceId;
    if (!deviceId) {
      await requestPermission();
      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter(
        (device) => device.kind === 'audioinput',
      );
      deviceId = inputs[0]?.deviceId ?? '';
      if (deviceId) {
        setSelectedDeviceId(deviceId);
        localStorage.setItem(AUDIO_INPUT_KEY, deviceId);
      }
      if (!deviceId) throw new Error('Выберите микрофон в списке');
    }
    const row = await api.get(requestId);
    await applyServer(row);
    if (row.status !== 'created') throw new Error('Запись этого приёма уже завершена');
    const capture = await recorder.start(requestId, deviceId);
    if (capture && inputLevelRef.current) {
      meterRef.current ??= new AudioMeter(inputLevelRef.current);
      await meterRef.current.start(capture.stream, capture.track);
    }
  };

  const save = async () => {
    setLastError(null);
    await recorder.finalize(requestId);
    meterRef.current?.stop();
    refreshRecorderState();
    await refreshLocal();
    const serverRow = await api.get(requestId);
    const localRow = await applyServer(serverRow);
    if (['processing', 'completed', 'abandoned', 'processing_failed'].includes(serverRow.status)) {
      return;
    }
    if (localRow.captureError) {
      throw new Error(
        'При записи произошла ошибка локального сохранения. Аудио оставлено для разбора; можно закрыть приём без сохранения.',
      );
    }
    let parts;
    if (!serverRow.audioStored && serverRow.error?.retryAction !== 'complete_without_audio') {
      parts = await store.parts(requestId);
      if (!parts.length || parts.some((part) => !part.blob.size)) {
        throw new Error('Локальное аудио недоступно на этом устройстве');
      }
    }
    try {
      await applyServer(await api.complete(requestId, parts));
    } catch (error) {
      setLastError(errorMessage(error));
      try {
        await applyServer(await api.get(requestId));
      } catch {
        // Keep the original error and frozen local audio.
      }
    }
  };

  const retryProcessing = async () => {
    const commandId = current?.commands?.[0]?.commandId;
    if (!commandId) return;
    setLastError(null);
    await applyServer(await api.retryProcessing(requestId, commandId));
  };

  const abandon = async () => {
    if (
      !confirm(
        'Закрыть приём без отчёта? Локальное аудио без копии на сервере сохранится на 3 часа.',
      )
    ) {
      return;
    }
    const row = await api.abandon(requestId);
    await applyServer(row);
    if (row.httpStatus === 202) setNotice('Сохранение ещё выполняется. Уточняем его результат.');
  };

  const selectDevice = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (deviceId) localStorage.setItem(AUDIO_INPUT_KEY, deviceId);
    else localStorage.removeItem(AUDIO_INPUT_KEY);
  };

  const frozen = Boolean(local?.frozenAt);
  const recording = recorder.state === 'recording';
  const saving = Boolean(
    current &&
      (['saving', 'save_failed'].includes(current.status) ||
        (current.status === 'created' && frozen)),
  );
  const status = current
    ? saving
      ? lastError || current.status === 'save_failed'
        ? labels.save_failed
        : labels.saving
      : labels[current.status]
    : 'Загрузка';
  const errorText =
    lastError ?? local?.captureError ?? (current?.error ? errorMessage(current.error) : '');
  const seconds = Math.floor(elapsedMs / 1000);
  const timerText = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(
    seconds % 60,
  ).padStart(2, '0')}`;

  return (
    <section id="requestView">
      <a href="#/requests" className="back">← Все приёмы</a>
      <div className="page-heading">
        <div>
          <p id="requestDate" className="eyebrow">{current ? date(current.createdAt) : ''}</p>
          <h1>Приём</h1>
        </div>
        <span id="requestStatus" className="badge" role="status">{status}</span>
      </div>
      <p id="requestId" className="identifier">{requestId}</p>
      {errorText && <p id="requestError" className="error" role="alert">{errorText}</p>}

      {current?.status === 'created' && !frozen && (
        <section id="recorderPanel" className="panel">
          <p id="timer" className="timer">{timerText}</p>
          <p id="recordingHint" className="muted">Аудио сохраняется на этом устройстве</p>
          <label className="input-picker" htmlFor="audioInput">
            Микрофон
            <select
              id="audioInput"
              value={selectedDeviceId}
              disabled={recording || busy}
              onChange={(event) => selectDevice(event.target.value)}
            >
              <option value="">Выберите микрофон</option>
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Микрофон ${index + 1}`}
                </option>
              ))}
            </select>
          </label>
          <button
            id="permissionButton"
            className="secondary"
            disabled={recording || busy}
            onClick={() => void perform(requestPermission)}
          >
            Разрешить доступ к микрофону
          </button>
          <p id="inputLevel" ref={inputLevelRef} className="input-level">
            Уровень сигнала появится после старта записи
          </p>
          <div className="actions">
            <button
              id="recordButton"
              className={`primary${recording ? ' recording' : ''}`}
              disabled={busy || recorder.state === 'starting' || recorder.state === 'stopping'}
              onClick={() => void perform(toggleRecording)}
            >
              {recording ? 'Стоп записи' : local?.parts.length ? 'Продолжить запись' : 'Начать запись'}
            </button>
            <button
              id="finishButton"
              className="secondary"
              disabled={busy || !local?.parts.length}
              onClick={() => void perform(save)}
            >
              Завершить приём
            </button>
          </div>
        </section>
      )}

      {saving && current && (
        <section id="savingPanel" className="panel">
          <h2>Сохранение аудио</h2>
          <p id="savingHint" className="muted">
            {busy
              ? 'Сохраняем запись. Дозапись уже завершена.'
              : current.audioStored === true
                ? 'Аудио в хранилище. Повторная передача файлов не требуется.'
                : 'Запись зафиксирована на этом устройстве. Можно повторить сохранение.'}
          </p>
          <div className="actions">
            <button id="retryButton" className="primary" disabled={busy} onClick={() => void perform(save)}>
              Повторить сохранение
            </button>
            {(lastError || current.error || current.status === 'save_failed') && (
              <button id="abandonButton" className="danger" disabled={busy} onClick={() => void perform(abandon)}>
                Закрыть без сохранения
              </button>
            )}
          </div>
        </section>
      )}

      {current?.status === 'processing' && (
        <section id="waitingPanel" className="panel">
          <div className="activity" aria-hidden="true" />
          <h2>Отчёт в обработке</h2>
          <p className="muted">Результат появится здесь автоматически. Можно вернуться к списку приёмов.</p>
        </section>
      )}

      {current?.status === 'abandoned' && <AbandonedPanel requestId={requestId} local={local} />}

      {current?.status === 'processing_failed' && (
        <section id="failedPanel" className="panel">
          <h2>Ошибка обработки</h2>
          <p className="muted">Не удалось подготовить отчёт. Информация об ошибке сохранена для разбора.</p>
          <button
            id="retryProcessingButton"
            className="primary"
            disabled={busy || !current.commands?.length}
            onClick={() => void perform(retryProcessing)}
          >
            Повторить обработку
          </button>
        </section>
      )}

      {current?.status === 'completed' && (
        <section id="reportPanel">
          <div className="report-toolbar">
            <h2>Отчёт</h2>
            <button
              id="downloadButton"
              className="secondary"
              disabled={!report}
              onClick={() => {
                if (report) {
                  download(
                    new Blob([report.content], { type: 'text/markdown;charset=utf-8' }),
                    `clinical_document_${report.requestId}.md`,
                  );
                }
              }}
            >
              Скачать .md
            </button>
          </div>
          <article
            id="reportContent"
            ref={reportRef}
            className="report"
            dangerouslySetInnerHTML={{ __html: reportHtml }}
          />
        </section>
      )}
    </section>
  );
}

function AbandonedPanel({ requestId, local }: { requestId: string; local: LocalRequest | null }) {
  const [links, setLinks] = useState<Array<{ partNo: number; mimeType: string; url: string }>>([]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    if (!local?.audioStored && !local?.audioExpired) {
      void store.parts(requestId).then((parts) => {
        if (!active) return;
        setLinks(
          parts.filter((part) => part.blob.size).map((part) => {
            const url = URL.createObjectURL(part.blob);
            urls.push(url);
            return { partNo: part.partNo, mimeType: part.mimeType, url };
          }),
        );
      });
    }
    return () => {
      active = false;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [local?.audioExpired, local?.audioStored, requestId]);

  const hint = local?.audioStored
    ? 'Аудио сохранено на сервере; локальная копия удалена.'
    : local?.audioExpired
      ? 'Срок хранения локальной копии истёк.'
      : 'Локальная копия доступна для скачивания в течение 3 часов после закрытия.';

  return (
    <section id="abandonedPanel" className="panel">
      <h2>Приём закрыт без сохранения</h2>
      <p id="abandonedHint" className="muted">{hint}</p>
      <div id="recoveryDownloads" className="actions">
        {links.map((link) => (
          <a
            key={link.partNo}
            className="secondary"
            href={link.url}
            download={`part_${link.partNo}_${requestId}.${
              link.mimeType.includes('mp4') ? 'm4a' : link.mimeType.includes('ogg') ? 'ogg' : 'webm'
            }`}
          >
            Скачать часть {link.partNo}
          </a>
        ))}
      </div>
    </section>
  );
}

export function App() {
  const [hash, setHash] = useState(location.hash);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useMemo(() => requestIdFromHash(hash), [hash]);

  useEffect(() => {
    if (!location.hash) location.hash = '/requests';
    const onHashChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onHashChange);
    void store
      .database()
      .then(() => store.cleanup())
      .catch((error) => setNotice(`Ошибка локального хранилища: ${errorMessage(error)}`));
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const preventNavigationWhileBusy = (event: ReactMouseEvent<HTMLElement>) => {
    if (busy && (event.target as Element).closest?.('a[href^="#/"]')) {
      event.preventDefault();
      setNotice('Дождитесь результата текущей операции.');
    }
  };

  return (
    <main className="shell" onClick={preventNavigationWhileBusy}>
      <header className="topbar">
        <a className="brand" href="#/requests">Overtone</a>
        <a href="#/requests">Приёмы</a>
      </header>
      {notice && <p id="notice" className="notice" role="status">{notice}</p>}
      {requestId ? (
        <RequestPage requestId={requestId} setNotice={setNotice} onBusyChange={setBusy} />
      ) : (
        <HistoryPage setNotice={setNotice} />
      )}
    </main>
  );
}
