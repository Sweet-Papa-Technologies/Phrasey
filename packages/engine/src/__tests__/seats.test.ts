import { defaultBalance } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../invariants.js';
import { activePlayers, createMatch, findPlayer, getPlayer, toPublic } from '../state.js';
import { makePuzzle } from '../testing/fixtures.js';
import { act, actWithEvents, catchCode, currentId, startGame } from '../testing/harness.js';

const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS');
const NO_INTERRUPTS = { interruptsEnabled: false };

describe('createMatch', () => {
  it('promotes the first player to host when none is flagged', () => {
    const s = createMatch({ seed: 1, players: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
    expect(s.hostId).toBe('a');
    expect(s.players[0]!.isHost).toBe(true);
    expect(s.status).toBe('lobby');
  });

  it('rejects duplicate ids and an over-full table', () => {
    expect(catchCode(() => createMatch({ seed: 1, players: [{ id: 'a', name: 'A' }, { id: 'a', name: 'A2' }] }))).toBe(
      'INVALID_TARGET',
    );
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
    expect(catchCode(() => createMatch({ seed: 1, players: nine }))).toBe('INVALID_TARGET');
  });

  it('takes a balance override without mutating the caller copy', () => {
    const balance = defaultBalance();
    balance.pressure.max = 6;
    const s = createMatch({ seed: 1, players: [{ id: 'a', name: 'A' }], balance });
    s.balance.pressure.max = 99;
    expect(balance.pressure.max).toBe(6);
  });

  it('projects public player state without the hand', () => {
    const s = startGame({ players: 2 });
    const pub = toPublic(s.players[0]!);
    expect(pub.handCount).toBe(7);
    expect('hand' in pub).toBe(false);
    expect('peeks' in pub).toBe(false);
  });
});

describe('addPlayer (§7)', () => {
  it('seats a late joiner for the next round, not this one', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, settings: { ...NO_INTERRUPTS, rounds: 3 } });
    s = act(s, { type: 'addPlayer', player: { id: 'p3', name: 'Late' } });
    expect(activePlayers(s)).toHaveLength(3);
    expect(s.round!.order).toEqual(['p1', 'p2']);
    // The seat is skipped until the next deal.
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    s = act(s, { type: 'pass', playerId: 'p1' });
    expect(s.round!.currentPlayerId).toBe('p2');
    s = act(s, { type: 'discard', playerId: 'p2', cardIds: [s.players[1]!.hand[0]!.id] });
    s = act(s, { type: 'solve', playerId: 'p2', guess: PUZZLE.text });
    s = act(s, { type: 'startRound', puzzle: PUZZLE });
    expect(s.round!.order).toEqual(['p1', 'p2', 'p3']);
    expect(s.players[2]!.hand).toHaveLength(7);
  });

  it('rejects a duplicate seat or a full room', () => {
    const s = startGame({ players: 2 });
    expect(catchCode(() => act(s, { type: 'addPlayer', player: { id: 'p1', name: 'Clone' } }))).toBe('INVALID_TARGET');
    let full = startGame({ players: 8, puzzle: PUZZLE });
    expect(catchCode(() => act(full, { type: 'addPlayer', player: { id: 'p9', name: 'Nine' } }))).toBe('INVALID_TARGET');
  });
});

