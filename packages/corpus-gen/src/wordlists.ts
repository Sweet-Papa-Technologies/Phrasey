/** Loads the bundled wordlists from `data/`. Read once, cached. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from './paths.js';

interface ProfanityFile {
  words: string[];
  substrings: string[];
  allow: string[];
}
interface ProperNounFile {
  names: string[];
  places: string[];
  brands: string[];
  franchises: string[];
}
interface AllowlistFile {
  allow: string[];
}
interface CommonWordFile {
  /** Descending frequency order — the array index IS the frequency rank. */
  core: string[];
  everyday: string[];
  contractions: string[];
}

function load<T>(name: string): T {
  return JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8')) as T;
}

let profanityCache: { words: Set<string>; substrings: string[]; allow: Set<string> } | null = null;

export function profanityList() {
  if (!profanityCache) {
    const f = load<ProfanityFile>('profanity.json');
    profanityCache = {
      words: new Set(f.words.map((w) => w.toLowerCase())),
      substrings: f.substrings.map((w) => w.toLowerCase()),
      allow: new Set(f.allow.map((w) => w.toLowerCase())),
    };
  }
  return profanityCache;
}

let properNounCache: Set<string> | null = null;

/** Every known proper noun, flattened and lowercased. Multi-word entries kept as-is. */
export function properNounLexicon(): Set<string> {
  if (!properNounCache) {
    const f = load<ProperNounFile>('proper-nouns.json');
    properNounCache = new Set(
      [...f.names, ...f.places, ...f.brands, ...f.franchises].map((w) => w.toLowerCase()),
    );
  }
  return properNounCache;
}

let allowlistCache: Set<string> | null = null;

/** The explicit proper-noun allowlist (design doc §4.3). */
export function properNounAllowlist(): Set<string> {
  if (!allowlistCache) {
    const f = load<AllowlistFile>('proper-noun-allowlist.json');
    allowlistCache = new Set(f.allow.map((w) => w.toLowerCase()));
  }
  return allowlistCache;
}

/**
 * Rank assigned to a word that is on the hand-authored everyday supplement but
 * not in the frequency-ranked core. The supplement is ordinary modern
 * vocabulary the 1900s source texts simply predate ("microwave", "voicemail"),
 * so it is scored as solidly common rather than rare.
 */
export const EVERYDAY_RANK = 2500;

let abstractCache: Set<string> | null = null;

/**
 * Vocabulary that marks the abstract register the corpus is moving away from.
 * Advisory only — `triage` uses it to shortlist entries for a human, and no
 * validator rule fires on it.
 */
export function abstractWords(): Set<string> {
  if (!abstractCache) {
    const f = load<{ words: string[] }>('abstract-words.json');
    abstractCache = new Set(f.words.map((w) => w.toLowerCase()));
  }
  return abstractCache;
}

export interface CommonWords {
  /** Every listed word, plus the stem of every listed word. */
  set: Set<string>;
  /** Frequency rank, 1 = commonest. `Infinity` for a word not on any list. */
  rank(word: string): number;
  coreCount: number;
  size: number;
}

let commonCache: CommonWords | null = null;

/** Suffix stripper shared with the validator — kept here to avoid a cycle. */
function crudeStem(word: string): string {
  let w = word.replace(/'s$/, '');
  for (const suf of ['ing', 'ies', 'ied', 'ed', 'es', 's']) {
    if (w.length - suf.length >= 3 && w.endsWith(suf)) {
      w = w.slice(0, w.length - suf.length);
      break;
    }
  }
  return w;
}

/** The bundled common-vocabulary list, indexed for membership and for rank. */
export function commonWords(): CommonWords {
  if (!commonCache) {
    const f = load<CommonWordFile>('common-words.json');
    const ranks = new Map<string, number>();
    f.core.forEach((w, i) => {
      if (!ranks.has(w)) ranks.set(w, i + 1);
    });
    for (const w of [...f.everyday, ...f.contractions]) {
      if (!ranks.has(w)) ranks.set(w, EVERYDAY_RANK);
    }
    // Stems are indexed too, so a listed plural covers its singular and vice
    // versa: the list has "customers" but not "customer", and both are common.
    const set = new Set(ranks.keys());
    for (const [w, r] of [...ranks]) {
      const s = crudeStem(w);
      if (s.length >= 3 && !ranks.has(s)) {
        ranks.set(s, r);
        set.add(s);
      }
    }
    commonCache = {
      set,
      rank: (word: string) => ranks.get(word) ?? Number.POSITIVE_INFINITY,
      coreCount: f.core.length,
      size: set.size,
    };
  }
  return commonCache;
}

/** Test seam — drops the caches so a test can swap the data directory. */
export function __resetWordlistCaches(): void {
  profanityCache = null;
  properNounCache = null;
  allowlistCache = null;
  commonCache = null;
  abstractCache = null;
}
