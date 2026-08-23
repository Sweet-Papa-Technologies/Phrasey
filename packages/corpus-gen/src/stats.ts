/** Corpus reporting for `phrasey-corpus stats`. */
import { distinctLetters, letterStats, totalLetterCount } from '@phrasey/shared';
import type { CorpusEntry } from './types.js';

export interface CategoryStat {
  category: string;
  count: number;
  difficulty: Record<1 | 2 | 3, number>;
  meanLength: number;
  meanDistinctLetters: number;
}

export interface CorpusStats {
  total: number;
  byCategory: CategoryStat[];
  difficulty: Record<1 | 2 | 3, number>;
  meanLength: number;
  /** Occurrence share per letter across the whole corpus, A-Z. */
  letterDistribution: { letter: string; count: number; share: number }[];
  /** Letters that never appear — a hole in the deck's letter pool. */
  missingLetters: string[];
  totalTiles: number;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function computeStats(entries: CorpusEntry[]): CorpusStats {
  const byCat = new Map<string, CorpusEntry[]>();
  for (const e of entries) {
    const list = byCat.get(e.category);
    if (list) list.push(e);
    else byCat.set(e.category, [e]);
  }

  const totals: Record<string, number> = {};
  let tiles = 0;
  let lengthSum = 0;
  const diff: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };

  for (const e of entries) {
    lengthSum += e.text.length;
    diff[e.difficulty] = (diff[e.difficulty] ?? 0) + 1;
    tiles += totalLetterCount(e.text);
    for (const [l, n] of Object.entries(letterStats(e.text))) {
      totals[l] = (totals[l] ?? 0) + n;
    }
  }

  const byCategory: CategoryStat[] = [...byCat.entries()]
    .map(([category, list]) => {
      const d: Record<1 | 2 | 3, number> = { 1: 0, 2: 0, 3: 0 };
      let len = 0;
      let dist = 0;
      for (const e of list) {
        d[e.difficulty] = (d[e.difficulty] ?? 0) + 1;
        len += e.text.length;
        dist += distinctLetters(e.text).length;
      }
      return {
        category,
        count: list.length,
        difficulty: d,
        meanLength: list.length ? len / list.length : 0,
        meanDistinctLetters: list.length ? dist / list.length : 0,
      };
    })
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  const letterDistribution = ALPHABET.map((letter) => ({
    letter,
    count: totals[letter] ?? 0,
    share: tiles ? (totals[letter] ?? 0) / tiles : 0,
  })).sort((a, b) => b.count - a.count || a.letter.localeCompare(b.letter));

  return {
    total: entries.length,
    byCategory,
    difficulty: diff,
    meanLength: entries.length ? lengthSum / entries.length : 0,
    letterDistribution,
    missingLetters: ALPHABET.filter((l) => !totals[l]),
    totalTiles: tiles,
  };
}

export function formatStats(s: CorpusStats): string {
  const lines: string[] = [];
  lines.push(`Corpus: ${s.total} validated puzzles, ${s.totalTiles} letter tiles`);
  lines.push(`Mean phrase length: ${s.meanLength.toFixed(1)} chars`);
  lines.push('');
  lines.push('Per category:');
  lines.push(`  ${'CATEGORY'.padEnd(36)} ${'N'.padStart(4)}   D1/D2/D3      LEN   DISTINCT`);
  for (const c of s.byCategory) {
    lines.push(
      `  ${c.category.padEnd(36)} ${String(c.count).padStart(4)}   ` +
        `${String(c.difficulty[1]).padStart(2)}/${String(c.difficulty[2]).padStart(2)}/${String(c.difficulty[3]).padStart(2)}   ` +
        `${c.meanLength.toFixed(1).padStart(6)}   ${c.meanDistinctLetters.toFixed(1).padStart(6)}`,
    );
  }
  lines.push('');
  lines.push(
    `Difficulty spread: 1=${s.difficulty[1]}  2=${s.difficulty[2]}  3=${s.difficulty[3]}` +
      (s.total ? `  (${((s.difficulty[1] / s.total) * 100).toFixed(0)}% / ${((s.difficulty[2] / s.total) * 100).toFixed(0)}% / ${((s.difficulty[3] / s.total) * 100).toFixed(0)}%)` : ''),
  );
  lines.push('');
  lines.push('Letter distribution (occurrences, share of all tiles):');
  const max = s.letterDistribution[0]?.count ?? 1;
  for (const row of s.letterDistribution) {
    const bar = '#'.repeat(Math.round((row.count / Math.max(1, max)) * 40));
    lines.push(`  ${row.letter}  ${String(row.count).padStart(5)}  ${(row.share * 100).toFixed(2).padStart(5)}%  ${bar}`);
  }
  if (s.missingLetters.length > 0) {
    lines.push('');
    lines.push(`Letters absent from the entire corpus: ${s.missingLetters.join(', ')}`);
  }
  return lines.join('\n');
}
