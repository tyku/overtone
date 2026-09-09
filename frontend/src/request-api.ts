import type { AudioPart, Report, RequestPage, RequestRow, RetryAction } from './types';

export class ApiFailure extends Error {
  readonly code: string;
  readonly retryAction: RetryAction;
  readonly requestId?: string;

  constructor(
    message: string,
    code: string,
    retryAction: RetryAction = 'none',
    requestId?: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
    this.code = code;
    this.retryAction = retryAction;
    this.requestId = requestId;
  }
}

interface ErrorEnvelope {
  requestId?: string;
  error?: {
    code?: string;
    message?: string;
    retryAction?: RetryAction;
  };
}

export class RequestApi {
  private async call<T>(path: string, options: RequestInit = {}): Promise<T & { httpStatus: number }> {
    let response: Response;
    try {
      response = await fetch(`/api/requests${path}`, {
        ...options,
        signal: AbortSignal.timeout(
          options.body instanceof FormData ? 35 * 60 * 1000 : 15_000,
        ),
      });
    } catch {
      throw new ApiFailure(
        'Не удалось получить ответ сервера. Проверим состояние приёма.',
        'REQUEST_STATE_UNKNOWN',
        'check_status',
      );
    }

    const body = (await response.json().catch(() => null)) as T | ErrorEnvelope | null;
    if (!response.ok) {
      const envelope = body as ErrorEnvelope | null;
      throw new ApiFailure(
        envelope?.error?.message ?? 'Сервер временно недоступен',
        envelope?.error?.code ?? 'REQUEST_STATE_UNKNOWN',
        envelope?.error?.retryAction ?? 'check_status',
        envelope?.requestId,
      );
    }
    if (!body) {
      throw new ApiFailure(
        'Сервер вернул неполный ответ',
        'REQUEST_STATE_UNKNOWN',
        'check_status',
      );
    }
    return { ...(body as T), httpStatus: response.status };
  }

  create(): Promise<RequestRow> {
    return this.call<RequestRow>('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  }

  list(cursor?: string | null): Promise<RequestPage> {
    return this.call<RequestPage>(
      `?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
  }

  get(id: string): Promise<RequestRow> {
    return this.call<RequestRow>(`/${encodeURIComponent(id)}`);
  }

  async complete(id: string, parts?: AudioPart[]): Promise<RequestRow> {
    if (!parts) {
      return this.call<RequestRow>(`/${encodeURIComponent(id)}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    }

    const manifest: {
      parts: Array<{
        partNo: number;
        field: string;
        mimeType: string;
        bytes: number;
        sha256: string;
      }>;
    } = { parts: [] };
    const form = new FormData();

    // Hash sequentially so a long visit is never materialized in memory at once.
    for (const part of parts) {
      if (!part.blob.size) {
        throw new ApiFailure(
          'Одна из частей записи пуста. Аудио сохранено для разбора.',
          'EMPTY_AUDIO',
        );
      }
      const digest = await crypto.subtle.digest('SHA-256', await part.blob.arrayBuffer());
      const sha256 = [...new Uint8Array(digest)]
        .map((value) => value.toString(16).padStart(2, '0'))
        .join('');
      const field = `part_${part.partNo}`;
      manifest.parts.push({
        partNo: part.partNo,
        field,
        mimeType: part.mimeType,
        bytes: part.blob.size,
        sha256,
      });
      form.append(field, part.blob, `part_${part.partNo}_${id}`);
    }
    form.append('manifest', JSON.stringify(manifest));
    return this.call<RequestRow>(`/${encodeURIComponent(id)}/complete`, {
      method: 'POST',
      body: form,
    });
  }

  abandon(id: string): Promise<RequestRow> {
    return this.call<RequestRow>(`/${encodeURIComponent(id)}/abandon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Закрыто пользователем после ошибки сохранения',
      }),
    });
  }

  report(id: string): Promise<Report> {
    return this.call<Report>(`/${encodeURIComponent(id)}/report`);
  }

  retryProcessing(id: string, commandId: string): Promise<RequestRow> {
    return this.call<RequestRow>(`/${encodeURIComponent(id)}/retry-processing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commandId }),
    });
  }
}
