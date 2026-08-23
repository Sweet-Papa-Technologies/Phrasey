/**
 * `shared` is the contract every other package builds against, and it carries
 * real logic: one normalization path for puzzle text, the board builder, the
 * deduction regex, and the balance override merge. A bug in any of these is a
 * bug in all four packages at once.
 */
import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  defaultBalance,
  mergeBalance,
  isValidRoomCode,
  CODE_CONSONANTS,
  CODE_VOWELS,
  pickPersonas,
  BOT_PERSONAS,
  accessibleBoardText,
  boardPattern,
  buildWords,
  distinctLetters,
  guessMatches,
  letterPositions,
  letterStats,
  normalizeGuess,
  normalizePuzzleText,
  totalLetterCount,
} from '../index.js';

describe('normalizePuzzleText', () => {
  it('uppercases, collapses whitespace and trims', () => {
    expect(normalizePuzzleText('  the   cat  sat ')).toBe('THE CAT SAT');
  });

  it('folds curly quotes and dashes to ASCII', () => {
    expect(normalizePuzzleText('don’t stop—now')).toBe("DON'T STOP-NOW");
  });

  it('strips combining accents rather than mangling the letter', () => {
    expect(normalizePuzzleText('CAFÉ OPEN LATE')).toBe('CAFE OPEN LATE');
  });

  it('is idempotent', () => {
    const once = normalizePuzzleText(' A  b’c ');
    expect(normalizePuzzleText(once)).toBe(once);
  });
});

describe('guess comparison', () => {
  it('ignores punctuation, case and spacing — what a typing race needs', () => {
    expect(guessMatches('dont stop', "DON'T STOP!")).toBe(true);
    expect(guessMatches('DONTSTOP', "DON'T STOP!")).toBe(true);
    expect(guessMatches('  Don’t   Stop  ', "DON'T STOP!")).toBe(true);
  });

  it('still rejects a wrong answer', () => {
    expect(guessMatches('dont go', "DON'T STOP!")).toBe(false);
  });

  it('never lets an empty guess match', () => {
    expect(guessMatches('', 'ANYTHING AT ALL')).toBe(false);
    expect(guessMatches('   ', 'ANYTHING AT ALL')).toBe(false);
    expect(guessMatches('!!!', 'ANYTHING AT ALL')).toBe(false);
  });

  it('normalizeGuess keeps digits', () => {
    expect(normalizeGuess('aisle 9, now!')).toBe('AISLE9NOW');
  });
});

describe('letter accounting', () => {
  const text = "DON'T STOP BELIEVING";

  it('counts occurrences per letter and ignores punctuation', () => {
    const stats = letterStats(text);
    expect(stats.N).toBe(2);
    expect(stats.I).toBe(2);
    expect(stats["'" as string]).toBeUndefined();
  });

  it('totalLetterCount matches the sum of letterStats', () => {
    const sum = Object.values(letterStats(text)).reduce((a, b) => a + b, 0);
    expect(totalLetterCount(text)).toBe(sum);
  });

  it('distinctLetters is sorted and deduplicated', () => {
    const d = distinctLetters(text);
    expect(d).toEqual([...new Set(d)].sort());
  });

  it('letterPositions indexes tiles in reading order, skipping spaces', () => {
    // "AB CD" → cells A,B,C,D at 0,1,2,3 with the space not taking an index.
    expect(letterPositions('AB CD')).toEqual([0, 1, 2, 3]);
    // Punctuation occupies a cell but is not a letter position.
    expect(letterPositions("A'B")).toEqual([0, 2]);
  });
});

describe('buildWords — the masking primitive', () => {
  const text = "DON'T STOP";

  it('emits no character at all for an unrevealed letter', () => {
    const words = buildWords(text, new Set());
    const json = JSON.stringify(words);
    for (const ch of 'DONTSP') expect(json).not.toContain(`"${ch}"`);
    // Not merely absent-valued — the key must not exist.
    for (const w of words) for (const c of w) if (c.t === 'letter') expect('ch' in c).toBe(false);
  });

  it('shows apostrophes and hyphens unmasked (§3.1)', () => {
    const words = buildWords(text, new Set());
    const punct = words.flat().filter((c) => c.t === 'punct');
    expect(punct).toHaveLength(1);
    expect(punct[0]).toMatchObject({ ch: "'" });
  });

  it('reveals every occurrence of a revealed letter', () => {
    const words = buildWords(text, new Set(['O']));
    const revealed = words.flat().filter((c) => c.t === 'letter' && c.revealed);
    expect(revealed).toHaveLength(2);
  });

  it('renders an accessible representation with underscores', () => {
    expect(accessibleBoardText(buildWords('AB CD', new Set(['A'])))).toBe('A _   _ _');
  });
});

