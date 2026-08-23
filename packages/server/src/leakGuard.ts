/**
 * The adversarial half of the masking rule (§6.2, §15).
 *
 * `maskBoard()` is the boundary; this is the tripwire that proves the boundary
 * held. It deep-scans a payload that is about to hit a socket and throws if it
 * can find the answer, or a letter that is still face-down, anywhere in it —
 * including inside `board:update.events`, which is the payload most likely to
 * carry something the masker never saw.
 *
 * It is on by default outside production (`LEAK_GUARD=0` to disable, `=1` to
 * force it on in production). The tests run it against every emit.
 *
 * A round that has ENDED is exempt: `RoundResult.answer` is sanctioned then
 * (§ types.ts) and the board has been flipped face-up anyway.
 */
import type { GameEvent, Letter } from '@phrasey/shared';
import { normalizeGuess } from '@phrasey/shared';
import { hiddenDistinctLetters, type GameState } from '@phrasey/engine';

export class LeakError extends Error {
  constructor(
    message: string,
    readonly event: string,
    readonly path: string,
  ) {
    super(message);
    this.name = 'LeakError';
  }
}

export interface Secrets {
  /** Normalized answer, letters and digits only. */
  answer: string;
  /** Letters that are still face-down on the board right now. */
  hidden: Letter[];
  /** null once CRACK has been played — the hint is public from then on. */
  hint: string | null;
}

/**
 * Narrow a secret set for ONE recipient.
 *
 * A tile this player bought with PEEK is theirs by the rules (§3.5), and the
 * protocol carries it in two sanctioned places: `hand:update.peeks` and the
 * `peek` event routed to that socket alone. Both would otherwise trip the
 * hidden-letter check, so the letters this player legitimately knows come out
 * of their own guard — and out of nobody else's.
 */
export function forRecipient(secrets: Secrets | null, peeks: Record<number, string>): Secrets | null {
  if (!secrets) return null;
  const known = new Set(Object.values(peeks));
  if (known.size === 0) return secrets;
  return { ...secrets, hidden: secrets.hidden.filter((l) => !known.has(l)) };
}

/** Snapshot what must not escape, given the state at emit time. */
export function secretsOf(state: GameState): Secrets | null {
  const round = state.round;
  // Round over: the answer is public by design and every tile is face-up.
  if (!round || round.endedReason !== null) return null;
  const hidden = hiddenDistinctLetters(round);
  // Every tile is already face-up but nobody has claimed the solve yet. The
  // answer is legitimately readable straight off the board — `accessibleText`
  // spells it out, which is required by §10 — so there is nothing left to keep.
  // Guarding here would be a false positive that drops real board updates.
  if (hidden.length === 0) return null;
  return {
    answer: normalizeGuess(round.answer),
    hidden,
    // A short or empty hint is not a secret worth matching on — `''` would
    // make `String.includes` true for every string in the payload and drop the
    // whole game. Corpus hints are sentences; anything shorter is not one.
    hint: !round.hintRevealed && round.puzzle.hint.trim().length >= 8 ? round.puzzle.hint : null,
  };
}

/**
 * Walk `payload` and throw on the first sighting of a secret.
 *
 * Two checks, both deliberately blunt:
 *   1. any string whose normalized form CONTAINS the normalized answer;
 *   2. any single-character string equal to a still-hidden letter, reached by a
 *      key that is not an allowlisted place a bare letter legitimately appears.
 *
 * (2) is what catches a stray `peek` event: `{ t:'peek', letter:'Q' }` has a
 * one-character `letter` under a `letter` key, and `letter` is only allowlisted
 * for cards a player is holding (`hand:update.cards[].letter`) — never for an
 * event in a broadcast.
 */
export function assertNoLeak(eventName: string, payload: unknown, secrets: Secrets | null): void {
  if (!secrets) return;
  walk(payload, '', eventName, secrets, new Set());
}

/**
 * Paths where a bare letter is legitimately present.
 * - a card in YOUR OWN hand (`hand:update`) — you are holding it
 * - a revealed board cell (`revealed:true` cells carry `ch`; hidden ones have
 *   no `ch` field at all, so a hidden letter cannot appear there)
 * - `guessedLetters` / `missedLetters` — already public
 */
const LETTER_OK = /(^|\.)(cards\[\d+\]\.letter|guessedLetters\[\d+\]|missedLetters\[\d+\]|letters\[\d+\])$/;

function walk(node: unknown, path: string, eventName: string, s: Secrets, seen: Set<object>): void {
  if (node === null || node === undefined) return;
  if (typeof node === 'string') {
    checkString(node, path, eventName, s);
    return;
  }
  if (typeof node !== 'object') return;
  if (seen.has(node as object)) return;
  seen.add(node as object);

  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, `${path}[${i}]`, eventName, s, seen));
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    walk(v, path ? `${path}.${k}` : k, eventName, s, seen);
  }
}

function checkString(value: string, path: string, eventName: string, s: Secrets): void {
  if (value.length === 1) {
    if (s.hidden.includes(value) && !LETTER_OK.test(path)) {
      throw new LeakError(`hidden letter leaked at ${eventName}:${path}`, eventName, path);
    }
    return;
  }
  if (s.answer.length >= 6) {
    const norm = normalizeGuess(value);
    if (norm.length >= s.answer.length && norm.includes(s.answer)) {
      throw new LeakError(`answer leaked at ${eventName}:${path}`, eventName, path);
    }
  }
  if (s.hint && value.includes(s.hint)) {
    throw new LeakError(`unrevealed hint leaked at ${eventName}:${path}`, eventName, path);
  }
}

/**
 * Event kinds a client may see about someone else. Anything NOT listed is
 * treated as private and routed only to its owner — the list fails CLOSED, so
 * a new engine event added tomorrow is withheld rather than broadcast.
 */
export const PUBLIC_EVENT_KINDS: ReadonlySet<GameEvent['t']> = new Set([
  'round:start',
  'turn:begin',
  'card:played',
  'letter:hit',
  'letter:miss',
  'reveal',
  'pressure',
  'blowout',
  'solve:attempt',
  'solve:success',
  'solve:fail',
  'discard',
  'draw',
  'skip',
  'reverse',
  'shuffle',
  'crack',
  'lockout',
  'swipe',
  'block',
  'buzz',
  'interrupt:open',
  'interrupt:close',
  'breath',
  'round:end',
  'match:end',
  'notice',
]);

/** For a private event, who is allowed to see it. */
export function privateOwner(e: GameEvent): string | null {
  switch (e.t) {
    case 'peek':
      // §: "the peek event carries the revealed letter and MUST be routed only
      // to the peeking socket."
      return e.playerId;
    default:
      // Unknown/unclassified: no owner, so nobody gets it.
      return null;
  }
}

/**
 * Split an engine event stream for one recipient. THE single place a
 * `GameEvent[]` is prepared for a socket.
 */
export function eventsFor(playerId: string | null, events: readonly GameEvent[]): GameEvent[] {
  return events.filter((e) => {
    if (PUBLIC_EVENT_KINDS.has(e.t)) return true;
    const owner = privateOwner(e);
    // `owner === null` means "unclassified", not "belongs to nobody in
    // particular" — an event with no owner reaches no one, including a caller
    // that passed a null playerId.
    return owner !== null && owner === playerId;
  });
}
