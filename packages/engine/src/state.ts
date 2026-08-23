/**
 * The engine's authoritative state shape.
 *
 * SERVER-ONLY (design doc §6.2). `RoundState.puzzle` holds the solution. Nothing
 * here is safe to hand a client. The only sanctioned exits are `maskBoard()`
 * (board.ts), `playerView()` (view.ts) and `RoundResult.answer` *after* the
 * round has ended.
 *
 * Everything in `GameState` is plain JSON — no Set, no Map, no class instances,
 * no functions. Three reasons:
 *   1. `structuredClone` is cheap and total, which is what makes `applyAction`
 *      non-mutating for the caller.
 *   2. The server snapshots state to Firestore every 10 events (§6.2).
 *   3. The RNG survives the round trip because its whole state is one uint32.
 */
import type {
  ActionCard,
  Balance,
  BotTier,
  Card,
  GameEvent,
  Letter,
  MatchResult,
  PlayerConnection,
  PlayerPublic,
  Puzzle,
  RoomSettings,
  RoomStatus,
  RoundEndReason,
  RoundResult,
  TurnDirection,
} from '@phrasey/shared';
import { EngineError, defaultBalance, normalizePuzzleText, totalLetterCount } from '@phrasey/shared';
import { buildDeck } from './deck.js';
import { createRng } from './rng.js';

/** Kept small on purpose — the log is cloned on every action (see LOG_CAP). */
export const LOG_CAP = 200;

/**
 * Where a round is in its turn cycle.
 *
 * `awaiting-solve` exists because §3.3 says the solve is offered *after* the
 * primary action ("Then, optionally, you may Solve"). Collapsing the two into
 * one action would remove the single best moment in the game: play a letter,
 * watch four tiles flip, and only *then* decide whether you can name it.
 */
export type RoundPhase = 'turn' | 'awaiting-solve' | 'interrupt' | 'ended';

export interface PlayerState {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
  isBot: boolean;
  botTier?: BotTier;
  botPersona?: string;
  connection: PlayerConnection;
  /** Match total. */
  score: number;
  /** Points banked in the current round. */
  roundScore: number;
  hand: Card[];
  /** PRIVATE. Board tile index → letter, from PEEK. Never enters MaskedBoard. */
  peeks: Record<number, Letter>;
  /** Wrong solve — locked out of solving for the rest of the round (§3.3). */
  solveLocked: boolean;
  /** LOCKOUT — cannot solve on their next turn only (§3.5). */
  lockedNextTurn: boolean;
  /** DOUBLE DOWN armed; consumed by the next letter play, expires at round end. */
  doubleDownArmed: boolean;
  /** SKIP applied — loses their next turn. */
  skipNextTurn: boolean;
  buzzInsLeft: number;
  /** Seat converted from a dropped human (§7). */
  wasHuman?: boolean;
  /** Left the room. Kept in the array so scores and the event log stay stable. */
  removed: boolean;
}

/**
 * A card effect that has been played but has NOT yet taken hold, because an
 * interrupt window is open on it. The stack resolves LIFO (§3.5).
 *
 * `card` is held here rather than in the discard pile so card conservation
 * (deck + hands + discard + stack === deckSize) is checkable at every instant.
 */
export type PendingEffect =
  | {
      kind: 'hit';
      playerId: string;
      card: Card;
      letter: Letter;
      occurrences: number;
      points: number;
      positions: number[];
    }
  | { kind: 'lockout'; playerId: string; targetPlayerId: string; card: ActionCard }
  | { kind: 'swipe'; playerId: string; card: ActionCard }
  | { kind: 'block'; playerId: string; card: ActionCard };

export type InterruptWindowKind = 'hit' | 'targeted' | 'between';

