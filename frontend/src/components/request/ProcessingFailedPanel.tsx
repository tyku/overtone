import type { RequestPageController } from '../../hooks/use-request-page-controller';

export function ProcessingFailedPanel({ controller }: { controller: RequestPageController }) {
  const { busy, current, errorText, canRetryProcessing, perform, retryProcessing } = controller;
  const timedOut = current?.error?.code === 'PROCESSING_TIMEOUT';
  return (
    <section id="failedPanel" className="panel">
      <h2>{timedOut ? 'Время ожидания отчёта истекло' : 'Ошибка обработки'}</h2>
      <p id="requestError" className="error" role="alert">
        {errorText || 'Не удалось подготовить отчёт.'}
      </p>
      {current?.audioStored === true && <p className="muted">Аудиозапись сохранена.</p>}
      {canRetryProcessing ? (
        <button
          id="retryProcessingButton"
          className="primary"
          disabled={busy}
          onClick={() => void perform(retryProcessing)}
        >
          Повторить обработку
        </button>
      ) : (
        <p className="muted">Повторная обработка сейчас недоступна.</p>
      )}
    </section>
  );
}
