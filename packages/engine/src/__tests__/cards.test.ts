import { defaultBalance } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { maskBoard, positionsOf } from '../board.js';
import { checkInvariants } from '../invariants.js';
import { makePuzzle } from '../testing/fixtures.js';
import { act, actWithEvents, catchCode, plantAction, plantHand, plantLetter, scoreOf, startGame } from '../testing/harness.js';

const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS', { hint: 'Patience, at the stove.' });
const NO_INTERRUPTS = { interruptsEnabled: false };

function game(players = 3, settings: Record<string, unknown> = {}) {
  return startGame({ puzzle: PUZZLE, players, seed: 777, settings: { ...NO_INTERRUPTS, ...settings } });
}

/** Play an action card from p1 and decline the follow-up solve. */
function playAction(state: ReturnType<typeof game>, playerId: string, cardId: string, extra: Record<string, unknown> = {}) {
  const res = actWithEvents(state, { type: 'playCard', playerId, intent: { type: 'action', cardId, ...extra } });
  let s = res.state;
  if (s.round?.phase === 'awaiting-solve') s = act(s, { type: 'pass', playerId });
  return { state: s, events: res.events, midState: res.state };
}

describe('SKIP', () => {
  it('makes the next player lose their turn', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'SKIP');
    const { state, events } = playAction(s, 'p1', id);
    expect(events.find((e) => e.t === 'skip')).toMatchObject({ skippedPlayerId: 'p2' });
    expect(state.round!.currentPlayerId).toBe('p3');
    expect(state.players.find((p) => p.id === 'p2')!.skipNextTurn).toBe(false);
  });
});

describe('REVERSE', () => {
  it('flips direction with 3+ players', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'REVERSE');
    const { state, events } = playAction(s, 'p1', id);
    expect(events.some((e) => e.t === 'reverse')).toBe(true);
    expect(state.round!.direction).toBe(-1);
    expect(state.round!.currentPlayerId).toBe('p3');
  });

  it('acts as SKIP in a 2-player game (§3.5)', () => {
    const s = game(2);
    const id = plantAction(s, 'p1', 'REVERSE');
    const { state, events } = playAction(s, 'p1', id);
    expect(events.some((e) => e.t === 'reverse')).toBe(false);
    expect(events.find((e) => e.t === 'skip')).toMatchObject({ skippedPlayerId: 'p2' });
    expect(state.round!.direction).toBe(1);
    expect(state.round!.currentPlayerId).toBe('p1');
  });
});

describe('DOUBLE DOWN', () => {
  it('doubles the next letter hit', () => {
    let s = game(2);
    const dd = plantAction(s, 'p1', 'DOUBLE_DOWN');
    s = playAction(s, 'p1', dd).state;
    expect(s.players[0]!.doubleDownArmed).toBe(true);
    s = act(s, { type: 'discard', playerId: 'p2', cardIds: [s.players[1]!.hand[0]!.id] });
    s = act(s, { type: 'pass', playerId: 'p2' });
    const occ = positionsOf(s.round!.answer, 'E').length;
    const letterId = plantLetter(s, 'p1', 'E');
    const { state, events } = actWithEvents(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId: letterId } });
    expect(events.find((e) => e.t === 'letter:hit')).toMatchObject({ points: occ * 10 * 2 });
    expect(state.players[0]!.doubleDownArmed).toBe(false);
  });

  it('doubles the pressure of a miss too', () => {
    let s = game(2);
    const dd = plantAction(s, 'p1', 'DOUBLE_DOWN');
    s = playAction(s, 'p1', dd).state;
    s = act(s, { type: 'discard', playerId: 'p2', cardIds: [s.players[1]!.hand[0]!.id] });
    s = act(s, { type: 'pass', playerId: 'p2' });
    const letterId = plantLetter(s, 'p1', 'Z');
    const { state, events } = actWithEvents(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId: letterId } });
    expect(events.find((e) => e.t === 'letter:miss')).toMatchObject({ pressureDelta: 2 });
    expect(state.round!.pressure).toBe(2);
  });

  it('expires at round end', () => {
    let s = game(2, { rounds: 3 });
    const dd = plantAction(s, 'p1', 'DOUBLE_DOWN');
    s = playAction(s, 'p1', dd).state;
    s = act(s, { type: 'discard', playerId: 'p2', cardIds: [s.players[1]!.hand[0]!.id] });
    s = act(s, { type: 'solve', playerId: 'p2', guess: PUZZLE.text });
    s = act(s, { type: 'startRound', puzzle: PUZZLE });
    expect(s.players[0]!.doubleDownArmed).toBe(false);
  });
});

