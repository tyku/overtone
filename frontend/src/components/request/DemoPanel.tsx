import { useEffect, useState } from 'react';
import { requestApi, requestStore } from '../../app/services';
import type { RequestPageController } from '../../hooks/use-request-page-controller';
import { errorMessage } from '../../shared/errors';

export function DemoPanel({
  controller,
}: {
  controller: RequestPageController;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const { requestId, refreshLocal } = controller;

  useEffect(() => {
    let active = true;
    let url: string | undefined;
    const load = async () => {
      try {
        setLoadError('');
        setAudioUrl(null);
        const saved = await requestStore.get(requestId);
        if (!saved?.parts.length) {
          const blob = await requestApi.demoAudio(requestId);
          await requestStore.addDemoAudio(requestId, blob);
          await refreshLocal();
        }
        const part = (await requestStore.parts(requestId))[0];
        if (!part?.blob.size)
          throw new Error('Демо-аудио недоступно на этом устройстве');
        url = URL.createObjectURL(part.blob);
        if (active) setAudioUrl(url);
        else URL.revokeObjectURL(url);
      } catch (error) {
        if (active) setLoadError(errorMessage(error));
      }
    };
    void load();
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [attempt, refreshLocal, requestId]);

  return (
    <section id="demoPanel" className="panel">
      <p className="muted">
        Готовое аудио приёма. Прослушайте запись и перейдите к нужному месту на
        дорожке.
      </p>
      {audioUrl && (
        <audio
          className="demo-audio"
          controls
          preload="metadata"
          src={audioUrl}
          aria-label="Аудио демо-приёма"
        />
      )}
      {!audioUrl && !loadError && <p role="status">Загружаем аудио…</p>}
      {loadError && (
        <p className="error" role="alert">
          {loadError}
        </p>
      )}
      <div className="actions">
        {loadError && (
          <button
            className="secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Повторить загрузку
          </button>
        )}
        <button
          id="finishButton"
          className="primary"
          disabled={controller.busy || !audioUrl}
          onClick={() => void controller.perform(controller.save)}
        >
          Завершить приём
        </button>
      </div>
    </section>
  );
}
