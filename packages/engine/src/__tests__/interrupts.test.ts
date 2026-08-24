import { describe, expect, it } from 'vitest';
import { positionsOf } from '../board.js';
import { checkInvariants } from '../invariants.js';
import type { GameState } from '../state.js';
import { makePuzzle } from '../testing/fixtures.js';
import { act, actWithEvents, catchCode, plantAction, plantLetter, scoreOf, startGame } from '../testing/harness.js';

const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS');

/** Interrupt windows only open if somebody holds the card, so tests must own
 *  exactly which interrupt cards are in play. */
function sanitize(state: GameState): GameState {
  for (const p of state.players) {
    p.hand = p.hand.map((c) =>
      c.kind === 'action' && ['SWIPE', 'BLOCK', 'BUZZ_IN'].includes(c.action)
        ? { id: c.id, kind: 'letter' as const, letter: 'Q' }
        : c,
    );
  }
  return state;
}

/**
 * Interrupts are OFF by default now (they were a lot to explain to a new
 * player), so this whole suite has to switch them on explicitly. A test that
 * silently relied on the default would pass for the wrong reason.
 */
function game(players = 3, settings: Record<string, unknown> = {}) {
  return sanitize(startGame({ puzzle: PUZZLE, players, seed: 314, settings: { interruptsEnabled: true, ...settings } }));
}

/** p1 plays a hitting letter; returns the state with the window open. */
function hitWithWindow(s: GameState) {
  const cardId = plantLetter(s, 'p1', 'E');
  return actWithEvents(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId } });
}

describe('SWIPE (§3.5)', () => {
  it('opens a window on a hit only when somebody holds a Swipe', () => {
    const none = game();
    expect(hitWithWindow(none).state.round!.window).toBeNull();

    const s = game();
    plantAction(s, 'p2', 'SWIPE');
    const { state, events } = hitWithWindow(s);
    expect(state.round!.window).toMatchObject({ kind: 'hit', sourcePlayerId: 'p1', chain: 0 });
    expect(state.round!.window!.eligible).toEqual(['p2']);
    expect(events.find((e) => e.t === 'interrupt:open')).toMatchObject({ kind: 'hit', expiresAt: 4000 });
    expect(state.round!.phase).toBe('interrupt');
  });

  it('steals the reveal points from the hit', () => {
    const s = game();
    const swipeId = plantAction(s, 'p2', 'SWIPE');
    const occ = positionsOf(s.round!.answer, 'E').length;
    let next = hitWithWindow(s).state;
    expect(scoreOf(next, 'p1')).toBe(occ * 10);

    const res = actWithEvents(next, { type: 'playInterrupt', playerId: 'p2', cardId: swipeId, windowId: next.round!.window!.id });
    next = res.state;
    expect(res.events.find((e) => e.t === 'swipe')).toMatchObject({ playerId: 'p2', fromPlayerId: 'p1', points: occ * 10 });
    expect(scoreOf(next, 'p1')).toBe(0);
    expect(scoreOf(next, 'p2')).toBe(occ * 10);
    expect(next.round!.phase).toBe('awaiting-solve');
    expect(checkInvariants(next)).toEqual([]);
  });

  it('resolves with the points intact when everyone passes', () => {
    const s = game();
    plantAction(s, 'p2', 'SWIPE');
    const occ = positionsOf(s.round!.answer, 'E').length;
    let next = hitWithWindow(s).state;
    const res = actWithEvents(next, { type: 'passInterrupt', playerId: 'p2', windowId: next.round!.window!.id });
    next = res.state;
    expect(res.events.some((e) => e.t === 'interrupt:close')).toBe(true);
    expect(next.round!.window).toBeNull();
    expect(scoreOf(next, 'p1')).toBe(occ * 10);
    expect(next.round!.stack).toHaveLength(0);
  });

  it('resolves on tick once the 4-second window expires', () => {
    const s = game();
    plantAction(s, 'p2', 'SWIPE');
    let next = hitWithWindow(s).state;
    expect(act(next, { type: 'tick' }, 3999).round!.window).not.toBeNull();
    next = act(next, { type: 'tick' }, 4000);
    expect(next.round!.window).toBeNull();
    expect(next.round!.phase).toBe('awaiting-solve');
  });

  it('cannot be played by the hitter, or after the window expires', () => {
    const s = game();
    plantAction(s, 'p2', 'SWIPE');
    const p1Swipe = plantAction(s, 'p1', 'SWIPE', 1);
    const next = hitWithWindow(s).state;
    const wid = next.round!.window!.id;
    expect(catchCode(() => act(next, { type: 'playInterrupt', playerId: 'p1', cardId: p1Swipe, windowId: wid }))).toBe(
      'INTERRUPT_NOT_ALLOWED',
    );
    expect(catchCode(() => act(next, { type: 'playInterrupt', playerId: 'p2', cardId: 'ghost', windowId: 'other' }))).toBe(
      'NO_INTERRUPT_WINDOW',
    );
    expect(
      catchCode(() => act(next, { type: 'playInterrupt', playerId: 'p2', cardId: 'ghost', windowId: wid }, 9999)),
    ).toBe('NO_INTERRUPT_WINDOW');
  });

  it('rejects the wrong card, a missing card, and a double response', () => {
    const s = game();
    const swipeId = plantAction(s, 'p2', 'SWIPE');
    plantAction(s, 'p2', 'CRACK', 1);
    const crackId = s.players[1]!.hand[1]!.id;
    const next = hitWithWindow(s).state;
    const wid = next.round!.window!.id;
    expect(catchCode(() => act(next, { type: 'playInterrupt', playerId: 'p2', cardId: crackId, windowId: wid }))).toBe(
      'WRONG_CARD_TYPE',
    );
    expect(catchCode(() => act(next, { type: 'playInterrupt', playerId: 'p2', cardId: 'nope', windowId: wid }))).toBe(
      'CARD_NOT_IN_HAND',
    );
    expect(catchCode(() => act(next, { type: 'passInterrupt', playerId: 'p3', windowId: wid }))).toBe(
      'INTERRUPT_NOT_ALLOWED',
    );
    const passed = act(next, { type: 'passInterrupt', playerId: 'p2', windowId: wid });
    // The window closed on that pass, so a follow-up finds nothing open.
    expect(catchCode(() => act(passed, { type: 'playInterrupt', playerId: 'p2', cardId: swipeId, windowId: wid }))).toBe(
      'NO_INTERRUPT_WINDOW',
    );
  });
});