describe('boardPattern — bot deduction', () => {
  it('matches the source phrase and rejects a same-shape phrase using a guessed letter', () => {
    const text = 'THE CAT SAT';
    const guessed = new Set(['T', 'H', 'E']);
    const words = buildWords(text, guessed);
    const re = boardPattern(words, guessed);
    expect(re.test(normalizePuzzleText(text))).toBe(true);
    // A hidden tile cannot be a guessed letter: a hit reveals every occurrence.
    expect(re.test('THE CAT TAT')).toBe(false);
  });

  it('with nothing guessed, matches only phrases of the same shape', () => {
    const words = buildWords('AB CD', new Set());
    const re = boardPattern(words, new Set());
    expect(re.test('XY ZW')).toBe(true);
    expect(re.test('XYZ W')).toBe(false);
    expect(re.test('XY ZWQ')).toBe(false);
  });

  it('escapes punctuation instead of treating it as regex syntax', () => {
    const words = buildWords('A.B CD', new Set(['A', 'B']));
    const re = boardPattern(words, new Set(['A', 'B']));
    expect(re.test('A.B XY')).toBe(true);
    expect(re.test('AQB XY')).toBe(false);
  });
});

describe('mergeBalance', () => {
  it('returns the defaults for a null override', () => {
    expect(mergeBalance(null)).toEqual(defaultBalance());
  });

  it('merges a leaf without disturbing its siblings', () => {
    const m = mergeBalance({ pressure: { max: 8 } });
    expect(m.pressure.max).toBe(8);
    expect(m.pressure.wrongLetter).toBe(BALANCE.pressure.wrongLetter);
    expect(m.scoring.solveBase).toBe(BALANCE.scoring.solveBase);
  });

  it('ignores unknown keys so a stale Firestore doc cannot inject garbage', () => {
    const m = mergeBalance({ nope: { whatever: 1 }, pressure: { bogus: 2 } } as never);
    expect((m as Record<string, unknown>).nope).toBeUndefined();
    expect((m.pressure as Record<string, unknown>).bogus).toBeUndefined();
  });

  it('rejects a type-mismatched leaf rather than corrupting the shape', () => {
    const m = mergeBalance({ pressure: { max: 'lots' } } as never);
    expect(m.pressure.max).toBe(BALANCE.pressure.max);
  });

  it('replaces arrays wholesale', () => {
    const m = mergeBalance({ turn: { allowedSeconds: [5, 30] } });
    expect(m.turn.allowedSeconds).toEqual([5, 30]);
  });

  it('does not mutate the module-level defaults', () => {
    const before = BALANCE.pressure.max;
    mergeBalance({ pressure: { max: 99 } });
    expect(BALANCE.pressure.max).toBe(before);
    expect(defaultBalance().pressure.max).toBe(before);
  });
});

describe('room codes (§6.6)', () => {
  it('accepts a pronounceable CVCV code and is case-insensitive', () => {
    expect(isValidRoomCode('KABO')).toBe(true);
    expect(isValidRoomCode('miru')).toBe(true);
  });

  it('rejects anything that is not CVCV', () => {
    for (const bad of ['KABOO', 'KAB', '1ABO', 'AKBO', 'KKBO', '']) {
      expect(isValidRoomCode(bad), bad).toBe(false);
    }
  });

  it('the alphabets are disjoint, so a code can only parse one way', () => {
    expect(CODE_CONSONANTS.filter((c) => CODE_VOWELS.includes(c))).toEqual([]);
  });

  it('excludes letters that sound alike over a phone', () => {
    // C/S, Q/K, W (three syllables), X and Y are all deliberately absent.
    for (const ch of ['C', 'Q', 'W', 'X', 'Y']) expect(CODE_CONSONANTS).not.toContain(ch);
  });
});

describe('bot personas (§5)', () => {
  it('returns distinct personas, preferring the requested tier', () => {
    const picked = pickPersonas(3, 'ruthless');
    expect(picked).toHaveLength(3);
    expect(new Set(picked.map((p) => p.name)).size).toBe(3);
    expect(picked.every((p) => p.flavorTier === 'ruthless')).toBe(true);
  });

  it('fills from other tiers when the requested one runs out', () => {
    const picked = pickPersonas(7, 'chill');
    expect(picked).toHaveLength(7);
    expect(new Set(picked.map((p) => p.name)).size).toBe(7);
  });

  it('skips names already taken by a seat', () => {
    const taken = new Set(['slush', 'fizz']);
    const picked = pickPersonas(BOT_PERSONAS.length, 'chill', taken);
    expect(picked.map((p) => p.name.toLowerCase())).not.toContain('slush');
    expect(picked.map((p) => p.name.toLowerCase())).not.toContain('fizz');
  });

  it('never returns more than it has', () => {
    expect(pickPersonas(99, 'sharp').length).toBe(BOT_PERSONAS.length);
  });
});
