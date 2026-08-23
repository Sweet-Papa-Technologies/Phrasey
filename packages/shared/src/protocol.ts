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
