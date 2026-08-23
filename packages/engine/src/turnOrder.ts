/** Seat rotation. Split out so the SKIP/REVERSE cards and the turn loop agree. */
import type { TurnDirection } from '@phrasey/shared';
import type { GameState, PlayerState, RoundState } from './state.js';

/** Seats still in this round, in the order fixed at deal time. */
export function seatOrder(state: GameState, round: RoundState): PlayerState[] {
  const out: PlayerState[] = [];
  for (const id of round.order) {
    const p = state.players.find((x) => x.id === id && !x.removed);
    if (p) out.push(p);
  }
  return out;
}

/** The seat `steps` places along from `fromId`. Null if the table is empty. */
export function seatAfter(
  state: GameState,
  round: RoundState,
  fromId: string | null,
  direction: TurnDirection,
  steps = 1,
): PlayerState | null {
  const seats = seatOrder(state, round);
  if (seats.length === 0) return null;
  const at = fromId === null ? -1 : seats.findIndex((p) => p.id === fromId);
  const base = at < 0 ? 0 : at;
  const offset = at < 0 ? steps - 1 : steps;
  const idx = (((base + direction * offset) % seats.length) + seats.length) % seats.length;
  return seats[idx] ?? null;
}
