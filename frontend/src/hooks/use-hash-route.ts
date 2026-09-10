import { useEffect, useState } from 'react';

const requestPattern = /^#\/requests\/([a-f0-9-]+)$/i;

export function useHashRoute(): string | null {
  const [hash, setHash] = useState(location.hash);

  useEffect(() => {
    if (!location.hash) location.hash = '/requests';
    const onHashChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return hash.match(requestPattern)?.[1] ?? null;
}
