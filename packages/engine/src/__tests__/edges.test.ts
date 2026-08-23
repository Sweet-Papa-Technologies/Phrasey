/**
 * Edge and error paths that a normal game rarely reaches, but a hostile client
 * or a bad disconnect will.
 */
import { defaultBalance } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { bestLetterFrom } from '../board.js';
import { applyShuffle } from '../cards/shuffle.js';
import { playBlock } from '../cards/block.js';
import { playBuzzIn } from '../cards/buzzIn.js';
import { playSwipe } from '../cards/swipe.js';
import { puzzleLetterPool } from '../deck.js';
import { findInterruptCard, holdsCard, topOwner } from '../interrupts.js';
import { endRound } from '../match.js';
import { passivePolicy, randomPolicy } from '../policy.js';
import { createRng, type Rng } from '../rng.js';
import { createMatch, drawUp, type GameState, type RoundState } from '../state.js';
import { seatAfter, seatOrder } from '../turnOrder.js';
import { makePuzzle } from '../testing/fixtures.js';
import { act, catchCode, plantAction, plantHand, plantLetter, startGame } from '../testing/harness.js';
import { playerView } from '../view.js';
import { applyActions } from '../actions.js';

const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS');
const NO_INTERRUPTS = { interruptsEnabled: false };

/** A deterministic stub so a policy branch can be pinned exactly. */
function stubRng(values: number[]): Rng {
  let i = 0;
  const next = () => values[i++ % values.length] as number;
  const base = createRng(1);
  return { ...base, next, bool: (p: number) => next() < p, int: (n: number) => Math.floor(next() * n) } as Rng;
}

describe('turn order edges', () => {
  it('returns null when nobody is seated', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2, settings: NO_INTERRUPTS });
    for (const p of s.players) p.removed = true;
    expect(seatOrder(s, s.round!)).toEqual([]);
    expect(seatAfter(s, s.round!, 'p1', 1)).toBeNull();
  });

  it('starts from the first seat when the reference player is unknown', () => {
    const s = startGame({ puzzle: PUZZLE, players: 3, settings: NO_INTERRUPTS });
    expect(seatAfter(s, s.round!, null, 1)!.id).toBe('p1');
    expect(seatAfter(s, s.round!, 'ghost', 1)!.id).toBe('p1');
    expect(seatAfter(s, s.round!, 'p1', -1)!.id).toBe('p3');
    expect(seatAfter(s, s.round!, 'p1', 1, 2)!.id).toBe('p3');
  });
});

describe('deck and board edges', () => {
  it('drops letters with a zero occurrence count', () => {
    const p = { ...PUZZLE, letterStats: { E: 3, Z: 0 } };
    expect(puzzleLetterPool(p, defaultBalance()).map(([l]) => l)).toEqual(['E']);
  });

  it('scores an unknown letter as zero frequency', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2 });
    expect(bestLetterFrom(s.round!, ['E'], {})).toBe('E');
    expect(bestLetterFrom(s.round!, [], {})).toBeNull();
  });

  it('drawUp is a no-op when the hand is already at the minimum', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2 });
    expect(drawUp(s.round!, s.players[0]!, s.balance)).toBe(0);
  });
});

describe('state edges', () => {
  it('creates a match with no players at all', () => {
    const s = createMatch({ seed: 1, players: [] });
    expect(s.hostId).toBe('');
    expect(s.players).toEqual([]);
  });

  it('empties the host slot once the last seat leaves', () => {
    let s = startGame({ players: 2, lobbyOnly: true });
    s = act(s, { type: 'removePlayer', playerId: 'p1' });
    s = act(s, { type: 'removePlayer', playerId: 'p2' });
    expect(s.hostId).toBe('');
  });

  it('ends a turn with an empty hand and an empty deck', () => {
    const s = startGame({ puzzle: PUZZLE, players: 3, settings: NO_INTERRUPTS });
    s.round!.discard.push(...s.round!.deck, ...s.players[0]!.hand);
    s.round!.deck = [];
    s.players[0]!.hand = [];
    const after = act(s, { type: 'timeout', playerId: 'p1' });
    expect(after.round!.currentPlayerId).not.toBe('p1');
  });

  it('applyActions threads a list of actions', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2, settings: { ...NO_INTERRUPTS, rounds: 3 } });
    const id = s.players[0]!.hand[0]!.id;
    const { state, events } = applyActions(s, [
      { type: 'discard', playerId: 'p1', cardIds: [id] },
      { type: 'pass', playerId: 'p1' },
    ], 0);
    expect(state.round!.currentPlayerId).toBe('p2');
    expect(events.length).toBeGreaterThan(1);
  });
});

