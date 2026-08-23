/**
 * Scoring — design doc §3.3, to the number.
 *
 *   hit           +10 x occurrences
 *   correct solve +50 + 5 x (letters still hidden at the moment of solve)
 *   wrong solve   +3 pressure, solve-locked for the rest of the round
 *   blowout       -20 to whoever tipped it
 *
 * The "still hidden" term is the load-bearing one: a solve on a nearly-full
 * board is worth almost nothing, which stops the endgame from being a free
 * lunch and pays the player who cracks it early and gambles.
 */
import type { Balance } from '@phrasey/shared';
import type { PlayerState } from './state.js';

export function letterHitPoints(occurrences: number, balance: Balance, doubled: boolean): number {
  const base = balance.scoring.perRevealedLetter * occurrences;
  return doubled ? base * balance.scoring.doubleDownMultiplier : base;
}

export function solvePoints(hiddenAtSolve: number, balance: Balance): number {
  return balance.scoring.solveBase + balance.scoring.solveHiddenBonus * hiddenAtSolve;
}

export function blowoutPenalty(balance: Balance): number {
  return balance.scoring.blowoutPenalty;
}

/** Match total and round total move together, always. */
export function award(player: PlayerState, points: number): void {
  player.score += points;
  player.roundScore += points;
}

/**
 * SWIPE (§3.5): the points move, they are not minted. Both totals follow, so a
 * swiped hit leaves the round's books balanced.
 */
export function transferPoints(from: PlayerState, to: PlayerState, points: number): void {
  award(from, -points);
  award(to, points);
}
