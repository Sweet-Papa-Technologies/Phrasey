/**
 * Simulator policies. These are NOT the shipping bots — M4 owns those. They
 * exist so balance sweeps produce numbers that resemble real play.
 *
 * `deductionPolicy` is deliberately built the way §5 describes the real bots:
 * it runs the masked board's regex against a corpus subset and only commits to a
 * solve when the pattern narrows to a single candidate. It is never handed the
 * answer, so the solve rates the sim reports are honest.
 */
import type { Puzzle } from '@phrasey/shared';
import { ENGLISH_LETTER_FREQUENCY, VOWELS, isActionCard, isLetterCard, letterStats } from '@phrasey/shared';
import type { EngineAction } from '../actions.js';
import type { PlayerPolicy, PlayerView } from '../index.js';
import type { Rng } from '../rng.js';

export interface DeductionOptions {
  corpus: readonly Puzzle[];
  /** Probability of committing when deduction narrows to one candidate (§5). */
  solveRoll: number;
  /** Probability of preferring a situationally good action card. */
  actionCardBias: number;
  /** Noise added to letter scores; higher = dumber. */
  scoreNoise: number;
  /**
   * Do not attempt a solve until this fraction of the board is face-up.
   *
   * Without it a corpus-matching bot is unrealistically strong: word-length
   * structure alone fingerprints most phrases, so the bot solves on turn one
   * and every balance number collapses. A strong human needs to actually see
   * letters. Default 0.35.
   */
  minRevealedFraction?: number;
}

function candidates(view: PlayerView, corpus: readonly Puzzle[]): Puzzle[] {
  if (!view.boardPattern) return [];
  const re = new RegExp(view.boardPattern);
  return corpus.filter((p) => re.test(p.text));
}

/**
 * Expected value of a letter, from the view alone: how often it shows up in the
 * phrases still consistent with the board, falling back to English frequency
 * when deduction has not narrowed anything yet.
 */
function letterScore(letter: string, pool: readonly Puzzle[]): number {
  if (pool.length === 0) return ENGLISH_LETTER_FREQUENCY[letter] ?? 0;
  let total = 0;
  for (const p of pool) total += letterStats(p.text)[letter] ?? 0;
  return (total / pool.length) * 10;
}

export function deductionPolicy(opts: DeductionOptions): PlayerPolicy {
  const { corpus, solveRoll, actionCardBias, scoreNoise } = opts;
  const minRevealed = opts.minRevealedFraction ?? 0.35;

  return {
    chooseTurnAction(view, rng): EngineAction {
      const id = view.playerId;
      const pool = candidates(view, corpus);

      if (view.phase === 'awaiting-solve') {
        const board = view.board;
        const shown = board && board.totalLetters > 0 ? 1 - board.hiddenLetters / board.totalLetters : 0;
        const only = pool.length === 1 ? pool[0] : undefined;
        if (only && shown >= minRevealed && rng.bool(solveRoll)) {
          return { type: 'solve', playerId: id, guess: only.text };
        }
        return { type: 'pass', playerId: id };
      }

      const used = new Set(view.board?.guessedLetters ?? []);
      const letters = view.hand.filter(isLetterCard).filter((c) => !used.has(c.letter));

      // Situational action cards, gated on the tier's bias.
      const actions = view.hand.filter(isActionCard).filter((c) => !['SWIPE', 'BLOCK', 'BUZZ_IN'].includes(c.action));
      if (actions.length > 0 && rng.bool(actionCardBias)) {
        const relief = actions.find((c) => c.action === 'RELIEF_VALVE');
        if (relief && view.pressure >= view.pressureMax - 3) {
          return { type: 'playCard', playerId: id, intent: { type: 'action', cardId: relief.id } };
        }
        const wild = actions.find((c) => c.action === 'WILD');
        if (wild) {
          const open = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((l) => !used.has(l));
          const best = open.sort((a, b) => letterScore(b, pool) - letterScore(a, pool))[0];
          if (best) return { type: 'playCard', playerId: id, intent: { type: 'action', cardId: wild.id, letter: best } };
        }
        const rush = actions.find((c) => c.action === 'VOWEL_RUSH');
        if (rush && view.pressure <= view.pressureMax - 4) {
          const vowel = (VOWELS as readonly string[]).filter((v) => !used.has(v))[0];
          if (vowel) return { type: 'playCard', playerId: id, intent: { type: 'action', cardId: rush.id, letter: vowel } };
        }
        const safe = actions.find((c) => ['SKIP', 'REVERSE', 'DOUBLE_DOWN', 'PEEK', 'CRACK', 'SHUFFLE'].includes(c.action));
        if (safe) return { type: 'playCard', playerId: id, intent: { type: 'action', cardId: safe.id } };
        const lock = actions.find((c) => c.action === 'LOCKOUT');
        const others = view.players.filter((p) => p.id !== id);
        if (lock && others.length > 0) {
          const target = others.reduce((a, b) => (b.score > a.score ? b : a));
          return { type: 'playCard', playerId: id, intent: { type: 'action', cardId: lock.id, targetPlayerId: target.id } };
        }
      }

      if (letters.length > 0) {
        const scored = letters.map((c) => ({ c, s: letterScore(c.letter, pool) + rng.next() * scoreNoise * 10 }));
        scored.sort((a, b) => b.s - a.s);
        const pick = scored[0];
        if (pick) return { type: 'playCard', playerId: id, intent: { type: 'letter', cardId: pick.c.id } };
      }

      // Nothing live: dump the deadest cards and redraw.
      const dump = view.hand.slice(0, Math.min(3, view.hand.length)).map((c) => c.id);
      if (dump.length > 0) return { type: 'discard', playerId: id, cardIds: dump };
      return { type: 'timeout', playerId: id };
    },

    chooseInterrupt(view, window, rng): EngineAction | null {
      if (window.playableCardIds.length === 0) return null;
      // Swipes and blocks are always worth it; buzzing in is situational.
      const take = window.kind === 'between' ? rng.bool(actionCardBias) : rng.bool(0.8);
      if (!take) return null;
      return {
        type: 'playInterrupt',
        playerId: view.playerId,
        cardId: window.playableCardIds[0] as string,
        windowId: window.windowId,
      };
    },
  };
}
