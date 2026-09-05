export class ApiFailure extends Error {
  constructor(message, code, retryAction = 'none', requestId) {
    super(message);
    Object.assign(this, { code, retryAction, requestId });
  }
}
export class RequestApi {
  async call(path, options = {}) {
    let response;
    try {
      response = await fetch(`/api/requests${path}`, {
        ...options,
        signal: AbortSignal.timeout(
          options.body instanceof FormData ? 35 * 60 * 1000 : 15000,
        ),
      });
    } catch {
      throw new ApiFailure(
        'Не удалось получить ответ сервера. Проверим состояние приёма.',
        'REQUEST_STATE_UNKNOWN',
        'check_status',
      );
    }
    const body = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiFailure(
        body?.error?.message ?? 'Сервер временно недоступен',
        body?.error?.code ?? 'REQUEST_STATE_UNKNOWN',
        body?.error?.retryAction ?? 'check_status',
        body?.requestId,
      );
    if (!body)
      throw new ApiFailure(
        'Сервер вернул неполный ответ',
        'REQUEST_STATE_UNKNOWN',
        'check_status',
      );
    return { ...body, httpStatus: response.status };
  }
  create() {
    return this.call('', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
  }
  list(cursor) {
    return this.call(
      `?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
  }
  get(id) {
    return this.call(`/${encodeURIComponent(id)}`);
  }
  async complete(id, parts) {
    if (!parts)
      return this.call(`/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
    const manifest = { parts: [] };
    const form = new FormData();
    // Hash one part at a time; do not materialize the entire visit in RAM.
    for (const part of parts) {
      if (!part.blob.size)
        throw new ApiFailure(
          'Одна из частей записи пуста. Аудио сохранено для разбора.',
          'EMPTY_AUDIO',
        );
      const digest = await crypto.subtle.digest(
        'SHA-256',
        await part.blob.arrayBuffer(),
      );
      const sha256 = [...new Uint8Array(digest)]
        .map((n) => n.toString(16).padStart(2, '0'))
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
    return this.call(`/${id}/complete`, { method: 'POST', body: form });
  }
  abandon(id) {
    return this.call(`/${id}/abandon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reason: 'Закрыто пользователем после ошибки сохранения',
      }),
    });
  }
  report(id) {
    return this.call(`/${id}/report`);
  }
}