describe('VOWEL RUSH', () => {
  it('reveals a vowel for +2 pressure and no points', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'VOWEL_RUSH');
    const { state, events } = playAction(s, 'p1', id, { letter: 'O' });
    expect(state.round!.revealed).toContain('O');
    expect(state.round!.pressure).toBe(2);
    expect(scoreOf(state, 'p1')).toBe(0);
    expect(events.find((e) => e.t === 'reveal')).toMatchObject({ reason: 'vowel-rush' });
  });

  it('records a vowel that is not in the puzzle as a miss', () => {
    const s = startGame({ puzzle: makePuzzle('MY GYM SHORTS'), settings: NO_INTERRUPTS, seed: 4 });
    const id = plantAction(s, 'p1', 'VOWEL_RUSH');
    const { state } = playAction(s, 'p1', id, { letter: 'A' });
    expect(state.round!.missed).toContain('A');
    expect(state.round!.pressure).toBe(2);
  });

  it('demands an actual, unplayed vowel', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'VOWEL_RUSH');
    expect(catchCode(() => act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: id } }))).toBe(
      'LETTER_REQUIRED',
    );
    expect(
      catchCode(() => act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: id, letter: 'T' } })),
    ).toBe('LETTER_REQUIRED');
    const played = playAction(s, 'p1', id, { letter: 'O' }).state;
    const again = plantAction(played, 'p2', 'VOWEL_RUSH');
    expect(
      catchCode(() => act(played, { type: 'playCard', playerId: 'p2', intent: { type: 'action', cardId: again, letter: 'O' } })),
    ).toBe('LETTER_ALREADY_GUESSED');
  });
});

describe('SHUFFLE', () => {
  it('passes every hand one seat along the play direction', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'SHUFFLE');
    const before = s.players.map((p) => p.hand.filter((c) => c.id !== id).map((c) => c.id).join(','));
    const { state, events } = playAction(s, 'p1', id);
    expect(events.find((e) => e.t === 'shuffle')).toMatchObject({ order: ['p1', 'p2', 'p3'] });
    // p1's remaining cards are now held by p2 (ignoring the end-of-turn draw).
    expect(state.players[1]!.hand.map((c) => c.id).join(',')).toBe(before[0]);
    expect(state.players[2]!.hand.map((c) => c.id).join(',')).toBe(before[1]);
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('PEEK', () => {
  it('records a private tile and keeps it out of the masked board', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'PEEK');
    const { state, events } = playAction(s, 'p1', id);
    const peek = events.find((e) => e.t === 'peek');
    expect(peek).toBeDefined();
    const entries = Object.entries(state.players[0]!.peeks);
    expect(entries).toHaveLength(1);
    const [index, letter] = entries[0]!;
    expect(state.round!.answer.replace(/ /g, '')[Number(index)]).toBe(letter);
    expect(JSON.stringify(maskBoard(state))).not.toContain(`"${letter}"`);
    expect(state.players[1]!.peeks).toEqual({});
  });

  it('does nothing when the board is already open', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'PEEK');
    for (const l of 'AWTCHEDPONVRBILS') if (!s.round!.revealed.includes(l)) s.round!.revealed.push(l);
    const { state, events } = playAction(s, 'p1', id);
    expect(events.some((e) => e.t === 'peek')).toBe(false);
    expect(state.players[0]!.peeks).toEqual({});
  });
});

describe('CRACK', () => {
  it('publishes the hint to everyone', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'CRACK');
    const { state, events } = playAction(s, 'p1', id);
    expect(events.find((e) => e.t === 'crack')).toMatchObject({ hint: PUZZLE.hint });
    expect(maskBoard(state).hint).toBe(PUZZLE.hint);
  });
});

describe('RELIEF VALVE', () => {
  it('drops the gauge by 3, clamped at zero', () => {
    const s = game(3);
    s.round!.pressure = 5;
    const id = plantAction(s, 'p1', 'RELIEF_VALVE');
    expect(playAction(s, 'p1', id).state.round!.pressure).toBe(2);

    const low = game(3);
    low.round!.pressure = 1;
    const id2 = plantAction(low, 'p1', 'RELIEF_VALVE');
    expect(playAction(low, 'p1', id2).state.round!.pressure).toBe(0);
  });
});

