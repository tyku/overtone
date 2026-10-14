import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../src/request-api';
import { errorMessage } from '../src/shared/errors';

describe('errorMessage', () => {
  it('shows the message from a structured server error', () => {
    const message = 'Не удалось получить отчёт за 5 минут. Выполнение GPU могло продолжиться.';
    expect(errorMessage({ code: 'PROCESSING_TIMEOUT', message, retryAction: 'none' })).toBe(message);
  });

  it('uses the same localized message for API failures and request state errors', () => {
    expect(errorMessage({ code: 'REQUEST_FINALIZATION_FAILED', message: 'Retry closing' })).toBe(
      errorMessage(new ApiFailure('Retry closing', 'REQUEST_FINALIZATION_FAILED')),
    );
  });

  it('preserves ordinary errors, microphone guidance and string messages', () => {
    expect(errorMessage(new Error('Не удалось сохранить запись'))).toBe('Не удалось сохранить запись');
    expect(errorMessage(new DOMException('Permission denied', 'NotAllowedError'))).toBe(
      'Разрешите доступ к микрофону',
    );
    expect(errorMessage('Соединение потеряно')).toBe('Соединение потеряно');
  });

  it.each([null, undefined, {}, { message: {} }, { message: ' ' }, ''])(
    'provides readable fallback text for %j',
    (error) => {
      expect(errorMessage(error)).toBe('Произошла ошибка. Подробности недоступны.');
    },
  );
});