describe('match edges', () => {
  it('reports a blowout with no identifiable culprit', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2, settings: { ...NO_INTERRUPTS, rounds: 3 } });
    const events: never[] = [];
    const result = endRound(s, 'blowout', {}, events as never);
    expect(result!.blownBy).toBeNull();
    expect(s.players.every((p) => p.score === 0)).toBe(true);
  });

  it('retires cards still parked on the interrupt stack', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2, settings: NO_INTERRUPTS });
    const card = s.round!.deck.pop()!;
    s.round!.stack.push({ kind: 'block', playerId: 'p1', card: card as never });
    endRound(s, 'abandoned', {}, []);
    expect(s.round!.stack).toEqual([]);
    expect(s.round!.discard).toContain(card);
  });
});

describe('card effect guard rails', () => {
  it('SHUFFLE does nothing at a one-seat table', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2, settings: NO_INTERRUPTS });
    s.players[1]!.removed = true;
    const ctx = {
      state: s, round: s.round!, player: s.players[0]!, card: { id: 'x', kind: 'action', action: 'SHUFFLE' },
      events: [], nowMs: 0, rng: createRng(1), balance: s.balance,
    };
    expect(applyShuffle(ctx as never)).toEqual({});
    expect(ctx.events).toEqual([]);
  });

  it('SWIPE and BLOCK refuse an empty or self-owned stack', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2, settings: NO_INTERRUPTS });
    const round = s.round as RoundState;
    const base = {
      state: s, round, player: s.players[0]!, card: { id: 'x', kind: 'action', action: 'SWIPE' },
      window: { id: 'w', kind: 'hit', sourcePlayerId: 'p2', targetPlayerId: null, expiresAt: 0, chain: 0, eligible: [], passed: [] },
      events: [], nowMs: 0, balance: s.balance,
    };
    expect(catchCode(() => playSwipe(base as never))).toBe('INTERRUPT_NOT_ALLOWED');
    expect(catchCode(() => playBlock(base as never))).toBe('INTERRUPT_NOT_ALLOWED');

    const card = round.deck.pop()!;
    round.stack.push({ kind: 'hit', playerId: 'p1', card, letter: 'E', occurrences: 1, points: 10, positions: [0] });
    expect(catchCode(() => playSwipe(base as never))).toBe('INTERRUPT_NOT_ALLOWED');
    expect(catchCode(() => playBlock(base as never))).toBe('INTERRUPT_NOT_ALLOWED');
  });

  it('BUZZ IN refuses an exhausted allowance', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2, settings: NO_INTERRUPTS });
    s.players[0]!.buzzInsLeft = 0;
    const ctx = {
      state: s, round: s.round!, player: s.players[0]!, card: { id: 'x', kind: 'action', action: 'BUZZ_IN' },
      window: { id: 'w', kind: 'between', sourcePlayerId: 'p2', targetPlayerId: null, expiresAt: 0, chain: 0, eligible: [], passed: [] },
      events: [], nowMs: 0, balance: s.balance,
    };
    expect(catchCode(() => playBuzzIn(ctx as never))).toBe('BUZZ_EXHAUSTED');
  });
});

