/**
 * The seat credential, persisted.
 *
 * Reclaiming a seat needs three things: the room CODE, the room KEY (§6.6
 * anti-enumeration — the server will not seat you without it) and the SESSION
 * TOKEN (§7 — the only credential in the system). Before this module all three
 * lived in a zustand store, i.e. in memory, i.e. gone the moment the tab was
 * discarded — and a backgrounded mobile tab is discarded routinely, by design.
 * That made a phone that slept too long unrecoverable even though the server
 * was still holding the seat.
 *
 * §7/§8 on what this is allowed to be: no account, no PII. A four-letter room
 * code, a four-character room key, an opaque 32-byte token and an opaque player
 * id. Nothing here identifies a person, and it is scoped to one room and
 * expires with that room.
 */
import { BALANCE } from '@phrasey/shared';

const SESSION_KEY = 'phrasey.session.v1';

/** Matches the server's room TTL (§6.4): past it there is nothing to reclaim. */
const MAX_AGE_MS = BALANCE.session.roomTtlHours * 60 * 60 * 1000;

export interface StoredSession {
  code: string;
  key: string;
  sessionToken: string;
  playerId: string;
  /** Epoch ms, so a stale credential expires instead of lingering forever. */
  savedAt: number;
}

function isSession(v: unknown): v is StoredSession {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<StoredSession>;
  return (
    typeof s.code === 'string' &&
    s.code.length > 0 &&
    typeof s.key === 'string' &&
    s.key.length > 0 &&
    typeof s.sessionToken === 'string' &&
    s.sessionToken.length > 0 &&
    typeof s.playerId === 'string' &&
    s.playerId.length > 0 &&
    typeof s.savedAt === 'number'
  );
}

/** The stored seat, or null if there is none, it is unreadable, or it expired. */
export function readSession(now: number = Date.now()): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSession(parsed)) return null;
    if (now - parsed.savedAt > MAX_AGE_MS) {
      clearSession();
      return null;
    }
    return parsed;
  } catch {
    // Private browsing, quota, or somebody hand-edited it. Same answer.
    return null;
  }
}

/** The stored seat, but only if it belongs to the room being asked about. */
export function sessionFor(code: string, now: number = Date.now()): StoredSession | null {
  const s = readSession(now);
  if (!s) return null;
  return s.code.toUpperCase() === code.toUpperCase() ? s : null;
}

export function writeSession(s: Omit<StoredSession, 'savedAt'>, now: number = Date.now()): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...s, code: s.code.toUpperCase(), savedAt: now }));
  } catch {
    // A phone in private browsing simply cannot survive a tab discard. The
    // in-memory path still works, so this is a degradation, not a failure.
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
