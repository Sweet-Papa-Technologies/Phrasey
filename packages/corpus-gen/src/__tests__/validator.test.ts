/**
 * Exit criterion for M5 (design doc §14): "validator rejects known-bad
 * fixtures". Each rule gets its own test against a deliberately invalid entry
 * from corpus/fixtures/known-bad.json, plus control entries that must pass.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR } from '../paths.js';
import {
  CorpusIndex,
  RULES,
  REJECTION_REASONS,
  deriveDifficulty,
  findProfanity,
  findProperNouns,
  leakedWords,
  normalizedHash,
  shapeSignature,
  simulateSolvability,
  stem,
  tokenize,
  validateCandidate,
  type RejectionReason,
} from '../validator.js';

interface FixtureCase {
  id: string;
  raw: string;
  hint: string;
  category: string;
  expect: RejectionReason[];
  note: string;
}
interface FixtureFile {
  corpusSeed: string[];
  cases: FixtureCase[];
  valid: { id: string; raw: string; hint: string; category: string }[];
}

const fixtures = JSON.parse(
  readFileSync(join(FIXTURES_DIR, 'known-bad.json'), 'utf8'),
) as FixtureFile;

function freshIndex(): CorpusIndex {
  return CorpusIndex.from(fixtures.corpusSeed);
}

function check(c: { raw: string; hint: string; category: string }) {
  return validateCandidate({ raw: c.raw, hint: c.hint, category: c.category }, { index: freshIndex() });
}

// ---------------------------------------------------------------------------

describe('known-bad fixtures', () => {
  it('has a fixture for every rule the validator can fire', () => {
    const covered = new Set(fixtures.cases.flatMap((c) => c.expect));
    // HINT_CHARSET rides along with HINT_NON_ASCII; everything else is explicit.
    const uncovered = REJECTION_REASONS.filter((r) => !covered.has(r) && r !== 'HINT_CHARSET');
    expect(uncovered).toEqual([]);
  });

  it.each(fixtures.cases.map((c) => [c.id, c] as const))('rejects %s', (_id, c) => {
    const result = check(c);
    expect(result.ok, `expected "${c.raw}" to be rejected (${c.note})`).toBe(false);
    const reasons = result.failures.map((f) => f.reason);
    for (const expected of c.expect) {
      expect(reasons, `${c.id}: expected reason ${expected}, got ${reasons.join(', ')}`).toContain(expected);
    }
  });

  it.each(fixtures.cases.map((c) => [c.id, c] as const))('gives %s a human-readable reason', (_id, c) => {
    for (const f of check(c).failures) {
      expect(f.detail.length).toBeGreaterThan(0);
      expect(REJECTION_REASONS).toContain(f.reason);
    }
  });

  it.each(fixtures.valid.map((c) => [c.id, c] as const))('accepts control entry %s', (_id, c) => {
    const result = check(c);
    expect(result.failures.map((f) => `${f.reason}: ${f.detail}`)).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Per-rule unit tests
// ---------------------------------------------------------------------------

const GOOD = {
  raw: 'DO NOT ASK ME WHAT NUMBER WE ARE ON',
  hint: 'a plea about the queue counter',
  category: "Sign you'd see at the DMV",
};

function reasonsFor(over: Partial<typeof GOOD>): string[] {
  return validateCandidate({ ...GOOD, ...over }).failures.map((f) => f.reason);
}

describe('rule: length', () => {
  it('rejects under the floor', () => {
    expect(reasonsFor({ raw: 'EAT THE BOX' })).toContain('LENGTH');
  });
  it('rejects over the ceiling', () => {
    expect(reasonsFor({ raw: 'A'.padEnd(20, 'B') + ' ' + 'C'.padEnd(20, 'D') + ' ' + 'E'.padEnd(21, 'F') })).toContain('LENGTH');
  });
  it('accepts exactly the floor and the ceiling', () => {
    const atFloor = 'ADD MORE SALTY'; // 14
    expect(atFloor.length).toBeGreaterThanOrEqual(RULES.MIN_LENGTH);
    expect(reasonsFor({ raw: atFloor, hint: 'increase the sodium in it' })).not.toContain('LENGTH');
  });
});

describe('rule: word count', () => {
  it('rejects two words', () => {
    expect(reasonsFor({ raw: 'UNBELIEVABLE PAPERWORK' })).toContain('WORD_COUNT');
  });
  it('accepts three', () => {
    expect(reasonsFor({ raw: 'BRING THE OTHER PAPERWORK', hint: 'fetch a different set of forms' })).not.toContain('WORD_COUNT');
  });
});

describe('rule: distinct letters', () => {
  it('rejects a phrase with fewer than six', () => {
    expect(reasonsFor({ raw: 'TOTO TOT TATA TOAST' })).toContain('DISTINCT_LETTERS');
  });
  it('accepts a normal phrase', () => {
    expect(reasonsFor({})).not.toContain('DISTINCT_LETTERS');
  });
});

describe('rule: ASCII and punctuation', () => {
  it('rejects emoji', () => {
    expect(reasonsFor({ raw: 'PICK UP THE MILK 🥛' })).toContain('NON_ASCII');
  });
  it('rejects a semicolon', () => {
    expect(reasonsFor({ raw: 'WAIT HERE; DO NOT ENTER' })).toContain('DISALLOWED_PUNCTUATION');
  });
  it('rejects parentheses, colons and asterisks', () => {
    for (const bad of ['WHY (NOT) ASK ME TWICE', 'NOTE: THE DOOR IS BROKEN', 'THE SOUP WAS *FINE* HERE']) {
      expect(reasonsFor({ raw: bad }), bad).toContain('DISALLOWED_PUNCTUATION');
    }
  });
  it("accepts every character in the ' - , . ! ? set", () => {
    expect(reasonsFor({ raw: "DON'T ASK, DON'T WAIT - JUST GO. NOW! OK?", hint: 'urgency delivered with no room to argue' })).not.toContain(
      'DISALLOWED_PUNCTUATION',
    );
  });
  it('folds curly quotes to ASCII rather than rejecting them', () => {
    const r = validateCandidate({ ...GOOD, raw: 'DON’T ASK ME ABOUT THE FORM', hint: 'do not raise the paperwork question' });
    expect(r.text).toContain("DON'T");
    expect(r.failures.map((f) => f.reason)).not.toContain('NON_ASCII');
  });
});

describe('rule: proper nouns', () => {
  it('catches a given name after uppercasing', () => {
    expect(findProperNouns('I HAVE KNOWN MICHAEL SINCE THEN')).toContain('michael');
  });
  it('catches a brand', () => {
    expect(findProperNouns('I BOUGHT THIS AT WALMART')).toContain('walmart');
  });
  it('catches a place', () => {
    expect(findProperNouns('THE TRAFFIC IN CHICAGO IS FINE')).toContain('chicago');
  });
  it('catches an invented proper noun via mixed-case capitalization', () => {
    expect(findProperNouns('please move off Bramblewood Court')).toContain('bramblewood');
  });
  it('does not fire on a sentence-initial capital', () => {
    expect(findProperNouns('Please move your car off the grass')).toEqual([]);
  });
  it('does not fire on an all-caps phrase with no proper nouns', () => {
    expect(findProperNouns('DO NOT ASK ME WHAT NUMBER WE ARE ON')).toEqual([]);
  });
  it('honours the explicit allowlist', () => {
    expect(findProperNouns('CALL ME BACK ON FRIDAY')).toEqual([]);
    expect(findProperNouns('THE DMV LINE IS OUT THE DOOR')).toEqual([]);
  });
  it('catches a multi-word franchise', () => {
    expect(findProperNouns('READING HARRY POTTER AGAIN')).toContain('harry potter');
  });
});

describe('rule: profanity', () => {
  it('catches a profane word', () => {
    expect(findProfanity('THIS PLACE IS BULLSHIT')).not.toEqual([]);
  });
  it('catches it inside punctuation and possessives', () => {
    expect(findProfanity("that guy's a real bastard, honestly")).toContain('bastard');
  });
  it('does not fire on innocent host words (no Scunthorpe problem)', () => {
    for (const clean of [
      'PLEASE COMPLETE THE ASSIGNMENT',
      'A CLASSIC GLASS OF COLD WATER',
      'PASS THE PASSWORD ALONG',
      'ASSESS THE DAMAGE FIRST',
      'ADD THE SHIITAKE MUSHROOMS',
      'ONE TITANIUM SPORK PLEASE',
    ]) {
      expect(findProfanity(clean), clean).toEqual([]);
    }
  });
  it('screens the hint as well as the phrase', () => {
    expect(reasonsFor({ hint: 'the whole thing is bullshit really' })).toContain('HINT_PROFANITY');
  });
});

describe('rule: dedupe', () => {
  it('hashes past punctuation and casing', () => {
    expect(normalizedHash('WHY IS THERE A SECOND FRIDGE')).toBe(normalizedHash('why is there a second fridge?!'));
  });
  it('rejects an exact duplicate', () => {
    const index = CorpusIndex.from(['WHY IS THERE A SECOND FRIDGE']);
    const r = validateCandidate({ raw: 'WHY IS THERE A SECOND FRIDGE', hint: 'an extra cold box appears', category: 'x' }, { index });
    expect(r.failures.map((f) => f.reason)).toContain('DUPLICATE');
  });
  it('accepts a genuinely different phrase against a populated index', () => {
    const index = CorpusIndex.from(fixtures.corpusSeed);
    const r = validateCandidate(
      { raw: 'THE PEN IS ON A STRING FOR A REASON', hint: 'why the writing tool is tethered', category: 'x' },
      { index },
    );
    expect(r.failures).toEqual([]);
  });
});

describe('rule: near-duplicate pattern', () => {
  it('computes a word-length board shape', () => {
    expect(shapeSignature("DON'T STOP NOW")).toBe('4-4-3'); // apostrophes are not tiles
  });
  it('rejects an entry with the same shape and near-identical wording', () => {
    const index = CorpusIndex.from(['THEY MOVED THE FROZEN AISLE AND I AM SHAKEN']);
    const r = validateCandidate(
      { raw: 'THEY MOVED THE FROZEN AISLE AND I AM BROKEN', hint: 'a relocated cold section causes upset', category: 'x' },
      { index },
    );
    expect(r.failures.map((f) => f.reason)).toContain('PATTERN_NEAR_DUPLICATE');
  });
  it('allows a different phrase that happens to share a shape', () => {
    const index = CorpusIndex.from(['WHY IS THERE A SECOND FRIDGE']);
    const r = validateCandidate(
      { raw: 'WHO ATE ALL THE PICKLE SLICES', hint: 'someone consumed the brined snack', category: 'x' },
      { index },
    );
    expect(r.failures.map((f) => f.reason)).not.toContain('PATTERN_NEAR_DUPLICATE');
  });
});

describe('rule: solvability', () => {
  it('is deterministic across runs', () => {
    const a = simulateSolvability('THE EARLY BIRD CATCHES THE WORM');
    const b = simulateSolvability('THE EARLY BIRD CATCHES THE WORM');
    expect(a).toEqual(b);
  });
  it('flags a phrase whose two commonest letters expose most of the board', () => {
    const sim = simulateSolvability('SEE THESE SEEDS TEASE');
    expect(sim.twoLetterCoverage).toBeGreaterThan(RULES.MAX_TWO_LETTER_COVERAGE);
    expect(reasonsFor({ raw: 'SEE THESE SEEDS TEASE' })).toContain('TRIVIALLY_SOLVABLE');
  });
  it('flags a phrase with almost nothing hidden after two letters', () => {
    const sim = simulateSolvability('EEL ALE ELLA');
    expect(sim.hiddenAfterTwo).toBeLessThan(RULES.MIN_HIDDEN_AFTER_TWO);
  });
  it('leaves a normal phrase alone', () => {
    for (const good of [
      'THE EARLY BIRD CATCHES THE WORM',
      'WHY IS THERE A SECOND FRIDGE',
      'MILK, EGGS, AND WHATEVER THAT SMELL IS',
    ]) {
      const sim = simulateSolvability(good);
      expect(sim.twoLetterCoverage, good).toBeLessThanOrEqual(RULES.MAX_TWO_LETTER_COVERAGE);
      expect(sim.meanWordsExposedAt40, good).toBeLessThanOrEqual(RULES.MAX_WORDS_EXPOSED_AT_40);
    }
  });
  it('needs several letters to reach the 40% reveal mark on a real phrase', () => {
    expect(simulateSolvability('THE EARLY BIRD CATCHES THE WORM').meanLettersTo40).toBeGreaterThan(2);
  });
});

describe('rule: hint', () => {
  it('rejects a missing hint', () => {
    expect(reasonsFor({ hint: '' })).toContain('HINT_MISSING');
  });
  it('rejects a hint that reuses a phrase word', () => {
    expect(leakedWords('WHOSE CHILD IS UNDER THE CAKE TABLE', 'a child under the cake table')).toEqual(['cake', 'child', 'table', 'under']);
  });
  it('rejects a hint that reuses an inflected phrase word', () => {
    expect(leakedWords('I HAVE BEEN THINKING ABOUT DOORS', 'a fixation on one door')).toContain('door');
  });
  it('ignores stopwords when checking for a leak', () => {
    expect(leakedWords('DO NOT ASK ME WHAT NUMBER WE ARE ON', 'the queue position is a mystery to them')).toEqual([]);
  });
  it('rejects a hint that is too short or too long', () => {
    expect(reasonsFor({ hint: 'sad' })).toContain('HINT_LENGTH');
    expect(reasonsFor({ hint: 'x'.repeat(RULES.HINT_MAX_LENGTH + 1) })).toContain('HINT_LENGTH');
  });
  it('rejects a proper noun in the hint', () => {
    expect(reasonsFor({ hint: 'something you would hear in Denver' })).toContain('HINT_PROPER_NOUN');
  });
  it('allows a hint with a colon or parentheses', () => {
    expect(reasonsFor({ hint: 'the queue position (unknown) frustrates someone' })).not.toContain('HINT_CHARSET');
  });
});

describe('tokenizing helpers', () => {
  it('keeps apostrophes inside a token', () => {
    expect(tokenize("DON'T STOP - GO NOW")).toEqual(["don't", 'stop', 'go', 'now']);
  });
  it('stems plurals and gerunds without mangling short words', () => {
    expect(stem('doors')).toBe('door');
    expect(stem('thinking')).toBe('think');
    expect(stem('bus')).toBe('bus');
    expect(stem('is')).toBe('is');
  });
});

describe('difficulty derivation', () => {
  it('scores a short common-letter phrase easiest', () => {
    expect(deriveDifficulty('ADD MORE SALT')).toBe(1);
  });
  it('scores a long, wide-alphabet phrase hardest', () => {
    expect(deriveDifficulty('QUICK, JUDGE MY VEXING PHRASE BEFORE WE ALL BLOW UP')).toBe(3);
  });
  it('always returns 1, 2 or 3', () => {
    for (const t of [...fixtures.corpusSeed, ...fixtures.valid.map((v) => v.raw)]) {
      expect([1, 2, 3]).toContain(deriveDifficulty(t));
    }
  });
});
