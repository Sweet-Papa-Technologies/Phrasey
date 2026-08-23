/**
 * Guards on the committed corpus itself. These fail the build if a bad entry
 * ever lands in git, which is the point of committing the corpus at all.
 */
import { CATEGORIES } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { loadAll, loadByCategory, puzzleId } from '../corpus.js';
import { computeStats } from '../stats.js';
import { CorpusIndex, validateCandidate } from '../validator.js';

const entries = loadAll();

describe('committed corpus', () => {
  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('holds at least the 80 puzzles §4.3 calls enough for internal playtesting', () => {
    expect(entries.length).toBeGreaterThanOrEqual(80);
  });

  it('covers every category', () => {
    const byCategory = loadByCategory();
    for (const c of CATEGORIES) {
      expect(byCategory.get(c)?.length ?? 0, `category "${c}" is empty`).toBeGreaterThan(0);
    }
  });

  it('passes the validator end to end, including cross-entry dedupe', () => {
    const index = new CorpusIndex();
    const problems: string[] = [];
    for (const e of entries) {
      const r = validateCandidate({ raw: e.raw || e.text, hint: e.hint, category: e.category }, { index });
      if (!r.ok) problems.push(`"${e.text}" -> ${r.failures.map((f) => `${f.reason}: ${f.detail}`).join('; ')}`);
      else index.add(r.text);
    }
    expect(problems).toEqual([]);
  });

  it('gives every entry a deterministic id matching its text', () => {
    for (const e of entries) expect(e.id, e.text).toBe(puzzleId(e.text));
  });

  it('has no duplicate ids', () => {
    const ids = entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('tags the proverbs as public domain and the rest as generated (§4.2)', () => {
    for (const e of entries) {
      expect(e.source, e.text).toBe(e.category === 'Idiom / proverb' ? 'public-domain' : 'generated');
    }
  });

  it('gives every entry a hint for the CRACK card to reveal', () => {
    for (const e of entries) expect(e.hint.length, e.text).toBeGreaterThan(0);
  });

  it('spreads across all three difficulties', () => {
    const s = computeStats(entries);
    expect(s.difficulty[1] + s.difficulty[2] + s.difficulty[3]).toBe(entries.length);
    expect(s.difficulty[2]).toBeGreaterThan(0);
    expect(s.difficulty[3]).toBeGreaterThan(0);
  });

  it('uses most of the alphabet, so the deck has letters to draw', () => {
    const s = computeStats(entries);
    expect(s.missingLetters.length).toBeLessThanOrEqual(2);
  });
});
