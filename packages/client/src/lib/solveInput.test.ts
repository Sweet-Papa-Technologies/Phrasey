/**
 * The fill-in-the-blanks arithmetic. Every one of these is a rule the playtest
 * asked for: you never retype a revealed letter, you never type punctuation,
 * and the guess that reaches the server is the phrase you can see.
 */
import { describe, expect, it } from 'vitest';
import { accessibleBoardText, buildWords, normalizeGuess, type MaskedBoard } from '@phrasey/shared';
import {
  applyValueChange,
  assembleGuess,
  backspace,
  buildSolveModel,
  clearEntry,
  cursorLabel,
  emptyEntry,
  filledCount,
  isComplete,
  mirrorOf,
  moveCursor,
  progressLabel,
  setCursor,
  typeChar,
  type SolveEntry,
  type SolveModel,
} from './solveInput';

const ANSWER = "DON'T MICROWAVE THE POUCH";

function makeBoard(revealed: string[]): MaskedBoard {
  const words = buildWords(ANSWER, new Set(revealed));
  let total = 0;
  let hidden = 0;
  for (const w of words) {
    for (const c of w) {
      if (c.t !== 'letter') continue;
      total++;
      if (!c.revealed) hidden++;
    }
  }
  return {
    category: 'Instructions on the back of a box',
    words,
    guessedLetters: revealed,
    missedLetters: [],
    totalLetters: total,
    hiddenLetters: hidden,
    hint: null,
    accessibleText: accessibleBoardText(words),
  };
}

/** Type a whole string, one keystroke at a time, from a fresh entry. */
function typeAll(model: SolveModel, text: string): SolveEntry {
  let entry = emptyEntry(model.blankCount);
  for (const ch of text) entry = typeChar(entry, ch);
  return entry;
}

describe('buildSolveModel', () => {
  it('makes a blank for every hidden letter and nothing else', () => {
    const board = makeBoard(['O', 'E']);
    const model = buildSolveModel(board);
    expect(model.blankCount).toBe(board.hiddenLetters);
    expect(model.letterCount).toBe(board.totalLetters);
  });

  it('pre-fills the revealed letters and shows punctuation as-is', () => {
    const model = buildSolveModel(makeBoard(['O']));
    const kinds = model.words.flatMap((w) => w.cells.map((c) => c.kind));
    expect(kinds).toContain('fixed');
    expect(kinds).toContain('punct');

    const fixed = model.words.flatMap((w) => w.cells.filter((c) => c.kind === 'fixed'));
    expect(fixed.every((c) => c.kind === 'fixed' && c.ch === 'O')).toBe(true);

    const punct = model.words.flatMap((w) => w.cells.filter((c) => c.kind === 'punct'));
    expect(punct.map((c) => (c.kind === 'punct' ? c.ch : ''))).toEqual(["'"]);
  });

  it('numbers cells with the same flat index the board uses', () => {
    const model = buildSolveModel(makeBoard([]));
    const indexes = model.words.flatMap((w) => w.cells.map((c) => c.index));
    expect(indexes).toEqual(indexes.map((_, i) => i));
  });

  it('numbers blanks consecutively in reading order', () => {
    const model = buildSolveModel(makeBoard(['O']));
    const blanks = model.words.flatMap((w) => w.cells.filter((c) => c.kind === 'blank'));
    expect(blanks.map((b) => (b.kind === 'blank' ? b.blank : -1))).toEqual(blanks.map((_, i) => i));
  });
});

describe('assembleGuess', () => {
  it('rebuilds the phrase from revealed cells plus typed blanks', () => {
    const model = buildSolveModel(makeBoard(['O', 'E']));
    // The blanks, in reading order, with the O's and E's already on the board.
    const entry = typeAll(model, 'DNTMICRWAVTHPUCH');
    expect(isComplete(entry)).toBe(true);
    expect(assembleGuess(model, entry)).toBe(ANSWER);
  });

  it('a fully revealed board needs no typing at all', () => {
    const model = buildSolveModel(makeBoard('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')));
    expect(model.blankCount).toBe(0);
    const entry = emptyEntry(model.blankCount);
    expect(isComplete(entry)).toBe(true);
    expect(assembleGuess(model, entry)).toBe(ANSWER);
  });

  it('never needs the punctuation or the spaces to be typed', () => {
    const model = buildSolveModel(makeBoard([]));
    // Only letters — no apostrophe, no spaces — and it still matches.
    const entry = typeAll(model, 'DONTMICROWAVETHEPOUCH');
    expect(normalizeGuess(assembleGuess(model, entry))).toBe(normalizeGuess(ANSWER));
  });

  it('leaves an unfilled blank as a space, so a partial guess is merely wrong', () => {
    const model = buildSolveModel(makeBoard([]));
    const entry = typeAll(model, 'DONT');
    expect(isComplete(entry)).toBe(false);
    const guess = assembleGuess(model, entry);
    // The apostrophe is a punctuation cell, so it lands without being typed.
    expect(guess.startsWith("DON'T")).toBe(true);
    expect(normalizeGuess(guess)).toBe('DONT');
  });

  it('cannot invent a letter the server never revealed', () => {
    const model = buildSolveModel(makeBoard(['O']));
    const blank = assembleGuess(model, emptyEntry(model.blankCount));
    // Every letter position that was hidden is blank; only O's survive.
    expect(blank.replace(/[^A-Z]/g, '')).toBe('OOO');
  });
});

