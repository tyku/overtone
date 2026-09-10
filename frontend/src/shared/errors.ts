import { ApiFailure } from '../request-api';

const messages: Record<string, string> = {
  NotAllowedError: 'Разрешите доступ к микрофону',
  NotFoundError: 'Микрофон не найден',
  NotReadableError: 'Микрофон занят другим приложением',
  AUDIO_UPLOAD_REQUIRED: 'Нужно повторно отправить сохранённое аудио',
  REQUEST_FINALIZATION_FAILED: 'Аудио сохранено. Нужно повторить закрытие приёма.',
  REQUEST_STATE_UNKNOWN: 'Нет достоверного ответа сервера. Запись сохранена; проверяем состояние.',
  AUDIO_CONTENT_CONFLICT:
    'Содержимое записи отличается от ранее отправленного. Изменять завершённую запись нельзя.',
  API_VERSION_UNSUPPORTED:
    'Версии приложения и API несовместимы. Обновите страницу или обратитесь к администратору.',
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiFailure) return messages[error.code] ?? error.message;
  if (error instanceof Error) return messages[error.name] ?? error.message;
  return String(error);
}
