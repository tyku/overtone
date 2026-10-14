import type {
  AudioPart,
  Report,
  RequestPage,
  RequestRow,
  RetryAction,
} from './types';
import {
  apiCall,
  ApiClientError,
  API_VERSION,
  API_VERSION_HEADER,
} from './shared/api-client';

export { API_VERSION, API_VERSION_HEADER };

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

export class RequestApi {
  private async call<T>(
    path: string,
    options: RequestInit = {},
  ): Promise<T & { httpStatus: number }> {
    try {
      return await apiCall<T>(
        `/api/requests${path}`,
        options,
        options.body instanceof FormData ? 35 * 60 * 1000 : 15_000,
      );
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw new ApiFailure(
          error.code === 'NETWORK_ERROR'
            ? 'Не удалось получить ответ сервера. Проверим состояние приёма.'
            : error.message,
          error.code === 'NETWORK_ERROR' ? 'REQUEST_STATE_UNKNOWN' : error.code,
          (error.details.error?.retryAction as RetryAction | undefined) ??
            (error.code === 'NETWORK_ERROR' ? 'check_status' : 'none'),
          error.details.requestId,
        );
      }
      throw new ApiFailure(
        'Не удалось получить ответ сервера. Проверим состояние приёма.',
        'REQUEST_STATE_UNKNOWN',
        'check_status',
      );
    }
  }

  async create(kind: 'regular' | 'demo' = 'regular'): Promise<RequestRow> {
    if (kind === 'demo') {
      try {
        const capability = await this.call<{ kind: string; ready: boolean }>(
          '/demo-capability',
        );
        if (capability.kind !== 'demo' || capability.ready !== true) {
          throw new ApiFailure(
            'Сервер не поддерживает демо-приём',
            'DEMO_UNSUPPORTED',
          );
        }
      } catch (error) {
        if (
          error instanceof ApiFailure &&
          ['INVALID_REQUEST_ID', 'REQUEST_NOT_FOUND'].includes(error.code)
        ) {
          throw new ApiFailure(
            'Сервер не поддерживает демо-приём. Обновите backend.',
            'DEMO_UNSUPPORTED',
          );
        }
        throw error;
      }
    }
    const row = await this.call<RequestRow>('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind }),
    });
    if (kind === 'demo' && row.kind !== 'demo') {
      await this.abandon(row.requestId).catch(() => undefined);
      throw new ApiFailure(
        'Сервер не создал демо-приём. Обновите backend.',
        'DEMO_KIND_MISMATCH',
      );
    }
    return row;
  }

  async demoAudio(id: string): Promise<Blob> {
    const headers = new Headers({ [API_VERSION_HEADER]: API_VERSION });
    const response = await fetch(
      `/api/requests/${encodeURIComponent(id)}/demo-audio`,
      {
        headers,
        credentials: 'same-origin',
      },
    );
    if (response.headers.get(API_VERSION_HEADER) !== API_VERSION) {
      throw new ApiFailure(
        'Версия API сервера не поддерживается',
        'API_VERSION_UNSUPPORTED',
      );
    }
    if (!response.ok) {
      throw new ApiFailure(
        'Не удалось загрузить демо-аудио',
        'DEMO_AUDIO_UNAVAILABLE',
      );
    }
    const blob = await response.blob();
    if (!blob.size)
      throw new ApiFailure('Демо-аудио пустое', 'DEMO_AUDIO_UNAVAILABLE');
    return new Blob([blob], { type: 'audio/mp4' });
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
      const digest = await crypto.subtle.digest(
        'SHA-256',
        await part.blob.arrayBuffer(),
      );
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
    return this.call<RequestRow>(
      `/${encodeURIComponent(id)}/retry-processing`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ commandId }),
      },
    );
  }
}
