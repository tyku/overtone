import type { RequestPageController } from '../../hooks/use-request-page-controller';

export function ProcessingFailedPanel({ controller }: { controller: RequestPageController }) {
  const { busy, current, perform, retryProcessing } = controller;
  return (
    <section id="failedPanel" className="panel">
      <h2>Ошибка обработки</h2>
      <p className="muted">
        Не удалось подготовить отчёт. Информация об ошибке сохранена для разбора.
      </p>
      <button
        id="retryProcessingButton"
        className="primary"
        disabled={busy || !current?.commands?.length}
        onClick={() => void perform(retryProcessing)}
      >
        Повторить обработку
      </button>
    </section>
  );
}
