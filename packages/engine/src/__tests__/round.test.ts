import { defaultBalance } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { applyAction } from '../actions.js';
import { hiddenLetterCount, positionsOf } from '../board.js';
import { checkInvariants, scoresFromEvents } from '../invariants.js';
import { makePuzzle } from '../testing/fixtures.js';
import { act, actWithEvents, catchCode, currentId, plantAction, plantHand, plantLetter, scoreOf, startGame } from '../testing/harness.js';

const PUZZLE = makePuzzle('A WATCHED POT NEVER BOILS', { hint: 'Patience, at the stove.' });
const NO_INTERRUPTS = { interruptsEnabled: false };

function game(overrides: Record<string, unknown> = {}) {
  return startGame({ puzzle: PUZZLE, seed: 2024, settings: { ...NO_INTERRUPTS, ...overrides } });
}

describe('round setup (§3.1)', () => {
  it('deals 7 cards to each player and puts p1 on the clock', () => {
    const s = game();
    expect(s.status).toBe('playing');
    expect(s.round!.roundNumber).toBe(1);
    for (const p of s.players) expect(p.hand).toHaveLength(7);
    expect(s.round!.currentPlayerId).toBe('p1');
    expect(s.round!.phase).toBe('turn');
    expect(s.round!.pressure).toBe(0);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('sizes the deck from the player count', () => {
    expect(startGame({ players: 2, puzzle: PUZZLE }).round!.deckSize).toBe(60);
    expect(startGame({ players: 8, puzzle: PUZZLE }).round!.deckSize).toBe(144);
  });

  it('emits round:start with the category but never the answer', () => {
    const s = startGame({ puzzle: PUZZLE, lobbyOnly: true });
    const { events } = actWithEvents(s, { type: 'startRound', puzzle: PUZZLE });
    const start = events.find((e) => e.t === 'round:start');
    expect(start).toMatchObject({ category: PUZZLE.category, roundNumber: 1 });
    expect(JSON.stringify(events)).not.toContain('WATCHED');
  });

  it('refuses to start a second round on top of a live one', () => {
    const s = game();
    expect(catchCode(() => act(s, { type: 'startRound', puzzle: PUZZLE }))).toBe('ROUND_NOT_ACTIVE');
  });

  it('refuses to start below the minimum player count', () => {
    const s = startGame({ players: [{ id: 'solo', name: 'Solo' }], lobbyOnly: true });
    expect(catchCode(() => act(s, { type: 'startRound', puzzle: PUZZLE }))).toBe('ROUND_NOT_ACTIVE');
  });
});

describe('playing a letter (§3.3)', () => {
  it('hits for +10 per occurrence and reveals every one', () => {
    const s = game();
    const cardId = plantLetter(s, 'p1', 'E');
    const occ = positionsOf(s.round!.answer, 'E').length;
    const { state, events } = actWithEvents(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId } });
    const hit = events.find((e) => e.t === 'letter:hit');
    expect(hit).toMatchObject({ playerId: 'p1', letter: 'E', occurrences: occ, points: occ * 10 });
    expect(scoreOf(state, 'p1')).toBe(occ * 10);
    expect(state.round!.revealed).toContain('E');
    expect(state.round!.pressure).toBe(0);
    expect(state.round!.phase).toBe('awaiting-solve');
  });

  it('misses for +1 pressure and no points', () => {
    const s = game();
    const cardId = plantLetter(s, 'p1', 'Z');
    const { state, events } = actWithEvents(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId } });
    expect(events.some((e) => e.t === 'letter:miss')).toBe(true);
    expect(state.round!.pressure).toBe(1);
    expect(scoreOf(state, 'p1')).toBe(0);
    expect(state.round!.missed).toContain('Z');
  });

  it('hands the turn on once the player declines the solve', () => {
    let s = game();
    const cardId = plantLetter(s, 'p1', 'E');
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId } });
    s = act(s, { type: 'pass', playerId: 'p1' });
    expect(s.round!.currentPlayerId).toBe('p2');
    expect(s.round!.phase).toBe('turn');
  });

  it('draws the acting player back up to the hand minimum', () => {
    let s = game();
    const cardId = plantLetter(s, 'p1', 'E');
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId } });
    s = act(s, { type: 'pass', playerId: 'p1' });
    // Started at 7, played 1 -> 6, which is already above the minimum of 5.
    expect(s.players[0]!.hand).toHaveLength(6);
  });

  it('rejects a letter already played', () => {
    let s = game();
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId: plantLetter(s, 'p1', 'E') } });
    s = act(s, { type: 'pass', playerId: 'p1' });
    const dupe = plantLetter(s, 'p2', 'E');
    expect(catchCode(() => act(s, { type: 'playCard', playerId: 'p2', intent: { type: 'letter', cardId: dupe } }))).toBe(
      'LETTER_ALREADY_GUESSED',
    );
  });
});

