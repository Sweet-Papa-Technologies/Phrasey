/**
 * Puzzle text handling, shared by the engine, the server and corpus-gen so
 * that "is this guess correct" means exactly the same thing everywhere.
 */
import type { BoardWord, Letter } from './types.js';

/** Punctuation the corpus validator allows, and the board renders unmasked. */
export const ALLOWED_PUNCTUATION = "'-,.!?";

/** Shown on the board rather than masked (§3.1). */
export const INLINE_PUNCTUATION = "'-";

const LETTER_RE = /^[A-Z]$/;

export function isLetter(ch: string): ch is Letter {
  return LETTER_RE.test(ch);
}

/**
 * Canonical puzzle form: uppercase, collapsed whitespace, curly quotes and
 * dashes folded to ASCII. Corpus entries are stored already normalized.
 */
export function normalizePuzzleText(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Comparison form for solve attempts: letters and digits only. A player who
 * types "dont stop" solves "DON'T STOP!", which is the behaviour anyone
 * expects from a party game typing race.
 */
export function normalizeGuess(raw: string): string {
  return normalizePuzzleText(raw).replace(/[^A-Z0-9]/g, '');
}

export function guessMatches(guess: string, answer: string): boolean {
  const g = normalizeGuess(guess);
  return g.length > 0 && g === normalizeGuess(answer);
}

/** Occurrence count per letter. Drives deck construction and scoring. */
export function letterStats(text: string): Record<Letter, number> {
  const out: Record<string, number> = {};
  for (const ch of normalizePuzzleText(text)) {
    if (isLetter(ch)) out[ch] = (out[ch] ?? 0) + 1;
  }
  return out;
}

export function distinctLetters(text: string): Letter[] {
  return Object.keys(letterStats(text)).sort();
}

/** Total maskable letter tiles in a puzzle. */
export function totalLetterCount(text: string): number {
  let n = 0;
  for (const ch of normalizePuzzleText(text)) if (isLetter(ch)) n++;
  return n;
}

/**
 * Flat index of every maskable letter tile, in reading order. The engine and
 * the client both address tiles by this index, so reveal animations line up.
 */
export function letterPositions(text: string): number[] {
  const out: number[] = [];
  let i = 0;
  for (const ch of normalizePuzzleText(text)) {
    if (ch === ' ') continue;
    if (isLetter(ch)) out.push(i);
    i++;
  }
  return out;
}

/**
 * Split a normalized puzzle into words of cells, with a running cell index so
 * callers can map a reveal position back to a specific tile.
 *
 * `revealed` decides which letters are shown. Everything not in that set comes
 * back as `{ t: 'letter', revealed: false }` — with no `ch` field, so there is
 * literally nothing in the payload to leak.
 */
export function buildWords(text: string, revealed: ReadonlySet<Letter>): BoardWord[] {
  const words: BoardWord[] = [];
  for (const word of normalizePuzzleText(text).split(' ')) {
    if (!word) continue;
    const cells: BoardWord = [];
    for (const ch of word) {
      if (isLetter(ch)) {
        cells.push(revealed.has(ch) ? { t: 'letter', revealed: true, ch } : { t: 'letter', revealed: false });
      } else {
        cells.push({ t: 'punct', ch });
      }
    }
    words.push(cells);
  }
  return words;
}

/** Screen-reader rendering of the board (§10). Underscores for hidden tiles. */
export function accessibleBoardText(words: BoardWord[]): string {
  return words
    .map((w) => w.map((c) => (c.t === 'punct' ? c.ch : c.revealed ? c.ch : '_')).join(' '))
    .join('   ');
}

/**
 * A regex that matches any corpus phrase consistent with the current board.
 * Used by bots for real deduction (§5) — they are never handed the answer.
 *
 * `guessed` is every letter already played this round, hit or miss. A hidden
 * tile cannot be any of them: a hit reveals every occurrence, so a still-hidden
 * tile is necessarily a letter nobody has played.
 */
export function boardPattern(words: BoardWord[], guessed: ReadonlySet<Letter>): RegExp {
  const excluded = [...guessed].sort().join('');
  const anyHidden = excluded ? `[^${excluded} ]` : '[^ ]';
  const body = words
    .map((w) =>
      w
        .map((c) => {
          if (c.t === 'punct') return escapeRe(c.ch);
          return c.revealed ? escapeRe(c.ch) : anyHidden;
        })
        .join(''),
    )
    .join(' ');
  return new RegExp(`^${body}$`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
