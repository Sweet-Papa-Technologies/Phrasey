import type { ActionCard, Balance, GameEvent } from '@phrasey/shared';
import type { GameState, InterruptWindow, PlayerState, RoundState } from '../state.js';

export interface InterruptContext {
  state: GameState;
  round: RoundState;
  player: PlayerState;
  /** The interrupt card, already removed from the hand. */
  card: ActionCard;
  window: InterruptWindow;
  events: GameEvent[];
  nowMs: number;
  balance: Balance;
}

export interface InterruptOutcome {
  /** A counter-window opened; the chain continues. */
  chained: boolean;
  /** The turn may resume (BUZZ IN needs no stack resolution). */
  immediate?: boolean;
}