describe('BLOCK and the LIFO chain (§3.5)', () => {
  it('a Block cancels the Swipe and the points stay put', () => {
    const s = game();
    const swipeId = plantAction(s, 'p2', 'SWIPE');
    const blockId = plantAction(s, 'p1', 'BLOCK', 1);
    const occ = positionsOf(s.round!.answer, 'E').length;

    let next = hitWithWindow(s).state;
    next = act(next, { type: 'playInterrupt', playerId: 'p2', cardId: swipeId, windowId: next.round!.window!.id });
    expect(next.round!.window).toMatchObject({ kind: 'targeted', targetPlayerId: 'p1', chain: 1 });

    const res = actWithEvents(next, { type: 'playInterrupt', playerId: 'p1', cardId: blockId, windowId: next.round!.window!.id });
    next = res.state;
    expect(res.events.some((e) => e.t === 'block')).toBe(true);
    expect(res.events.some((e) => e.t === 'swipe')).toBe(false);
    expect(scoreOf(next, 'p1')).toBe(occ * 10);
    expect(scoreOf(next, 'p2')).toBe(0);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('a Block can itself be blocked, so the Swipe lands after all', () => {
    const s = game();
    const swipeId = plantAction(s, 'p2', 'SWIPE');
    const blockP1 = plantAction(s, 'p1', 'BLOCK', 1);
    const blockP2 = plantAction(s, 'p2', 'BLOCK', 1);
    const occ = positionsOf(s.round!.answer, 'E').length;

    let next = hitWithWindow(s).state;
    next = act(next, { type: 'playInterrupt', playerId: 'p2', cardId: swipeId, windowId: next.round!.window!.id });
    next = act(next, { type: 'playInterrupt', playerId: 'p1', cardId: blockP1, windowId: next.round!.window!.id });
    expect(next.round!.window).toMatchObject({ targetPlayerId: 'p2', chain: 2 });
    next = act(next, { type: 'playInterrupt', playerId: 'p2', cardId: blockP2, windowId: next.round!.window!.id });

    // Chain cap is 3, so no fourth window opens and the stack settles.
    expect(next.round!.window).toBeNull();
    expect(scoreOf(next, 'p2')).toBe(occ * 10);
    expect(scoreOf(next, 'p1')).toBe(0);
    expect(next.round!.stack).toHaveLength(0);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('refuses an interrupt once the chain cap is reached', () => {
    const s = game();
    const swipeId = plantAction(s, 'p2', 'SWIPE');
    plantAction(s, 'p1', 'BLOCK', 1);
    const next = hitWithWindow(s).state;
    const forced = act(next, { type: 'playInterrupt', playerId: 'p2', cardId: swipeId, windowId: next.round!.window!.id });
    forced.round!.window!.chain = 3;
    const blockId = forced.players[0]!.hand.find((c) => c.kind === 'action' && c.action === 'BLOCK')!.id;
    expect(
      catchCode(() => act(forced, { type: 'playInterrupt', playerId: 'p1', cardId: blockId, windowId: forced.round!.window!.id })),
    ).toBe('CHAIN_LIMIT');
  });

  it('cancels a targeted LOCKOUT outright', () => {
    const s = game();
    const lockId = plantAction(s, 'p1', 'LOCKOUT');
    const blockId = plantAction(s, 'p2', 'BLOCK');
    let next = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: lockId, targetPlayerId: 'p2' } });
    expect(next.round!.window).toMatchObject({ kind: 'targeted', targetPlayerId: 'p2' });
    expect(next.players[1]!.lockedNextTurn).toBe(false);

    const res = actWithEvents(next, { type: 'playInterrupt', playerId: 'p2', cardId: blockId, windowId: next.round!.window!.id });
    next = res.state;
    expect(res.events.some((e) => e.t === 'lockout')).toBe(false);
    expect(next.players[1]!.lockedNextTurn).toBe(false);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('applies the LOCKOUT when the target lets the window lapse', () => {
    const s = game();
    const lockId = plantAction(s, 'p1', 'LOCKOUT');
    plantAction(s, 'p2', 'BLOCK');
    let next = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: lockId, targetPlayerId: 'p2' } });
    next = act(next, { type: 'passInterrupt', playerId: 'p2', windowId: next.round!.window!.id });
    expect(next.players[1]!.lockedNextTurn).toBe(true);
  });
});

