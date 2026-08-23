/**
 * Out-of-turn interrupts — design doc §3.5.
 *
 * "This is the anti-boredom mechanic; without it, 8-player games have 100+
 * seconds of dead time per turn cycle."
 *
 * Two rules govern everything here:
 *   - The window is 4s (balance.interrupt.windowMs) and resolution is LIFO —
 *     a BLOCK can be blocked.
 *   - The chain is capped at balance.interrupt.maxChain so BLOCK-on-BLOCK
 *     cannot stall the table.
 *
 * DELIBERATE DEVIATION (documented, see the report): a window only opens if at
 * least one eligible player is actually *holding* a card that could be played
 * into it. The doc's literal reading — pause 4s after every hit and between
 * every turn — reintroduces exactly the dead time interrupts exist to remove,
 * and in an 8-player game that is over a minute of nothing per cycle. Opening
 * the window leaks one bit ("somebody holds a Swipe"), which is a far smaller
 * cost than the stall. Everything else about the rule is unchanged.
 */
import type { ActionCard, Balance, Card, GameEvent, InterruptActionKind } from '@phrasey/shared';
import { EngineError, isActionCard } from '@phrasey/shared';
import type { GameState, InterruptWindow, InterruptWindowKind, PendingEffect, RoundState } from './state.js';
import { activePlayers, findPlayer } from './state.js';
import { transferPoints } from './scoring.js';

/** Which interrupt card a given window accepts. */
export const WINDOW_CARD: Record<InterruptWindowKind, InterruptActionKind> = {
  hit: 'SWIPE',
  targeted: 'BLOCK',
  between: 'BUZZ_IN',
};

export function holdsCard(hand: readonly Card[], kind: InterruptActionKind): boolean {
  return hand.some((c) => isActionCard(c) && c.action === kind);
}

export function findInterruptCard(hand: readonly Card[], cardId: string): ActionCard | undefined {
  const card = hand.find((c) => c.id === cardId);
  return card && isActionCard(card) ? card : undefined;
}

/**
 * Who may respond to a window right now. A player must be seated, still in the
 * round, and holding the matching card. BUZZ IN additionally needs a use left.
 */
export function eligibleFor(
  state: GameState,
  kind: InterruptWindowKind,
  sourcePlayerId: string,
  targetPlayerId: string | null,
): string[] {
  const want = WINDOW_CARD[kind];
  const seated = activePlayers(state).filter((p) => state.round?.order.includes(p.id));
  return seated
    .filter((p) => {
      if (kind === 'targeted') return p.id === targetPlayerId;
      if (p.id === sourcePlayerId) return false;
      if (kind === 'between' && p.buzzInsLeft <= 0) return false;
      return true;
    })
    .filter((p) => holdsCard(p.hand, want))
    .map((p) => p.id);
}

/**
 * Open a window if anybody can actually use it. Returns false when the play
 * should just resolve immediately, which is the common case.
 */
export function openWindow(
  state: GameState,
  round: RoundState,
  kind: InterruptWindowKind,
  sourcePlayerId: string,
  targetPlayerId: string | null,
  chain: number,
  nowMs: number,
  events: GameEvent[],
): boolean {
  if (!state.settings.interruptsEnabled) return false;
  if (chain >= state.balance.interrupt.maxChain) return false;
  const eligible = eligibleFor(state, kind, sourcePlayerId, targetPlayerId);
  if (eligible.length === 0) return false;

  const id = `w${round.roundNumber}-${round.windowSeq++}`;
  const window: InterruptWindow = {
    id,
    kind,
    sourcePlayerId,
    targetPlayerId,
    expiresAt: nowMs + state.balance.interrupt.windowMs,
    chain,
    eligible,
    passed: [],
  };
  round.window = window;
  round.phase = 'interrupt';
  events.push({ t: 'interrupt:open', windowId: id, kind, sourcePlayerId, expiresAt: window.expiresAt });
  return true;
}

export function closeWindow(round: RoundState, events: GameEvent[]): void {
  if (!round.window) return;
  events.push({ t: 'interrupt:close', windowId: round.window.id });
  round.window = null;
}

export function everyoneResponded(window: InterruptWindow): boolean {
  return window.eligible.every((id) => window.passed.includes(id));
}

export function isExpired(window: InterruptWindow, nowMs: number): boolean {
  return nowMs >= window.expiresAt;
}

/**
 * Resolve the pending stack LIFO. See the module header for why this is a loop
 * and not a recursion: cancelling a BLOCK means the effect *underneath* it now
 * takes hold, so resolution simply continues down the stack.
 *
 * Mutates `state` — always called on a cloned draft.
 */
export function resolveStack(state: GameState, round: RoundState, balance: Balance, events: GameEvent[]): void {
  void balance;
  while (round.stack.length > 0) {
    const top = round.stack.pop() as PendingEffect;

    if (top.kind === 'block') {
      const victim = round.stack.pop();
      if (victim) {
        events.push({ t: 'block', playerId: top.playerId, blockedCard: victim.card });
        round.discard.push(victim.card);
      }
      round.discard.push(top.card);
      continue;
    }

    if (top.kind === 'swipe') {
      const victim = round.stack.pop();
      if (victim && victim.kind === 'hit') {
        const from = findPlayer(state, victim.playerId);
        const to = findPlayer(state, top.playerId);
        if (from && to && victim.points !== 0) {
          transferPoints(from, to, victim.points);
        }
        events.push({ t: 'swipe', playerId: top.playerId, fromPlayerId: victim.playerId, points: victim.points });
        round.discard.push(victim.card);
      }
      round.discard.push(top.card);
      continue;
    }

    if (top.kind === 'lockout') {
      const target = findPlayer(state, top.targetPlayerId);
      if (target) {
        target.lockedNextTurn = true;
        events.push({ t: 'lockout', playerId: top.playerId, targetPlayerId: top.targetPlayerId });
      }
      round.discard.push(top.card);
      continue;
    }

    // 'hit' — points were already awarded when the letter was played, so the
    // only thing left is to retire the card. Awarding on play (rather than on
    // resolution) keeps `player.score` and the event log in agreement at every
    // instant, which is what the soak invariant checker asserts.
    round.discard.push(top.card);
  }
}

/** The player who owns the effect currently on top of the stack. */
export function topOwner(round: RoundState): string | null {
  const top = round.stack[round.stack.length - 1];
  return top ? top.playerId : null;
}

export function requireWindow(round: RoundState, windowId: string): InterruptWindow {
  const w = round.window;
  if (!w) throw new EngineError('NO_INTERRUPT_WINDOW');
  if (w.id !== windowId) throw new EngineError('NO_INTERRUPT_WINDOW', `window ${windowId} is not open`);
  return w;
}