describe('removePlayer (§7)', () => {
  it('returns their cards to the discard and moves the turn on', () => {
    let s = startGame({ puzzle: PUZZLE, players: 3, settings: NO_INTERRUPTS });
    expect(s.round!.currentPlayerId).toBe('p1');
    s = act(s, { type: 'removePlayer', playerId: 'p1' });
    expect(s.round!.currentPlayerId).toBe('p2');
    expect(s.players[0]!.hand).toHaveLength(0);
    expect(activePlayers(s).map((p) => p.id)).toEqual(['p2', 'p3']);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('abandons the round when the table drops below the minimum', () => {
    let s = startGame({ puzzle: PUZZLE, players: 2, settings: { ...NO_INTERRUPTS, rounds: 3 } });
    s = act(s, { type: 'removePlayer', playerId: 'p2' });
    expect(s.round!.endedReason).toBe('abandoned');
    expect(s.results[0]!.reason).toBe('abandoned');
  });

  it('hands the host badge to another human', () => {
    let s = startGame({ puzzle: PUZZLE, players: [
      { id: 'p1', name: 'Host', isHost: true },
      { id: 'p2', name: 'Bot', isBot: true },
      { id: 'p3', name: 'Human' },
    ] });
    s = act(s, { type: 'removePlayer', playerId: 'p1' });
    expect(s.hostId).toBe('p3');
    expect(s.players.find((p) => p.id === 'p3')!.isHost).toBe(true);
  });

  it('closes an open interrupt window the leaver was holding up', () => {
    let s = startGame({ puzzle: PUZZLE, players: 3, seed: 314 });
    for (const p of s.players) {
      p.hand = p.hand.map((c) =>
        c.kind === 'action' && ['SWIPE', 'BLOCK', 'BUZZ_IN'].includes(c.action) ? { id: c.id, kind: 'letter', letter: 'Q' } : c,
      );
    }
    const swipe = s.players[1]!.hand[0]!;
    s.players[1]!.hand[0] = { id: swipe.id, kind: 'action', action: 'SWIPE' };
    const letter = s.players[0]!.hand[0]!;
    s.players[0]!.hand[0] = { id: letter.id, kind: 'letter', letter: 'E' };
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId: letter.id } });
    expect(s.round!.window).not.toBeNull();
    s = act(s, { type: 'removePlayer', playerId: 'p2' });
    expect(s.round!.window).toBeNull();
    expect(checkInvariants(s)).toEqual([]);
  });

  it('is a no-op for the round when nobody is playing', () => {
    let s = startGame({ players: 3, lobbyOnly: true });
    s = act(s, { type: 'removePlayer', playerId: 'p1' });
    expect(activePlayers(s)).toHaveLength(2);
    expect(s.hostId).toBe('p2');
  });
});

describe('convertSeatToBot (§7)', () => {
  it('keeps the name and marks the seat as a converted human', () => {
    let s = startGame({ puzzle: PUZZLE, players: 3 });
    const { state, events } = actWithEvents(s, { type: 'convertSeatToBot', playerId: 'p1', tier: 'ruthless', persona: 'Cold.' });
    s = state;
    const p1 = getPlayer(s, 'p1');
    expect(p1).toMatchObject({ isBot: true, connection: 'bot', wasHuman: true, botTier: 'ruthless', name: 'P1', botPersona: 'Cold.' });
    expect(events.some((e) => e.t === 'notice')).toBe(true);
    // The host badge moves off a converted seat.
    expect(s.hostId).toBe('p2');
  });

  it('accepts a renamed seat and defaults the tier from settings', () => {
    let s = startGame({ puzzle: PUZZLE, players: 3, settings: { botTier: 'chill' } });
    s = act(s, { type: 'convertSeatToBot', playerId: 'p2', name: 'P2 (bot)' });
    expect(getPlayer(s, 'p2')).toMatchObject({ name: 'P2 (bot)', botTier: 'chill' });
  });

  it('keeps playing that seat without interruption', () => {
    let s = startGame({ puzzle: PUZZLE, players: 3, settings: NO_INTERRUPTS });
    s = act(s, { type: 'convertSeatToBot', playerId: 'p1' });
    expect(currentId(s)).toBe('p1');
    s = act(s, { type: 'timeout', playerId: 'p1' });
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('player lookup', () => {
  it('distinguishes present, removed and unknown', () => {
    let s = startGame({ players: 3, lobbyOnly: true });
    s = act(s, { type: 'removePlayer', playerId: 'p3' });
    expect(findPlayer(s, 'p3')!.removed).toBe(true);
    expect(catchCode(() => getPlayer(s, 'p3'))).toBe('INVALID_TARGET');
    expect(findPlayer(s, 'ghost')).toBeUndefined();
  });
});
