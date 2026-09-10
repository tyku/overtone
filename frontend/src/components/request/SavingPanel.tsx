import type { RequestPageController } from '../../hooks/use-request-page-controller';

export function SavingPanel({ controller }: { controller: RequestPageController }) {
  const { busy, current, errorText, perform, save, abandon } = controller;
  if (!current) return null;

  return (
    <section id="savingPanel" className="panel">
      <h2>Сохранение аудио</h2>
      <p id="savingHint" className="muted">
        {busy
          ? 'Сохраняем запись. Дозапись уже завершена.'
          : current.audioStored === true
            ? 'Аудио в хранилище. Повторная передача файлов не требуется.'
            : 'Запись зафиксирована на этом устройстве. Можно повторить сохранение.'}
      </p>
      <div className="actions">
        <button id="retryButton" className="primary" disabled={busy} onClick={() => void perform(save)}>
          Повторить сохранение
        </button>
        {(errorText || current.status === 'save_failed') && (
          <button id="abandonButton" className="danger" disabled={busy} onClick={() => void perform(abandon)}>
            Закрыть без сохранения
          </button>
        )}
      </div>
    </section>
  );
}
