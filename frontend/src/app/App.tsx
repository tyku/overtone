import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { AuthProvider, useAuth } from '../auth/AuthContext';
import { AdminPage } from '../pages/admin/AdminPage';
import { HistoryPage } from '../pages/HistoryPage';
import { LoginPage } from '../pages/LoginPage';
import { ProfilePage } from '../pages/ProfilePage';
import { RequestPage } from '../pages/RequestPage';
import { errorMessage } from '../shared/errors';
import { AppLink, navigate, useRoute } from './router';
import { requestStore } from './services';

export function App() {
  return <AuthProvider><Application /></AuthProvider>;
}
function Application() {
  const route = useRoute();
  const auth = useAuth();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!auth.user) return;
    void requestStore.database().then(() => requestStore.cleanup()).catch((error) =>
      setNotice(`Ошибка локального хранилища: ${errorMessage(error)}`),
    );
  }, [auth.user]);

  useEffect(() => {
    if (auth.user && route.name === 'login') navigate('/requests', true);
  }, [auth.user, route.name]);

  const onBusyChange = useCallback((value: boolean) => setBusy(value), []);
  const preventNavigationWhileBusy = (event: ReactMouseEvent<HTMLElement>) => {
    if (busy && (event.target as Element).closest?.('a[href^="/"]')) {
      event.preventDefault();
      setNotice('Дождитесь результата текущей операции.');
    }
  };

  if (auth.loading) return <main className="auth-shell"><p className="muted">Проверяем сессию…</p></main>;
  if (!auth.user)
    return <LoginPage destination={route.name === 'admin' ? '/admin' : '/requests'} />;
  const isAdmin = auth.user.permissions.includes('admin:access');

  return (
    <main className="shell" onClick={preventNavigationWhileBusy}>
      <header className="topbar">
        <AppLink className="brand" href="/requests">Overtone</AppLink>
        <nav className="topnav" aria-label="Основная навигация">
          <AppLink href="/requests">Приёмы</AppLink>
          <AppLink href="/profile">Профиль</AppLink>
          {isAdmin && <AppLink href="/admin">Админка</AppLink>}
          <button className="link-button" onClick={() => void auth.logout().then(() => navigate('/login', true))}>Выйти</button>
        </nav>
      </header>
      {(notice || auth.error) && <p id="notice" className="notice" role="status">{notice || auth.error}</p>}
      {route.name === 'requests' && <HistoryPage setNotice={setNotice} />}
      {route.name === 'request' && <RequestPage requestId={route.requestId} setNotice={setNotice} onBusyChange={onBusyChange} />}
      {route.name === 'profile' && <ProfilePage />}
      {route.name === 'admin' && (isAdmin ? <AdminPage /> : <p className="error">Недостаточно прав.</p>)}
      {route.name === 'not-found' && <section><h1>Страница не найдена</h1><AppLink href="/requests">Вернуться к приёмам</AppLink></section>}
    </main>
  );
}