describe('BUZZ IN (§3.5)', () => {
  it('takes the next turn out of order, once per round', () => {
    const s = game(3);
    const buzzId = plantAction(s, 'p3', 'BUZZ_IN');
    let next = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    next = act(next, { type: 'pass', playerId: 'p1' });
    expect(next.round!.window).toMatchObject({ kind: 'between' });
    expect(next.round!.window!.eligible).toEqual(['p3']);

    const res = actWithEvents(next, { type: 'playInterrupt', playerId: 'p3', cardId: buzzId, windowId: next.round!.window!.id });
    next = res.state;
    expect(res.events.some((e) => e.t === 'buzz')).toBe(true);
    expect(next.round!.currentPlayerId).toBe('p3');
    expect(next.players[2]!.buzzInsLeft).toBe(0);
    expect(checkInvariants(next)).toEqual([]);
  });

  it('will not open a window for a player with no buzz left', () => {
    const s = game(3);
    plantAction(s, 'p3', 'BUZZ_IN');
    s.players[2]!.buzzInsLeft = 0;
    let next = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    next = act(next, { type: 'pass', playerId: 'p1' });
    expect(next.round!.window).toBeNull();
    expect(next.round!.currentPlayerId).toBe('p2');
  });

  it('rejects a buzz once the allowance is spent', () => {
    const s = game(3);
    const buzzId = plantAction(s, 'p3', 'BUZZ_IN');
    let next = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    next = act(next, { type: 'pass', playerId: 'p1' });
    next.players[2]!.buzzInsLeft = 0;
    expect(
      catchCode(() => act(next, { type: 'playInterrupt', playerId: 'p3', cardId: buzzId, windowId: next.round!.window!.id })),
    ).toBe('BUZZ_EXHAUSTED');
  });

  it('hands the turn on normally when the buzz window lapses', () => {
    const s = game(3);
    plantAction(s, 'p3', 'BUZZ_IN');
    let next = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    next = act(next, { type: 'pass', playerId: 'p1' });
    next = act(next, { type: 'tick' }, 99_999);
    expect(next.round!.currentPlayerId).toBe('p2');
  });
});

describe('interrupts disabled', () => {
  it('never opens a window when the host turns them off', () => {
    const s = game(3, { interruptsEnabled: false });
    plantAction(s, 'p2', 'SWIPE');
    plantAction(s, 'p3', 'BUZZ_IN');
    const next = hitWithWindow(s).state;
    expect(next.round!.window).toBeNull();
    expect(next.round!.phase).toBe('awaiting-solve');
  });
});
