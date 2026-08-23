/**
 * Room codes (§6.6): 4 characters, consonant-vowel-consonant-vowel, so they are
 * pronounceable over Zoom. "KABO", "MIRU".
 *
 * The alphabet and the pattern are frozen in @phrasey/shared; this module only
 * generates and screens. 16 consonants x 5 vowels x 16 x 5 = 6400 codes, which
 * is plenty for a single-instance party server and small enough that collision
 * handling has to be real rather than probabilistic.
 */
import { randomInt } from 'node:crypto';
import { CODE_CONSONANTS, CODE_VOWELS, ROOM_CODE_PATTERN, ROOM_KEY_ALPHABET, ROOM_KEY_LENGTH } from '@phrasey/shared';
import { isProfaneCode } from './profanity.js';

/**
 * The room key — the part that is actually a secret.
 *
 * Generated with a CSPRNG, not Math.random: the code space is small enough to
 * enumerate, so the key is the only thing standing between a stranger and
 * someone's game. 31^4 is ~923k, and joins are rate limited, which is the
 * "lightweight" part — this is a party game, not a bank.
 */
export function generateRoomKey(): string {
  let out = '';
  for (let i = 0; i < ROOM_KEY_LENGTH; i++) {
    out += ROOM_KEY_ALPHABET[randomInt(ROOM_KEY_ALPHABET.length)];
  }
  return out;
}

/**
 * Constant-time-ish comparison. The timing signal on a 4-char key is not a
 * realistic attack, but comparing credentials with === is a habit worth not
 * having.
 */
export function keyMatches(expected: string, given: string | undefined): boolean {
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.toUpperCase().charCodeAt(i);
  return diff === 0;
}

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
