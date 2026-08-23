/**
 * What a bot can honestly work out from its `PlayerView` (§5).
 *
 * The only inputs are the masked board, the letters already played, the
 * `boardPattern` regex the engine hands every seat, and the bot's own PEEK
 * results. There is no path from here to `RoundState.answer` — `PlayerView`
 * does not contain it, and view.test.ts asserts that.
 */
import type { Letter, MaskedBoard, Puzzle } from '@phrasey/shared';
import { isLetter } from '@phrasey/shared';
import type { PlayerView } from '../view.js';
import type { CorpusIndex, IndexedPuzzle } from './corpusIndex.js';

export type BotCell =
  | { index: number; kind: 'revealed'; ch: string }
  | { index: number; kind: 'hidden' }
  | { index: number; kind: 'punct'; ch: string };

export interface BotWord {
  cells: BotCell[];
  hiddenCount: number;
}

/**
 * Flatten a masked board into words of indexed cells. Indices follow the
 * engine's tile numbering (spaces do not consume an index, punctuation does),
 * so a PEEK result keyed by tile index lines up without translation.
 */
export function readBoard(board: MaskedBoard): BotWord[] {
  const out: BotWord[] = [];
  let index = 0;
  for (const word of board.words) {
    const cells: BotCell[] = [];
    let hidden = 0;
    for (const cell of word) {
      if (cell.t === 'punct') cells.push({ index, kind: 'punct', ch: cell.ch });
      else if (cell.revealed) cells.push({ index, kind: 'revealed', ch: cell.ch });
      else {
        cells.push({ index, kind: 'hidden' });
        hidden++;
      }
      index++;
    }
    out.push({ cells, hiddenCount: hidden });
  }
  return out;
}

export interface Deduction {
  words: BotWord[];
  /** Tile index -> letter, bought with PEEK. Private to this bot by the rules. */
  peeks: Record<number, Letter>;
  /** Every letter already played this round, hit or miss. */
  guessed: Set<string>;
  /** Letters still worth playing. */
  open: string[];
  /** Letters this bot has PEEKed and nobody has revealed yet, with a floor on
   *  how many tiles carry them. A peeked letter is a guaranteed hit. */
  known: Map<string, number>;
  /** Corpus phrases still consistent with the board *and* with our peeks. */
  pool: IndexedPuzzle[];
  revealedFraction: number;
  hiddenLetters: number;
  totalLetters: number;
  /**
   * Corpus words rarer than this are treated as outside the bot's vocabulary.
   * See `BotOptions.vocabularyMinWeight`.
   */
  vocabularyMinWeight: number;
  /**
   * The board is not yet open enough for this bot to claim it recognizes the
   * phrase, so `pool` was deliberately left empty. See the evidence gate in
   * policy.ts for why that matters.
   */
  gated: boolean;
}

/** How much board evidence a bot needs before phrase-level deduction is allowed. */
export interface DeductionGate {
  minRevealedFraction: number;
  minGuessedLetters: number;
}

const OPEN_GATE: DeductionGate = { minRevealedFraction: 0, minGuessedLetters: 0 };

/** Default vocabulary floor: words that recur across the corpus. */
export const DEFAULT_VOCABULARY_MIN_WEIGHT = 2;

const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

/** Does a candidate phrase agree with every tile this bot has paid to see? */
function agreesWithPeeks(p: IndexedPuzzle, peeks: Record<number, Letter>): boolean {
  for (const [key, letter] of Object.entries(peeks)) {
    if (p.cells[Number(key)] !== letter) return false;
  }
  return true;
}

export function deduce(
  view: PlayerView,
  index: CorpusIndex,
  gate: DeductionGate = OPEN_GATE,
  vocabularyMinWeight = DEFAULT_VOCABULARY_MIN_WEIGHT,
): Deduction {
  const board = view.board;
  const guessed = new Set<string>(board?.guessedLetters ?? []);
  const words = board ? readBoard(board) : [];
  const open = ALPHA.filter((l) => !guessed.has(l));

  const known = new Map<string, number>();
  for (const [key, letter] of Object.entries(view.peeks)) {
    void key;
    if (guessed.has(letter)) continue; // somebody already flipped it
    known.set(letter, (known.get(letter) ?? 0) + 1);
  }

  const totalLetters = board?.totalLetters ?? 0;
  const hiddenLetters = board?.hiddenLetters ?? 0;
  const revealedFraction = totalLetters > 0 ? 1 - hiddenLetters / totalLetters : 0;

  // THE EVIDENCE GATE. Phrase-level matching is enormously powerful — word
  // lengths and punctuation alone fingerprint most of a few-hundred-phrase
  // corpus, so an ungated bot identifies the answer before a card is played and
  // then never misses a letter again. That is corpus recall, not deduction, and
  // no human can do it. Until the board is genuinely open the bot reasons from
  // word shape and English frequency only, exactly like a person who has not
  // recognized the phrase yet.
  const gated = revealedFraction < gate.minRevealedFraction || guessed.size < gate.minGuessedLetters;

  let pool: IndexedPuzzle[] = [];
  if (!gated && view.boardPattern) {
    const re = new RegExp(view.boardPattern);
    pool = index.puzzles.filter((p) => re.test(p.text) && agreesWithPeeks(p, view.peeks));
  }

  return {
    words,
    peeks: view.peeks,
    guessed,
    open,
    known,
    pool,
    revealedFraction,
    hiddenLetters,
    totalLetters,
    vocabularyMinWeight,
    gated,
  };
}

/** Corpus words of the right shape for one board word. */
export function matchingWords(word: BotWord, ded: Deduction, index: CorpusIndex) {
  const bucket = index.wordsByLength.get(word.cells.length);
  if (!bucket) return [];
  return bucket.filter((cand) => {
    // Vocabulary floor: a word that occurs once in the corpus is not English
    // knowledge, it is a memorized answer. See DEFAULT_VOCABULARY_MIN_WEIGHT.
    if (cand.weight < ded.vocabularyMinWeight) return false;
    for (let i = 0; i < word.cells.length; i++) {
      const cell = word.cells[i] as BotCell;
      const ch = cand.chars[i] as string;
      if (cell.kind === 'punct' || cell.kind === 'revealed') {
        if (ch !== cell.ch) return false;
        continue;
      }
      // Hidden: must be a letter nobody has played yet, and must agree with
      // any tile this bot has already paid a PEEK to see.
      if (!isLetter(ch) || ded.guessed.has(ch)) return false;
      const peeked = ded.peeks[cell.index];
      if (peeked !== undefined && ch !== peeked) return false;
    }
    return true;
  });
}

/** The single remaining candidate, if deduction has narrowed to exactly one (§5). */
export function soleCandidate(ded: Deduction): Puzzle | null {
  return ded.pool.length === 1 ? (ded.pool[0] as IndexedPuzzle).puzzle : null;
}
