export function OneTimePassword({
  email,
  password,
  close,
}: {
  email: string;
  password: string;
  close(): void;
}) {
  const copy = () => void navigator.clipboard.writeText(password);
  return (
    <aside className="secret-panel" role="status">
      <div><p className="eyebrow">Показывается один раз</p><h2>Пароль пользователя</h2></div>
      <p>{email}</p>
      <code>{password}</code>
      <p className="muted">После закрытия или ухода со страницы пароль восстановить нельзя — только пересоздать.</p>
      <div className="actions"><button className="primary" onClick={copy}>Скопировать пароль</button><button className="secondary" onClick={close}>Закрыть</button></div>
    </aside>
  );
}

