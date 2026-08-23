/**
 * The prompt layer is where the corpus's voice and its legal posture both live,
 * so both get asserted.
 */
import { CATEGORIES, type Category } from '@phrasey/shared';
import { describe, expect, it } from 'vitest';
import {
  allocate,
  BRIEFS,
  buildPrompt,
  POP_CULTURE_CATEGORIES,
  SYSTEM_PROMPT,
  TARGET_MAX_LENGTH,
  TARGET_MIN_LENGTH,
  TOTAL_WEIGHT,
} from '../prompts.js';
import { RULES, validateCandidate } from '../validator.js';

describe('briefs', () => {
  it('covers every category in the design doc', () => {
    expect(Object.keys(BRIEFS).sort()).toEqual([...CATEGORIES].sort());
  });

  it('sources the public-domain categories correctly (§4.2)', () => {
    for (const c of ['Idiom / proverb', 'Nursery rhyme line'] as const) {
      expect(BRIEFS[c].source, c).toBe('public-domain');
      expect(BRIEFS[c].rightsTier, c).toBe('core');
    }
  });

  it('weights the familiar categories heavily, per the playtest correction', () => {
    // §4.1 originally said the mundane categories beat the quotes and to weight
    // them accordingly. Playtest said the opposite about *guessability*: the
    // surreal tail was unguessable, and familiar material is what carries a
    // round. Every mundane category is still here — they just no longer crowd
    // out the phrases a player can actually finish from three letters.
    const familiar: Category[] = [
      'Idiom / proverb',
      'Nursery rhyme line',
      'Common sign or public notice',
      'Thing your GPS says',
      'Thing on a restaurant menu',
      ...POP_CULTURE_CATEGORIES,
    ];
    const familiarWeight = familiar.reduce((n, c) => n + BRIEFS[c].weight, 0);
    expect(familiarWeight / TOTAL_WEIGHT).toBeGreaterThan(0.45);
    // ...and the observational categories still hold a real share.
    expect(familiarWeight / TOTAL_WEIGHT).toBeLessThan(0.7);
    expect(BRIEFS['Idiom / proverb'].weight).toBeGreaterThan(BRIEFS['Grocery list'].weight);
  });

  it('puts every rights-sensitive category in the pop-culture tier and nothing else', () => {
    expect([...POP_CULTURE_CATEGORIES].sort()).toEqual(
      [
        'Catchphrase everyone knows',
        'Movie title everyone knows',
        'Song title everyone knows',
        'TV show title everyone knows',
      ].sort(),
    );
    for (const c of CATEGORIES) {
      const b = BRIEFS[c];
      if (b.rightsTier === 'pop-culture') {
        expect(b.source, c).toBe('reference');
        expect(b.rightsNote, c).toBeTruthy();
      } else {
        expect(b.source, c).not.toBe('reference');
      }
    }
  });

  it('only relaxes the common-word floor for categories famous as a whole', () => {
    // A frequency list has no opinion about "ITSY BITSY SPIDER"; a five-year-old
    // does. Titles and rhymes are recognized whole, so they get a lower floor —
    // and nothing else does.
    for (const c of CATEGORIES) {
      const b = BRIEFS[c];
      if (b.commonWordFloor === undefined) continue;
      expect(b.rightsTier === 'pop-culture' || c === 'Nursery rhyme line', c).toBe(true);
      expect(b.commonWordFloor, c).toBeLessThan(RULES.MIN_COMMON_WORD_FRACTION);
    }
  });

  it('ships calibration examples that would themselves survive the validator', () => {
    for (const c of CATEGORIES) {
      const b = BRIEFS[c];
      for (const ex of b.examples) {
        const r = validateCandidate(
          { raw: ex.text, hint: ex.hint, category: c },
          {
            ...(b.commonWordFloor !== undefined ? { commonWordFloor: b.commonWordFloor } : {}),
            ...(b.maxUncommonWords !== undefined ? { maxUncommonWords: b.maxUncommonWords } : {}),
          },
        );
        expect(r.failures.map((f) => `${c} / ${ex.text} / ${f.reason}: ${f.detail}`)).toEqual([]);
      }
    }
  });
});

describe('allocate', () => {
  it('splits a total in proportion to weight', () => {
    for (const row of allocate(TOTAL_WEIGHT * 4)) {
      expect(row.count, row.category).toBe(Math.max(2, BRIEFS[row.category].weight * 4));
    }
  });
  it('never allocates fewer than two to a category', () => {
    for (const row of allocate(5)) expect(row.count).toBeGreaterThanOrEqual(2);
  });
  it('covers every category', () => {
    expect(allocate(100)).toHaveLength(CATEGORIES.length);
  });
  it('can allocate to one rights tier only, so the tiers generate independently', () => {
    const pop = allocate(100, 'pop-culture');
    expect(pop.map((r) => r.category).sort()).toEqual([...POP_CULTURE_CATEGORIES].sort());
    // Re-normalized, not merely filtered: a tier-only run still asks for the
    // full total rather than the tier's share of it.
    expect(pop.reduce((n, r) => n + r.count, 0)).toBeGreaterThan(90);
  });
});

describe('buildPrompt', () => {
  const prompt = buildPrompt({ category: 'Grocery list', count: 12, existing: ['ALREADY WROTE THIS ONE'] });

  it('states the category and the count', () => {
    expect(prompt).toContain('CATEGORY: Grocery list');
    expect(prompt).toContain('write 12 new phrases');
  });
  it('restates the validator rules so the model self-filters', () => {
    expect(prompt).toContain(`${TARGET_MIN_LENGTH} to ${TARGET_MAX_LENGTH} characters`);
    expect(prompt).toContain('at least 6 different letters');
    expect(prompt).toContain('No proper nouns');
  });
  it('asks for the short, guessable band rather than the validator hard cap', () => {
    expect(TARGET_MAX_LENGTH).toBeLessThan(RULES.MAX_LENGTH);
    expect(prompt).toContain('GUESSABILITY');
    expect(prompt).toContain('At most ONE unusual word');
    expect(prompt).toContain('Do NOT write surreal or absurdist lines');
  });
  it('asks for the hint in the same pass (§4.3) and forbids leaks', () => {
    expect(prompt).toContain('HARD RULES for every hint');
    expect(prompt).toContain('must NOT contain any word that appears in the phrase');
  });
  it('carries the sourcing posture into the prompt itself (§4.2)', () => {
    expect(prompt).toContain('Do not quote song lyrics, film or television dialogue');
  });
  it('forbids lyrics and dialogue in the pop-culture briefs, titles only (§4.2)', () => {
    for (const c of POP_CULTURE_CATEGORIES) {
      const p = buildPrompt({ category: c, count: 5 });
      expect(p, c).toContain('Give the TITLE ONLY');
      expect(p, c).toContain('never a line of dialogue');
      expect(p, c).toContain('no personal name, place name or brand');
    }
  });
  it('appends a brief-specific rule block when the category has one', () => {
    expect(buildPrompt({ category: 'Thing your GPS says', count: 5 })).toContain(
      'EXTRA RULES for Thing your GPS says',
    );
  });
  it('feeds existing phrases back so the model does not repeat itself', () => {
    expect(prompt).toContain('ALREADY WROTE THIS ONE');
  });
  it('asks for JSON only', () => {
    expect(prompt).toContain('"text"');
    expect(prompt).toContain('"hint"');
    expect(SYSTEM_PROMPT).toContain('JSON');
  });
  it('leads with guessability in the system prompt', () => {
    expect(SYSTEM_PROMPT).toContain('GUESSABLE');
  });
});
