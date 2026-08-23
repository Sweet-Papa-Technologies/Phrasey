/**
 * Load the real puzzle corpus off disk for the balance simulator.
 *
 * This is the ONLY module in the package that reads the filesystem, and it
 * lives under `src/sim/` for exactly that reason: the purity guard exempts the
 * simulator because it is a developer tool, not part of the rules path or the
 * bots. Bots receive their corpus as an injected option — they never load one.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Puzzle } from '@phrasey/shared';
import { letterStats, normalizePuzzleText } from '@phrasey/shared';

/** corpus-gen writes one JSON array per category, plus a review queue. */
const SKIP = new Set(['review-queue.json']);

interface RawEntry {
  id?: string;
  text?: string;
  category?: string;
  hint?: string;
  difficulty?: number;
}

export function corpusDir(): string {
  return new URL('../../../corpus-gen/corpus/', import.meta.url).pathname;
}

export function hasCorpus(dir = corpusDir()): boolean {
  return existsSync(dir);
}

/** Every validated puzzle in `dir`, normalized into the engine's `Puzzle`. */
export function loadCorpus(dir = corpusDir()): Puzzle[] {
  if (!existsSync(dir)) return [];
  const out: Puzzle[] = [];
  const seen = new Set<string>();
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith('.json') || SKIP.has(file)) continue;
    const parsed: unknown = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    if (!Array.isArray(parsed)) continue;
    for (const raw of parsed as RawEntry[]) {
      if (typeof raw.text !== 'string') continue;
      const text = normalizePuzzleText(raw.text);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      const difficulty = raw.difficulty === 1 || raw.difficulty === 2 || raw.difficulty === 3 ? raw.difficulty : 2;
      out.push({
        id: raw.id ?? `c${out.length}`,
        text,
        category: raw.category ?? 'Idiom / proverb',
        hint: raw.hint ?? '',
        difficulty,
        letterStats: letterStats(text),
        active: true,
        source: 'generated',
      });
    }
  }
  return out;
}
