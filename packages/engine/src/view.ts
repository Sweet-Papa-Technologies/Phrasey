/**
 * `PlayerView` — everything one player is legitimately allowed to see.
 *
 * SECURITY INVARIANT (§6.2, §5): a PlayerView must NEVER contain the answer.
 * That is not a nicety, it is what makes bot deduction real: a bot gets the same
 * masked board and the same `boardPattern` a sharp human would reason from, and
 * nothing else. `view.test.ts` asserts the leak-freeness directly.
 *
 * The one piece of private information here is `peeks` — tiles this player paid
 * a PEEK card for. That is theirs by the rules, and it is per-player, so it can
 * never reach anyone else's view.
 */
import type {
  Card,
  Letter,
  MaskedBoard,
  PlayerPublic,
  RoomSettings,
  RoomStatus,
  RoundPublic,
} from '@phrasey/shared';
import { boardPattern as computePattern, maskBoardFromRound } from './board.js';
import { idleCycles } from './antiStall.js';
import { WINDOW_CARD } from './interrupts.js';
import { activePlayers, getPlayer, toPublic, type GameState, type InterruptWindowKind, type RoundPhase } from './state.js';
import { seatOrder } from './turnOrder.js';

export interface InterruptWindowView {
  windowId: string;
  kind: InterruptWindowKind;
  sourcePlayerId: string;
  targetPlayerId: string | null;
  expiresAt: number;
  chain: number;
  /** Cards in *your* hand that are legal in this window right now. */
  playableCardIds: string[];
  /** You have already declined. */
  passed: boolean;
}

export interface PlayerView {
  playerId: string;
  status: RoomStatus;
  roundNumber: number;
  settings: RoomSettings;
  /** null outside a round. */
  phase: RoundPhase | null;
  board: MaskedBoard | null;
  round: RoundPublic | null;
  pressure: number;
  pressureMax: number;
  hand: Card[];
  /** PRIVATE: board tile index -> letter, bought with PEEK. */
  peeks: Record<number, Letter>;
  self: PlayerPublic;
  players: PlayerPublic[];
  isMyTurn: boolean;
  hasActed: boolean;
  /** The engine would accept a `solve` from you right now. */
  canSolve: boolean;
  /** The engine would accept a primary action from you right now. */
  canAct: boolean;
  /**
   * Source of a regex matching every phrase consistent with the visible board
   * (§5). Bots do `new RegExp(view.boardPattern)` against the corpus.
   */
  boardPattern: string | null;
  window: InterruptWindowView | null;
  deckRemaining: number;
  discardCount: number;
  idleCycles: number;
}

export function roundPublic(state: GameState): RoundPublic | null {
  const round = state.round;
  if (!round) return null;
  return {
    roundNumber: round.roundNumber,
    board: maskBoardFromRound(round),
    pressure: round.pressure,
    pressureMax: state.balance.pressure.max,
    phase: round.phase,
    currentPlayerId: round.currentPlayerId,
    direction: round.direction,
    turnEndsAt: round.turnEndsAt,
    deckRemaining: round.deck.length,
    idleCycles: idleCycles(round, seatOrder(state, round).length),
  };
}

export function playerView(state: GameState, playerId: string): PlayerView {
  const self = getPlayer(state, playerId);
  const round = state.round;
  const publicPlayers = activePlayers(state).map(toPublic);

  if (!round) {
    return {
      playerId,
      status: state.status,
      roundNumber: state.roundNumber,
      settings: state.settings,
      phase: null,
      board: null,
      round: null,
      pressure: 0,
      pressureMax: state.balance.pressure.max,
      hand: self.hand.map((c) => ({ ...c })),
      peeks: { ...self.peeks },
      self: toPublic(self),
      players: publicPlayers,
      isMyTurn: false,
      hasActed: false,
      canSolve: false,
      canAct: false,
      boardPattern: null,
      window: null,
      deckRemaining: 0,
      discardCount: 0,
      idleCycles: 0,
    };
  }

  const isMyTurn = round.currentPlayerId === playerId;
  const active = round.endedReason === null;
  const canSolve = active && isMyTurn && round.phase === 'awaiting-solve' && !self.solveLocked && !self.lockedNextTurn;

  let window: InterruptWindowView | null = null;
  const w = round.window;
  if (w && active && w.eligible.includes(playerId)) {
    const wanted = WINDOW_CARD[w.kind];
    window = {
      windowId: w.id,
      kind: w.kind,
      sourcePlayerId: w.sourcePlayerId,
      targetPlayerId: w.targetPlayerId,
      expiresAt: w.expiresAt,
      chain: w.chain,
      playableCardIds: self.hand.filter((c) => c.kind === 'action' && c.action === wanted).map((c) => c.id),
      passed: w.passed.includes(playerId),
    };
  }

  return {
    playerId,
    status: state.status,
    roundNumber: round.roundNumber,
    settings: state.settings,
    phase: round.phase,
    board: maskBoardFromRound(round),
    round: roundPublic(state),
    pressure: round.pressure,
    pressureMax: state.balance.pressure.max,
    hand: self.hand.map((c) => ({ ...c })),
    peeks: { ...self.peeks },
    self: toPublic(self),
    players: publicPlayers,
    isMyTurn,
    hasActed: round.turnActed,
    canSolve,
    canAct: active && isMyTurn && round.phase === 'turn',
    boardPattern: computePattern(round).source,
    window,
    deckRemaining: round.deck.length,
    discardCount: round.discard.length,
    idleCycles: idleCycles(round, seatOrder(state, round).length),
  };
}
