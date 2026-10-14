import { useState } from 'react';
import type { RequestPageController } from '../../hooks/use-request-page-controller';

export function DemoPanel({
  controller,
}: {
  controller: RequestPageController;
}) {
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const audioSrc = `/api/requests/${encodeURIComponent(controller.requestId)}/demo-audio${attempt ? `?retry=${attempt}` : ''}`;

  return (
    <section id="demoPanel" className="panel">
      <p className="muted">
        Готовое аудио приёма. Прослушайте запись и перейдите к нужному месту на
        дорожке.
      </p>
      <audio
        key={audioSrc}
        className="demo-audio"
        controls
        preload="metadata"
        src={audioSrc}
        aria-label="Аудио демо-приёма"
        onLoadedMetadata={() => {
          setReady(true);
          setLoadError('');
        }}
        onError={() => {
          setReady(false);
          setLoadError('Не удалось загрузить демо-аудио');
        }}
      />
      {!ready && !loadError && <p role="status">Загружаем аудио…</p>}
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      <div className="actions">
        {loadError && (
          <button
            className="secondary"
            onClick={() => {
              setLoadError('');
              setAttempt((value) => value + 1);
            }}
          >
            Повторить загрузку
          </button>
        )}
        <button
          id="finishButton"
          className="primary"
          disabled={controller.busy || Boolean(loadError)}
          onClick={() => void controller.perform(controller.save)}
        >
          Завершить приём
        </button>
      </div>
    </section>
  );
}
