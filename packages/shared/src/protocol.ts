/**
 * Socket.IO protocol (design doc §6.5).
 *
 * Client→server payloads are untrusted input: the server re-validates every one
 * of them. Server→client payloads carrying board state are ALWAYS masked.
 */
import type {
  Card,
  GameEvent,
  InterruptIntent,
  MatchResult,
  MaskedBoard,
  PlayCardIntent,
  RoomPublic,
  RoomSettings,
  RoundPublic,
  RoundResult,
} from './types.js';

export const SOCKET_PATH = '/socket.io';
export const PROTOCOL_VERSION = 1;

// --------------------------------------------------------------------------
// Client → Server
// --------------------------------------------------------------------------

export interface CreateRoomPayload {
  name: string;
  color: string;
  settings?: Partial<RoomSettings>;
}

export interface JoinRoomPayload {
  code: string;
  /**
   * The room key. Required unless `sessionToken` reclaims a seat you already
   * held. See ROOM_KEY_LENGTH below for why this exists.
   */
  key?: string;
  name: string;
  color: string;
  /** Present on reconnect; lets the server restore a held seat (§7). */
  sessionToken?: string;
}

export interface StartGamePayload {
  settings?: Partial<RoomSettings>;
}

export interface ClientToServerEvents {
  'room:create': (p: CreateRoomPayload, ack: Ack<JoinedPayload>) => void;
  'room:join': (p: JoinRoomPayload, ack: Ack<JoinedPayload>) => void;
  'room:leave': (p: Record<string, never>, ack: Ack<{ ok: true }>) => void;
  'room:settings': (p: { settings: Partial<RoomSettings> }, ack: Ack<{ ok: true }>) => void;
  'game:start': (p: StartGamePayload, ack: Ack<{ ok: true }>) => void;
  'turn:playCard': (p: PlayCardIntent, ack: Ack<{ ok: true }>) => void;
  'turn:discard': (p: { cardIds: string[] }, ack: Ack<{ ok: true }>) => void;
  'turn:solve': (p: { guess: string }, ack: Ack<{ ok: true }>) => void;
  /**
   * Decline the optional solve and end your turn (§3.3 makes solving optional
   * after the primary action). A distinct event rather than an empty `guess`:
   * conflating them means a player who submits a blank box silently passes,
   * and it makes declining indistinguishable from a mis-click in the logs.
   */
  'turn:pass': (p: Record<string, never>, ack: Ack<{ ok: true }>) => void;
  'interrupt:play': (p: InterruptIntent, ack: Ack<{ ok: true }>) => void;
  /**
   * Decline an open interrupt window. Without this the window can only close
   * by expiry, so every uncontested window costs the table the full 4 seconds.
   */
  'interrupt:pass': (p: { windowId: string }, ack: Ack<{ ok: true }>) => void;
  'chat:emote': (p: { emote: string }, ack: Ack<{ ok: true }>) => void;
  ping_: (p: Record<string, never>, ack: Ack<{ t: number }>) => void;
}

/** Standard ack envelope. Every client→server call gets exactly one. */
export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: SocketError }) => void;

export interface SocketError {
  code: string;
  message: string;
}

export interface JoinedPayload {
  /** Opaque token the client stores to reclaim its seat after a drop. */
  sessionToken: string;
  playerId: string;
  /**
   * The room key, returned only to someone who is now legitimately in the
   * room. The host needs it to share; a joiner already had it. It is not on
   * RoomPublic because it is a credential, not room state.
   */
  key: string;
  room: RoomPublic;
}

// --------------------------------------------------------------------------
// Server → Client
// --------------------------------------------------------------------------

export interface BoardUpdatePayload {
  board: MaskedBoard;
  round: RoundPublic;
  /** Events that produced this update, in order, for animation sequencing. */
  events: GameEvent[];
}

export interface HandUpdatePayload {
  /** PRIVATE — emitted only to the owning socket. */
  cards: Card[];
  /** Tiles this player has privately peeked: board index → letter. */
  peeks: Record<number, string>;
}

