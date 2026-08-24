/**
 * Why a player may not solve right now.
 *
 * There are two ways to lose the solve and they mean very different things:
 *
 *  - `round` — you guessed wrong (§3.3). It is gone for the rest of the round,
 *    and the only thing left to do is play letters.
 *  - `turn`  — somebody played LOCKOUT at you (§3.5). It is back next turn, so
 *    the right move is often to sit on what you know rather than feed the
 *    board.
 *
 * The screen used to check only `solveLocked`, so a LOCKOUT left the Solve
 * button live: you typed a whole guess and the server threw it out. Both
 * reasons are checked here, in one place, and every gate — the button, the
 * Enter key, the solve box — reads this function.
 */
import type { PlayerPublic } from '@phrasey/shared';

export type SolveLockReason = 'round' | 'turn';

export interface SolveLockCopy {
  /** Text on the disabled Solve button. */
  button: string;
  /** `aria-label` and `title` on it. */
  detail: string;
  /** Toast shown when Enter is pressed anyway. */
  toast: string;
  /** Line inside the solve box if it is open when the lock lands. */
  note: string;
}

export const SOLVE_LOCK_COPY: Record<SolveLockReason, SolveLockCopy> = {
  round: {
    button: 'Locked out',
    detail: 'You missed a solve — locked out of solving for the rest of this round',
    toast: "You missed a solve. You're locked out for the rest of this round.",
    note: "You missed a solve, so you're locked out for the rest of this round.",
  },
  turn: {
    button: 'Locked this turn',
    detail: 'A LOCKOUT card blocks your solve for this turn only',
    toast: 'A LOCKOUT card blocks your solve this turn. It comes back next turn.',
    note: 'A LOCKOUT card blocks your solve this turn. It comes back next turn.',
  },
};

/**
 * The reason this player cannot solve, or null if they can.
 *
 * The round lock wins when both are set: it is the more final of the two, and
 * telling someone their solve returns next turn when it does not would be the
 * worse mistake.
 */
export function solveLockReason(
  player: Pick<PlayerPublic, 'solveLocked' | 'lockedNextTurn'> | null | undefined,
): SolveLockReason | null {
  if (!player) return null;
  if (player.solveLocked) return 'round';
  if (player.lockedNextTurn) return 'turn';
  return null;
}
