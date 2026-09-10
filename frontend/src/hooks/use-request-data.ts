import { useCallback, useEffect, useState } from 'react';
import { requestApi, requestStore } from '../app/services';
import { ApiFailure } from '../request-api';
import { errorMessage } from '../shared/errors';
import { isTerminalRequestStatus } from '../shared/request-status';
import type { LocalRequest, RequestRow } from '../types';
import { useRequestPolling } from './use-request-polling';

interface RequestDataOptions {
  requestId: string;
  setNotice: (message: string) => void;
  clearResolvedError: () => void;
}

export function useRequestData({
  requestId,
  setNotice,
  clearResolvedError,
}: RequestDataOptions) {
  const [current, setCurrent] = useState<RequestRow | null>(null);
  const [local, setLocal] = useState<LocalRequest | null>(null);

  const applyServer = useCallback(
    async (row: RequestRow): Promise<LocalRequest> => {
      const remembered = await requestStore.remember(row);
      setCurrent(row);
      setLocal(remembered);
      if (isTerminalRequestStatus(row.status) || row.status === 'processing') {
        clearResolvedError();
      }
      return remembered;
    },
    [clearResolvedError],
  );

  const refreshLocal = useCallback(async () => {
    const saved = await requestStore.get(requestId);
    setLocal(saved ?? null);
    return saved;
  }, [requestId]);

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;
    let retryDelay = 3_000;

    const loadInitial = async () => {
      try {
        const row = await requestApi.get(requestId);
        if (!active) return;
        setNotice('');
        await applyServer(row);
      } catch (error) {
        if (!active) return;
        setNotice(errorMessage(error));
        const saved = await requestStore.get(requestId);
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
          retryTimer = window.setTimeout(() => void loadInitial(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 15_000);
        }
      }
    };

    void loadInitial();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [applyServer, requestId, setNotice]);

  const handlePollRow = useCallback(
    async (row: RequestRow) => {
      setNotice('');
      await applyServer(row);
    },
    [applyServer, setNotice],
  );
  const handlePollError = useCallback(
    (error: unknown) => setNotice(errorMessage(error)),
    [setNotice],
  );
  const loadRequest = useCallback((id: string) => requestApi.get(id), []);

  useRequestPolling({
    requestId,
    status: current?.status,
    load: loadRequest,
    onRow: handlePollRow,
    onError: handlePollError,
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      void requestStore.cleanup().then(refreshLocal).catch((error) => setNotice(errorMessage(error)));
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [refreshLocal, setNotice]);

  return { current, local, applyServer, refreshLocal };
}