describe('discard & draw (§3.3)', () => {
  it('discards 1-3 and redraws to the hand minimum', () => {
    let s = game();
    const ids = s.players[0]!.hand.slice(0, 3).map((c) => c.id);
    const { state, events } = actWithEvents(s, { type: 'discard', playerId: 'p1', cardIds: ids });
    s = state;
    expect(events.find((e) => e.t === 'discard')).toMatchObject({ count: 3 });
    expect(s.round!.discard).toHaveLength(3);
    s = act(s, { type: 'pass', playerId: 'p1' });
    expect(s.players[0]!.hand).toHaveLength(5);
    expect(checkInvariants(s)).toEqual([]);
  });

  it('rejects an out-of-range or duplicated discard', () => {
    const s = game();
    const ids = s.players[0]!.hand.map((c) => c.id);
    expect(catchCode(() => act(s, { type: 'discard', playerId: 'p1', cardIds: [] }))).toBe('INVALID_DISCARD');
    expect(catchCode(() => act(s, { type: 'discard', playerId: 'p1', cardIds: ids.slice(0, 4) }))).toBe('INVALID_DISCARD');
    expect(catchCode(() => act(s, { type: 'discard', playerId: 'p1', cardIds: [ids[0]!, ids[0]!] }))).toBe('INVALID_DISCARD');
    expect(catchCode(() => act(s, { type: 'discard', playerId: 'p1', cardIds: ['nope'] }))).toBe('CARD_NOT_IN_HAND');
  });
});

