import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const navigationEvent = 'overtone:navigate';

export type Route =
  | { name: 'login' }
  | { name: 'requests' }
  | { name: 'request'; requestId: string }
  | { name: 'profile' }
  | { name: 'admin' }
  | { name: 'not-found' };

export function navigate(path: string, replace = false) {
  if (replace) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  window.dispatchEvent(new Event(navigationEvent));
}

export function useRoute(): Route {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    migrateLegacyHash();
    const update = () => setPath(location.pathname);
    window.addEventListener('popstate', update);
    window.addEventListener(navigationEvent, update);
    if (location.pathname === '/') navigate('/requests', true);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(navigationEvent, update);
    };
  }, []);
  if (path === '/login') return { name: 'login' };
  if (path === '/requests' || path === '/') return { name: 'requests' };
  const requestId = path.match(/^\/requests\/([0-9a-f-]+)$/i)?.[1];
  if (requestId) return { name: 'request', requestId };
  if (path === '/profile') return { name: 'profile' };
  if (path === '/admin' || path === '/admin/') return { name: 'admin' };
  return { name: 'not-found' };
}

export function AppLink({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      !href?.startsWith('/')
    )
      return;
    event.preventDefault();
    navigate(href);
  };
  return <a {...props} href={href} onClick={handleClick} />;
}

function migrateLegacyHash() {
  const legacyPath = location.hash.match(/^#(\/requests(?:\/[^?]+)?)/)?.[1];
  if (legacyPath) navigate(legacyPath, true);
}

