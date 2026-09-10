import { useEffect } from 'react';
import type { RequestRow, RequestStatus } from '../types';
import { isPollingRequestStatus } from '../shared/request-status';

const POLL_INTERVAL_MS = 2_000;
const MAX_ERROR_DELAY_MS = 15_000;

interface RequestPollingOptions {
  requestId: string;
  status?: RequestStatus;
  load: (requestId: string) => Promise<RequestRow>;
  onRow: (row: RequestRow) => Promise<void> | void;
  onError: (error: unknown) => void;
}

/**
 * Polls only while the request is in a transient server state.
 * Network failures use exponential backoff; returning online or focusing the tab retries immediately.
 */
export function useRequestPolling({
  requestId,
  status,
  load,
  onRow,
  onError,
}: RequestPollingOptions): void {
  useEffect(() => {
    if (!isPollingRequestStatus(status)) return;

    let active = true;
    let inFlight = false;
    let timer: number | undefined;
    let errorDelay = POLL_INTERVAL_MS;

    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const row = await load(requestId);
        if (!active) return;
        await onRow(row);
        errorDelay = POLL_INTERVAL_MS;
        if (active && isPollingRequestStatus(row.status)) schedule(POLL_INTERVAL_MS);
      } catch (error) {
        if (!active) return;
        onError(error);
        errorDelay = Math.min(errorDelay * 2, MAX_ERROR_DELAY_MS);
        schedule(errorDelay);
      } finally {
        inFlight = false;
      }
    };

    const retryWhenVisible = () => {
      if (document.visibilityState === 'visible') schedule(0);
    };
    const retryWhenOnline = () => schedule(0);

    schedule(POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', retryWhenVisible);
    window.addEventListener('online', retryWhenOnline);
    return () => {
      active = false;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', retryWhenVisible);
      window.removeEventListener('online', retryWhenOnline);
    };
  }, [load, onError, onRow, requestId, status]);
}
