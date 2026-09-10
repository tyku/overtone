export const API_VERSION_HEADER = 'X-Overtone-API-Version';
export const API_VERSION = '1';

type ErrorEnvelope = {
  requestId?: string;
  error?: { code?: string; message?: string; retryAction?: string };
};

export class ApiClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: ErrorEnvelope = {},
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

export async function apiCall<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T & { httpStatus: number }> {
  const headers = new Headers(options.headers);
  headers.set(API_VERSION_HEADER, API_VERSION);
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers,
      credentials: 'same-origin',
      signal: options.signal ?? AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new ApiClientError(0, 'NETWORK_ERROR', 'Сервер временно недоступен');
  }

  const responseVersion = response.headers.get(API_VERSION_HEADER);
  if (responseVersion !== API_VERSION) {
    throw new ApiClientError(
      response.status,
      'API_VERSION_UNSUPPORTED',
      `Frontend ожидает API v${API_VERSION}, сервер вернул ${responseVersion ? `v${responseVersion}` : 'ответ без версии'}`,
    );
  }

  const body = (await response.json().catch(() => null)) as T | ErrorEnvelope | null;
  if (!response.ok) {
    const envelope = body as ErrorEnvelope | null;
    throw new ApiClientError(
      response.status,
      envelope?.error?.code ?? 'API_ERROR',
      envelope?.error?.message ?? 'Сервер временно недоступен',
      envelope ?? {},
    );
  }
  if (!body) {
    throw new ApiClientError(
      response.status,
      'INVALID_RESPONSE',
      'Сервер вернул неполный ответ',
    );
  }
  return { ...(body as T), httpStatus: response.status };
}

