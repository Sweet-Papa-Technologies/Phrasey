/**
 * Fill-in-the-blanks solving — the pure half.
 *
 * The reported problem: the solve box was a bare text field, so you had to
 * retype the letters already sitting revealed on the board, and nothing told
 * you whether the apostrophe in `DON'T` mattered. (It never did —
 * `normalizeGuess()` in @phrasey/shared strips everything that is not A–Z or
 * 0–9 — but the UI never said so.)
 *
 * So the box now renders the board's own shape with the revealed letters
 * already filled in and the punctuation drawn as-is, and the player types only
 * the blanks. Punctuation and spacing stop being a question because they are
 * never typed at all.
 *
 * Everything here is arithmetic on plain data: no DOM, no React. The component
 * owns one real focused input and hands its keystrokes to these functions.
 *
 * SECURITY (§6.2): the only input is `MaskedBoard`, which by construction has
 * no character on a hidden cell. Nothing in this module can invent one, and the
 * comparison against the answer stays on the server — we only assemble a
 * string and post it.
 */
import type { BoardCell, MaskedBoard } from '@phrasey/shared';

/**
 * One rendered cell of the solve field.
 *
 * `index` is the same flat index `layoutBoard()` assigns — every non-space
 * character in reading order — so the solve field and the board agree about
 * what is where.
 */
export type SolveCell =
  /** A letter the board has already revealed. Not editable. */
  | { kind: 'fixed'; index: number; ch: string }
  /** Punctuation (and digits): shown as-is, never typed. */
  | { kind: 'punct'; index: number; ch: string }
  /** A hidden letter the player has to supply. */
  | { kind: 'blank'; index: number; blank: number };

export interface SolveWord {
  wordIndex: number;
  cells: SolveCell[];
}

export interface SolveModel {
  words: SolveWord[];
  /** How many characters the player actually has to type. */
  blankCount: number;
  /** Every letter tile, revealed or not. Used for copy, not for logic. */
  letterCount: number;
}

/** What the player has typed, and where the next keystroke lands. */
export interface SolveEntry {
  /** One slot per blank, in reading order. `''` means still empty. */
  typed: readonly string[];
  /** Index of the active blank. Always within range (or 0 when there are none). */
  cursor: number;
}

const TYPEABLE = /^[A-Z0-9]$/;

export function buildSolveModel(board: Pick<MaskedBoard, 'words'>): SolveModel {
  let index = 0;
  let blank = 0;
  let letterCount = 0;

  const words = board.words.map((word, wordIndex) => ({
    wordIndex,
    cells: word.map((cell: BoardCell): SolveCell => {
      const at = index++;
      if (cell.t === 'punct') return { kind: 'punct', index: at, ch: cell.ch };
      letterCount++;
      if (cell.revealed) return { kind: 'fixed', index: at, ch: cell.ch };
      return { kind: 'blank', index: at, blank: blank++ };
    }),
  }));

  return { words, blankCount: blank, letterCount };
}

export function emptyEntry(blankCount: number): SolveEntry {
  return { typed: new Array(Math.max(0, blankCount)).fill(''), cursor: 0 };
}

/**
 * Type one character into the active blank and step forward.
 *
 * Anything that is not a letter or a digit is ignored outright — the player
 * cannot type a space or an apostrophe into a blank, which is precisely why
 * they never have to think about them. The cursor stops on the last blank
 * rather than running past it, so a stray extra keystroke overwrites the last
 * letter instead of silently disappearing.
 */
export function typeChar(entry: SolveEntry, raw: string): SolveEntry {
  const n = entry.typed.length;
  if (n === 0) return entry;
  const ch = raw.toUpperCase();
  if (!TYPEABLE.test(ch)) return entry;

  const at = clamp(entry.cursor, n);
  const typed = entry.typed.slice();
  typed[at] = ch;
  return { typed, cursor: Math.min(at + 1, n - 1) };
}

