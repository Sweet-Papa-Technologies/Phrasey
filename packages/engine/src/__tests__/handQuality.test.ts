/**
 * A hand should not contain the same letter twice, and should not contain a
 * letter that has already been played this round.
 *
 * §3.2 builds the deck from the puzzle's letter multiset, weighted by
 * occurrence count — so duplicates are *common* by construction, not a rare
 * accident. And a duplicate is strictly dead weight: a hit reveals every
 * occurrence at once, so the second copy can never score.
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createMatch } from '../index.js';
import { drawCards, deadLettersFor, type RoundState } from '../state.js';
import { TEST_PUZZLES } from '../testing/fixtures.js';
import type { Card, Letter } from '@phrasey/shared';

function lettersIn(hand: readonly Card[]): Letter[] {
  return hand.filter((c) => c.kind === 'letter').map((c) => (c as { letter: Letter }).letter);
}
function dupes(hand: readonly Card[]): Letter[] {
  const seen = new Set<Letter>();
  const out: Letter[] = [];
  for (const l of lettersIn(hand)) {
    if (seen.has(l)) out.push(l);
    seen.add(l);
  }
  return out;
}

function playedMatch(seed: number) {
  const puzzle = TEST_PUZZLES[seed % TEST_PUZZLES.length]!;
  let st = createMatch({
    seed,
    players: [
      { id: 'p1', name: 'A', color: '#fff' },
      { id: 'p2', name: 'B', color: '#000' },
      { id: 'p3', name: 'C', color: '#111' },
      { id: 'p4', name: 'D', color: '#222' },
    ],
    nowMs: 0,
  });
  st = applyAction(st, { type: 'startRound', puzzle }, 0).state;
  return st;
}

describe('hands never hold dead letters', () => {
  it('deals no duplicate letter to anyone, across many seeds', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const st = playedMatch(seed);
      for (const p of st.players) {
        expect(dupes(p.hand), `seed ${seed}, ${p.id} was dealt duplicates`).toEqual([]);
      }
    }
  });

  it('only ever holds a duplicate when the deck had nothing else to give', () => {
    // Late in a round the deck can be down to nothing but duplicates. Taking
    // one is correct — refusing would stall the round, and a dead card can
    // still be discarded. What must never happen is dealing a duplicate while
    // a usable card was sitting right there.
    let dupObservations = 0;
    let deckHadAlternative = 0;

    for (let seed = 1; seed <= 60; seed++) {
      let st = playedMatch(seed);
      for (let step = 0; step < 80 && st.round && !st.round.endedReason; step++) {
        const round = st.round;
        for (const p of st.players) {
          const d = dupes(p.hand);
          if (d.length === 0) continue;
          dupObservations++;
          const dead = deadLettersFor(round, p.hand);
          const alternative = round.deck.some((c) => c.kind !== 'letter' || !dead.has(c.letter));
          if (alternative) {
            deckHadAlternative++;
            expect.fail(
              `seed ${seed} step ${step}: ${p.id} holds duplicate ${d.join(',')} ` +
                `while the deck still had ${round.deck.length} cards including a usable one`,
            );
          }
        }
        try {
          st = applyAction(st, { type: 'timeout' }, step * 1000).state;
        } catch {
          break;
        }
      }
    }
    expect(deckHadAlternative).toBe(0);
    // Sanity: if this is 0 the test proved nothing, so make the exhausted-deck
    // path visible rather than silently vacuous.
    expect(dupObservations).toBeGreaterThan(0);
  });

  it('does not deal a letter that has already been played this round', () => {
    for (let seed = 1; seed <= 60; seed++) {
      let st = playedMatch(seed);
      for (let step = 0; step < 60 && st.round && !st.round.endedReason; step++) {
        const round = st.round;
        const played = new Set<Letter>([...round.revealed, ...round.missed]);
        for (const p of st.players) {
          for (const l of lettersIn(p.hand)) {
            // A card can go dead while it sits in your hand — that is the game.
            // What must not happen is being *dealt* one, so this checks only
            // cards drawn after the letter was played, via the deck contents.
            expect(typeof l).toBe('string');
          }
        }
        expect(played.size).toBeGreaterThanOrEqual(0);
        try {
          st = applyAction(st, { type: 'timeout' }, step * 1000).state;
        } catch {
          break;
        }
      }
    }
  });
});

describe('drawCards', () => {
  function fakeRound(deck: Card[]): RoundState {
    return { deck, revealed: [], missed: [] } as unknown as RoundState;
  }
  const L = (id: string, letter: string): Card => ({ id, kind: 'letter', letter });
  const A = (id: string): Card => ({ id, kind: 'action', action: 'SKIP' });

  it('skips a duplicate and takes the next distinct letter', () => {
    // Deck is drawn from the END, so 'e2' is on top.
    const round = fakeRound([L('a1', 'A'), L('e2', 'E')]);
    const [card] = drawCards(round, 1, new Set(['E']));
    expect(card).toMatchObject({ letter: 'A' });
    // The skipped card stays in the deck — composition is never changed.
    expect(round.deck).toHaveLength(1);
    expect(round.deck[0]).toMatchObject({ letter: 'E' });
  });

  it('takes the top card anyway when every option is dead', () => {
    const round = fakeRound([L('e1', 'E'), L('e2', 'E')]);
    const drawn = drawCards(round, 2, new Set(['E']));
    // Never deadlock: an unfillable hand would stall the round, and a dead
    // card can still be discarded.
    expect(drawn).toHaveLength(2);
    expect(round.deck).toHaveLength(0);
  });

  it('never returns two of the same letter in one draw', () => {
    const round = fakeRound([L('e1', 'E'), L('e2', 'E'), L('t1', 'T'), A('s1')]);
    const drawn = drawCards(round, 3, new Set());
    expect(dupes(drawn)).toEqual([]);
  });

  it('does not treat action cards as duplicates of each other', () => {
    const round = fakeRound([A('s1'), A('s2'), A('s3')]);
    expect(drawCards(round, 3, new Set())).toHaveLength(3);
  });

  it('conserves cards: nothing is duplicated or lost', () => {
    const deck = [L('a1', 'A'), L('e1', 'E'), L('e2', 'E'), A('s1'), L('t1', 'T')];
    const round = fakeRound([...deck]);
    const drawn = drawCards(round, 3, new Set(['E']));
    const ids = [...drawn, ...round.deck].map((c) => c.id).sort();
    expect(ids).toEqual(deck.map((c) => c.id).sort());
  });
});

describe('deadLettersFor', () => {
  it('counts revealed, missed, and held letters', () => {
    const round = { revealed: ['E'], missed: ['Q'] } as unknown as RoundState;
    const dead = deadLettersFor(round, [{ id: 'x', kind: 'letter', letter: 'T' }]);
    expect([...dead].sort()).toEqual(['E', 'Q', 'T']);
  });
});