export interface InterruptWindow {
  id: string;
  kind: InterruptWindowKind;
  /** Whoever's play opened the window. */
  sourcePlayerId: string;
  /** For 'targeted', the single player who may respond. */
  targetPlayerId: string | null;
  expiresAt: number;
  /** Interrupt cards already stacked on this effect; capped at maxChain. */
  chain: number;
  /** Players who may legally respond right now (they hold a usable card). */
  eligible: string[];
  /** Players who have declined. When eligible ⊆ passed, the window closes early. */
  passed: string[];
}

export interface RoundState {
  roundNumber: number;
  /** SERVER-ONLY. The solution. */
  puzzle: Puzzle;
  /** Normalized `puzzle.text`, cached. SERVER-ONLY. */
  answer: string;
  /** Letters shown on the board. A hit reveals every occurrence at once. */
  revealed: Letter[];
  /** Letters played that were not in the puzzle. */
  missed: Letter[];
  hintRevealed: boolean;
  pressure: number;
  direction: TurnDirection;
  currentPlayerId: string | null;
  /** Epoch ms; null when the host disabled the turn timer (§10). */
  turnEndsAt: number | null;
  phase: RoundPhase;
  /** The current player has used their one primary action. */
  turnActed: boolean;
  deck: Card[];
  discard: Card[];
  stack: PendingEffect[];
  window: InterruptWindow | null;
  windowSeq: number;
  /**
   * What to do once the open interrupt window closes and its stack resolves:
   * hand the turn back to the current player for their optional solve, or move
   * on to the next seat. Null when no window is open.
   */
  afterWindow: 'resume-turn' | 'advance' | null;
  deckSize: number;
  totalLetters: number;
  /** Turns taken with no new reveal. Drives "the board breathes" (§3.6). */
  turnsSinceReveal: number;
  /** Seat order for this round, fixed at deal time. */
  order: string[];
  /** BUZZ IN winner takes the next turn out of order. */
  nextPlayerOverride: string | null;
  endedReason: RoundEndReason | null;
  solvedBy: string | null;
  blownBy: string | null;
}

export interface GameState {
  version: 1;
  sessionId: string;
  seed: number;
  /** Resumable PRNG state; see rng.ts. */
  rngState: number;
  balance: Balance;
  settings: RoomSettings;
  status: RoomStatus;
  hostId: string;
  players: PlayerState[];
  roundNumber: number;
  round: RoundState | null;
  results: RoundResult[];
  matchResult: MatchResult | null;
  /** Tail of the event log, capped at LOG_CAP so cloning stays O(1)-ish. */
  log: GameEvent[];
  createdAt: number;
}

export interface NewPlayer {
  id: string;
  name: string;
  color?: string;
  isHost?: boolean;
  isBot?: boolean;
  botTier?: BotTier;
  botPersona?: string;
  connection?: PlayerConnection;
}

export interface CreateMatchOptions {
  seed: number;
  players: NewPlayer[];
  settings?: Partial<RoomSettings>;
  /** Defaults to `defaultBalance()`. Sims sweep this. */
  balance?: Balance;
  sessionId?: string;
  nowMs?: number;
}

export function defaultSettings(balance: Balance): RoomSettings {
  return {
    matchMode: balance.match.defaultMode,
    rounds: balance.match.defaultRounds,
    targetScore: balance.match.defaultTargetScore,
    turnSeconds: balance.turn.defaultSeconds,
    botCount: balance.setup.defaultBots,
    botTier: 'sharp',
    interruptsEnabled: true,
  };
}

export function makePlayer(p: NewPlayer, balance: Balance): PlayerState {
  return {
    id: p.id,
    name: p.name,
    color: p.color ?? '#FF5C1A',
    isHost: p.isHost ?? false,
    isBot: p.isBot ?? false,
    botTier: p.botTier,
    botPersona: p.botPersona,
    connection: p.connection ?? (p.isBot ? 'bot' : 'connected'),
    score: 0,
    roundScore: 0,
    hand: [],
    peeks: {},
    solveLocked: false,
    lockedNextTurn: false,
    doubleDownArmed: false,
    skipNextTurn: false,
    buzzInsLeft: balance.interrupt.buzzInPerRound,
    removed: false,
  };
}

