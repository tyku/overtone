import { useCallback, useEffect, useState } from 'react';
import { requestApi, requestStore } from '../app/services';
import { ApiFailure } from '../request-api';
import { downloadBlob } from '../shared/download';
import { errorMessage } from '../shared/errors';
import { formatDate } from '../shared/format';
import { requestStatusLabels } from '../shared/request-status';
import type { LegacyRecording, RequestRow } from '../types';

interface HistoryPageProps {
  setNotice: (message: string) => void;
}

export function HistoryPage({ setNotice }: HistoryPageProps) {
  const [items, setItems] = useState<RequestRow[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [legacy, setLegacy] = useState<LegacyRecording[]>([]);

  const load = useCallback(
    async (append = false) => {
      try {
        const page = await requestApi.list(append ? cursor : null);
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
    void requestStore.legacy().then(setLegacy).catch((error) => setNotice(errorMessage(error)));
    // Returning to this route remounts the page and refreshes the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRequest = async () => {
    if (creating) return;
    setCreating(true);
    try {
      await requestStore.database();
      const value = await requestApi.create();
      await requestStore.remember(value);
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
      for (const part of await requestStore.legacyParts(recording.id)) {
        downloadBlob(part.blob, `legacy_${recording.id}_part_${part.number}.webm`);
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
            <strong>{formatDate(row.createdAt)}</strong>
            <span className="badge">{requestStatusLabels[row.status] ?? row.status}</span>
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
                Скачать запись {formatDate(recording.startedAt)}
              </button>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
