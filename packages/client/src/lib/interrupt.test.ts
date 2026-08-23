import { describe, expect, it } from 'vitest';
import { BALANCE } from '@phrasey/shared';
import {
  INTERRUPT_WINDOW_MS,
  interruptFraction,
  interruptRemainingMs,
  interruptSecondsLeft,
  isInterruptOpen,
} from './interrupt';

const NOW = 1_700_000_000_000;

describe('interrupt countdown', () => {
  it('uses the shared 4 second window (§3.5)', () => {
    expect(INTERRUPT_WINDOW_MS).toBe(BALANCE.interrupt.windowMs);
    expect(INTERRUPT_WINDOW_MS).toBe(4000);
  });

  it('counts down and never goes negative', () => {
    expect(interruptRemainingMs(NOW + 4000, NOW)).toBe(4000);
    expect(interruptRemainingMs(NOW + 1500, NOW)).toBe(1500);
    expect(interruptRemainingMs(NOW - 5000, NOW)).toBe(0);
  });

  it('reports a 1 → 0 fraction across the window', () => {
    expect(interruptFraction(NOW + 4000, NOW)).toBe(1);
    expect(interruptFraction(NOW + 2000, NOW)).toBe(0.5);
    expect(interruptFraction(NOW, NOW)).toBe(0);
    expect(interruptFraction(NOW - 1, NOW)).toBe(0);
  });

  it('clamps a fraction above 1 when the server hands out a longer window', () => {
    expect(interruptFraction(NOW + 9000, NOW)).toBe(1);
  });

  it('shows whole seconds, rounded up, so "1" is visible for a full second', () => {
    expect(interruptSecondsLeft(NOW + 4000, NOW)).toBe(4);
    expect(interruptSecondsLeft(NOW + 3001, NOW)).toBe(4);
    expect(interruptSecondsLeft(NOW + 1, NOW)).toBe(1);
    expect(interruptSecondsLeft(NOW, NOW)).toBe(0);
  });

  it('knows when the window has closed', () => {
    expect(isInterruptOpen(NOW + 1, NOW)).toBe(true);
    expect(isInterruptOpen(NOW, NOW)).toBe(false);
  });

  it('treats a garbage expiry as closed rather than open forever', () => {
    expect(interruptRemainingMs(Number.NaN, NOW)).toBe(0);
    expect(isInterruptOpen(Number.NaN, NOW)).toBe(false);
  });
});