/**
 * Build a fresh match in the lobby. No round has started; call `startRound`
 * (or dispatch `{ type: 'startRound' }`) with a puzzle to deal.
 *
 * The engine performs no I/O, so puzzle selection is the caller's job — that is
 * the seam that lets a balance sweep feed 10,000 fixed puzzles through it.
 */
export function createMatch(opts: CreateMatchOptions): GameState {
  const balance = opts.balance ? structuredClone(opts.balance) : defaultBalance();
  const settings = { ...defaultSettings(balance), ...(opts.settings ?? {}) };
  const players = opts.players.map((p) => makePlayer(p, balance));
  if (players.length > balance.setup.maxPlayers) {
    throw new EngineError('INVALID_TARGET', `max ${balance.setup.maxPlayers} players`);
  }
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) throw new EngineError('INVALID_TARGET', 'duplicate player id');

  const host = players.find((p) => p.isHost) ?? players[0];
  if (host) host.isHost = true;

  return {
    version: 1,
    sessionId: opts.sessionId ?? `s-${opts.seed >>> 0}`,
    seed: opts.seed,
    rngState: opts.seed >>> 0,
    balance,
    settings,
    status: 'lobby',
    hostId: host?.id ?? '',
    players,
    roundNumber: 0,
    round: null,
    results: [],
    matchResult: null,
    log: [],
    createdAt: opts.nowMs ?? 0,
  };
}

/** Players who occupy a seat this match: everyone who has not left. */
export function activePlayers(state: GameState): PlayerState[] {
  return state.players.filter((p) => !p.removed);
}

export function getPlayer(state: GameState, playerId: string): PlayerState {
  const p = state.players.find((x) => x.id === playerId && !x.removed);
  if (!p) throw new EngineError('INVALID_TARGET', `no such player ${playerId}`);
  return p;
}

export function findPlayer(state: GameState, playerId: string): PlayerState | undefined {
  return state.players.find((x) => x.id === playerId);
}

export function toPublic(p: PlayerState): PlayerPublic {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    isHost: p.isHost,
    isBot: p.isBot,
    botTier: p.botTier,
    botPersona: p.botPersona,
    connection: p.connection,
    score: p.score,
    roundScore: p.roundScore,
    handCount: p.hand.length,
    solveLocked: p.solveLocked,
    lockedNextTurn: p.lockedNextTurn,
    doubleDownArmed: p.doubleDownArmed,
    buzzInsLeft: p.buzzInsLeft,
    wasHuman: p.wasHuman,
  };
}

/** Deal `n` cards off the top of the deck. Short-deals rather than throwing. */
/**
 * Letters that would be dead weight in a hand right now: anything already
 * played this round (a hit reveals every occurrence, so the card can never
 * score again) plus anything the player is already holding.
 *
 * Holding two E's is not a strategic choice, it is a wasted card — you can
 * only ever cash one. The deck is deliberately built from the puzzle's letter
 * multiset (§3.2), which makes duplicates common rather than rare, so this has
 * to be handled at the draw rather than left to chance.
 */
export function deadLettersFor(round: RoundState, hand: readonly Card[]): Set<Letter> {
  const dead = new Set<Letter>([...round.revealed, ...round.missed]);
  for (const c of hand) if (c.kind === 'letter') dead.add(c.letter);
  return dead;
}

/**
 * Draw `n` cards off the top of the deck, preferring cards that are not dead
 * for this hand.
 *
 * Skipped cards stay in the deck in their original order — this reorders what
 * a player receives, never the deck's composition, so card conservation and
 * the seeded-RNG guarantees are untouched. If every remaining card is dead the
 * top card is taken anyway: a hand that cannot be filled would deadlock the
 * round, and a dead card can still be discarded.
 */
