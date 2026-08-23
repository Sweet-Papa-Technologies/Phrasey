import { hiddenTiles } from '../board.js';
import type { CardContext, CardOutcome } from './types.js';

/**
 * PEEK (§3.5): the server privately reveals the identity of one hidden tile to
 * you only.
 *
 * The result goes into `player.peeks` (board index -> letter) and is surfaced
 * only through `hand:update`, which the protocol marks PRIVATE. It never enters
 * `MaskedBoard`. The emitted `peek` event carries the letter, so the server MUST
 * route that event to the peeking socket alone.
 */
export function applyPeek(ctx: CardContext): CardOutcome {
  const candidates = hiddenTiles(ctx.round).filter((t) => ctx.player.peeks[t.index] === undefined);
  if (candidates.length === 0) {
    ctx.events.push({ t: 'notice', message: 'Nothing left to peek at.' });
    return {};
  }
  const tile = ctx.rng.pick(candidates);
  ctx.player.peeks[tile.index] = tile.ch;
  ctx.events.push({ t: 'peek', playerId: ctx.player.id, index: tile.index, letter: tile.ch });
  return {};
}
