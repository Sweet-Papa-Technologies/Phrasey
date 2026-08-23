/**
 * The bot's view of the corpus, pre-chewed.
 *
 * §5 says a bot runs "the revealed pattern as a regex against the corpus
 * subset". That gets you *solving*. It does not get you good *letter play*,
 * because the whole phrase almost never matches early — one unusual word and
 * the pool is empty, and the bot is back to raw English frequency.
 *
 * So the index is built at two levels:
 *
 *   - **phrases** — for deduction and solving. Exactly what §5 describes.
 *   - **words**, bucketed by cell length — for letter scoring. A three-cell
 *     word ending in a revealed E matches THE / ARE / ICE / ONE / SHE ...,
 *     and averaging letter counts across those is real positional and
 *     word-shape signal that survives long after the phrase pool empties.
 *
 * The index is derived from the *same* puzzle pool the room draws from, which
 * is injected by the caller. Nothing here reads the filesystem or the answer.
 */
import type { Letter, Puzzle } from '@phrasey/shared';
import { isLetter, normalizePuzzleText } from '@phrasey/shared';

export interface IndexedPuzzle {
  puzzle: Puzzle;
  /** Normalized text, exactly what `boardPattern` is written against. */
  text: string;
  /** Space-free cells, indexed the way board tiles are (punctuation counts). */
  cells: string[];
  /** Occurrence count per letter. */
  counts: Record<Letter, number>;
}

export interface IndexedWord {
  chars: string[];
  /** How many times this exact word occurs across the corpus. */
  weight: number;
}

export interface CorpusIndex {
  puzzles: IndexedPuzzle[];
  /** Cell length -> distinct words of that length. */
  wordsByLength: Map<number, IndexedWord[]>;
}

function indexPuzzle(puzzle: Puzzle): IndexedPuzzle {
  const text = normalizePuzzleText(puzzle.text);
  const counts: Record<string, number> = {};
  const cells: string[] = [];
  for (const ch of text) {
    if (ch === ' ') continue;
    cells.push(ch);
    if (isLetter(ch)) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  return { puzzle, text, cells, counts };
}

export function buildCorpusIndex(corpus: readonly Puzzle[]): CorpusIndex {
  const puzzles = corpus.map(indexPuzzle);
  const byLength = new Map<number, Map<string, IndexedWord>>();
  for (const p of puzzles) {
    for (const word of p.text.split(' ')) {
      if (!word) continue;
      const chars = [...word];
      let bucket = byLength.get(chars.length);
      if (!bucket) {
        bucket = new Map();
        byLength.set(chars.length, bucket);
      }
      const existing = bucket.get(word);
      if (existing) existing.weight += 1;
      else bucket.set(word, { chars, weight: 1 });
    }
  }
  const wordsByLength = new Map<number, IndexedWord[]>();
  for (const [len, bucket] of byLength) wordsByLength.set(len, [...bucket.values()]);
  return { puzzles, wordsByLength };
}

/**
 * Building the index is O(corpus) and a room reuses one corpus for every bot in
 * every round, so it is memoized on the array identity the caller passed in.
 * A WeakMap keeps this from pinning a corpus the server has moved on from.
 */
const CACHE = new WeakMap<object, CorpusIndex>();

export function corpusIndexFor(corpus: readonly Puzzle[]): CorpusIndex {
  const key = corpus as unknown as object;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const built = buildCorpusIndex(corpus);
  CACHE.set(key, built);
  return built;
}
