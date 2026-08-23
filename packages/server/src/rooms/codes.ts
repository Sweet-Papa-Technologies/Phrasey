/**
 * Room codes (§6.6): 4 characters, consonant-vowel-consonant-vowel, so they are
 * pronounceable over Zoom. "KABO", "MIRU".
 *
 * The alphabet and the pattern are frozen in @phrasey/shared; this module only
 * generates and screens. 16 consonants x 5 vowels x 16 x 5 = 6400 codes, which
 * is plenty for a single-instance party server and small enough that collision
 * handling has to be real rather than probabilistic.
 */
import { CODE_CONSONANTS, CODE_VOWELS, ROOM_CODE_PATTERN } from '@phrasey/shared';
import { isProfaneCode } from './profanity.js';

export const TOTAL_CODES = CODE_CONSONANTS.length * CODE_VOWELS.length * CODE_CONSONANTS.length * CODE_VOWELS.length;

export function isWellFormedCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}

/** A code is usable if it is CVCV, not profane, and not already in use. */
export function isUsableCode(code: string, taken: ReadonlySet<string>): boolean {
  return isWellFormedCode(code) && !isProfaneCode(code) && !taken.has(code);
}

function build(rand: () => number): string {
  const c = () => CODE_CONSONANTS[Math.floor(rand() * CODE_CONSONANTS.length)] as string;
  const v = () => CODE_VOWELS[Math.floor(rand() * CODE_VOWELS.length)] as string;
  return `${c()}${v()}${c()}${v()}`;
}

/**
 * Generate an unused, non-profane code.
 *
 * Random attempts first (cheap, no ordering bias), then an exhaustive scan so
 * the function is total: with 6400 codes, "the space is nearly full" is a
 * reachable state and silently returning a duplicate would corrupt rooms.
 */
export function generateRoomCode(taken: ReadonlySet<string>, rand: () => number = Math.random): string {
  for (let i = 0; i < 200; i++) {
    const code = build(rand);
    if (isUsableCode(code, taken)) return code;
  }
  const start = Math.floor(rand() * TOTAL_CODES);
  for (let n = 0; n < TOTAL_CODES; n++) {
    const code = codeAt((start + n) % TOTAL_CODES);
    if (isUsableCode(code, taken)) return code;
  }
  throw new Error('room code space exhausted');
}

/** Deterministic enumeration of the code space, used by the exhaustive scan. */
export function codeAt(n: number): string {
  const nv = CODE_VOWELS.length;
  const nc = CODE_CONSONANTS.length;
  const v2 = n % nv;
  const c2 = Math.floor(n / nv) % nc;
  const v1 = Math.floor(n / (nv * nc)) % nv;
  const c1 = Math.floor(n / (nv * nc * nv)) % nc;
  return `${CODE_CONSONANTS[c1]}${CODE_VOWELS[v1]}${CODE_CONSONANTS[c2]}${CODE_VOWELS[v2]}`;
}
