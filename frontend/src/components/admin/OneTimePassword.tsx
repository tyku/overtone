import { useState } from 'react';

export function OneTimePassword({
  email,
  password,
  close,
}: {
  email: string;
  password: string;
  close(): void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  return (
    <aside className="secret-panel" role="status">
      <div><p className="eyebrow">Показывается один раз</p><h2>Пароль пользователя</h2></div>
      <p>{email}</p>
      <code>{password}</code>
      <p className="muted">После закрытия или ухода со страницы пароль восстановить нельзя — только пересоздать.</p>
      <div className="actions"><button className="primary" onClick={() => void copy()}>Скопировать пароль</button><button className="secondary" onClick={close}>Закрыть</button></div>
      {copyState === 'copied' && <p className="copy-success" role="status">✓ Пароль скопирован</p>}
      {copyState === 'failed' && <p className="error" role="alert">Не удалось скопировать пароль</p>}
    </aside>
  );
}
