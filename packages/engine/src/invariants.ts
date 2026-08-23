/**
 * Runtime invariant checker.
 *
 * The soak test (§14 M1: "200 seeded random matches complete without deadlock or
 * illegal state") runs this after EVERY action. It is exported rather than kept
 * in the test folder because the server can cheaply run it behind a debug flag
 * when a room misbehaves in production.
 */
import type { GameEvent } from '@phrasey/shared';
import { positionsOf } from './board.js';
import type { GameState } from './state.js';
import { seatOrder } from './turnOrder.js';

export interface InvariantViolation {
  code: string;
  detail: string;
}

export function checkInvariants(state: GameState): InvariantViolation[] {
  const v: InvariantViolation[] = [];
  const bal = state.balance;

  for (const p of state.players) {
    if (p.hand.length < 0 || p.hand.length > bal.setup.handCap) {
      v.push({ code: 'HAND_SIZE', detail: `${p.id} holds ${p.hand.length} > cap ${bal.setup.handCap}` });
    }
  }

  const round = state.round;
  if (!round) return v;

  // 1. Card conservation: deck + hands + discard + in-play === deckSize.
  const inHands = state.players.reduce((n, p) => n + p.hand.length, 0);
  const total = round.deck.length + inHands + round.discard.length + round.stack.length;
  if (total !== round.deckSize) {
    v.push({
      code: 'CARD_CONSERVATION',
      detail: `deck ${round.deck.length} + hands ${inHands} + discard ${round.discard.length} + stack ${round.stack.length} = ${total}, expected ${round.deckSize}`,
    });
  }

  // 1b. No card exists twice.
  const ids: string[] = [
    ...round.deck.map((c) => c.id),
    ...round.discard.map((c) => c.id),
    ...round.stack.map((p) => p.card.id),
    ...state.players.flatMap((p) => p.hand.map((c) => c.id)),
  ];
  if (new Set(ids).size !== ids.length) {
    v.push({ code: 'DUPLICATE_CARD', detail: `${ids.length - new Set(ids).size} duplicate card id(s)` });
  }

  // 2. Pressure stays inside the gauge.
  if (round.pressure < 0 || round.pressure > bal.pressure.max) {
    v.push({ code: 'PRESSURE_RANGE', detail: `pressure ${round.pressure} outside [0, ${bal.pressure.max}]` });
  }

  // 3. Exactly one current player while the round is live.
  const live = round.endedReason === null;
  if (live) {
    const seats = seatOrder(state, round);
    if (!round.currentPlayerId) {
      v.push({ code: 'NO_CURRENT_PLAYER', detail: 'round is live with no current player' });
    } else if (!seats.some((p) => p.id === round.currentPlayerId)) {
      v.push({ code: 'CURRENT_PLAYER_NOT_SEATED', detail: `${round.currentPlayerId} is not at the table` });
    }
  } else if (round.currentPlayerId !== null) {
    v.push({ code: 'CURRENT_PLAYER_AFTER_END', detail: `${round.currentPlayerId} still on the clock` });
  }

  // 4. Reveals must be real: a revealed letter occurs in the puzzle, a missed
  //    one does not, and the two sets never overlap.
  for (const l of round.revealed) {
    if (positionsOf(round.answer, l).length === 0) {
      v.push({ code: 'PHANTOM_REVEAL', detail: `${l} revealed but not in the puzzle` });
    }
  }
  for (const l of round.missed) {
    if (positionsOf(round.answer, l).length > 0) {
      v.push({ code: 'PHANTOM_MISS', detail: `${l} recorded as a miss but it is in the puzzle` });
    }
    if (round.revealed.includes(l)) {
      v.push({ code: 'REVEALED_AND_MISSED', detail: `${l} is both revealed and missed` });
    }
  }

  // 5. The interrupt chain cannot exceed the cap.
  if (round.window && round.window.chain > bal.interrupt.maxChain) {
    v.push({ code: 'CHAIN_OVERFLOW', detail: `chain ${round.window.chain} > ${bal.interrupt.maxChain}` });
  }
  if (round.stack.length > bal.interrupt.maxChain + 1) {
    v.push({ code: 'STACK_OVERFLOW', detail: `stack depth ${round.stack.length}` });
  }

  // 6. A live round always has a phase that somebody can act on.
  if (live && round.phase === 'ended') {
    v.push({ code: 'PHASE_MISMATCH', detail: 'phase ended but round has no end reason' });
  }
  if (!live && round.phase !== 'ended') {
    v.push({ code: 'PHASE_MISMATCH', detail: `round ended (${round.endedReason}) but phase is ${round.phase}` });
  }

  return v;
}

/** Revealed letters may only ever be added. */
export function checkMonotonicReveal(before: GameState, after: GameState): InvariantViolation[] {
  const a = before.round;
  const b = after.round;
  if (!a || !b || a.roundNumber !== b.roundNumber) return [];
  const now = new Set(b.revealed);
  return a.revealed
    .filter((l) => !now.has(l))
    .map((l) => ({ code: 'UNREVEAL', detail: `${l} was revealed and is now hidden` }));
}

/**
 * Replay the event log into per-player score totals. Every point in the game
 * comes from exactly one of these four events, so this must equal
 * `player.score` at all times.
 */
export function scoresFromEvents(events: readonly GameEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (id: string | null, n: number): void => {
    if (!id) return;
    out[id] = (out[id] ?? 0) + n;
  };
  for (const e of events) {
    switch (e.t) {
      case 'letter:hit':
        add(e.playerId, e.points);
        break;
      case 'solve:success':
        add(e.playerId, e.points);
        break;
      case 'swipe':
        add(e.playerId, e.points);
        add(e.fromPlayerId, -e.points);
        break;
      case 'blowout':
        add(e.byPlayerId, e.penalty);
        break;
      default:
        break;
    }
  }
  return out;
}

export function assertInvariants(state: GameState, label = ''): void {
  const violations = checkInvariants(state);
  if (violations.length > 0) {
    throw new Error(`invariant violation${label ? ` (${label})` : ''}: ${violations.map((x) => `${x.code}: ${x.detail}`).join('; ')}`);
  }
}
