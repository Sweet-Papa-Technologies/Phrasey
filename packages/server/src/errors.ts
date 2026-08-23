/** Errors that are safe to hand a client. Never carries engine internals. */
import { EngineError, type SocketError } from '@phrasey/shared';

export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
  toSocketError(): SocketError {
    return { code: this.code, message: this.message };
  }
}

/**
 * Map anything thrown during a client-initiated action into a stable
 * `{ code, message }`. Unknown failures collapse to INTERNAL: an exception
 * message could name a card id, a seat, or worse.
 */
export function toSocketError(err: unknown): SocketError {
  if (err instanceof AppError) return err.toSocketError();
  if (err instanceof EngineError) return { code: err.code, message: engineMessage(err.code) };
  return { code: 'INTERNAL', message: 'Something went wrong.' };
}

function engineMessage(code: string): string {
  switch (code) {
    case 'NOT_YOUR_TURN':
      return "It is not your turn.";
    case 'CARD_NOT_IN_HAND':
      return 'You are not holding that card.';
    case 'WRONG_CARD_TYPE':
      return 'That card cannot be played that way.';
    case 'LETTER_ALREADY_GUESSED':
      return 'That letter has already been played this round.';
    case 'LETTER_REQUIRED':
      return 'That card needs a letter.';
    case 'TARGET_REQUIRED':
      return 'That card needs a target.';
    case 'INVALID_TARGET':
      return 'That target is not valid.';
    case 'SOLVE_LOCKED':
      return 'You are locked out of solving.';
    case 'ALREADY_ACTED':
      return 'You have already taken your action this turn.';
    case 'ROUND_NOT_ACTIVE':
      return 'The round is not accepting that right now.';
    case 'INVALID_DISCARD':
      return 'You cannot discard that.';
    case 'NO_INTERRUPT_WINDOW':
      return 'That interrupt window is closed.';
    case 'INTERRUPT_NOT_ALLOWED':
      return 'You cannot interrupt with that.';
    case 'BUZZ_EXHAUSTED':
      return 'You have used your Buzz In this round.';
    case 'CHAIN_LIMIT':
      return 'The interrupt chain is capped.';
    default:
      return 'That move is not legal.';
  }
}