export interface InterruptWindowPayload {
  windowId: string;
  kind: 'hit' | 'targeted' | 'between';
  sourcePlayerId: string;
  expiresAt: number;
  /** Cards in *your* hand that are legal right now. */
  playableCardIds: string[];
}

export interface ServerToClientEvents {
  'room:state': (p: RoomPublic) => void;
  'game:started': (p: { round: RoundPublic; board: MaskedBoard }) => void;
  'board:update': (p: BoardUpdatePayload) => void;
  'hand:update': (p: HandUpdatePayload) => void;
  'turn:begin': (p: { playerId: string; endsAt: number | null; roundNumber: number }) => void;
  'turn:timer': (p: { playerId: string; remainingMs: number }) => void;
  'pressure:update': (p: { value: number; delta: number; max: number; cause: string; byPlayerId: string | null }) => void;
  'interrupt:window': (p: InterruptWindowPayload) => void;
  'interrupt:closed': (p: { windowId: string }) => void;
  'round:end': (p: RoundResult) => void;
  'match:end': (p: MatchResult) => void;
  'chat:emote': (p: { playerId: string; emote: string }) => void;
  error: (p: SocketError) => void;
}

// --------------------------------------------------------------------------
// Room codes (§6.6) — pronounceable CVCV, e.g. "KABO", "MIRU"
// --------------------------------------------------------------------------

/** Consonants chosen to be unambiguous when read aloud over Zoom. */
export const CODE_CONSONANTS = 'BDFGHJKLMNPRSTVZ'.split('');
export const CODE_VOWELS = 'AEIOU'.split('');
export const ROOM_CODE_LENGTH = 4;
export const ROOM_CODE_PATTERN = /^[BDFGHJKLMNPRSTVZ][AEIOU][BDFGHJKLMNPRSTVZ][AEIOU]$/;

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code.toUpperCase());
}

// --------------------------------------------------------------------------
// Room keys — anti-enumeration
// --------------------------------------------------------------------------

/**
 * The 4-character CVCV code is a *name*, not a secret: 16 consonants x 5 vowels
 * squared is 6,400 possibilities, which a script walks in seconds. Pronounceable
 * over Zoom (§6.6) and unguessable are incompatible goals for one short string,
 * so they are two strings.
 *
 * The code stays exactly as designed — big, sayable, on the cast view. The key
 * is the credential: it rides in the share link and the QR, so the normal path
 * is unchanged, and a code-only guess gets nowhere.
 *
 * Alphabet excludes 0/O/1/I/L, which people transcribe wrong when reading a
 * code off a screen.
 */
export const ROOM_KEY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const ROOM_KEY_LENGTH = 4;
export const ROOM_KEY_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/;

export function isValidRoomKey(key: string): boolean {
  return ROOM_KEY_PATTERN.test(key.toUpperCase());
}

/** The shareable identity: "KABO-M3XR". One thing to paste, say, or scan. */
export function formatRoomHandle(code: string, key: string): string {
  return `${code.toUpperCase()}-${key.toUpperCase()}`;
}

/**
 * Parse a pasted handle. Tolerant on purpose — people retype these from a
 * screen, so separators, spaces and case are all forgiven.
 */
export function parseRoomHandle(input: string): { code: string; key: string } | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (cleaned.length !== ROOM_CODE_LENGTH + ROOM_KEY_LENGTH) return null;
  const code = cleaned.slice(0, ROOM_CODE_LENGTH);
  const key = cleaned.slice(ROOM_CODE_LENGTH);
  if (!isValidRoomCode(code) || !isValidRoomKey(key)) return null;
  return { code, key };
}

/** Avatar colors offered at join (§7, §9 palette). */
export const AVATAR_COLORS = [
  '#FF5C1A', // fanta
  '#B8FF3C', // lime
  '#6C3BFF', // grape
  '#FF2E63', // cherry
  '#00C2FF', // slush blue
  '#FFC93C', // orange soda
  '#22D3A0', // melon
  '#FF8AD8', // bubblegum
] as const;
