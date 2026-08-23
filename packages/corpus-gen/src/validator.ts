/**
 * Deterministic corpus validator — design doc §4.3.
 *
 * NO LLM. Every rule here is a pure function of the candidate plus the corpus
 * already on disk, so `validate` re-run on the same inputs always returns the
 * same verdict. Each failure carries a named reason so the review queue tells a
 * human *why* something was pulled instead of just that it was.
 */
import { createHash } from 'node:crypto';
import {
  distinctLetters,
  letterStats,
  normalizeGuess,
  normalizePuzzleText,
  totalLetterCount,
} from '@phrasey/shared';
import { hashSeed, mulberry32, shuffle } from './rng.js';
import type { Candidate } from './types.js';
import { abstractWords, commonWords, profanityList, properNounAllowlist, properNounLexicon } from './wordlists.js';

// ---------------------------------------------------------------------------
// Thresholds — all in one place so they can be tuned from evidence, not vibes.
// ---------------------------------------------------------------------------

export const RULES = {
  MIN_LENGTH: 12,
  MAX_LENGTH: 60,
  /**
   * The band we actually want. §4.3's hard cap stays at 60 for the occasional
   * long one, but `generate` defaults to this so new material lands short:
   * a 40-character phrase is one you can complete from three letters, and a
   * 55-character one is a reading comprehension exercise.
   */
  TARGET_MAX_LENGTH: 44,
  MIN_WORDS: 3,
  MIN_DISTINCT_LETTERS: 6,
  HINT_MIN_LENGTH: 10,
  HINT_MAX_LENGTH: 90,
  /** Fraction of letter tiles the simulation reveals (§4.3). */
  REVEAL_FRACTION: 0.4,
  SOLVABILITY_TRIALS: 24,

  // --- guessability --------------------------------------------------------
  /**
   * Minimum share of a phrase's words that are on the bundled common-word list.
   * A board only gives you traction if you can *guess ahead*, and you cannot
   * guess ahead at vocabulary you do not own. Measured against the corpus and
   * against known-good phrases: ordinary English lands at 1.00, and a phrase
   * with one specialist word in six still reads fine, so the floor sits just
   * below that.
   */
  MIN_COMMON_WORD_FRACTION: 0.85,
  /**
   * ...and an absolute cap, because a long phrase can hide several rare words
   * behind a good-looking fraction. One unusual word is a flavour; two is a
   * phrase nobody completes.
   */
  MAX_UNCOMMON_WORDS: 1,

  // --- solvability ---------------------------------------------------------
  /**
   * Two commonest letters revealing more than this much of the board.
   *
   * Was 0.55, which was tuned to reject *easy* phrases back when the corpus
   * needed to be harder. It is now the wrong way round: E and T alone are ~20%
   * of written English, so on the 15-40 character phrases we now want, two
   * letters exposing half the board is simply what a familiar phrase looks
   * like — and it is exactly the "you get three letters and it clicks" moment
   * the game is for. Raised to 0.70, which still catches the degenerate case
   * of a phrase built from two repeated letters.
   */
  MAX_TWO_LETTER_COVERAGE: 0.7,
  /**
   * Secondary coverage bar, applied only when there is also almost nothing
   * left: high coverage is a giveaway when the remainder is unguessable-small,
   * not on its own. This pair is what "falls out from two letters" means.
   */
  ELEVATED_TWO_LETTER_COVERAGE: 0.55,
  MIN_HIDDEN_WHEN_ELEVATED: 6,
  /** ...and a floor on what is left after those two letters, whatever the coverage. */
  MIN_HIDDEN_AFTER_TWO: 3,
  /**
   * Share of long words fully exposed at the 40% mark. Was 0.5, which threw out
   * repetitive familiar material ("ROW ROW ROW YOUR BOAT", "BAA BAA BLACK
   * SHEEP") whose whole appeal is that the repetition makes it guessable.
   * Raised to 0.75; above that the board really does read itself out.
   */
  MAX_WORDS_EXPOSED_AT_40: 0.75,

  /** Token overlap with an existing entry sharing the same word-length shape. */
  NEAR_DUP_JACCARD_SAME_SHAPE: 0.6,
  /** Token overlap high enough to be a near-duplicate whatever the shape. */
  NEAR_DUP_JACCARD_ANY: 0.85,
} as const;

