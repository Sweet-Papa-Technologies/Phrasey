/**
 * The policy seam between the engine and the bots (M4 owns the brains).
 *
 * A policy sees ONLY a `PlayerView`. It cannot reach the answer, the deck, or
 * anybody else's hand — which is the entire point of §5: "Bots are never given
 * the answer — this is real deduction, and it's what a strong human does anyway."
 *
 * Policies are pure and take the RNG as a parameter, so a bot match is as
 * reproducible as a human one.
 */
import { ALPHABET, VOWELS, isActionCard, isLetterCard } from '@phrasey/shared';
import type { EngineAction } from './actions.js';
import type { Rng } from './rng.js';
import type { InterruptWindowView, PlayerView } from './view.js';

export interface PlayerPolicy {
  /** Called when it is this player's turn (phase 'turn' or 'awaiting-solve'). */
  chooseTurnAction(view: PlayerView, rng: Rng): EngineAction;
  /** Called while an interrupt window this player is eligible for is open. */
  chooseInterrupt(view: PlayerView, window: InterruptWindowView, rng: Rng): EngineAction | null;
}

/** Letters that are still worth playing, from the view alone. */
export function unguessedLetters(view: PlayerView): string[] {
  const used = new Set(view.board?.guessedLetters ?? []);
  return ALPHABET.filter((l) => !used.has(l));
}

/**
 * The trivial reference policy. Not a bot — it exists so the simulator can run
 * before M4 lands, and so the soak test explores weird lines a smart policy
 * would never take.
 */
export const randomPolicy: PlayerPolicy = {
  chooseTurnAction(view, rng) {
    const id = view.playerId;
    if (view.phase === 'awaiting-solve') {
      // A random policy has no idea what the phrase is. Occasionally guessing
      // garbage is useful: it exercises the wrong-solve / pressure path.
      if (rng.next() < 0.05) return { type: 'solve', playerId: id, guess: 'NOT THE ANSWER' };
      return { type: 'pass', playerId: id };
    }

    const open = unguessedLetters(view);
    const openSet = new Set(open);
    const others = view.players.filter((p) => p.id !== id).map((p) => p.id);
    const playable: EngineAction[] = [];

    for (const card of view.hand) {
      if (isLetterCard(card)) {
        if (openSet.has(card.letter)) {
          playable.push({ type: 'playCard', playerId: id, intent: { type: 'letter', cardId: card.id } });
        }
        continue;
      }
      if (!isActionCard(card)) continue;
      switch (card.action) {
        case 'SWIPE':
        case 'BLOCK':
        case 'BUZZ_IN':
          break; // interrupts are never a turn action
        case 'WILD': {
          if (open.length === 0) break;
          playable.push({
            type: 'playCard',
            playerId: id,
            intent: { type: 'action', cardId: card.id, letter: rng.pick(open) },
          });
          break;
        }
        case 'VOWEL_RUSH': {
          const vowels = (VOWELS as readonly string[]).filter((v) => openSet.has(v));
          if (vowels.length === 0) break;
          playable.push({
            type: 'playCard',
            playerId: id,
            intent: { type: 'action', cardId: card.id, letter: rng.pick(vowels) },
          });
          break;
        }
        case 'LOCKOUT': {
          if (others.length === 0) break;
          playable.push({
            type: 'playCard',
            playerId: id,
            intent: { type: 'action', cardId: card.id, targetPlayerId: rng.pick(others) },
          });
          break;
        }
        default:
          playable.push({ type: 'playCard', playerId: id, intent: { type: 'action', cardId: card.id } });
      }
    }

    if (playable.length > 0) return rng.pick(playable);
    const first = view.hand[0];
    if (first) return { type: 'discard', playerId: id, cardIds: [first.id] };
    // Empty hand: let the clock hand the turn on.
    return { type: 'timeout', playerId: id };
  },

  chooseInterrupt(view, window, rng) {
    if (window.playableCardIds.length === 0) return null;
    if (rng.next() < 0.5) return null;
    return {
      type: 'playInterrupt',
      playerId: view.playerId,
      cardId: rng.pick(window.playableCardIds),
      windowId: window.windowId,
    };
  },
};

/** A policy that never does anything but take the cheapest legal action. */
export const passivePolicy: PlayerPolicy = {
  chooseTurnAction(view) {
    const id = view.playerId;
    if (view.phase === 'awaiting-solve') return { type: 'pass', playerId: id };
    const first = view.hand[0];
    if (first) return { type: 'discard', playerId: id, cardIds: [first.id] };
    return { type: 'timeout', playerId: id };
  },
  chooseInterrupt(): null {
    return null;
  },
};
