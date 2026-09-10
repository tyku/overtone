import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useEffect, useState } from 'react';
import { requestApi } from '../app/services';
import { errorMessage } from '../shared/errors';
import type { Report, RequestStatus } from '../types';

export function useRequestReport(
  requestId: string,
  status: RequestStatus | undefined,
  setLastError: (message: string | null) => void,
) {
  const [report, setReport] = useState<Report | null>(null);
  const [reportHtml, setReportHtml] = useState('');

  useEffect(() => {
    if (status !== 'completed') {
      setReport(null);
      setReportHtml('');
      return;
    }

    let active = true;
    let retryTimer: number | undefined;
    let retryDelay = 5_000;
    const loadReport = async () => {
      try {
        const value = await requestApi.report(requestId);
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
        retryTimer = window.setTimeout(() => void loadReport(), retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30_000);
      }
    };

    void loadReport();
    return () => {
      active = false;
      window.clearTimeout(retryTimer);
    };
  }, [requestId, setLastError, status]);

  return { report, reportHtml };
}
