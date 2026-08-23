/**
 * One module per action-card effect (§3.5) so each is individually testable.
 *
 * Every effect receives the same context and reports back the two things the
 * turn loop needs to know: did the round just end, and is the effect parked on
 * the interrupt stack waiting for a BLOCK.
 */
import type { ActionCard, Balance, GameEvent, Letter } from '@phrasey/shared';
import type { Rng } from '../rng.js';
import type { GameState, PlayerState, RoundState } from '../state.js';

export interface CardContext {
  state: GameState;
  round: RoundState;
  /** The player taking the turn. */
  player: PlayerState;
  /** The card, already removed from the hand. */
  card: ActionCard;
  /** WILD / VOWEL_RUSH carry a letter; LOCKOUT carries a target. */
  letter?: Letter;
  targetPlayerId?: string;
  events: GameEvent[];
  nowMs: number;
  rng: Rng;
  balance: Balance;
}

export interface CardOutcome {
  /** The gauge tipped. The turn loop ends the round. */
  blowout?: boolean;
  /** Parked on the interrupt stack; do not advance the turn yet. */
  deferred?: boolean;
  /** The card is held on the stack, so the turn loop must not discard it. */
  retainsCard?: boolean;
}

export type CardEffect = (ctx: CardContext) => CardOutcome;
