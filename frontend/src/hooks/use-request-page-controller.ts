import { useCallback, useEffect, useState } from 'react';
import { requestApi, requestStore } from '../app/services';
import { errorMessage } from '../shared/errors';
import { formatDuration } from '../shared/format';
import { requestStatusLabels } from '../shared/request-status';
import type { AudioPart } from '../types';
import { useRecordingSession } from './use-recording-session';
import { useRequestData } from './use-request-data';
import { useRequestReport } from './use-request-report';

interface RequestPageControllerOptions {
  requestId: string;
  setNotice: (message: string) => void;
  onBusyChange: (busy: boolean) => void;
}

export function useRequestPageController({
  requestId,
  setNotice,
  onBusyChange,
}: RequestPageControllerOptions) {
  const [busy, setBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const clearResolvedError = useCallback(() => setLastError(null), []);
  const { current, local, applyServer, refreshLocal } = useRequestData({
    requestId,
    setNotice,
    clearResolvedError,
  });
  const recording = useRecordingSession({
    requestId,
    status: current?.status,
    local,
    busy,
    setLastError,
    applyServer,
  });
  const { report, reportHtml } = useRequestReport(requestId, current?.status, setLastError);

  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);

  const perform = useCallback(
    async (action: () => Promise<void>) => {
      if (busy) return;
      setBusy(true);
      try {
        await action();
      } catch (error) {
        setLastError(errorMessage(error));
      } finally {
        setBusy(false);
        await refreshLocal();
        recording.refreshRecorderState();
      }
    },
    [busy, recording, refreshLocal],
  );

  const save = useCallback(async () => {
    setLastError(null);
    await recording.finalize();
    recording.stopMeter();
    recording.refreshRecorderState();
    await refreshLocal();
    const serverRow = await requestApi.get(requestId);
    const localRow = await applyServer(serverRow);
    if (['processing', 'completed', 'abandoned', 'processing_failed'].includes(serverRow.status)) {
      return;
    }
    if (localRow.captureError) {
      throw new Error(
        'При записи произошла ошибка локального сохранения. Аудио оставлено для разбора; можно закрыть приём без сохранения.',
      );
    }

    let parts: AudioPart[] | undefined;
    if (!serverRow.audioStored && serverRow.error?.retryAction !== 'complete_without_audio') {
      parts = await requestStore.parts(requestId);
      if (!parts.length || parts.some((part) => !part.blob.size)) {
        throw new Error('Локальное аудио недоступно на этом устройстве');
      }
    }
    try {
      await applyServer(await requestApi.complete(requestId, parts));
    } catch (error) {
      setLastError(errorMessage(error));
      try {
        await applyServer(await requestApi.get(requestId));
      } catch {
        // Preserve the original error and the frozen local audio.
      }
    }
  }, [applyServer, recording, refreshLocal, requestId]);

  const retryProcessing = useCallback(async () => {
    const commandId = current?.commands?.[0]?.commandId;
    if (!commandId) return;
    setLastError(null);
    await applyServer(await requestApi.retryProcessing(requestId, commandId));
  }, [applyServer, current?.commands, requestId]);

  const abandon = useCallback(async () => {
    if (
      !confirm(
        'Закрыть приём без отчёта? Локальное аудио без копии на сервере сохранится на 3 часа.',
      )
    ) {
      return;
    }
    const row = await requestApi.abandon(requestId);
    await applyServer(row);
    if (row.httpStatus === 202) setNotice('Сохранение ещё выполняется. Уточняем его результат.');
  }, [applyServer, requestId, setNotice]);

  const frozen = Boolean(local?.frozenAt);
  const saving = Boolean(
    current &&
      (['saving', 'save_failed'].includes(current.status) ||
        (current.status === 'created' && frozen)),
  );
  const statusLabel = current
    ? saving
      ? lastError || current.status === 'save_failed'
        ? requestStatusLabels.save_failed
        : requestStatusLabels.saving
      : requestStatusLabels[current.status]
    : 'Загрузка';
  const errorText =
    lastError ?? local?.captureError ?? (current?.error ? errorMessage(current.error) : '');

  return {
    requestId,
    current,
    local,
    busy,
    frozen,
    saving,
    statusLabel,
    errorText,
    report,
    reportHtml,
    timerText: formatDuration(recording.elapsedMs),
    recording,
    perform,
    save,
    retryProcessing,
    abandon,
  };
}

export type RequestPageController = ReturnType<typeof useRequestPageController>;
