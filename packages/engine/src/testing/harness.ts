/**
 * Test scaffolding. Not part of the shipped surface.
 *
 * The trick that makes rules tests readable: cards are plain data with stable
 * ids, so a test can *rewrite* a card already in a hand instead of trying to
 * inject one. Card ids and total counts are untouched, so the conservation
 * invariant keeps holding while the test controls exactly what a player holds.
 */
import type { ActionCardKind, Balance, Card, Letter, Puzzle, RoomSettings } from '@phrasey/shared';
import { EngineError } from '@phrasey/shared';
import { applyAction, type EngineAction } from '../actions.js';
import { createMatch, type GameState, type NewPlayer } from '../state.js';
import { TEST_PUZZLES } from './fixtures.js';

export interface HarnessOptions {
  seed?: number;
  players?: number | (string | NewPlayer)[];
  puzzle?: Puzzle;
  settings?: Partial<RoomSettings>;
  balance?: Balance;
  /** Skip the initial deal; leaves the match in the lobby. */
  lobbyOnly?: boolean;
}

export function seats(n: number): NewPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}`, isHost: i === 0 }));
}

export function startGame(opts: HarnessOptions = {}): GameState {
  const players =
    typeof opts.players === 'number' || opts.players === undefined
      ? seats(opts.players ?? 3)
      : opts.players.map((p, i) => (typeof p === 'string' ? { id: p, name: p, isHost: i === 0 } : p));

  const state = createMatch({
    seed: opts.seed ?? 12345,
    players,
    settings: opts.settings,
    balance: opts.balance,
  });
  if (opts.lobbyOnly) return state;
  return applyAction(state, { type: 'startRound', puzzle: opts.puzzle ?? (TEST_PUZZLES[0] as Puzzle) }, 0).state;
}

export function handOf(state: GameState, playerId: string): Card[] {
  const p = state.players.find((x) => x.id === playerId);
  if (!p) throw new Error(`no player ${playerId}`);
  return p.hand;
}

export function currentId(state: GameState): string {
  const id = state.round?.currentPlayerId;
  if (!id) throw new Error('no current player');
  return id;
}

/** Rewrite hand slot `index` into a letter card and return its id. */
export function plantLetter(state: GameState, playerId: string, letter: Letter, index = 0): string {
  const hand = handOf(state, playerId);
  const card = hand[index];
  if (!card) throw new Error(`player ${playerId} has no card at ${index}`);
  hand[index] = { id: card.id, kind: 'letter', letter };
  return card.id;
}

/** Rewrite hand slot `index` into an action card and return its id. */
export function plantAction(state: GameState, playerId: string, action: ActionCardKind, index = 0): string {
  const hand = handOf(state, playerId);
  const card = hand[index];
  if (!card) throw new Error(`player ${playerId} has no card at ${index}`);
  hand[index] = { id: card.id, kind: 'action', action };
  return card.id;
}

/** Rewrite an entire hand, keeping the existing card ids. */
export function plantHand(state: GameState, playerId: string, specs: (Letter | ActionCardKind)[]): string[] {
  const ids: string[] = [];
  specs.forEach((spec, i) => {
    ids.push(spec.length === 1 ? plantLetter(state, playerId, spec, i) : plantAction(state, playerId, spec as ActionCardKind, i));
  });
  return ids;
}

export function act(state: GameState, action: EngineAction, nowMs = 0): GameState {
  return applyAction(state, action, nowMs).state;
}

export function actWithEvents(state: GameState, action: EngineAction, nowMs = 0): ReturnType<typeof applyAction> {
  return applyAction(state, action, nowMs);
}

export function scoreOf(state: GameState, playerId: string): number {
  return state.players.find((p) => p.id === playerId)?.score ?? 0;
}

/** Play a letter and immediately decline the optional solve. */
export function playLetterAndPass(state: GameState, playerId: string, letter: Letter, nowMs = 0): GameState {
  const cardId = plantLetter(state, playerId, letter);
  let next = act(state, { type: 'playCard', playerId, intent: { type: 'letter', cardId } }, nowMs);
  if (next.round?.phase === 'awaiting-solve') next = act(next, { type: 'pass', playerId }, nowMs);
  return next;
}

/**
 * `EngineError.message` carries the human detail, not the code, so tests assert
 * on the code directly.
 */
export function catchCode(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof EngineError) return e.code;
    return `NOT_ENGINE_ERROR: ${String(e)}`;
  }
  return 'NO_THROW';
}