describe('interrupt helpers', () => {
  it('finds and identifies interrupt cards in a hand', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2 });
    const id = plantAction(s, 'p1', 'BLOCK');
    const hand = s.players[0]!.hand;
    expect(holdsCard(hand, 'BLOCK')).toBe(true);
    expect(findInterruptCard(hand, id)).toMatchObject({ action: 'BLOCK' });
    expect(findInterruptCard(hand, 'nope')).toBeUndefined();
    const letterId = plantLetter(s, 'p1', 'E', 1);
    expect(findInterruptCard(hand, letterId)).toBeUndefined();
  });

  it('reports the owner of the top pending effect', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2 });
    expect(topOwner(s.round!)).toBeNull();
    const card = s.round!.deck.pop()!;
    s.round!.stack.push({ kind: 'block', playerId: 'p2', card: card as never });
    expect(topOwner(s.round!)).toBe('p2');
  });
});

describe('randomPolicy branch coverage', () => {
  function viewFor(state: GameState, id: string) {
    return playerView(state, id);
  }

  it('occasionally gambles a garbage solve', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, settings: NO_INTERRUPTS });
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    expect(randomPolicy.chooseTurnAction(viewFor(s, 'p1'), stubRng([0.01])).type).toBe('solve');
    expect(randomPolicy.chooseTurnAction(viewFor(s, 'p1'), stubRng([0.9])).type).toBe('pass');
    expect(passivePolicy.chooseTurnAction(viewFor(s, 'p1'), stubRng([0.5])).type).toBe('pass');
  });

  it('skips cards it cannot legally aim', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2, settings: NO_INTERRUPTS });
    // Only unaimable or interrupt cards: WILD/VOWEL_RUSH with nothing left to
    // name, plus interrupts that are never a turn action.
    plantHand(s, 'p1', ['WILD', 'VOWEL_RUSH', 'SWIPE', 'BLOCK', 'BUZZ_IN', 'LOCKOUT', 'CRACK']);
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') if (!s.round!.revealed.includes(l)) s.round!.missed.push(l);
    const chosen = randomPolicy.chooseTurnAction(viewFor(s, 'p1'), createRng(3));
    expect(['playCard', 'discard']).toContain(chosen.type);
  });

  it('has no interrupt to offer when it holds nothing', () => {
    const s = startGame({ puzzle: PUZZLE, players: 2 });
    const view = viewFor(s, 'p1');
    const window = { windowId: 'w', kind: 'hit' as const, sourcePlayerId: 'p2', targetPlayerId: null, expiresAt: 0, chain: 0, playableCardIds: [], passed: false };
    expect(randomPolicy.chooseInterrupt(view, window, createRng(1))).toBeNull();
    expect(randomPolicy.chooseInterrupt(view, { ...window, playableCardIds: ['c1'] }, stubRng([0.1]))).toBeNull();
    expect(randomPolicy.chooseInterrupt(view, { ...window, playableCardIds: ['c1'] }, stubRng([0.9]))).toMatchObject({
      type: 'playInterrupt',
      cardId: 'c1',
    });
  });

  it('aims LOCKOUT at a real opponent and WILD at an open letter', () => {
    const s = startGame({ puzzle: PUZZLE, players: 3, settings: NO_INTERRUPTS });
    plantHand(s, 'p1', ['LOCKOUT', 'WILD', 'VOWEL_RUSH', 'CRACK', 'SKIP', 'PEEK', 'SHUFFLE']);
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const a = randomPolicy.chooseTurnAction(viewFor(s, 'p1'), createRng(i));
      if (a.type === 'playCard' && a.intent.type === 'action') {
        const card = s.players[0]!.hand.find((c) => c.id === a.intent.cardId)!;
        if (card.kind === 'action') seen.add(card.action);
        if (card.kind === 'action' && card.action === 'LOCKOUT') expect(['p2', 'p3']).toContain(a.intent.targetPlayerId);
        if (card.kind === 'action' && card.action === 'VOWEL_RUSH') expect('AEIOU').toContain(a.intent.letter!);
      }
    }
    expect(seen.has('LOCKOUT')).toBe(true);
    expect(seen.has('WILD')).toBe(true);
    expect(seen.has('VOWEL_RUSH')).toBe(true);
  });
});
