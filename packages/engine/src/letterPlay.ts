/**
 * Resolving a letter — design doc §3.3.
 *
 *   Hit:  reveals EVERY occurrence, +10 x occurrences.
 *   Miss: +1 pressure, 0 points.
 *
 * Shared by the plain letter card and by WILD ("Scores as a normal letter
 * play"), which is why it lives in its own module rather than inside actions.ts.
 *
 * TIMING NOTE: the reveal and the points both land immediately, and SWIPE later
 * *transfers* the points rather than the engine withholding them. Two reasons:
 * the reveal cascade is the best moment in the game (§9) and must not be delayed
 * four seconds behind an interrupt window; and awarding on play keeps
 * `player.score` equal to the sum of the event log at every single instant,
 * which is what the soak invariant checker asserts.
 */
import type { Balance, Card, GameEvent, Letter } from '@phrasey/shared';
import { EngineError } from '@phrasey/shared';
import { isGuessed, revealLetter } from './board.js';
import { openWindow, resolveStack } from './interrupts.js';
import { applyPressure } from './pressure.js';
import { award, letterHitPoints } from './scoring.js';
import type { GameState, PlayerState, RoundState } from './state.js';

export interface LetterPlayResult {
  hit: boolean;
  occurrences: number;
  points: number;
  /** The gauge tipped; the caller ends the round (§3.4). */
  blowout: boolean;
  /** An interrupt window is open; the turn is paused until it resolves. */
  deferred: boolean;
}

/**
 * `card` has already been removed from the player's hand by the caller.
 * Throws BEFORE any mutation if the letter is illegal.
 */
export function resolveLetterPlay(
  state: GameState,
  round: RoundState,
  player: PlayerState,
  card: Card,
  letter: Letter,
  nowMs: number,
  events: GameEvent[],
): LetterPlayResult {
  const balance: Balance = state.balance;
  const doubled = player.doubleDownArmed;
  // DOUBLE DOWN is spent by the next letter play whether it lands or not —
  // that is the gamble (§3.5).
  player.doubleDownArmed = false;

  const { occurrences, positions } = revealLetter(round, letter);

  if (occurrences > 0) {
    const points = letterHitPoints(occurrences, balance, doubled);
    award(player, points);
    events.push({ t: 'reveal', letters: [letter], positions, reason: 'play' });
    events.push({ t: 'letter:hit', playerId: player.id, letter, occurrences, points, positions });

    // Park the card on the stack so SWIPE has something to answer.
    round.stack.push({ kind: 'hit', playerId: player.id, card, letter, occurrences, points, positions });
    const deferred = openWindow(state, round, 'hit', player.id, null, 0, nowMs, events);
    if (!deferred) resolveStack(state, round, balance, events);
    return { hit: true, occurrences, points, blowout: false, deferred };
  }

  round.missed.push(letter);
  round.discard.push(card);
  const delta = balance.pressure.wrongLetter * (doubled ? balance.pressure.doubleDownMissMultiplier : 1);
  events.push({ t: 'letter:miss', playerId: player.id, letter, pressureDelta: delta });
  const res = applyPressure(round, delta, 'wrong-letter', player.id, balance, events);
  return { hit: false, occurrences: 0, points: 0, blowout: res.blowout, deferred: false };
}

/** Validation shared by the letter card and WILD. Runs before any mutation. */
export function assertPlayableLetter(round: RoundState, letter: string | undefined): Letter {
  if (!letter || !/^[A-Z]$/.test(letter)) throw new EngineError('LETTER_REQUIRED');
  if (isGuessed(round, letter)) throw new EngineError('LETTER_ALREADY_GUESSED', letter);
  return letter;
}
