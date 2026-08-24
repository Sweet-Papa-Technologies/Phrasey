import { defaultBalance, isActionCard, isLetterCard, letterStats } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { actionPool, buildDeck, deckSizeFor, isVowel, noiseLetterPool, puzzleLetterPool, puzzleLetterSet } from '../deck.js';
import { createRng } from '../rng.js';
import { TEST_PUZZLES, makePuzzle } from '../testing/fixtures.js';

const balance = defaultBalance();
const puzzle = TEST_PUZZLES[0]!; // MILK EGGS AND THE GOOD BREAD

describe('deckSizeFor (§3.2)', () => {
  it('is max(60, players * 18)', () => {
    expect(deckSizeFor(2, balance)).toBe(60);
    expect(deckSizeFor(3, balance)).toBe(60);
    expect(deckSizeFor(4, balance)).toBe(72);
    expect(deckSizeFor(8, balance)).toBe(144);
  });
});

describe('buildDeck', () => {
  it('honours the 70/30 letter/action split', () => {
    const deck = buildDeck(puzzle, 4, balance, createRng(1));
    expect(deck).toHaveLength(72);
    const letters = deck.filter(isLetterCard).length;
    const actions = deck.filter(isActionCard).length;
    expect(letters).toBe(Math.round(72 * 0.7));
    expect(actions).toBe(72 - letters);
  });

  it('gives every card a unique, seed-stable id', () => {
    const deck = buildDeck(puzzle, 4, balance, createRng(9), 'r1');
    expect(new Set(deck.map((c) => c.id)).size).toBe(deck.length);
    expect(deck.every((c) => c.id.startsWith('r1-'))).toBe(true);
    const again = buildDeck(puzzle, 4, balance, createRng(9), 'r1');
    expect(again).toEqual(deck);
  });

  it('changes with the seed', () => {
    const a = buildDeck(puzzle, 4, balance, createRng(1));
    const b = buildDeck(puzzle, 4, balance, createRng(2));
    expect(a).not.toEqual(b);
  });

  it('is heavily biased toward letters actually in the puzzle', () => {
    const inPuzzle = puzzleLetterSet(puzzle);
    let hits = 0;
    let total = 0;
    for (let seed = 0; seed < 30; seed++) {
      for (const c of buildDeck(puzzle, 4, balance, createRng(seed))) {
        if (!isLetterCard(c)) continue;
        total++;
        if (inPuzzle.has(c.letter)) hits++;
      }
    }
    // 65% come from the puzzle pool by construction, plus incidental overlap
    // from the noise pool, so the observed share sits comfortably above 0.65.
    expect(hits / total).toBeGreaterThan(0.7);
  });

  it('never deals J/Q/X/Z as noise unless the puzzle contains them', () => {
    const clean = makePuzzle('THE RENT WAS DUE ON TUESDAY');
    const present = puzzleLetterSet(clean);
    for (let seed = 0; seed < 40; seed++) {
      for (const c of buildDeck(clean, 8, balance, createRng(seed))) {
        if (!isLetterCard(c)) continue;
        if ('JQXZ'.includes(c.letter)) expect(present.has(c.letter)).toBe(true);
      }
    }
  });

  it('does allow a rare letter once the puzzle uses it', () => {
    const zed = makePuzzle('THE LAZY FOX SLEPT ON A QUILT');
    const pool = noiseLetterPool(zed, balance).map(([l]) => l);
    expect(pool).toContain('Z');
    expect(pool).toContain('X');
    expect(pool).toContain('Q');
    expect(pool).not.toContain('J');
  });

  it('under-weights vowels in both pools', () => {
    const p = makePuzzle('A WATCHED POT NEVER BOILS');
    const stats = letterStats(p.text);
    for (const [letter, weight] of puzzleLetterPool(p, balance)) {
      const raw = stats[letter]!;
      expect(weight).toBeCloseTo(isVowel(letter) ? raw * balance.deck.vowelWeightMultiplier : raw, 6);
    }
    const noise = Object.fromEntries(noiseLetterPool(p, balance));
    expect(noise.E! / noise.T!).toBeLessThan(12.7 / 9.06);
  });

  it('samples action cards by their configured weights', () => {
    const counts: Record<string, number> = {};
    for (let seed = 0; seed < 60; seed++) {
      for (const c of buildDeck(puzzle, 8, balance, createRng(seed))) {
        if (isActionCard(c)) counts[c.action] = (counts[c.action] ?? 0) + 1;
      }
    }
    // SKIP (weight 10) should clearly outrank BUZZ_IN (weight 4).
    expect(counts.SKIP!).toBeGreaterThan(counts.BUZZ_IN!);
    expect(Object.keys(counts).length).toBe(14);
  });

  it('drops action kinds whose weight is zeroed out', () => {
    const b = defaultBalance();
    b.deck.actionWeights.VANDAL = 0;
    expect(actionPool(b).map(([k]) => k)).not.toContain('VANDAL');
    const deck = buildDeck(puzzle, 4, b, createRng(3));
    expect(deck.filter((c) => isActionCard(c) && c.action === 'VANDAL')).toHaveLength(0);
  });

  it('falls back to the noise pool for a degenerate letterless puzzle', () => {
    const empty = { ...makePuzzle('a'), text: '...', letterStats: {} };
    const deck = buildDeck(empty, 2, balance, createRng(4));
    expect(deck).toHaveLength(60);
    expect(deck.filter(isLetterCard).length).toBeGreaterThan(0);
  });

  it('recomputes letterStats when the puzzle does not carry them', () => {
    const bare = { ...puzzle, letterStats: {} };
    expect(puzzleLetterPool(bare, balance).length).toBe(puzzleLetterPool(puzzle, balance).length);
  });
});

describe('interrupt cards follow the host setting', () => {
  /**
   * Interrupts default off now. An interrupt card is playable only inside an
   * interrupt window, so with windows disabled it is a card that can never be
   * played — and the dead-card sweep cannot clear it, because an action card
   * is never dead in the letter sense. So it must not be dealt at all.
   */
  const INTERRUPTS = ['SWIPE', 'BLOCK', 'BUZZ_IN'];
  const PUZZLE = TEST_PUZZLES[0]!;

  it('leaves SWIPE, BLOCK and BUZZ IN out when interrupts are off', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const deck = buildDeck(PUZZLE, 4, defaultBalance(), createRng(seed), 'd', false);
      const found = deck.filter((c) => c.kind === 'action' && INTERRUPTS.includes(c.action as string));
      expect(found, `seed ${seed} dealt ${found.map((c) => (c as { action: string }).action).join(',')}`).toEqual([]);
    }
  });

  it('still deals them when interrupts are on', () => {
    let total = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const deck = buildDeck(PUZZLE, 4, defaultBalance(), createRng(seed), 'd', true);
      total += deck.filter((c) => c.kind === 'action' && INTERRUPTS.includes(c.action as string)).length;
    }
    expect(total).toBeGreaterThan(0);
  });

  it('keeps the deck the same size either way — the slice is redistributed', () => {
    const on = buildDeck(PUZZLE, 4, defaultBalance(), createRng(7), 'd', true);
    const off = buildDeck(PUZZLE, 4, defaultBalance(), createRng(7), 'd', false);
    expect(off.length).toBe(on.length);
  });

  it('actionPool filters by the flag', () => {
    const off = actionPool(defaultBalance(), false).map(([k]) => k);
    expect(off).not.toContain('SWIPE');
    expect(off).toContain('SKIP');
    expect(actionPool(defaultBalance(), true).map(([k]) => k)).toContain('SWIPE');
  });
});
