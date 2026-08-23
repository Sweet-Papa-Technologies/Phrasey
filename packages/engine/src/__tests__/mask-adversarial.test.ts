/**
 * Adversarial masking tests (§15: "Write maskBoard() once. Test it
 * adversarially. Everything else in the security model rests on it.").
 *
 * The approach is deliberately paranoid: fuzz across many puzzles and many
 * reveal states, serialize the payload, and deep-walk EVERY string in it looking
 * for a character that belongs to a tile the player is not allowed to see.
 *
 * `category` and `hint` are excluded from the character sweep and only from it:
 * both are public strings by design (§3.1 puts the category on the board; the
 * hint is null until CRACK pays for it), and both are English prose that will
 * naturally contain almost every letter. The cell-kind discriminator `t` is
 * excluded for the same reason — it is structure, not content. All three are
 * still checked against the answer itself.
 */
import { normalizeGuess, normalizePuzzleText } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { hiddenDistinctLetters, maskBoardFromRound, revealLetter } from '../board.js';
import { createRng } from '../rng.js';
import type { RoundState } from '../state.js';
import { TEST_PUZZLES, makePuzzle } from '../testing/fixtures.js';
import { startGame } from '../testing/harness.js';

/** Every string in the payload, minus the two legitimately public prose fields. */
function walkStrings(node: unknown, skipKeys: Set<string>, out: string[] = []): string[] {
  if (typeof node === 'string') {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const v of node) walkStrings(v, skipKeys, out);
    return out;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (skipKeys.has(k)) continue;
      walkStrings(v, skipKeys, out);
    }
  }
  return out;
}

/**
 * `t` is the cell-kind discriminator ('letter' | 'punct') — structure, never
 * content. `category` and `hint` are public prose. Everything else is swept.
 */
const SKIP = new Set(['category', 'hint', 't']);

const EXTRA = [
  makePuzzle("DON'T STOP BELIEVING NOW"),
  makePuzzle('WE ARE OUT OF THE GOOD COFFEE, SORRY!'),
  makePuzzle('IS IT TOO LATE TO SAY NO?'),
  makePuzzle('A ROLLING STONE GATHERS NO MOSS'),
  makePuzzle('THE WI-FI IS DOWN AGAIN'),
  makePuzzle('AAA AAA AAA'),
  makePuzzle('QUIZ ZONE, JUMBO XYLOPHONE'),
];

const CORPUS = [...TEST_PUZZLES, ...EXTRA];

describe('maskBoard never leaks a hidden letter', () => {
  it('holds across a fuzz of puzzles and reveal states', () => {
    const rng = createRng(0xc0ffee);
    let checked = 0;

    for (const puzzle of CORPUS) {
      for (let trial = 0; trial < 12; trial++) {
        const state = startGame({ puzzle, seed: rng.int(1_000_000) });
        const round = state.round as RoundState;

        // Reveal a random subset, and occasionally record bogus misses too.
        const all = hiddenDistinctLetters(round);
        for (const letter of all) if (rng.bool(0.4)) revealLetter(round, letter);
        for (const noise of ['Z', 'Q', 'J', 'X']) {
          if (!round.answer.includes(noise) && rng.bool(0.5)) round.missed.push(noise);
        }
        if (rng.bool(0.3)) round.hintRevealed = true;

        const hidden = new Set(hiddenDistinctLetters(round).map((l) => l));
        const payload = maskBoardFromRound(round);
        const json = JSON.stringify(payload);

        // 1. No hidden letter's character anywhere in the payload...
        for (const s of walkStrings(payload, SKIP)) {
          for (const ch of s.toUpperCase()) {
            expect(hidden.has(ch), `hidden letter ${ch} leaked in ${JSON.stringify(s)}`).toBe(false);
          }
        }

        // 2. ...and the normalized answer never appears in the serialized form.
        const answer = normalizeGuess(round.answer);
        if (answer.length >= 6 && hidden.size > 0) {
          expect(json.includes(answer)).toBe(false);
          expect(json.replace(/[^A-Z]/g, '').includes(answer)).toBe(false);
        }

        // 3. Counts are consistent and never negative.
        expect(payload.hiddenLetters).toBe(hidden.size === 0 ? 0 : payload.hiddenLetters);
        expect(payload.hiddenLetters).toBeGreaterThanOrEqual(0);
        expect(payload.hiddenLetters).toBeLessThanOrEqual(payload.totalLetters);

        // 4. Guessed and hidden letters are disjoint — a hit reveals ALL
        //    occurrences, so a hidden tile can never be a played letter.
        for (const g of payload.guessedLetters) expect(hidden.has(g)).toBe(false);

        checked++;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });

  it('leaks nothing at all on a completely fresh board', () => {
    for (const puzzle of CORPUS) {
      const state = startGame({ puzzle, seed: 7 });
      const board = maskBoardFromRound(state.round as RoundState);
      const letters = walkStrings(board, SKIP).join('').toUpperCase().replace(/[^A-Z]/g, '');
      // Only punctuation and structure survive: no A-Z at all.
      expect(letters).toBe('');
      expect(board.hiddenLetters).toBe(board.totalLetters);
    }
  });

  it('word and cell structure matches the puzzle exactly', () => {
    for (const puzzle of CORPUS) {
      const state = startGame({ puzzle, seed: 3 });
      const round = state.round as RoundState;
      const board = maskBoardFromRound(round);
      const words = normalizePuzzleText(puzzle.text).split(' ');
      expect(board.words).toHaveLength(words.length);
      board.words.forEach((cells, i) => expect(cells).toHaveLength((words[i] as string).length));
    }
  });

  it('a solved board is fully open and safe to publish', () => {
    const state = startGame({ puzzle: TEST_PUZZLES[3]!, seed: 11 });
    const round = state.round as RoundState;
    for (const l of hiddenDistinctLetters(round)) revealLetter(round, l);
    const board = maskBoardFromRound(round);
    expect(board.hiddenLetters).toBe(0);
    expect(board.accessibleText).not.toContain('_');
  });
});
