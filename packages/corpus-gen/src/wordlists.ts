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

/** Test seam — drops the caches so a test can swap the data directory. */
export function __resetWordlistCaches(): void {
  profanityCache = null;
  properNounCache = null;
  allowlistCache = null;
}
