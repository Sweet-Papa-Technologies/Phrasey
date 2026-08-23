/**
 * The masking boundary (design doc §6.2, §15: "Write maskBoard() once. Test it
 * adversarially. Everything else in the security model rests on it.").
 *
 * There is exactly one function in this package that turns a `GameState` into
 * something safe to put on a socket: `maskBoard`. It builds cells through
 * `buildWords()` from @phrasey/shared, which emits `{ t:'letter', revealed:false }`
 * with **no `ch` field at all** for a hidden tile. There is no "hidden but
 * present" field to forget to strip, because the field does not exist.
 *
 * Tile indices follow `letterPositions()` from shared: spaces do not consume an
 * index, punctuation does. That is exactly the order a client gets by flattening
 * `MaskedBoard.words`, so reveal animations line up without extra bookkeeping.
 */
import type { Balance, BoardWord, Letter, MaskedBoard } from '@phrasey/shared';
import {
  EngineError,
  accessibleBoardText,
  boardPattern as sharedBoardPattern,
  buildWords,
  isLetter,
  normalizePuzzleText,
} from '@phrasey/shared';
import type { GameState, RoundState } from './state.js';

export interface Tile {
  /** Index in the flattened, space-free cell sequence. */
  index: number;
  ch: string;
  isLetter: boolean;
}

/** Every non-space cell of a puzzle, in reading order. */
export function tiles(text: string): Tile[] {
  const out: Tile[] = [];
  let i = 0;
  for (const ch of normalizePuzzleText(text)) {
    if (ch === ' ') continue;
    out.push({ index: i, ch, isLetter: isLetter(ch) });
    i++;
  }
  return out;
}

export function positionsOf(text: string, letter: Letter): number[] {
  return tiles(text)
    .filter((t) => t.isLetter && t.ch === letter)
    .map((t) => t.index);
}

export function revealedSet(round: RoundState): Set<Letter> {
  return new Set(round.revealed);
}

/**
 * Letters a client is entitled to know are "used up": everything revealed plus
 * everything that missed. A still-hidden tile is provably none of these, because
 * a hit reveals *every* occurrence at once — which is what makes `boardPattern`
 * sound for bot deduction (§5) without ever handing over the answer.
 */
export function guessedLetters(round: RoundState): Letter[] {
  return [...new Set([...round.revealed, ...round.missed])].sort();
}

/** Tiles still face-down, with their true characters. SERVER-ONLY. */
export function hiddenTiles(round: RoundState): { index: number; ch: Letter }[] {
  const shown = revealedSet(round);
  return tiles(round.answer)
    .filter((t) => t.isLetter && !shown.has(t.ch))
    .map((t) => ({ index: t.index, ch: t.ch }));
}

/** Distinct letters not yet on the board. SERVER-ONLY. */
export function hiddenDistinctLetters(round: RoundState): Letter[] {
  return [...new Set(hiddenTiles(round).map((t) => t.ch))].sort();
}

export function hiddenLetterCount(round: RoundState): number {
  return hiddenTiles(round).length;
}

export function totalLetterCount(round: RoundState): number {
  return round.totalLetters;
}

export function isRevealed(round: RoundState, letter: Letter): boolean {
  return round.revealed.includes(letter);
}

/** Every letter already played this round, hit or miss. */
export function isGuessed(round: RoundState, letter: Letter): boolean {
  return round.revealed.includes(letter) || round.missed.includes(letter);
}

/**
 * Turn a letter face-up. Idempotent: revealing an already-revealed letter is a
 * no-op returning zero occurrences, so a double-dispatch can never make a tile
 * un-reveal or double-score.
 *
 * Mutates `round` — internal use only, always on a cloned draft.
 */
export function revealLetter(round: RoundState, letter: Letter): { occurrences: number; positions: number[] } {
  if (round.revealed.includes(letter)) return { occurrences: 0, positions: [] };
  const positions = positionsOf(round.answer, letter);
  if (positions.length === 0) return { occurrences: 0, positions: [] };
  round.revealed.push(letter);
  round.turnsSinceReveal = 0;
  return { occurrences: positions.length, positions };
}

/** Flip the whole board face-up. Called only once the round has ended. */
export function revealAll(round: RoundState): void {
  for (const t of tiles(round.answer)) {
    if (t.isLetter && !round.revealed.includes(t.ch)) round.revealed.push(t.ch);
  }
}

export function boardWords(round: RoundState): BoardWord[] {
  return buildWords(round.answer, revealedSet(round));
}

/**
 * THE masking function. Every server→client payload carrying board state goes
 * through this (§6.5).
 *
 * `hint` is null until CRACK has been played. `category` is public by design
 * (§3.1: the board shows the category label).
 */
export function maskBoardFromRound(round: RoundState): MaskedBoard {
  const words = boardWords(round);
  return {
    category: round.puzzle.category,
    words,
    guessedLetters: guessedLetters(round),
    missedLetters: [...round.missed].sort(),
    totalLetters: round.totalLetters,
    hiddenLetters: hiddenLetterCount(round),
    hint: round.hintRevealed ? round.puzzle.hint : null,
    accessibleText: accessibleBoardText(words),
  };
}

export function maskBoard(state: GameState): MaskedBoard {
  if (!state.round) throw new EngineError('ROUND_NOT_ACTIVE', 'no round to mask');
  return maskBoardFromRound(state.round);
}

/**
 * The deduction regex bots run against the corpus (§5). Derived purely from the
 * masked board, so a bot has exactly the information a sharp human has.
 */
export function boardPattern(round: RoundState): RegExp {
  return sharedBoardPattern(boardWords(round), new Set(guessedLetters(round)));
}

/** Statistically best letter to play from a hand, used by the timeout autoplay. */
export function bestLetterFrom(
  round: RoundState,
  letters: readonly Letter[],
  frequency: Record<string, number>,
): Letter | null {
  let best: Letter | null = null;
  let bestScore = -1;
  for (const letter of letters) {
    if (isGuessed(round, letter)) continue;
    const score = frequency[letter] ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = letter;
    }
  }
  return best;
}

/** Pressure gauge headroom, exposed for the sim's stats. */
export function gaugeFraction(round: RoundState, balance: Balance): number {
  return balance.pressure.max === 0 ? 0 : round.pressure / balance.pressure.max;
}
