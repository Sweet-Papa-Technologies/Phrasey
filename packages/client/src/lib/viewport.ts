/**
 * Viewport and element measurement.
 *
 * The board's tile size is a *measured* fit rather than a viewport clamp,
 * because how big a tile can be depends on the puzzle as much as the screen.
 * These hooks are the measuring end of that; the arithmetic lives in
 * `lib/boardFit.ts` where it can be tested without a DOM.
 *
 * All of them are SSR- and jsdom-safe: with no `window`, no `ResizeObserver`
 * or a zero-sized element they return sensible neutral values and the caller
 * falls back to its unconstrained defaults.
 */
import { useEffect, useState } from 'react';

export interface Size {
  width: number;
  height: number;
}

/** Matches a media query, and keeps matching as the window changes. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/**
 * The visual viewport, in CSS px. Used for height budgets — how much vertical
 * room the board is allowed to claim before it should start shrinking tiles.
 */
export function useViewportSize(): Size {
  const [size, setSize] = useState<Size>(() =>
    typeof window === 'undefined'
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight },
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    onResize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return size;
}

/**
 * Content-box size of an element, tracked with a ResizeObserver.
 *
 * Only ever read the axis the *parent* controls. Reading an axis the element's
 * own content determines would close a measure→render→measure loop.
 */
export function useElementSize<T extends HTMLElement>(ref: React.RefObject<T | null>): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const read = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) =>
        Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5
          ? prev
          : { width: rect.width, height: rect.height },
      );
    };

    read();

    if (typeof ResizeObserver === 'undefined') {
      if (typeof window === 'undefined') return undefined;
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }

    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);

  return size;
}
