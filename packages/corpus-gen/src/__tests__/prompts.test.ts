/**
 * The prompt layer is where the corpus's voice and its legal posture both live,
 * so both get asserted.
 */
import { CATEGORIES } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import { allocate, BRIEFS, buildPrompt, SYSTEM_PROMPT, TOTAL_WEIGHT } from '../prompts.js';
import { validateCandidate } from '../validator.js';

describe('briefs', () => {
  it('covers every category in the design doc', () => {
    expect(Object.keys(BRIEFS).sort()).toEqual([...CATEGORIES].sort());
  });

  it('weights the mundane categories above the proverbs (§4.1)', () => {
    expect(BRIEFS['Idiom / proverb'].weight).toBeLessThan(BRIEFS['Grocery list'].weight);
    expect(BRIEFS['Idiom / proverb'].weight).toBeLessThan(BRIEFS['Group chat message at 2am'].weight);
    expect(BRIEFS["Overheard at Trader Joe's"].weight).toBeGreaterThanOrEqual(BRIEFS['Error message'].weight);
  });

  it('sources proverbs as public domain and everything else as generated (§4.2)', () => {
    expect(BRIEFS['Idiom / proverb'].source).toBe('public-domain');
    for (const c of CATEGORIES) {
      if (c === 'Idiom / proverb') continue;
      expect(BRIEFS[c].source, c).toBe('generated');
    }
  });

  it('ships calibration examples that would themselves survive the validator', () => {
    for (const c of CATEGORIES) {
      for (const ex of BRIEFS[c].examples) {
        const r = validateCandidate({ raw: ex.text, hint: ex.hint, category: c });
        expect(r.failures.map((f) => `${c} / ${ex.text} / ${f.reason}: ${f.detail}`)).toEqual([]);
      }
    }
  });
});

describe('allocate', () => {
  it('splits a total roughly by weight', () => {
    const rows = allocate(TOTAL_WEIGHT * 4);
    const grocery = rows.find((r) => r.category === 'Grocery list');
    const proverb = rows.find((r) => r.category === 'Idiom / proverb');
    expect(grocery?.count).toBe(12);
    expect(proverb?.count).toBe(4);
  });
  it('never allocates fewer than two to a category', () => {
    for (const row of allocate(5)) expect(row.count).toBeGreaterThanOrEqual(2);
  });
  it('covers every category', () => {
    expect(allocate(100)).toHaveLength(CATEGORIES.length);
  });
});

describe('buildPrompt', () => {
  const prompt = buildPrompt({ category: 'Grocery list', count: 12, existing: ['ALREADY WROTE THIS ONE'] });

  it('states the category and the count', () => {
    expect(prompt).toContain('CATEGORY: Grocery list');
    expect(prompt).toContain('write 12 new phrases');
  });
  it('restates the validator rules so the model self-filters', () => {
    expect(prompt).toContain('12 to 60 characters');
    expect(prompt).toContain('at least 6 different letters');
    expect(prompt).toContain('No proper nouns');
  });
  it('asks for the hint in the same pass (§4.3) and forbids leaks', () => {
    expect(prompt).toContain('HARD RULES for every hint');
    expect(prompt).toContain('must NOT contain any word that appears in the phrase');
  });
  it('carries the sourcing posture into the prompt itself (§4.2)', () => {
    expect(prompt).toContain('Do not quote song lyrics, film or television dialogue');
  });
  it('feeds existing phrases back so the model does not repeat itself', () => {
    expect(prompt).toContain('ALREADY WROTE THIS ONE');
  });
  it('asks for JSON only', () => {
    expect(prompt).toContain('"text"');
    expect(prompt).toContain('"hint"');
    expect(SYSTEM_PROMPT).toContain('JSON');
  });
});
