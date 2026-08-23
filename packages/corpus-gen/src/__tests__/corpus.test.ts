/**
 * Guards on the committed corpus itself. These fail the build if a bad entry
 * ever lands in git, which is the point of committing the corpus at all.
 */
import { CATEGORIES } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { loadAll, loadByCategory, puzzleId } from '../corpus.js';
import { computeStats } from '../stats.js';
import { BRIEFS, POP_CULTURE_CATEGORIES } from '../prompts.js';
import { CorpusIndex, validateCandidate } from '../validator.js';
import { isCategory } from '../corpus.js';

const entries = loadAll();

describe('committed corpus', () => {
  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('holds at least 400 puzzles, on the way to the 500 §4.3 wants at launch', () => {
    expect(entries.length).toBeGreaterThanOrEqual(400);
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
      const b = isCategory(e.category) ? BRIEFS[e.category] : undefined;
      const r = validateCandidate(
        { raw: e.raw || e.text, hint: e.hint, category: e.category },
        {
          index,
          ...(b?.commonWordFloor !== undefined ? { commonWordFloor: b.commonWordFloor } : {}),
          ...(b?.maxUncommonWords !== undefined ? { maxUncommonWords: b.maxUncommonWords } : {}),
        },
      );
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

  it('tags every entry with the source its brief declares (§4.2)', () => {
    for (const e of entries) {
      expect(isCategory(e.category), `unknown category "${e.category}"`).toBe(true);
      if (!isCategory(e.category)) continue;
      expect(e.source, e.text).toBe(BRIEFS[e.category].source);
    }
  });

  it('keeps the pop-culture slice cleanly separable (corpus/SOURCING.md)', () => {
    const pop = new Set<string>(POP_CULTURE_CATEGORIES);
    for (const e of entries) {
      const expected = pop.has(e.category) ? 'pop-culture' : 'core';
      expect(e.rightsTier ?? 'core', e.text).toBe(expected);
      // Every pop-culture entry carries its own rights note, so dropping the
      // tier is a decision a reviewer can make from the data alone.
      if (expected === 'pop-culture') expect(e.rightsNote, e.text).toBeTruthy();
    }
  });

  it('skews easy and medium — the whole point of the corpus overhaul', () => {
    const s = computeStats(entries);
    const easyish = (s.difficulty[1] + s.difficulty[2]) / entries.length;
    expect(easyish).toBeGreaterThan(0.75);
    expect(s.difficulty[1]).toBeGreaterThan(0);
  });

  it('sits in the short, guessable length band', () => {
    const s = computeStats(entries);
    expect(s.meanLength).toBeLessThan(36);
    const inBand = entries.filter((e) => e.text.length >= 15 && e.text.length <= 40).length;
    expect(inBand / entries.length).toBeGreaterThan(0.75);
  });

  it('gives every entry a hint for the CRACK card to reveal', () => {
    for (const e of entries) expect(e.hint.length, e.text).toBeGreaterThan(0);
  });

  it('still spreads across all three difficulties', () => {
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