/**
 * Backspace. Clears the active blank if it holds something, otherwise steps
 * back and clears the one before it — the behaviour every verification-code
 * field has, and the one a thumb expects.
 */
export function backspace(entry: SolveEntry): SolveEntry {
  const n = entry.typed.length;
  if (n === 0) return entry;

  const at = clamp(entry.cursor, n);
  const typed = entry.typed.slice();
  if (typed[at]) {
    typed[at] = '';
    return { typed, cursor: at };
  }
  const back = Math.max(0, at - 1);
  typed[back] = '';
  return { typed, cursor: back };
}

/** Clear every blank and go back to the start. */
export function clearEntry(entry: SolveEntry): SolveEntry {
  return emptyEntry(entry.typed.length);
}

export function moveCursor(entry: SolveEntry, delta: number): SolveEntry {
  const n = entry.typed.length;
  if (n === 0) return entry;
  return { typed: entry.typed, cursor: clamp(entry.cursor + delta, n) };
}

export function setCursor(entry: SolveEntry, at: number): SolveEntry {
  const n = entry.typed.length;
  if (n === 0) return entry;
  return { typed: entry.typed, cursor: clamp(at, n) };
}

/** The value the one real input carries: the filled blanks, in order. */
export function mirrorOf(entry: SolveEntry): string {
  return entry.typed.join('');
}

/**
 * The mobile path.
 *
 * Android soft keyboards routinely report `keydown` as key code 229 with no
 * usable `key`, so keystrokes cannot be read from `keydown` alone. The input's
 * value is the reliable signal: we keep it mirrored to the filled blanks, force
 * the caret to the end, and diff. A longer value is that many new characters; a
 * shorter one is that many deletions.
 */
export function applyValueChange(entry: SolveEntry, nextValue: string): SolveEntry {
  const before = mirrorOf(entry);
  if (nextValue === before) return entry;

  if (nextValue.length > before.length) {
    // The caret is forced to the end, so new characters are always the tail.
    const added = nextValue.slice(-(nextValue.length - before.length));
    let next = entry;
    for (const ch of added) next = typeChar(next, ch);
    return next;
  }

  let next = entry;
  for (let i = nextValue.length; i < before.length; i++) next = backspace(next);
  return next;
}

export function filledCount(entry: SolveEntry): number {
  return entry.typed.reduce((n, c) => (c ? n + 1 : n), 0);
}

export function isComplete(entry: SolveEntry): boolean {
  return entry.typed.every((c) => c !== '');
}

/**
 * The guess we post.
 *
 * Revealed letters and punctuation come straight off the masked board, the
 * blanks come from what was typed, and words are rejoined with the spaces the
 * player never had to type. An unfilled blank becomes a space, which
 * `normalizeGuess()` strips — a partial guess is therefore simply a wrong one,
 * never a crash.
 */
export function assembleGuess(model: SolveModel, entry: SolveEntry): string {
  return model.words
    .map((word) =>
      word.cells
        .map((cell) => (cell.kind === 'blank' ? entry.typed[cell.blank] || ' ' : cell.ch))
        .join(''),
    )
    .join(' ');
}

/**
 * §10 — what a screen reader says about where you are. The input's label is
 * this string, so tabbing in announces the position rather than "edit text".
 */
export function cursorLabel(entry: SolveEntry): string {
  const n = entry.typed.length;
  if (n === 0) return 'Every letter is already revealed. Submit to solve.';
  const at = clamp(entry.cursor, n);
  const ch = entry.typed[at];
  return `Missing letter ${at + 1} of ${n}, ${ch ? `filled with ${ch}` : 'blank'}`;
}

/** A polite progress line: how much of the phrase is still owed. */
export function progressLabel(entry: SolveEntry): string {
  const n = entry.typed.length;
  if (n === 0) return 'No letters left to fill in.';
  return `${filledCount(entry)} of ${n} missing letters filled in.`;
}

function clamp(value: number, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.trunc(value), length - 1));
}
