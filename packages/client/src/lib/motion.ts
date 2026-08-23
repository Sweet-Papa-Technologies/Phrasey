/**
 * Motion policy. §9 gives specific numbers; §10 makes honoring
 * `prefers-reduced-motion` an exit criterion, so the check lives in one place
 * and every animated component reads it from here.
 */
import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia(QUERY).matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** §9 durations, in seconds, for the `motion` library. */
export const DUR = {
  cardArc: 0.35,
  tileFlip: 0.26,
  glug: 0.7,
  settle: 0.24,
  panel: 0.22,
} as const;

export const EASE = {
  settle: [0.22, 1.2, 0.36, 1],
  glug: [0.18, 0.9, 0.24, 1],
  out: [0.16, 1, 0.3, 1],
} as const;

/**
 * The pressure "glug": one weighted motion with a small overshoot and settle,
 * never a linear fill (§9). Returns keyframes from `from` to `to`.
 */
export function glugKeyframes(from: number, to: number): number[] {
  if (to === from) return [to];
  const overshoot = (to - from) * 0.14;
  return [from, to + overshoot, to - overshoot * 0.35, to];
}

export const GLUG_TIMES = [0, 0.52, 0.78, 1];
