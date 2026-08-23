/**
 * The out-of-turn interrupt window (§3.5) — 4 seconds, and the countdown is
 * the entire UI affordance, so it gets its own tested module.
 */
import { BALANCE } from '@phrasey/shared';

export const INTERRUPT_WINDOW_MS = BALANCE.interrupt.windowMs;

/** Milliseconds left, never negative. */
export function interruptRemainingMs(expiresAt: number, now: number): number {
  if (!Number.isFinite(expiresAt)) return 0;
  return Math.max(0, expiresAt - now);
}

/** 1 at the moment the window opens, 0 when it closes. Clamped both ends. */
export function interruptFraction(expiresAt: number, now: number, windowMs = INTERRUPT_WINDOW_MS): number {
  if (windowMs <= 0) return 0;
  return Math.min(1, Math.max(0, interruptRemainingMs(expiresAt, now) / windowMs));
}

/** Whole seconds left, rounded up — "3", "2", "1", gone. */
export function interruptSecondsLeft(expiresAt: number, now: number): number {
  return Math.ceil(interruptRemainingMs(expiresAt, now) / 1000);
}

export function isInterruptOpen(expiresAt: number, now: number): boolean {
  return interruptRemainingMs(expiresAt, now) > 0;
}
