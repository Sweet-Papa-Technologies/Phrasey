/**
 * Phrasey domain types.
 *
 * SECURITY INVARIANT (design doc §6.2): nothing in this file that crosses the
 * wire to a client may contain the puzzle solution. `MaskedBoard` is the only
 * board shape a client ever receives. The full `Puzzle.text` is server-only.
 */
import type { BotTier, MatchMode } from './balance.js';

export type { BotTier, MatchMode };

/** A single uppercase A–Z character. */
export type Letter = string;

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

/** Action cards played on your turn as your primary action (§3.5). */
export const TURN_ACTION_KINDS = [
  'SKIP',
  'REVERSE',
  'DOUBLE_DOWN',
  'VOWEL_RUSH',
  'SHUFFLE',
  'PEEK',
  'CRACK',
  'RELIEF_VALVE',
  'VANDAL',
  'WILD',
  'LOCKOUT',
] as const;

/** Cards played out of turn inside the interrupt window (§3.5). */
export const INTERRUPT_ACTION_KINDS = ['SWIPE', 'BLOCK', 'BUZZ_IN'] as const;

export const ACTION_KINDS = [...TURN_ACTION_KINDS, ...INTERRUPT_ACTION_KINDS] as const;

export type TurnActionKind = (typeof TURN_ACTION_KINDS)[number];
export type InterruptActionKind = (typeof INTERRUPT_ACTION_KINDS)[number];
export type ActionCardKind = (typeof ACTION_KINDS)[number];

export function isInterruptKind(k: ActionCardKind): k is InterruptActionKind {
  return (INTERRUPT_ACTION_KINDS as readonly string[]).includes(k);
}

export interface LetterCard {
  id: string;
  kind: 'letter';
  letter: Letter;
}

export interface ActionCard {
  id: string;
  kind: 'action';
  action: ActionCardKind;
}

export type Card = LetterCard | ActionCard;

export function isLetterCard(c: Card): c is LetterCard {
  return c.kind === 'letter';
}
export function isActionCard(c: Card): c is ActionCard {
  return c.kind === 'action';
}

/** Human-facing card copy, shared by client UI and bot explanations. */
export const ACTION_CARD_META: Record<ActionCardKind, { name: string; blurb: string; targets: boolean; interrupt: boolean }> = {
  SKIP: { name: 'Skip', blurb: 'Next player loses their turn.', targets: false, interrupt: false },
  REVERSE: { name: 'Reverse', blurb: 'Flip play direction. Acts as Skip with 2 players.', targets: false, interrupt: false },
  DOUBLE_DOWN: { name: 'Double Down', blurb: 'Your next letter scores 2×. A miss costs 2× pressure.', targets: false, interrupt: false },
  VOWEL_RUSH: { name: 'Vowel Rush', blurb: 'Reveal every instance of one vowel. You score nothing. +2 pressure.', targets: false, interrupt: false },
  SHUFFLE: { name: 'Shuffle', blurb: 'Everyone passes their hand to the next player.', targets: false, interrupt: false },
  PEEK: { name: 'Peek', blurb: 'Privately reveals one hidden tile to you only.', targets: false, interrupt: false },
  CRACK: { name: 'Crack', blurb: "Reveals the puzzle's hint to everyone.", targets: false, interrupt: false },
  RELIEF_VALVE: { name: 'Relief Valve', blurb: '−3 pressure.', targets: false, interrupt: false },
  VANDAL: { name: 'Vandal', blurb: '+2 pressure, draw 2 cards. Pure spite.', targets: false, interrupt: false },
  WILD: { name: 'Wild', blurb: 'Play as any letter. Scores as a normal letter play.', targets: false, interrupt: false },
  LOCKOUT: { name: 'Lockout', blurb: 'Target cannot Solve on their next turn.', targets: true, interrupt: false },
  SWIPE: { name: 'Swipe', blurb: "Steal the reveal points from another player's hit.", targets: false, interrupt: true },
  BLOCK: { name: 'Block', blurb: 'Cancel an action card aimed at you. Both discard.', targets: false, interrupt: true },
  BUZZ_IN: { name: 'Buzz In', blurb: 'Take the next turn out of order. Once per round.', targets: false, interrupt: true },
};

// ---------------------------------------------------------------------------
// Puzzles
// ---------------------------------------------------------------------------

