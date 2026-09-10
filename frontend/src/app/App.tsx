import { useCallback, useEffect, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { useHashRoute } from '../hooks/use-hash-route';
import { HistoryPage } from '../pages/HistoryPage';
import { RequestPage } from '../pages/RequestPage';
import { errorMessage } from '../shared/errors';
import { requestStore } from './services';

export function App() {
  const requestId = useHashRoute();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void requestStore
      .database()
      .then(() => requestStore.cleanup())
      .catch((error) => setNotice(`Ошибка локального хранилища: ${errorMessage(error)}`));
  }, []);

  const onBusyChange = useCallback((value: boolean) => setBusy(value), []);
  const preventNavigationWhileBusy = (event: ReactMouseEvent<HTMLElement>) => {
    if (busy && (event.target as Element).closest?.('a[href^="#/"]')) {
      event.preventDefault();
      setNotice('Дождитесь результата текущей операции.');
    }
  };

  return (
    <main className="shell" onClick={preventNavigationWhileBusy}>
      <header className="topbar">
        <a className="brand" href="#/requests">Overtone</a>
        <a href="#/requests">Приёмы</a>
      </header>
      {notice && <p id="notice" className="notice" role="status">{notice}</p>}
      {requestId ? (
        <RequestPage requestId={requestId} setNotice={setNotice} onBusyChange={onBusyChange} />
      ) : (
        <HistoryPage setNotice={setNotice} />
      )}
    </main>
  );
}