describe('solving (§3.3)', () => {
  it('pays 50 + 5 per still-hidden letter and ends the round', () => {
    let s = game({ rounds: 3 });
    const cardId = plantLetter(s, 'p1', 'E');
    s = act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId } });
    const hiddenAtSolve = hiddenLetterCount(s.round!);
    const before = scoreOf(s, 'p1');
    const { state, events } = actWithEvents(s, { type: 'solve', playerId: 'p1', guess: 'a watched pot never boils' });
    expect(events.find((e) => e.t === 'solve:success')).toMatchObject({ hiddenAtSolve, points: 50 + 5 * hiddenAtSolve });
    expect(scoreOf(state, 'p1')).toBe(before + 50 + 5 * hiddenAtSolve);
    expect(state.status).toBe('round-end');
    expect(state.round!.endedReason).toBe('solved');
    expect(state.results[0]!.answer).toBe(state.round!.answer);
  });

  it('is worth almost nothing on a nearly-full board', () => {
    // Stops one letter short on purpose: a board with NOTHING hidden now ends
    // the round on its own (see checkBoardComplete), so the last solvable
    // moment is with a single tile left. §3.3's point still stands — 55 versus
    // the 150-odd a solve is worth on a dark board.
    let s = game({ rounds: 3 });
    for (const l of ['A', 'W', 'T', 'C', 'H', 'E', 'D', 'P', 'O', 'N', 'V', 'R', 'B', 'I', 'L']) {
      if (hiddenLetterCount(s.round!) <= 1) break;
      const id = plantLetter(s, currentId(s), l);
      s = act(s, { type: 'playCard', playerId: currentId(s), intent: { type: 'letter', cardId: id } });
      if (s.round!.endedReason !== null) break;
      if (s.round!.phase === 'awaiting-solve') s = act(s, { type: 'pass', playerId: currentId(s) });
    }
    const hidden = hiddenLetterCount(s.round!);
    expect(hidden).toBeGreaterThan(0);
    expect(hidden).toBeLessThanOrEqual(2);
    const { events } = actWithEvents(s, { type: 'solve', playerId: currentId(s), guess: PUZZLE.text });
    expect(events.find((e) => e.t === 'solve:success')).toMatchObject({ points: 50 + 5 * hidden });
  });

  it('ends the round when every letter is up, instead of looping forever', () => {
    // A live game hit this: all letters revealed, nobody solved, and the table
    // kept taking turns with nothing left to guess.
    let s = game({ rounds: 3 });
    for (const l of ['A', 'W', 'T', 'C', 'H', 'E', 'D', 'P', 'O', 'N', 'V', 'R', 'B', 'I', 'L', 'S']) {
      if (s.round!.endedReason !== null) break;
      const id = plantLetter(s, currentId(s), l);
      s = act(s, { type: 'playCard', playerId: currentId(s), intent: { type: 'letter', cardId: id } });
      if (s.round!.endedReason !== null) break;
      if (s.round!.phase === 'awaiting-solve') s = act(s, { type: 'pass', playerId: currentId(s) });
    }
    expect(hiddenLetterCount(s.round!)).toBe(0);
    expect(s.round!.endedReason).toBe('revealed');
  });

  it('accepts a sloppy guess (case and punctuation)', () => {
    let s = startGame({ puzzle: makePuzzle("DON'T STOP, REALLY!"), settings: NO_INTERRUPTS, seed: 5 });
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    const { events } = actWithEvents(s, { type: 'solve', playerId: 'p1', guess: 'dont stop really' });
    expect(events.some((e) => e.t === 'solve:success')).toBe(true);
  });

  it('punishes a wrong solve with +3 pressure and a round-long lockout', () => {
    let s = game();
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    const { state, events } = actWithEvents(s, { type: 'solve', playerId: 'p1', guess: 'NOPE' });
    s = state;
    expect(events.find((e) => e.t === 'solve:fail')).toMatchObject({ pressureDelta: 3 });
    expect(s.round!.pressure).toBe(3);
    expect(s.players[0]!.solveLocked).toBe(true);
    expect(s.round!.currentPlayerId).toBe('p2');
  });

  it('bars a solve-locked player from trying again', () => {
    let s = game();
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    s = act(s, { type: 'solve', playerId: 'p1', guess: 'NOPE' });
    // p2, p3, back to p1
    for (const id of ['p2', 'p3']) {
      s = act(s, { type: 'discard', playerId: id, cardIds: [s.players.find((p) => p.id === id)!.hand[0]!.id] });
      s = act(s, { type: 'pass', playerId: id });
    }
    expect(s.round!.currentPlayerId).toBe('p1');
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    // A locked player is never offered the solve step at all.
    expect(s.round!.currentPlayerId).toBe('p2');
  });

  it('allows a solve before the primary action — it is your turn either way', () => {
    // Changed after playtest: pressing Solve on your own turn used to answer
    // "not your turn" until you had spent a card, with no way to discover why.
    // Being unable to say an answer you can see is the opposite of the premise.
    const s = game();
    const { state, events } = applyAction(s, { type: 'solve', playerId: 'p1', guess: PUZZLE.text }, 0);
    expect(events.some((e) => e.t === 'solve:success')).toBe(true);
    expect(state.round?.endedReason).toBe('solved');
  });

  it('a wrong solve before acting keeps the turn you have not spent', () => {
    const s = game();
    const { state } = applyAction(s, { type: 'solve', playerId: 'p1', guess: 'DEFINITELY NOT IT' }, 0);
    expect(state.round?.currentPlayerId).toBe('p1');
    expect(state.round?.phase).toBe('turn');
    expect(state.round?.turnActed).toBe(false);
    // The price is still real: locked out of solving for the rest of the round.
    expect(state.players.find((p) => p.id === 'p1')?.solveLocked).toBe(true);
    expect(state.round?.pressure).toBe(3);
  });

  it('a wrong solve after acting ends the turn, as before', () => {
    let s = game();
    const card = s.players[0]!.hand[0]!;
    s = applyAction(s, { type: 'playCard', playerId: 'p1', intent: { type: card.kind === 'letter' ? 'letter' : 'action', cardId: card.id } }, 0).state;
    if (s.round?.phase !== 'awaiting-solve') return; // action card may end the turn itself
    const after = applyAction(s, { type: 'solve', playerId: 'p1', guess: 'STILL NOT IT' }, 0).state;
    expect(after.round?.currentPlayerId).not.toBe('p1');
  });
});

