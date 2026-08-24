/**
 * A ~60 line router. React Router is not a dependency of this package and a
 * three-route party game does not justify adding one.
 */
import { useCallback, useEffect, useState } from 'react';
import { parseRoomHandle } from '@phrasey/shared';

export type Route =
  | { name: 'landing' }
  | { name: 'join'; code: string; key: string | null }
  | { name: 'room'; code: string }
  | { name: 'legal'; page: 'privacy' | 'cookies' | 'terms' }
  | { name: 'notfound'; path: string };

const NAV_EVENT = 'phrasey:navigate';

export function parseRoute(pathname: string): Route {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts.length === 0) return { name: 'landing' };
  const [head, tail] = parts;
  if (head === 'join' && tail) {
    // A share link carries code + key ("KABO-M3XR"); a hand-typed URL may be
    // code only, in which case the join screen asks for the key.
    const handle = parseRoomHandle(tail);
    if (handle) return { name: 'join', code: handle.code, key: handle.key };
    return { name: 'join', code: tail.toUpperCase().slice(0, 4), key: null };
  }
  if (head === 'room' && tail) return { name: 'room', code: tail.toUpperCase().slice(0, 4) };
  if (head === 'privacy') return { name: 'legal', page: 'privacy' };
  if (head === 'cookies') return { name: 'legal', page: 'cookies' };
  if (head === 'terms') return { name: 'legal', page: 'terms' };
  return { name: 'notfound', path: pathname };
}

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (typeof window === 'undefined') return;
  // Navigating to where we already are is a no-op rather than a history entry.
  // `Room` redirects on a timer while it has no seat, so without this a tab
  // that is mid-reconnect can stack duplicate entries and strand the back
  // button behind a run of identical URLs.
  const here = `${window.location.pathname}${window.location.search}`;
  if (to === here || to === window.location.pathname) return;
  if (opts.replace) window.history.replaceState({}, '', to);
  else window.history.pushState({}, '', to);
  window.dispatchEvent(new Event(NAV_EVENT));
}

export function useRoute(): Route {
  const read = useCallback(
    () => parseRoute(typeof window === 'undefined' ? '/' : window.location.pathname),
    [],
  );
  const [route, setRoute] = useState<Route>(read);

  useEffect(() => {
    const update = () => setRoute(read());
    window.addEventListener('popstate', update);
    window.addEventListener(NAV_EVENT, update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener(NAV_EVENT, update);
    };
  }, [read]);

  return route;
}

/** An anchor that stays a real link (middle-click, copy link) but routes in-app. */
export function Link({
  to,
  children,
  ...rest
}: { to: string } & React.AnchorHTMLAttributes<HTMLAnchorElement>): React.ReactElement {
  return (
    <a
      href={to}
      {...rest}
      onClick={(e) => {
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
        rest.onClick?.(e);
      }}
    >
      {children}
    </a>
  );
}
