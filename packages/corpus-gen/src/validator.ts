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
import { profanityList, properNounAllowlist, properNounLexicon } from './wordlists.js';

// ---------------------------------------------------------------------------
// Thresholds — all in one place so they can be tuned from evidence, not vibes.
// ---------------------------------------------------------------------------

export const RULES = {
  MIN_LENGTH: 12,
  MAX_LENGTH: 60,
  MIN_WORDS: 3,
  MIN_DISTINCT_LETTERS: 6,
  HINT_MIN_LENGTH: 10,
  HINT_MAX_LENGTH: 90,
  /** Fraction of letter tiles the simulation reveals (§4.3). */
  REVEAL_FRACTION: 0.4,
  SOLVABILITY_TRIALS: 24,
  /** Two most common letters revealing more than this much of the board is a giveaway. */
  MAX_TWO_LETTER_COVERAGE: 0.55,
  /** ...as is having almost nothing left hidden after those two letters. */
  MIN_HIDDEN_AFTER_TWO: 4,
  /** Share of long words fully exposed at the 40% mark before the board reads itself out. */
  MAX_WORDS_EXPOSED_AT_40: 0.5,
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
}

export function validateCandidate(candidate: Candidate, opts: ValidateOptions = {}): ValidationResult {
  const failures: Failure[] = [];
  const raw = (candidate.raw ?? '').trim();
  const text = normalizePuzzleText(raw);
  const hint = (candidate.hint ?? '').trim();
  const hash = normalizedHash(text);

  // --- phrase: shape -------------------------------------------------------
  if (text.length < RULES.MIN_LENGTH || text.length > RULES.MAX_LENGTH) {
    failures.push({
      reason: 'LENGTH',
      detail: `${text.length} chars, need ${RULES.MIN_LENGTH}-${RULES.MAX_LENGTH}`,
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
  const sim = simulateSolvability(text);
  if (sim.totalTiles > 0) {
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

const RARE_LETTERS = new Set(['J', 'Q', 'X', 'Z', 'K', 'V', 'W', 'Y']);

/**
 * Difficulty 1–3, derived from phrase length, distinct-letter count and the
 * presence of rare letters. Longer phrases with a wide alphabet and awkward
 * letters take more of the board to crack.
 */
export function deriveDifficulty(text: string): 1 | 2 | 3 {
  const norm = normalizePuzzleText(text);
  const distinct = distinctLetters(norm);
  const tiles = totalLetterCount(norm);
  let score = 0;
  if (norm.length >= 30) score += 1;
  if (norm.length >= 45) score += 1;
  if (distinct.length >= 13) score += 1;
  if (distinct.length >= 17) score += 1;
  if (distinct.some((l) => RARE_LETTERS.has(l))) score += 1;
  if (tiles >= 40) score += 1;
  if (score <= 1) return 1;
  if (score <= 3) return 2;
  return 3;
}
