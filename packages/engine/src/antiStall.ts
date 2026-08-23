/**
 * "The board breathes" — design doc §3.6.
 *
 * If two full turn cycles pass with no new letter revealed, the server opens one
 * random hidden letter for free: no pressure, no points to anyone. It exists so
 * a table full of dead hands cannot lock the board.
 *
 * NOTE ON GRANULARITY: the doc says "one random hidden letter". The board is
 * keyed by letter, not by tile — a hit reveals *every* occurrence at once (§3.3)
 * and `MaskedBoard` has no way to express "this A is up but that A is down".
 * So the breath reveals every occurrence of one randomly chosen hidden letter.
 * Per-tile knowledge is what PEEK is for, and that stays private.
 */
import type { Balance, GameEvent } from '@phrasey/shared';
import { hiddenDistinctLetters, revealLetter } from './board.js';
import type { Rng } from './rng.js';
import type { RoundState } from './state.js';

/** Completed turn cycles with no reveal. */
export function idleCycles(round: RoundState, seatCount: number): number {
  if (seatCount <= 0) return 0;
  return Math.floor(round.turnsSinceReveal / seatCount);
}

export function shouldBreathe(round: RoundState, seatCount: number, balance: Balance): boolean {
  if (round.endedReason !== null) return false;
  return idleCycles(round, seatCount) >= balance.antiStall.idleCyclesBeforeBreath;
}

/**
 * Reveal one free letter. Returns false when there is nothing left to open,
 * which happens only if the board is already full.
 */
export function breathe(round: RoundState, rng: Rng, events: GameEvent[]): boolean {
  const candidates = hiddenDistinctLetters(round);
  if (candidates.length === 0) {
    round.turnsSinceReveal = 0;
    return false;
  }
  const letter = rng.pick(candidates);
  const { positions } = revealLetter(round, letter);
  events.push({ t: 'breath', letter, positions });
  events.push({ t: 'reveal', letters: [letter], positions, reason: 'breath' });
  return true;
}
