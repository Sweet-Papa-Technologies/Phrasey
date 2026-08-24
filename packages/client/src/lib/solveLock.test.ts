import { describe, expect, it } from 'vitest';
import { SOLVE_LOCK_COPY, solveLockReason } from './solveLock';

describe('solveLockReason', () => {
  it('is null when nothing is stopping you', () => {
    expect(solveLockReason({ solveLocked: false, lockedNextTurn: false })).toBeNull();
    expect(solveLockReason(null)).toBeNull();
    expect(solveLockReason(undefined)).toBeNull();
  });

  it('reports the wrong-solve lockout as lasting the round (§3.3)', () => {
    expect(solveLockReason({ solveLocked: true, lockedNextTurn: false })).toBe('round');
  });

  it('reports the LOCKOUT card as lasting the turn (§3.5)', () => {
    expect(solveLockReason({ solveLocked: false, lockedNextTurn: true })).toBe('turn');
  });

  it('prefers the round lockout when both apply — it is the more final of the two', () => {
    expect(solveLockReason({ solveLocked: true, lockedNextTurn: true })).toBe('round');
  });
});

describe('SOLVE_LOCK_COPY', () => {
  it('says round for one and turn for the other, so the two cannot be confused', () => {
    expect(SOLVE_LOCK_COPY.round.toast).toMatch(/round/i);
    expect(SOLVE_LOCK_COPY.round.note).toMatch(/round/i);
    expect(SOLVE_LOCK_COPY.turn.toast).toMatch(/turn/i);
    expect(SOLVE_LOCK_COPY.turn.note).toMatch(/turn/i);
    expect(SOLVE_LOCK_COPY.turn.toast).toMatch(/lockout/i);
    expect(SOLVE_LOCK_COPY.round.button).not.toBe(SOLVE_LOCK_COPY.turn.button);
  });
});
