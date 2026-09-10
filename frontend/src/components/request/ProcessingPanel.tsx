export function ProcessingPanel() {
  return (
    <section id="waitingPanel" className="panel">
      <div className="activity" aria-hidden="true" />
      <h2>Отчёт в обработке</h2>
      <p className="muted">
        Результат появится здесь автоматически. Можно вернуться к списку приёмов.
      </p>
    </section>
  );
}