export function drawCards(round: RoundState, n: number, avoid?: ReadonlySet<Letter>): Card[] {
  const out: Card[] = [];
  const taken = new Set<Letter>(avoid ?? []);
  for (let i = 0; i < n && round.deck.length > 0; i++) {
    let idx = round.deck.length - 1;
    if (taken.size > 0) {
      for (let j = round.deck.length - 1; j >= 0; j--) {
        const c = round.deck[j] as Card;
        if (c.kind !== 'letter' || !taken.has(c.letter)) {
          idx = j;
          break;
        }
      }
    }
    const [card] = round.deck.splice(idx, 1) as [Card];
    if (card.kind === 'letter') taken.add(card.letter);
    out.push(card);
  }
  return out;
}

/**
 * Draw a player up to `handMinimum`, never past `handCap` (§3.3).
 * Returns how many cards were actually drawn.
 */
export function drawUp(round: RoundState, player: PlayerState, balance: Balance): number {
  const target = Math.min(balance.setup.handMinimum, balance.setup.handCap);
  const want = target - player.hand.length;
  if (want <= 0) return 0;
  const cards = drawCards(round, want, deadLettersFor(round, player.hand));
  player.hand.push(...cards);
  return cards.length;
}

/**
 * Start a round: fresh deck, 7 cards each, gauge at 0, seat order fixed.
 *
 * Mutates `state` — internal use. `applyAction` clones before calling this, so
 * the caller's state is never touched.
 */
export function startRound(state: GameState, puzzle: Puzzle, nowMs: number, events: GameEvent[]): void {
  const seated = activePlayers(state);
  if (seated.length < state.balance.setup.minPlayers) {
    throw new EngineError('ROUND_NOT_ACTIVE', `need ${state.balance.setup.minPlayers} players`);
  }
  if (state.status === 'match-end') throw new EngineError('ROUND_NOT_ACTIVE', 'match is over');
  if (state.round && state.round.endedReason === null) {
    throw new EngineError('ROUND_NOT_ACTIVE', 'a round is already in progress');
  }

  const rng = createRng(state.rngState);
  state.roundNumber += 1;
  const answer = normalizePuzzleText(puzzle.text);
  const deck = buildDeck(puzzle, seated.length, state.balance, rng, `r${state.roundNumber}`);

  const round: RoundState = {
    roundNumber: state.roundNumber,
    puzzle,
    answer,
    revealed: [],
    missed: [],
    hintRevealed: false,
    pressure: state.balance.pressure.start,
    direction: 1,
    currentPlayerId: null,
    turnEndsAt: null,
    phase: 'turn',
    turnActed: false,
    deck,
    discard: [],
    stack: [],
    window: null,
    windowSeq: 0,
    afterWindow: null,
    deckSize: deck.length,
    totalLetters: totalLetterCount(answer),
    turnsSinceReveal: 0,
    order: seated.map((p) => p.id),
    nextPlayerOverride: null,
    endedReason: null,
    solvedBy: null,
    blownBy: null,
  };

  for (const p of seated) {
    p.roundScore = 0;
    // Same rule at the deal: no player starts holding a pair of the same letter.
    p.hand = drawCards(round, state.balance.setup.startingHand, new Set());
    p.peeks = {};
    p.solveLocked = false;
    p.lockedNextTurn = false;
    p.doubleDownArmed = false;
    p.skipNextTurn = false;
    p.buzzInsLeft = state.balance.interrupt.buzzInPerRound;
  }

  state.round = round;
  state.status = 'playing';
  state.rngState = rng.state();
  events.push({ t: 'round:start', roundNumber: round.roundNumber, category: puzzle.category, deckSize: round.deckSize });
}

/** Append events to the capped in-state log. */
export function pushLog(state: GameState, events: GameEvent[]): void {
  if (events.length === 0) return;
  state.log.push(...events);
  if (state.log.length > LOG_CAP) state.log.splice(0, state.log.length - LOG_CAP);
}