export const CATEGORIES = [
  'Grocery list',
  "Sign you'd see at the DMV",
  'Text from your mom',
  'Group chat message at 2am',
  'Error message',
  'Thing said at a wedding',
  'Idiom / proverb',
  'Instructions on the back of a box',
  'Yelp review, one star',
  'Voicemail from your landlord',
  'Note left on a windshield',
  "Overheard at Trader Joe's",
  'Bumper sticker',
] as const;

export type Category = (typeof CATEGORIES)[number];

/** SERVER-ONLY. `text` must never cross the wire. */
export interface Puzzle {
  id: string;
  /** The solution. Uppercase, ASCII, punctuation limited to ' - , . ! ? */
  text: string;
  category: string;
  /** One-line hint revealed by the CRACK card. */
  hint: string;
  difficulty: 1 | 2 | 3;
  /** Occurrence count per letter, precomputed at seed time. */
  letterStats: Record<Letter, number>;
  active: boolean;
  source?: 'generated' | 'public-domain' | 'manual';
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

/**
 * One board cell. `letter` cells carry `ch` ONLY once revealed — an unrevealed
 * cell has no `ch` field at all, so there is nothing to leak.
 */
export type BoardCell =
  | { t: 'letter'; revealed: false }
  | { t: 'letter'; revealed: true; ch: Letter }
  /** Apostrophes and hyphens are shown, not masked (§3.1). */
  | { t: 'punct'; ch: string };

/** A word is a run of cells; words are separated by spaces on render. */
export type BoardWord = BoardCell[];

/** The ONLY board representation a client is ever sent. */
export interface MaskedBoard {
  category: string;
  words: BoardWord[];
  /** Letters that have been played and resolved, hit or miss. */
  guessedLetters: Letter[];
  /** Letters played that turned out not to be in the puzzle. */
  missedLetters: Letter[];
  /** Total letter tiles in the puzzle. */
  totalLetters: number;
  /** Letter tiles still hidden. Drives the solve bonus (§3.3). */
  hiddenLetters: number;
  /** Non-null once CRACK has been played. */
  hint: string | null;
  /** Accessible plain-text rendering, e.g. "_ E _ _ O   _ O R L D" (§10). */
  accessibleText: string;
}

// ---------------------------------------------------------------------------
// Players & rooms
// ---------------------------------------------------------------------------

export type PlayerConnection = 'connected' | 'disconnected' | 'bot';

export interface PlayerPublic {
  id: string;
  name: string;
  /** Avatar color token chosen at join (§7). */
  color: string;
  isHost: boolean;
  isBot: boolean;
  botTier?: BotTier;
  /** One-line personality shown on hover (§5). */
  botPersona?: string;
  connection: PlayerConnection;
  /** Match score. */
  score: number;
  /** Points banked this round. */
  roundScore: number;
  handCount: number;
  /** Locked out of solving for the rest of the round (wrong solve, §3.3). */
  solveLocked: boolean;
  /** LOCKOUT card applied — blocked from solving on their next turn only. */
  lockedNextTurn: boolean;
  /** DOUBLE DOWN armed for the next letter play. */
  doubleDownArmed: boolean;
  /** BUZZ IN uses left this round. */
  buzzInsLeft: number;
  /** Seat converted from a dropped human (§7). */
  wasHuman?: boolean;
}

export type RoomStatus = 'lobby' | 'playing' | 'round-end' | 'match-end';

export interface RoomSettings {
  matchMode: MatchMode;
  rounds: number;
  targetScore: number;
  /** null disables the turn timer entirely (§10). */
  turnSeconds: number | null;
  botCount: number;
  botTier: BotTier;
  interruptsEnabled: boolean;
}

export interface RoomPublic {
  code: string;
  status: RoomStatus;
  hostId: string;
  settings: RoomSettings;
  players: PlayerPublic[];
  roundNumber: number;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Round state (public projection)
// ---------------------------------------------------------------------------

export type TurnDirection = 1 | -1;

/**
 * Which beat of the turn we are on. §3.3 gives a player a primary action and
 * then an optional solve, so "it is your turn" and "you are being offered the
 * solve" are different states — and a client that has to infer the difference
 * gets it wrong across a reconnect.
 */
export type TurnPhase = 'turn' | 'awaiting-solve' | 'interrupt' | 'ended';

export interface RoundPublic {
  roundNumber: number;
  board: MaskedBoard;
  pressure: number;
  pressureMax: number;
  phase: TurnPhase;
  currentPlayerId: string | null;
  direction: TurnDirection;
  /** Epoch ms when the current turn expires; null if the timer is off. */
  turnEndsAt: number | null;
  deckRemaining: number;
  /** Consecutive full cycles with no new reveal (§3.6). */
  idleCycles: number;
}

export type RoundEndReason = 'solved' | 'blowout' | 'deck-exhausted' | 'abandoned';

export interface RoundResult {
  roundNumber: number;
  reason: RoundEndReason;
  /** Who solved it, if anyone. */
  solvedBy: string | null;
  /** Who tipped the gauge, if it blew. */
  blownBy: string | null;
  /** The answer — safe to send ONLY now, the round is over. */
  answer: string;
  category: string;
  hint: string;
  /** Per-player points earned this round. */
  roundScores: Record<string, number>;
  /** Running match totals after this round. */
  totals: Record<string, number>;
}

export interface MatchResult {
  winnerIds: string[];
  totals: Record<string, number>;
  roundsPlayed: number;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Actions & events
// ---------------------------------------------------------------------------

export type PlayCardIntent =
  | { type: 'letter'; cardId: string }
  /** WILD carries the chosen letter; VOWEL_RUSH carries the chosen vowel. */
  | { type: 'action'; cardId: string; letter?: Letter; targetPlayerId?: string };

export interface DiscardIntent {
  cardIds: string[];
}

export interface SolveIntent {
  guess: string;
}

export interface InterruptIntent {
  cardId: string;
  /** The event this interrupt is responding to. */
  windowId: string;
}

/**
 * Everything the engine emits. The server fans these out to clients (after
 * masking) and the client uses them to drive animation and the event log.
 */
export type GameEvent =
  | { t: 'round:start'; roundNumber: number; category: string; deckSize: number }
  | { t: 'turn:begin'; playerId: string; endsAt: number | null }
  | { t: 'card:played'; playerId: string; card: Card; letter?: Letter; targetPlayerId?: string }
  | { t: 'letter:hit'; playerId: string; letter: Letter; occurrences: number; points: number; positions: number[] }
  | { t: 'letter:miss'; playerId: string; letter: Letter; pressureDelta: number }
  | { t: 'reveal'; letters: Letter[]; positions: number[]; reason: 'play' | 'vowel-rush' | 'breath' | 'solve' }
  | { t: 'pressure'; value: number; delta: number; cause: string; byPlayerId: string | null }
  | { t: 'blowout'; byPlayerId: string | null; penalty: number }
  | { t: 'solve:attempt'; playerId: string; correct: boolean }
  | { t: 'solve:success'; playerId: string; points: number; hiddenAtSolve: number }
  | { t: 'solve:fail'; playerId: string; pressureDelta: number }
  | { t: 'discard'; playerId: string; count: number }
  | { t: 'draw'; playerId: string; count: number }
  | { t: 'skip'; playerId: string; skippedPlayerId: string }
  | { t: 'reverse'; playerId: string; direction: TurnDirection }
  | { t: 'shuffle'; order: string[] }
  | { t: 'peek'; playerId: string; index: number; letter: Letter }
  | { t: 'crack'; playerId: string; hint: string }
  | { t: 'lockout'; playerId: string; targetPlayerId: string }
  | { t: 'swipe'; playerId: string; fromPlayerId: string; points: number }
  | { t: 'block'; playerId: string; blockedCard: Card }
  | { t: 'buzz'; playerId: string }
  | { t: 'interrupt:open'; windowId: string; kind: 'hit' | 'targeted' | 'between'; sourcePlayerId: string; expiresAt: number }
  | { t: 'interrupt:close'; windowId: string }
  | { t: 'breath'; letter: Letter; positions: number[] }
  | { t: 'round:end'; result: RoundResult }
  | { t: 'match:end'; result: MatchResult }
  | { t: 'notice'; message: string };

/** Rejection reasons the engine can return for an illegal action. */
export type EngineErrorCode =
  | 'NOT_YOUR_TURN'
  | 'CARD_NOT_IN_HAND'
  | 'WRONG_CARD_TYPE'
  | 'LETTER_ALREADY_GUESSED'
  | 'LETTER_REQUIRED'
  | 'TARGET_REQUIRED'
  | 'INVALID_TARGET'
  | 'SOLVE_LOCKED'
  | 'ALREADY_ACTED'
  | 'ROUND_NOT_ACTIVE'
  | 'INVALID_DISCARD'
  | 'NO_INTERRUPT_WINDOW'
  | 'INTERRUPT_NOT_ALLOWED'
  | 'BUZZ_EXHAUSTED'
  | 'CHAIN_LIMIT';

export class EngineError extends Error {
  constructor(
    public code: EngineErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'EngineError';
  }
}