describe('illegal actions never corrupt state', () => {
  it('leaves the caller state untouched and throws the right code', () => {
    const s = game();
    const snapshot = JSON.stringify(s);
    const cases: [() => unknown, string][] = [
      [() => act(s, { type: 'playCard', playerId: 'p2', intent: { type: 'letter', cardId: 'x' } }), 'NOT_YOUR_TURN'],
      [() => act(s, { type: 'playCard', playerId: 'p1', intent: { type: 'letter', cardId: 'nope' } }), 'CARD_NOT_IN_HAND'],
      [() => act(s, { type: 'solve', playerId: 'p2', guess: 'x' }), 'NOT_YOUR_TURN'],
      [() => act(s, { type: 'pass', playerId: 'p1' }), 'ROUND_NOT_ACTIVE'],
      [() => act(s, { type: 'passInterrupt', playerId: 'p2', windowId: 'w' }), 'NO_INTERRUPT_WINDOW'],
      [() => act(s, { type: 'playInterrupt', playerId: 'p2', cardId: 'c', windowId: 'w' }), 'NO_INTERRUPT_WINDOW'],
      [() => act(s, { type: 'removePlayer', playerId: 'ghost' }), 'INVALID_TARGET'],
    ];
    for (const [fn, code] of cases) {
      expect(catchCode(fn), code).toBe(code);
      expect(JSON.stringify(s)).toBe(snapshot);
    }
  });

  it('rejects the wrong card type for the intent', () => {
    const s = game();
    const letterId = plantLetter(s, 'p1', 'E', 0);
    const actionId = plantAction(s, 'p1', 'SKIP', 1);
    const swipeId = plantAction(s, 'p1', 'SWIPE', 2);
    for (const bad of [
      { type: 'action' as const, cardId: letterId },
      { type: 'letter' as const, cardId: actionId },
      { type: 'action' as const, cardId: swipeId },
    ]) {
      expect(catchCode(() => act(s, { type: 'playCard', playerId: 'p1', intent: bad }))).toBe('WRONG_CARD_TYPE');
    }
  });

  it('rejects a second primary action in the same turn', () => {
    let s = game();
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    expect(catchCode(() => act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] }))).toBe(
      'ALREADY_ACTED',
    );
  });

  it('rejects any play once the round has ended', () => {
    let s = game({ rounds: 3 });
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    s = act(s, { type: 'solve', playerId: 'p1', guess: PUZZLE.text });
    expect(catchCode(() => act(s, { type: 'discard', playerId: 'p2', cardIds: [s.players[1]!.hand[0]!.id] }))).toBe(
      'ROUND_NOT_ACTIVE',
    );
    expect(catchCode(() => act(s, { type: 'timeout', playerId: 'p2' }))).toBe('ROUND_NOT_ACTIVE');
  });
});