describe('typing', () => {
  it('advances to the next blank on every keystroke', () => {
    let e = emptyEntry(4);
    e = typeChar(e, 'a');
    expect(e.typed).toEqual(['A', '', '', '']);
    expect(e.cursor).toBe(1);
    e = typeChar(e, 'b');
    expect(e.typed).toEqual(['A', 'B', '', '']);
    expect(e.cursor).toBe(2);
  });

  it('uppercases, and ignores anything that is not a letter or a digit', () => {
    let e = emptyEntry(2);
    for (const ch of "' .,-! ") e = typeChar(e, ch);
    expect(e.typed).toEqual(['', '']);
    e = typeChar(e, '7');
    expect(e.typed).toEqual(['7', '']);
  });

  it('stops on the last blank, so an extra keystroke overwrites rather than vanishing', () => {
    let e = emptyEntry(2);
    e = typeChar(typeChar(e, 'A'), 'B');
    expect(e.cursor).toBe(1);
    e = typeChar(e, 'C');
    expect(e.typed).toEqual(['A', 'C']);
  });

  it('replaces the letter in a blank the cursor is moved back onto', () => {
    let e = typeAll({ blankCount: 3, words: [], letterCount: 3 }, 'ABC');
    e = setCursor(e, 0);
    e = typeChar(e, 'Z');
    expect(e.typed).toEqual(['Z', 'B', 'C']);
    expect(e.cursor).toBe(1);
  });

  it('does nothing at all when there is nothing to fill in', () => {
    const e = typeChar(emptyEntry(0), 'A');
    expect(e.typed).toEqual([]);
  });
});

describe('backspace', () => {
  it('steps back and clears when the cursor sits on an empty blank', () => {
    let e = emptyEntry(3);
    e = typeChar(typeChar(e, 'A'), 'B');
    expect(e.cursor).toBe(2);
    e = backspace(e);
    expect(e.typed).toEqual(['A', '', '']);
    expect(e.cursor).toBe(1);
  });

  it('clears in place when the cursor sits on a filled blank', () => {
    let e = emptyEntry(2);
    e = typeChar(typeChar(e, 'A'), 'B');
    expect(e.cursor).toBe(1);
    e = backspace(e);
    expect(e.typed).toEqual(['A', '']);
    expect(e.cursor).toBe(1);
    e = backspace(e);
    expect(e.typed).toEqual(['', '']);
    expect(e.cursor).toBe(0);
  });

  it('is a no-op at the very start', () => {
    const e = backspace(emptyEntry(3));
    expect(e.typed).toEqual(['', '', '']);
    expect(e.cursor).toBe(0);
  });

  it('walks the whole phrase back to empty', () => {
    const model = buildSolveModel(makeBoard(['O']));
    let e = typeAll(model, 'DNTMICRWAVETHEPUCH'.slice(0, model.blankCount));
    for (let i = 0; i < model.blankCount + 5; i++) e = backspace(e);
    expect(filledCount(e)).toBe(0);
    expect(e.cursor).toBe(0);
  });
});

describe('cursor movement', () => {
  it('clamps at both ends', () => {
    const e = emptyEntry(3);
    expect(moveCursor(e, -1).cursor).toBe(0);
    expect(setCursor(e, 99).cursor).toBe(2);
    expect(setCursor(e, -4).cursor).toBe(0);
    expect(moveCursor(setCursor(e, 2), 1).cursor).toBe(2);
  });

  it('leaves an empty model alone', () => {
    expect(moveCursor(emptyEntry(0), 1).cursor).toBe(0);
    expect(setCursor(emptyEntry(0), 3).cursor).toBe(0);
  });
});

describe('applyValueChange (the soft-keyboard path)', () => {
  it('treats a longer value as the characters that were added', () => {
    const e = applyValueChange(emptyEntry(4), 'AB');
    expect(e.typed).toEqual(['A', 'B', '', '']);
    expect(mirrorOf(e)).toBe('AB');
  });

  it('treats a shorter value as that many backspaces', () => {
    let e = applyValueChange(emptyEntry(4), 'ABC');
    e = applyValueChange(e, 'A');
    expect(e.typed).toEqual(['A', '', '', '']);
  });

  it('ignores an unchanged value', () => {
    const before = applyValueChange(emptyEntry(3), 'AB');
    expect(applyValueChange(before, 'AB')).toBe(before);
  });

  it('drops punctuation an autocorrecting keyboard tries to insert', () => {
    const e = applyValueChange(emptyEntry(4), "A'B");
    expect(e.typed).toEqual(['A', 'B', '', '']);
  });
});

describe('labels (§10)', () => {
  it('says where the cursor is and whether that blank is filled', () => {
    let e = emptyEntry(12);
    e = setCursor(e, 2);
    expect(cursorLabel(e)).toBe('Missing letter 3 of 12, blank');
    e = typeChar(e, 'q');
    expect(cursorLabel(setCursor(e, 2))).toBe('Missing letter 3 of 12, filled with Q');
  });

  it('reports progress politely', () => {
    const e = applyValueChange(emptyEntry(5), 'AB');
    expect(progressLabel(e)).toBe('2 of 5 missing letters filled in.');
  });

  it('has something to say when there is nothing left to fill', () => {
    expect(cursorLabel(emptyEntry(0))).toMatch(/already revealed/i);
    expect(progressLabel(emptyEntry(0))).toMatch(/no letters left/i);
  });
});

describe('clearEntry', () => {
  it('empties everything and returns to the first blank', () => {
    const e = clearEntry(applyValueChange(emptyEntry(4), 'ABCD'));
    expect(e.typed).toEqual(['', '', '', '']);
    expect(e.cursor).toBe(0);
  });
});
