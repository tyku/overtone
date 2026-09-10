import type { RequestStatus } from '../types';

export const requestStatusLabels: Record<RequestStatus, string> = {
  created: 'Создан',
  saving: 'Сохранение аудио',
  save_failed: 'Ошибка сохранения',
  processing: 'Отчёт в обработке',
  completed: 'Завершён',
  processing_failed: 'Ошибка обработки',
  abandoned: 'Закрыт без сохранения',
};

export const isTerminalRequestStatus = (status: RequestStatus): boolean =>
  status === 'completed' || status === 'processing_failed' || status === 'abandoned';

export const isPollingRequestStatus = (status?: RequestStatus): boolean =>
  status === 'saving' || status === 'processing';