describe('turn timer and timeout (§3.3)', () => {
  it('sets a deadline from the host setting', () => {
    const s = game({ turnSeconds: 25 });
    expect(s.round!.turnEndsAt).toBe(25_000);
    expect(game({ turnSeconds: null }).round!.turnEndsAt).toBeNull();
  });

  it('auto-plays the statistically best held letter', () => {
    const s = game();
    plantHand(s, 'p1', ['Z', 'E', 'Q', 'SKIP', 'SHUFFLE', 'CRACK', 'PEEK']);
    const { state, events } = actWithEvents(s, { type: 'timeout', playerId: 'p1' });
    // E (12.7) beats Z (0.07) and Q (0.1).
    expect(events.find((e) => e.t === 'letter:hit')).toMatchObject({ letter: 'E' });
    expect(state.round!.revealed).toContain('E');
  });

  it('discards when it holds no playable letter', () => {
    const s = game();
    plantHand(s, 'p1', ['SKIP', 'SHUFFLE', 'CRACK', 'PEEK', 'RELIEF_VALVE', 'VANDAL', 'BLOCK']);
    const { state, events } = actWithEvents(s, { type: 'timeout', playerId: 'p1' });
    expect(events.some((e) => e.t === 'discard')).toBe(true);
    // Discarding still leaves the optional solve on the table.
    expect(state.round!.phase).toBe('awaiting-solve');
  });

  it('passes on the solve step when the clock runs out', () => {
    let s = game();
    s = act(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] });
    expect(s.round!.phase).toBe('awaiting-solve');
    s = act(s, { type: 'timeout', playerId: 'p1' });
    expect(s.round!.currentPlayerId).toBe('p2');
  });

  it('tick fires the timeout once the deadline passes', () => {
    const s = game({ turnSeconds: 10 });
    expect(act(s, { type: 'tick' }, 5_000).round!.currentPlayerId).toBe('p1');
    const after = act(s, { type: 'tick' }, 10_001);
    expect(after.round!.currentPlayerId === 'p1' && after.round!.phase === 'turn').toBe(false);
  });

  it('tick is a no-op with no live round', () => {
    const lobby = startGame({ lobbyOnly: true });
    expect(actWithEvents(lobby, { type: 'tick' }).events).toEqual([]);
  });

  it('rejects a timeout for a player who is not on the clock', () => {
    const s = game();
    expect(catchCode(() => act(s, { type: 'timeout', playerId: 'p3' }))).toBe('NOT_YOUR_TURN');
  });
});

describe('a full round is playable', () => {
  it('plays out to a solve with the books balanced', () => {
    let s = game({ rounds: 1 });
    const events = [];
    let guard = 0;
    while (s.status === 'playing' && guard++ < 200) {
      const id = currentId(s);
      if (s.round!.phase === 'awaiting-solve') {
        const res = hiddenLetterCount(s.round!) <= 6
          ? actWithEvents(s, { type: 'solve', playerId: id, guess: PUZZLE.text })
          : actWithEvents(s, { type: 'pass', playerId: id });
        s = res.state;
        events.push(...res.events);
        continue;
      }
      const res = actWithEvents(s, { type: 'timeout', playerId: id });
      s = res.state;
      events.push(...res.events);
      expect(checkInvariants(s), `after ${id}`).toEqual([]);
    }
    expect(s.status).toBe('match-end');
    expect(s.results[0]!.reason).toBe('solved');
    const fromLog = scoresFromEvents(events);
    for (const p of s.players) expect(p.score).toBe(fromLog[p.id] ?? 0);
  });
});

describe('deck exhaustion', () => {
  it('ends the round when the deck and every hand are empty', () => {
    const balance = defaultBalance();
    let s = startGame({ puzzle: PUZZLE, seed: 8, balance, settings: NO_INTERRUPTS });
    // Force the endgame: no deck, one card each.
    s.round!.discard.push(...s.round!.deck);
    s.round!.deck = [];
    for (const p of s.players) {
      s.round!.discard.push(...p.hand.slice(1));
      p.hand = p.hand.slice(0, 1);
    }
    let guard = 0;
    while (s.round!.endedReason === null && guard++ < 40) {
      const id = currentId(s);
      s = act(s, { type: 'timeout', playerId: id });
      if (s.round!.phase === 'awaiting-solve') s = act(s, { type: 'pass', playerId: id });
    }
    expect(s.round!.endedReason).toBe('deck-exhausted');
    expect(checkInvariants(s)).toEqual([]);
  });
});

describe('applyAction purity', () => {
  it('returns a new object and never mutates the input', () => {
    const s = game();
    const before = JSON.stringify(s);
    const res = applyAction(s, { type: 'discard', playerId: 'p1', cardIds: [s.players[0]!.hand[0]!.id] }, 0);
    expect(JSON.stringify(s)).toBe(before);
    expect(res.state).not.toBe(s);
    expect(res.state.round).not.toBe(s.round);
  });

  it('caps the in-state event log', () => {
    let s = game({ turnSeconds: null, rounds: 15 });
    for (let i = 0; i < 120 && s.status === 'playing'; i++) {
      const id = currentId(s);
      s = s.round!.phase === 'awaiting-solve'
        ? act(s, { type: 'pass', playerId: id })
        : act(s, { type: 'timeout', playerId: id });
    }
    expect(s.log.length).toBeLessThanOrEqual(200);
  });
});