describe('VANDAL', () => {
  it('adds 2 pressure and draws 2', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'VANDAL');
    const { midState, events } = playAction(s, 'p1', id);
    expect(events.find((e) => e.t === 'draw')).toMatchObject({ count: 2 });
    expect(midState.round!.pressure).toBe(2);
    expect(midState.players[0]!.hand).toHaveLength(8);
  });

  it('never pushes a hand past the cap', () => {
    const balance = defaultBalance();
    balance.setup.startingHand = 8;
    const s = startGame({ puzzle: PUZZLE, players: 3, balance, settings: NO_INTERRUPTS, seed: 5 });
    const id = plantAction(s, 'p1', 'VANDAL');
    const { midState } = playAction(s, 'p1', id);
    expect(midState.players[0]!.hand.length).toBeLessThanOrEqual(balance.setup.handCap);
    expect(checkInvariants(midState)).toEqual([]);
  });
});

describe('WILD', () => {
  it('plays as any letter and scores normally', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'WILD');
    const occ = positionsOf(s.round!.answer, 'T').length;
    const { state, events } = playAction(s, 'p1', id, { letter: 'T' });
    expect(events.find((e) => e.t === 'letter:hit')).toMatchObject({ letter: 'T', points: occ * 10 });
    expect(state.round!.revealed).toContain('T');
  });

  it('demands a legal, unplayed letter', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'WILD');
    expect(catchCode(() => act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: id } }))).toBe(
      'LETTER_REQUIRED',
    );
    expect(
      catchCode(() => act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: id, letter: '5' } })),
    ).toBe('LETTER_REQUIRED');
  });

  it('can miss, and then costs pressure', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'WILD');
    const { state } = playAction(s, 'p1', id, { letter: 'Z' });
    expect(state.round!.pressure).toBe(1);
    expect(checkInvariants(state)).toEqual([]);
  });
});

describe('LOCKOUT', () => {
  it('blocks the target from solving on their next turn only', () => {
    let s = game(2);
    const id = plantAction(s, 'p1', 'LOCKOUT');
    const res = playAction(s, 'p1', id, { targetPlayerId: 'p2' });
    s = res.state;
    expect(res.events.find((e) => e.t === 'lockout')).toMatchObject({ targetPlayerId: 'p2' });
    expect(s.players[1]!.lockedNextTurn).toBe(true);
    expect(s.round!.currentPlayerId).toBe('p2');
    // p2 acts; the lock means the solve step is skipped entirely.
    s = act(s, { type: 'discard', playerId: 'p2', cardIds: [s.players[1]!.hand[0]!.id] });
    expect(s.round!.currentPlayerId).toBe('p1');
    expect(s.players[1]!.lockedNextTurn).toBe(false);
  });

  it('requires a real target that is not yourself', () => {
    const s = game(3);
    const id = plantAction(s, 'p1', 'LOCKOUT');
    expect(catchCode(() => act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: id } }))).toBe(
      'TARGET_REQUIRED',
    );
    for (const target of ['p1', 'ghost']) {
      expect(
        catchCode(() =>
          act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'action', cardId: id, targetPlayerId: target } }),
        ),
      ).toBe('INVALID_TARGET');
    }
  });
});

describe('every turn card is playable without breaking an invariant', () => {
  it('runs the whole registry', () => {
    const kinds = ['SKIP', 'REVERSE', 'DOUBLE_DOWN', 'VOWEL_RUSH', 'SHUFFLE', 'PEEK', 'CRACK', 'RELIEF_VALVE', 'VANDAL', 'WILD', 'LOCKOUT'] as const;
    for (const kind of kinds) {
      const s = game(4);
      plantHand(s, 'p1', [kind, 'B', 'C', 'D', 'F', 'G', 'H']);
      const id = s.players[0]!.hand[0]!.id;
      const extra: Record<string, unknown> = {};
      if (kind === 'VOWEL_RUSH') extra.letter = 'E';
      if (kind === 'WILD') extra.letter = 'W';
      if (kind === 'LOCKOUT') extra.targetPlayerId = 'p3';
      const { state } = playAction(s, 'p1', id, extra);
      expect(checkInvariants(state), kind).toEqual([]);
    }
  });
});