export const REJECTION_REASONS = [
  'LENGTH',
  'WORD_COUNT',
  'DISTINCT_LETTERS',
  'NON_ASCII',
  'DISALLOWED_PUNCTUATION',
  'PROPER_NOUN',
  'PROFANITY',
  'UNCOMMON_VOCABULARY',
  'DUPLICATE',
  'TRIVIALLY_SOLVABLE',
  'PATTERN_NEAR_DUPLICATE',
  'HINT_MISSING',
  'HINT_LENGTH',
  'HINT_NON_ASCII',
  'HINT_CHARSET',
  'HINT_PROFANITY',
  'HINT_PROPER_NOUN',
  'HINT_LEAKS_PHRASE',
] as const;

export type RejectionReason = (typeof REJECTION_REASONS)[number];

export interface Failure {
  reason: RejectionReason;
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  /** Canonical uppercase text — present even on failure, for the review queue. */
  text: string;
  hash: string;
  failures: Failure[];
}

// ---------------------------------------------------------------------------
// Character-level rules
// ---------------------------------------------------------------------------

/** A–Z, digits, space, and exactly the punctuation §4.3 permits. */
const ALLOWED_TEXT_RE = /^[A-Z0-9 '\-,.!?]+$/;
const ASCII_RE = /^[\x20-\x7E]*$/;
/** Hints are prose read off a card, not board text, so they get a wider set. */
const ALLOWED_HINT_RE = /^[A-Za-z0-9 '\-,.!?:;()&/]+$/;

function checkAscii(text: string, reason: 'NON_ASCII' | 'HINT_NON_ASCII', failures: Failure[]): void {
  if (!ASCII_RE.test(text)) {
    const bad = [...text].filter((c) => !ASCII_RE.test(c));
    failures.push({
      reason,
      detail: `non-ASCII character(s): ${[...new Set(bad)].map((c) => JSON.stringify(c)).join(', ')}`,
    });
  }
}

// ---------------------------------------------------------------------------
// Tokenizing
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'a','an','and','are','as','at','be','been','but','by','can','did','do','does','for','from',
  'had','has','have','he','her','him','his','how','i','if','in','is','it','its','just','me',
  'my','no','not','of','on','or','our','out','she','so','than','that','the','their','them',
  'then','there','these','they','this','to','up','us','was','we','were','what','when','who',
  'why','will','with','you','your','im','ive','dont','it’s','its','am','get','got','all',
]);

/** Words of a phrase, apostrophes and hyphens kept inside the token. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? []).map((t) => t.replace(/^'+|'+$/g, ''));
}

/** Crude suffix stripper — enough to catch DOOR/DOORS, WAIT/WAITING in a leak check. */
export function stem(word: string): string {
  let w = word.replace(/'s$/, '');
  for (const suf of ['ing', 'ies', 'ied', 'ed', 'es', 's']) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      w = w.slice(0, w.length - suf.length);
      break;
    }
  }
  return w;
}

function contentStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const t of tokenize(text)) {
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    out.add(stem(t));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Profanity
// ---------------------------------------------------------------------------

/** Whole-word match with a light suffix tolerance, plus a severe-substring pass. */
export function findProfanity(text: string): string[] {
  const { words, substrings, allow } = profanityList();
  const hits = new Set<string>();
  const lower = text.toLowerCase();
  for (const raw of tokenize(lower)) {
    if (allow.has(raw)) continue;
    // Deliberately NOT the aggressive stemmer: it turns SPICES into "spic".
    // Exact match, apostrophe-stripped, and a single trailing plural s.
    const bare = raw.replace(/'/g, '');
    const candidates = [raw, bare, bare.length >= 5 && bare.endsWith('s') ? bare.slice(0, -1) : bare];
    for (const c of candidates) {
      if (words.has(c)) {
        hits.add(c);
        break;
      }
    }
  }
  const squashed = lower.replace(/[^a-z]/g, '');
  for (const sub of substrings) {
    if (squashed.includes(sub)) hits.add(sub);
  }
  return [...hits].sort();
}

// ---------------------------------------------------------------------------
// Common vocabulary (guessability)
// ---------------------------------------------------------------------------

/**
 * Is this a word an ordinary player owns?
 *
 * The bundled list is stored in base forms, so the lookup has to undo the
 * inflection the phrase happens to use. Everything here is cheap string work:
 * exact, apostrophe-stripped, stemmed, then the three spelling repairs the
 * crude stemmer needs (doubled consonant, dropped silent e, -ies -> -y).
 * Hyphenated compounds pass when every part passes.
 */
export function isCommonWord(word: string): boolean {
  const { set } = commonWords();
  const w = word.toLowerCase();
  if (set.has(w)) return true;
  const bare = w.replace(/'/g, '');
  // A one-letter word ("A", "I", the U in "U TURN") is never the thing that
  // makes a phrase unguessable.
  if (bare.length <= 1) return true;
  if (set.has(bare)) return true;
  const s = stem(bare);
  if (set.has(s)) return true;
  if (/([a-z])\1$/.test(s) && set.has(s.slice(0, -1))) return true; // stopping -> stop
  if (set.has(`${s}e`)) return true; // making -> make
  if (set.has(`${s}y`)) return true; // tries -> try
  if (bare.includes('-')) return bare.split('-').every((part) => part.length < 2 || isCommonWord(part));
  return false;
}

/**
 * Frequency rank of a word, 1 = commonest. `Infinity` when it is not on the
 * list at all. Used by the difficulty scorer, which wants a gradient rather
 * than the in/out verdict the reject rule uses.
 */
export function wordRank(word: string): number {
  const { rank } = commonWords();
  const w = word.toLowerCase();
  const bare = w.replace(/'/g, '');
  const s = stem(bare);
  return Math.min(
    rank(w),
    rank(bare),
    rank(s),
    /([a-z])\1$/.test(s) ? rank(s.slice(0, -1)) : Number.POSITIVE_INFINITY,
    rank(`${s}e`),
    rank(`${s}y`),
  );
}

export interface VocabularyReport {
  words: number;
  /** Share of words on the common list. 1 = every word is ordinary English. */
  commonFraction: number;
  /** The words that are not, in order of appearance. */
  uncommon: string[];
  /** Share of words outside the top 3000 by frequency — the "reaching" measure. */
  rareBandFraction: number;
}

/** Frequency rank past which a word is common but not *instantly* available. */
export const RARE_BAND_RANK = 3000;

export function vocabularyReport(text: string): VocabularyReport {
  const words = tokenize(text).filter((w) => w.length > 0);
  if (words.length === 0) {
    return { words: 0, commonFraction: 1, uncommon: [], rareBandFraction: 0 };
  }
  const uncommon: string[] = [];
  let rareBand = 0;
  for (const w of words) {
    if (!isCommonWord(w)) uncommon.push(w);
    if (wordRank(w) > RARE_BAND_RANK) rareBand++;
  }
  return {
    words: words.length,
    commonFraction: (words.length - uncommon.length) / words.length,
    uncommon,
    rareBandFraction: rareBand / words.length,
  };
}

// ---------------------------------------------------------------------------
// Proper nouns
// ---------------------------------------------------------------------------

const SENTENCE_END = /[.!?]$/;

/**
 * Two detectors, because one is not enough:
 *  1. capitalization — only trustworthy while the ORIGINAL casing survives, so
 *     it is skipped for all-caps and all-lowercase text;
 *  2. a bundled lexicon of names, places, brands and franchises, which still
 *     works after the text has been uppercased into corpus form.
 * Anything on the explicit allowlist is dropped from the result (§4.3).
 */
export function findProperNouns(raw: string): string[] {
  const allowlist = properNounAllowlist();
  const lexicon = properNounLexicon();
  const hits = new Set<string>();

  const hasLower = /[a-z]/.test(raw);
  const hasUpper = /[A-Z]/.test(raw);
  const mixedCase = hasLower && hasUpper;

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (mixedCase) {
    let sentenceStart = true;
    for (const tok of tokens) {
      const word = tok.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
      const bare = word.replace(/'s$/i, '').replace(/'/g, '');
      if (bare) {
        const isTitle = /^[A-Z][a-z]/.test(bare);
        const isAcronym = /^[A-Z]{2,}$/.test(bare);
        if ((isTitle && !sentenceStart) || isAcronym) {
          const key = bare.toLowerCase();
          if (!allowlist.has(key)) hits.add(key);
        }
      }
      sentenceStart = SENTENCE_END.test(tok);
    }
  }

  const words = tokenize(raw);
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    const key = w.replace(/'s$/, '');
    if (!allowlist.has(key) && lexicon.has(key)) hits.add(key);
    const next = words[i + 1];
    if (next) {
      const bigram = `${key} ${next.replace(/'s$/, '')}`;
      if (!allowlist.has(bigram) && lexicon.has(bigram)) hits.add(bigram);
    }
  }

  return [...hits].sort();
}

// ---------------------------------------------------------------------------
// Solvability simulation (§4.3)
// ---------------------------------------------------------------------------

export interface SolvabilityReport {
  totalTiles: number;
  /** Share of tiles the two most frequent letters reveal on their own. */
  twoLetterCoverage: number;
  hiddenAfterTwo: number;
  /** Mean letters needed to hit the 40% reveal mark, across trials. */
  meanLettersTo40: number;
  /** Mean share of 3+ letter words fully exposed once 40% of tiles are up. */
  meanWordsExposedAt40: number;
}

/**
 * Simulates a round's worth of random letter reveals. Deterministic: the RNG is
 * seeded from the phrase, so the same phrase always yields the same report.
 */
export function simulateSolvability(text: string, trials = RULES.SOLVABILITY_TRIALS): SolvabilityReport {
  const norm = normalizePuzzleText(text);
  const stats = letterStats(norm);
  const total = totalLetterCount(norm);
  const letters = Object.keys(stats);
  const longWords = norm
    .split(' ')
    .map((w) => [...w].filter((c) => /[A-Z]/.test(c)))
    .filter((w) => w.length >= 3);

  if (total === 0 || letters.length === 0) {
    return {
      totalTiles: 0,
      twoLetterCoverage: 1,
      hiddenAfterTwo: 0,
      meanLettersTo40: 0,
      meanWordsExposedAt40: 1,
    };
  }

  const byFreq = [...letters].sort((a, b) => (stats[b] ?? 0) - (stats[a] ?? 0) || a.localeCompare(b));
  const topTwo = byFreq.slice(0, 2);
  const twoCount = topTwo.reduce((n, l) => n + (stats[l] ?? 0), 0);

  const target = Math.ceil(total * RULES.REVEAL_FRACTION);
  const rng = mulberry32(hashSeed(norm));
  let lettersSum = 0;
  let exposedSum = 0;

  for (let t = 0; t < trials; t++) {
    const order = shuffle([...letters], rng);
    const revealed = new Set<string>();
    let shown = 0;
    let used = 0;
    for (const l of order) {
      if (shown >= target) break;
      revealed.add(l);
      shown += stats[l] ?? 0;
      used++;
    }
    lettersSum += used;
    if (longWords.length > 0) {
      const exposed = longWords.filter((w) => w.every((c) => revealed.has(c))).length;
      exposedSum += exposed / longWords.length;
    }
  }

  return {
    totalTiles: total,
    twoLetterCoverage: twoCount / total,
    hiddenAfterTwo: total - twoCount,
    meanLettersTo40: lettersSum / trials,
    meanWordsExposedAt40: longWords.length === 0 ? 1 : exposedSum / trials,
  };
}

// ---------------------------------------------------------------------------
// Corpus index — dedupe and near-duplicate patterns
// ---------------------------------------------------------------------------

/** Normalized hash: letters and digits only, so punctuation drift can't hide a dupe. */
export function normalizedHash(text: string): string {
  return createHash('sha256').update(normalizeGuess(text)).digest('hex').slice(0, 16);
}

/** Word-length shape, e.g. "3-2-5" — what the board looks like before any reveal. */
export function shapeSignature(text: string): string {
  return normalizePuzzleText(text)
    .split(' ')
    .filter(Boolean)
    .map((w) => [...w].filter((c) => /[A-Z0-9]/.test(c)).length)
    .join('-');
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

interface IndexRow {
  text: string;
  shape: string;
  stems: Set<string>;
}

/** Everything already in the corpus, in the shape the dedupe rules need. */
export class CorpusIndex {
  private hashes = new Set<string>();
  private rows: IndexRow[] = [];

  static from(texts: Iterable<string>): CorpusIndex {
    const idx = new CorpusIndex();
    for (const t of texts) idx.add(t);
    return idx;
  }

  add(text: string): void {
    this.hashes.add(normalizedHash(text));
    this.rows.push({
      text: normalizePuzzleText(text),
      shape: shapeSignature(text),
      stems: contentStems(text),
    });
  }

  hasHash(hash: string): boolean {
    return this.hashes.has(hash);
  }

  get size(): number {
    return this.rows.length;
  }

  /** The closest existing entry that is too close to tell apart on a board. */
  nearDuplicate(text: string): { text: string; overlap: number; sameShape: boolean } | null {
    const shape = shapeSignature(text);
    const stems = contentStems(text);
    let best: { text: string; overlap: number; sameShape: boolean } | null = null;
    for (const row of this.rows) {
      const overlap = jaccard(stems, row.stems);
      const sameShape = row.shape === shape;
      const limit = sameShape ? RULES.NEAR_DUP_JACCARD_SAME_SHAPE : RULES.NEAR_DUP_JACCARD_ANY;
      if (overlap >= limit && (!best || overlap > best.overlap)) {
        best = { text: row.text, overlap, sameShape };
      }
    }
    return best;
  }
}

// ---------------------------------------------------------------------------
// The validator
// ---------------------------------------------------------------------------

export interface ValidateOptions {
  /** Existing corpus to dedupe against. Omit for a standalone check. */
  index?: CorpusIndex;
  /**
   * Overrides `RULES.MAX_LENGTH`. `generate` passes `TARGET_MAX_LENGTH` so new
   * material lands in the short, guessable band, while re-validating what is
   * already committed keeps §4.3's 60-character hard cap.
   */
  maxLength?: number;
  /**
   * Overrides `RULES.MIN_COMMON_WORD_FRACTION` / `MAX_UNCOMMON_WORDS`.
   *
   * Categories whose whole point is a *named* thing — a film title, a nursery
   * rhyme — are familiar because the title is famous, not because its words are
   * frequent. "ITSY BITSY SPIDER" is instantly guessable and scores 0.33 on a
   * frequency list. Those categories declare a lower floor in their brief.
   */
  commonWordFloor?: number;
  maxUncommonWords?: number;
}

export function validateCandidate(candidate: Candidate, opts: ValidateOptions = {}): ValidationResult {
  const failures: Failure[] = [];
  const raw = (candidate.raw ?? '').trim();
  const text = normalizePuzzleText(raw);
  const hint = (candidate.hint ?? '').trim();
  const hash = normalizedHash(text);

  // --- phrase: shape -------------------------------------------------------
  const maxLength = opts.maxLength ?? RULES.MAX_LENGTH;
  if (text.length < RULES.MIN_LENGTH || text.length > maxLength) {
    failures.push({
      reason: 'LENGTH',
      detail: `${text.length} chars, need ${RULES.MIN_LENGTH}-${maxLength}`,
    });
  }

  const words = text.split(' ').filter(Boolean);
  if (words.length < RULES.MIN_WORDS) {
    failures.push({ reason: 'WORD_COUNT', detail: `${words.length} words, need >= ${RULES.MIN_WORDS}` });
  }

  const distinct = distinctLetters(text);
  if (distinct.length < RULES.MIN_DISTINCT_LETTERS) {
    failures.push({
      reason: 'DISTINCT_LETTERS',
      detail: `${distinct.length} distinct letters, need >= ${RULES.MIN_DISTINCT_LETTERS}`,
    });
  }

  // --- phrase: characters --------------------------------------------------
  checkAscii(text, 'NON_ASCII', failures);
  if (text.length > 0 && !ALLOWED_TEXT_RE.test(text)) {
    const bad = [...new Set([...text].filter((c) => !/[A-Z0-9 '\-,.!?]/.test(c)))];
    failures.push({
      reason: 'DISALLOWED_PUNCTUATION',
      detail: `disallowed character(s): ${bad.map((c) => JSON.stringify(c)).join(', ')}`,
    });
  }

  // --- phrase: content -----------------------------------------------------
  const properNouns = findProperNouns(raw);
  if (properNouns.length > 0) {
    failures.push({ reason: 'PROPER_NOUN', detail: `proper noun(s) not on the allowlist: ${properNouns.join(', ')}` });
  }

  const profane = findProfanity(raw);
  if (profane.length > 0) {
    failures.push({ reason: 'PROFANITY', detail: `profanity: ${profane.join(', ')}` });
  }

  // --- phrase: guessable vocabulary ----------------------------------------
  const vocab = vocabularyReport(text);
  const floor = opts.commonWordFloor ?? RULES.MIN_COMMON_WORD_FRACTION;
  const uncommonCap = opts.maxUncommonWords ?? RULES.MAX_UNCOMMON_WORDS;
  if (vocab.words > 0 && (vocab.commonFraction < floor - 1e-9 || vocab.uncommon.length > uncommonCap)) {
    failures.push({
      reason: 'UNCOMMON_VOCABULARY',
      detail:
        `${Math.round(vocab.commonFraction * 100)}% common words (floor ${Math.round(floor * 100)}%), ` +
        `${vocab.uncommon.length} outside the list (cap ${uncommonCap}): ${vocab.uncommon.join(', ')}`,
    });
  }

  // --- phrase: dedupe ------------------------------------------------------
  const index = opts.index;
  if (index) {
    if (index.hasHash(hash)) {
      failures.push({ reason: 'DUPLICATE', detail: `normalized hash ${hash} already in corpus` });
    } else {
      const near = index.nearDuplicate(text);
      if (near) {
        failures.push({
          reason: 'PATTERN_NEAR_DUPLICATE',
          detail: `${Math.round(near.overlap * 100)}% word overlap with "${near.text}"${near.sameShape ? ' (identical board shape)' : ''}`,
        });
      }
    }
  }

  // --- phrase: solvability -------------------------------------------------
  //
  // "Trivially solvable" now means the board is HANDED OVER by two cards, not
  // merely that it is easy. Coverage alone is no longer disqualifying — it is
  // disqualifying together with there being nothing left to deduce.
  const sim = simulateSolvability(text);
  if (sim.totalTiles > 0) {
    const elevated =
      sim.twoLetterCoverage > RULES.ELEVATED_TWO_LETTER_COVERAGE &&
      sim.hiddenAfterTwo < RULES.MIN_HIDDEN_WHEN_ELEVATED;
    if (sim.twoLetterCoverage > RULES.MAX_TWO_LETTER_COVERAGE) {
      failures.push({
        reason: 'TRIVIALLY_SOLVABLE',
        detail: `two commonest letters expose ${Math.round(sim.twoLetterCoverage * 100)}% of tiles`,
      });
    } else if (sim.hiddenAfterTwo < RULES.MIN_HIDDEN_AFTER_TWO) {
      failures.push({
        reason: 'TRIVIALLY_SOLVABLE',
        detail: `only ${sim.hiddenAfterTwo} tiles left hidden after two letters`,
      });
    } else if (elevated) {
      failures.push({
        reason: 'TRIVIALLY_SOLVABLE',
        detail:
          `two commonest letters expose ${Math.round(sim.twoLetterCoverage * 100)}% of tiles ` +
          `and leave only ${sim.hiddenAfterTwo} hidden`,
      });
    } else if (sim.meanWordsExposedAt40 > RULES.MAX_WORDS_EXPOSED_AT_40) {
      failures.push({
        reason: 'TRIVIALLY_SOLVABLE',
        detail: `${Math.round(sim.meanWordsExposedAt40 * 100)}% of long words fully exposed at a 40% reveal`,
      });
    }
  }

  // --- hint ----------------------------------------------------------------
  if (!hint) {
    failures.push({ reason: 'HINT_MISSING', detail: 'no hint supplied' });
  } else {
    if (hint.length < RULES.HINT_MIN_LENGTH || hint.length > RULES.HINT_MAX_LENGTH) {
      failures.push({
        reason: 'HINT_LENGTH',
        detail: `hint is ${hint.length} chars, need ${RULES.HINT_MIN_LENGTH}-${RULES.HINT_MAX_LENGTH}`,
      });
    }
    checkAscii(hint, 'HINT_NON_ASCII', failures);
    if (!ALLOWED_HINT_RE.test(hint)) {
      const bad = [...new Set([...hint].filter((c) => !/[A-Za-z0-9 '\-,.!?:;()&/]/.test(c)))];
      failures.push({
        reason: 'HINT_CHARSET',
        detail: `disallowed character(s) in hint: ${bad.map((c) => JSON.stringify(c)).join(', ')}`,
      });
    }
    const hintProfane = findProfanity(hint);
    if (hintProfane.length > 0) {
      failures.push({ reason: 'HINT_PROFANITY', detail: `profanity in hint: ${hintProfane.join(', ')}` });
    }
    const hintProper = findProperNouns(hint);
    if (hintProper.length > 0) {
      failures.push({ reason: 'HINT_PROPER_NOUN', detail: `proper noun(s) in hint: ${hintProper.join(', ')}` });
    }
    const leaked = leakedWords(text, hint);
    if (leaked.length > 0) {
      failures.push({ reason: 'HINT_LEAKS_PHRASE', detail: `hint reuses phrase word(s): ${leaked.join(', ')}` });
    }
  }

  return { ok: failures.length === 0, text, hash, failures };
}

/**
 * A hint must not contain any word from the phrase. Compared on stems so
 * DOORS/door and WAIT/waiting both count, and stopwords are ignored — a hint
 * that says "the" is not giving anything away.
 */
export function leakedWords(text: string, hint: string): string[] {
  const phrase = contentStems(text);
  const out = new Set<string>();
  for (const t of tokenize(hint)) {
    if (t.length < 3 || STOPWORDS.has(t)) continue;
    if (phrase.has(stem(t))) out.add(t);
  }
  return [...out].sort();
}

// ---------------------------------------------------------------------------
// Difficulty
// ---------------------------------------------------------------------------

/** The four letters §3.2 keeps out of the noise pool entirely. */
const RARE_LETTERS = new Set(['J', 'Q', 'X', 'Z']);
/** Awkward but not exotic — a K or a V costs you a turn, not a round. */
const AWKWARD_LETTERS = new Set(['K', 'V', 'W', 'F', 'B']);

export interface DifficultyReport {
  difficulty: 1 | 2 | 3;
  score: number;
  reasons: string[];
  length: number;
  tiles: number;
  distinctLetters: number;
  commonFraction: number;
  rareBandFraction: number;
}

/**
 * Difficulty 1–3, derived from what actually makes a board hard to *guess*
 * rather than from length alone.
 *
 * Four inputs, in the order they matter at the table:
 *
 *  1. **Vocabulary.** A word you do not own cannot be guessed ahead, only
 *     spelled out one card at a time. This is the dominant term.
 *  2. **Length.** More tiles is more board to fill before the shape reads.
 *  3. **Distinct letters.** A wide alphabet means each card you hold covers
 *     less of the board, so deduction converges more slowly.
 *  4. **Rare letters.** J/Q/X/Z are excluded from the deck's noise pool
 *     (§3.2), so a phrase containing one can sit unsolved waiting for it.
 *
 * The bands are deliberately generous at the easy end: after the playtest
 * feedback the corpus is supposed to *skew* easy/medium, and a scorer that
 * calls everything a 2 tells nobody anything.
 */
export interface DifficultyOptions {
  /**
   * The phrase is recognized as a whole rather than word by word — a title, a
   * proverb, a nursery rhyme. Suppresses the vocabulary term: "BAA BAA BLACK
   * SHEEP" is not hard because "baa" is not on a frequency list.
   */
  recalled?: boolean;
}

export function difficultyReport(text: string, opts: DifficultyOptions = {}): DifficultyReport {
  const norm = normalizePuzzleText(text);
  const distinct = distinctLetters(norm);
  const tiles = totalLetterCount(norm);
  const vocab = vocabularyReport(norm);
  const reasons: string[] = [];
  let score = 0;

  const add = (n: number, why: string) => {
    score += n;
    reasons.push(`+${n} ${why}`);
  };

  // 1. vocabulary
  if (!opts.recalled) {
    if (vocab.uncommon.length >= 1) add(2, `unfamiliar word(s): ${vocab.uncommon.join(', ')}`);
    if (vocab.rareBandFraction > 0.34) {
      add(1, `${Math.round(vocab.rareBandFraction * 100)}% of words outside the top ${RARE_BAND_RANK}`);
    }
  }

  // 2. length
  if (norm.length >= 30) add(1, 'over 30 characters');
  if (norm.length >= 44) add(1, 'over 44 characters');

  // 3. alphabet width
  if (distinct.length >= 14) add(1, `${distinct.length} distinct letters`);
  if (distinct.length >= 18) add(1, `${distinct.length} distinct letters`);

  // 4. awkward letters
  const rare = distinct.filter((l) => RARE_LETTERS.has(l));
  const awkward = distinct.filter((l) => AWKWARD_LETTERS.has(l));
  // §3.2 excludes J/Q/X/Z from the noise pool only when the puzzle does not
  // contain them, so a phrase with an X still gets X's dealt from the 65%
  // puzzle-letter share. The cost is a slower find, not a dead board — one
  // point, and a second only when there are several.
  if (rare.length > 0) add(1, `contains ${rare.join('/')}, thin in the deck's noise pool`);
  if (rare.length >= 2) add(1, `several deck-thin letters: ${rare.join('/')}`);
  if (awkward.length >= 3) add(1, `awkward letters ${awkward.join('/')}`);

  const difficulty: 1 | 2 | 3 = score <= 2 ? 1 : score <= 5 ? 2 : 3;
  return {
    difficulty,
    score,
    reasons,
    length: norm.length,
    tiles,
    distinctLetters: distinct.length,
    commonFraction: vocab.commonFraction,
    rareBandFraction: vocab.rareBandFraction,
  };
}

export function deriveDifficulty(text: string, opts: DifficultyOptions = {}): 1 | 2 | 3 {
  return difficultyReport(text, opts).difficulty;
}

// ---------------------------------------------------------------------------
// Triage — the abstract tail
// ---------------------------------------------------------------------------

/**
 * Why an already-valid entry might still not be worth guessing.
 *
 * This is deliberately NOT a validator rule. Everything here passes `validate`;
 * it is a shortlist for a human, and the entries it names are moved to the
 * review queue rather than deleted — they are a plausible "hard mode" set later
 * (§4.3 keeps rejects for a skim for exactly this reason).
 */
export interface TriageVerdict {
  flagged: boolean;
  reasons: string[];
}

export interface TriageOptions {
  /** Entries longer than this are too much board to fill. */
  maxLength?: number;
  /** Entries scoring above this on the new difficulty derivation. */
  maxDifficulty?: 1 | 2 | 3;
  /** Look for the surreal-tautology tell and abstract vocabulary. */
  checkRegister?: boolean;
  /** See `DifficultyOptions.recalled`. Also turns the register checks off. */
  recalled?: boolean;
}

/**
 * The tautology tell: a content word repeated inside one short phrase.
 *
 * This is the signature of the register the corpus is moving away from — "THE
 * DEPOSIT WAS FOR THE DEPOSIT", "INVERT THE TRAY BEFORE THE TRAY EXISTS",
 * "REMOVE ALL PARTS BEFORE REMOVING ANY PARTS". They read as jokes and play as
 * dead ends, because the repetition is the whole content and there is nothing
 * to deduce toward.
 */
export function repeatedContentWords(text: string): string[] {
  const seen = new Map<string, number>();
  for (const t of tokenize(text)) {
    if (t.length < 4 || STOPWORDS.has(t)) continue;
    const key = stem(t);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, n]) => n > 1)
    .map(([w]) => w)
    .sort();
}

/** Abstract nouns present in the phrase, from the advisory bundled list. */
export function abstractVocabulary(text: string): string[] {
  const list = abstractWords();
  const hits = new Set<string>();
  for (const t of tokenize(text)) {
    const bare = t.replace(/'/g, '');
    if (list.has(bare) || list.has(stem(bare))) hits.add(bare);
  }
  return [...hits].sort();
}

export function triage(text: string, opts: TriageOptions = {}): TriageVerdict {
  const { maxLength = RULES.TARGET_MAX_LENGTH, maxDifficulty = 2, recalled = false } = opts;
  // Repetition is a smell in an invented line and the point of a remembered
  // one, so the register checks never run against recalled material.
  const checkRegister = (opts.checkRegister ?? true) && !recalled;
  const norm = normalizePuzzleText(text);
  const reasons: string[] = [];

  if (norm.length > maxLength) {
    reasons.push(`TOO_LONG: ${norm.length} chars, target band tops out at ${maxLength}`);
  }
  const d = difficultyReport(norm, { recalled });
  if (d.difficulty > maxDifficulty) {
    reasons.push(`TOO_HARD: difficulty ${d.difficulty} (${d.reasons.join('; ')})`);
  }
  if (checkRegister) {
    const repeated = repeatedContentWords(norm);
    if (repeated.length > 0) {
      reasons.push(`SELF_REFERENTIAL: repeats "${repeated.join('", "')}" - the surreal-tautology shape, funny to read and dead to guess`);
    }
    const abstract = abstractVocabulary(norm);
    if (abstract.length > 0) {
      reasons.push(`ABSTRACT_VOCABULARY: ${abstract.join(', ')}`);
    }
  }

  return { flagged: reasons.length > 0, reasons };
}
