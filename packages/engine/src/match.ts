/**
 * Round -> match progression (§3.1, §3.4).
 *
 * Both match modes ship. The host picks at room creation:
 *   'rounds' — a fixed round count (default 5)
 *   'score'  — first player past targetScore (default 300) AFTER a completed
 *              round, never mid-round. A match that ends the instant somebody
 *              crosses 300 would cut off the solve everyone is racing for.
 */
import type { GameEvent, MatchResult, RoundEndReason, RoundResult } from '@phrasey/shared';
import { revealAll } from './board.js';
import { closeWindow } from './interrupts.js';
import { award, blowoutPenalty } from './scoring.js';
import { activePlayers, findPlayer, type GameState } from './state.js';

export interface EndRoundOptions {
  solvedBy?: string | null;
  /** Whoever tipped the gauge. Takes the -20 (§3.4). */
  blownBy?: string | null;
}

/**
 * End the round and settle the books. Idempotent — a blowout that races a solve
 * cannot double-fire.
 */
export function endRound(
  state: GameState,
  reason: RoundEndReason,
  opts: EndRoundOptions,
  events: GameEvent[],
): RoundResult | null {
  const round = state.round;
  if (!round || round.endedReason !== null) return null;

  // Anything still parked on the interrupt stack is abandoned, not applied —
  // but the cards must land in the discard or conservation breaks.
  closeWindow(round, events);
  for (const pending of round.stack) round.discard.push(pending.card);
  round.stack = [];

  const blownBy = opts.blownBy ?? null;
  if (reason === 'blowout') {
    const penalty = blowoutPenalty(state.balance);
    const culprit = blownBy ? findPlayer(state, blownBy) : null;
    if (culprit) award(culprit, penalty);
    events.push({ t: 'blowout', byPlayerId: blownBy, penalty });
  }

  round.endedReason = reason;
  round.solvedBy = opts.solvedBy ?? null;
  round.blownBy = blownBy;
  round.phase = 'ended';
  round.currentPlayerId = null;
  round.turnEndsAt = null;
  revealAll(round);

  const roundScores: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const p of activePlayers(state)) {
    roundScores[p.id] = p.roundScore;
    totals[p.id] = p.score;
  }

  const result: RoundResult = {
    roundNumber: round.roundNumber,
    reason,
    solvedBy: round.solvedBy,
    blownBy,
    answer: round.answer,
    category: round.puzzle.category,
    hint: round.puzzle.hint,
    roundScores,
    totals,
  };
  state.results.push(result);
  state.status = 'round-end';
  events.push({ t: 'round:end', result });

  if (isMatchComplete(state)) endMatch(state, events);
  return result;
}

export function isMatchComplete(state: GameState): boolean {
  if (state.settings.matchMode === 'rounds') {
    return state.roundNumber >= state.settings.rounds;
  }
  return activePlayers(state).some((p) => p.score >= state.settings.targetScore);
}

/** Ties are real: everyone on the top score wins. */
export function matchWinners(state: GameState): string[] {
  const seated = activePlayers(state);
  if (seated.length === 0) return [];
  const top = Math.max(...seated.map((p) => p.score));
  return seated.filter((p) => p.score === top).map((p) => p.id);
}

export function endMatch(state: GameState, events: GameEvent[]): MatchResult {
  const totals: Record<string, number> = {};
  for (const p of activePlayers(state)) totals[p.id] = p.score;
  const result: MatchResult = {
    winnerIds: matchWinners(state),
    totals,
    roundsPlayed: state.roundNumber,
    sessionId: state.sessionId,
  };
  state.matchResult = result;
  state.status = 'match-end';
  events.push({ t: 'match:end', result });
  return result;
}
