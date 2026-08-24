/**
 * Every tunable number in Phrasey lives here.
 *
 * Design doc §15: "Every balance number in this doc is a starting value."
 * These are defaults; `/config/balance` in Firestore can override any leaf at
 * runtime via `mergeBalance()`. The engine NEVER reads this module directly —
 * it takes a `Balance` object as input so simulations can sweep values.
 */
import type { ActionCardKind } from './types.js';

export type MatchMode = 'rounds' | 'score';
export type BotTier = 'chill' | 'sharp' | 'ruthless';

export interface BotTierConfig {
  /** Probability of committing to a solve when deduction narrows to one answer. */
  solveRoll: number;
  /** Probability of preferring an action card when one is situationally good. */
  actionCardBias: number;
  /** Noise added to letter expected-value scoring; higher = dumber. */
  scoreNoise: number;
  thinkMsMin: number;
  thinkMsMax: number;
  usesInterrupts: boolean;
}

export const BALANCE = {
  /** §3.1 Setup */
  setup: {
    minPlayers: 2,
    maxPlayers: 8,
    /** Single-player default: 1 human + this many bots. */
    defaultBots: 3,
    maxBots: 7,
    /** Cards dealt to each player at the start of a round. */
    startingHand: 7,
    /** Draw back up to this at end of turn (§3.3). */
    handMinimum: 5,
    /** Cannot draw at or above this; must play or discard (§3.3). */
    handCap: 8,
  },

  /** §3.1 Match length. Host picks a mode at room creation. */
  match: {
    /** 'rounds' = fixed round count, 'score' = first past targetScore. */
    defaultMode: 'rounds' as MatchMode,
    defaultRounds: 5,
    minRounds: 1,
    maxRounds: 15,
    defaultTargetScore: 300,
    minTargetScore: 50,
    maxTargetScore: 2000,
  },

  /** §3.2 Deck construction — the most important tuning knob in the game. */
  deck: {
    /** Fraction of the deck that is letter cards; the rest are action cards. */
    letterCardShare: 0.7,
    /** Of the letter cards, the share drawn from letters in the puzzle. */
    puzzleLetterShare: 0.65,
    /** deckSize = max(minDeckSize, players * perPlayer) */
    minDeckSize: 60,
    perPlayer: 18,
    /** Never dealt as noise unless the letter appears in the puzzle. */
    rareNoiseExcluded: ['J', 'Q', 'X', 'Z'],
    /**
     * Vowels are powerful, so they are under-weighted relative to natural
     * English frequency in BOTH the noise pool and the puzzle-letter pool.
     */
    vowelWeightMultiplier: 0.55,
    /**
     * Relative weights for action cards inside the 30% action slice.
     * Interrupts are rarer than turn cards — they are meant to be a moment.
     */
    actionWeights: {
      SKIP: 10,
      REVERSE: 8,
      DOUBLE_DOWN: 9,
      VOWEL_RUSH: 7,
      SHUFFLE: 5,
      PEEK: 8,
      CRACK: 5,
      RELIEF_VALVE: 9,
      VANDAL: 5,
      WILD: 6,
      LOCKOUT: 6,
      SWIPE: 5,
      BLOCK: 5,
      BUZZ_IN: 4,
    } as Record<ActionCardKind, number>,
  },

  /** §3.3 Turn */
  turn: {
    /** Seconds. `null` = timer disabled (host option, also §10 a11y). */
    defaultSeconds: 15 as number | null,
    allowedSeconds: [10, 15, 25, null] as (number | null)[],
    /** Max cards discardable in one Discard & Draw action. */
    maxDiscard: 3,
    minDiscard: 1,
  },

  /** §3.3 Scoring */
  scoring: {
    /** Points per revealed occurrence on a letter hit. */
    perRevealedLetter: 10,
    /** Flat bonus for a correct solve. */
    solveBase: 50,
    /** Extra per letter tile still hidden at the moment of the solve. */
    solveHiddenBonus: 5,
    /** Penalty applied to whoever tipped the gauge to BLOWOUT. */
    blowoutPenalty: -20,
    /** DOUBLE DOWN multiplier on the next letter play. */
    doubleDownMultiplier: 2,
  },

  /** §3.4 The pressure gauge */
  pressure: {
    max: 12,
    start: 0,
    wrongLetter: 1,
    wrongSolve: 3,
    vowelRush: 2,
    vandal: 2,
    reliefValve: -3,
    /** DOUBLE DOWN doubles the pressure cost of a miss too. */
    doubleDownMissMultiplier: 2,
  },

  /** §3.5 Interrupts */
  interrupt: {
    /** Milliseconds the out-of-turn window stays open. */
    windowMs: 4000,
    /** LIFO chain cap so BLOCK-on-BLOCK cannot stall the game. */
    maxChain: 3,
    /** BUZZ IN is once per round per player. */
    buzzInPerRound: 1,
  },

  /** §3.6 Anti-stall — "the board breathes" */
  antiStall: {
    /** Full turn cycles with no new reveal before the server opens a tile. */
    idleCyclesBeforeBreath: 2,
  },

  /** §5 Bots */
  bots: {
    tiers: {
      chill: { solveRoll: 0.25, actionCardBias: 0.15, scoreNoise: 0.55, thinkMsMin: 2500, thinkMsMax: 4000, usesInterrupts: false },
      sharp: { solveRoll: 0.6, actionCardBias: 0.35, scoreNoise: 0.2, thinkMsMin: 1500, thinkMsMax: 3000, usesInterrupts: false },
      ruthless: { solveRoll: 0.9, actionCardBias: 0.5, scoreNoise: 0.03, thinkMsMin: 1200, thinkMsMax: 2500, usesInterrupts: true },
    } as Record<BotTier, BotTierConfig>,
  },

  /** §7 Session flow */
  session: {
    /**
     * Seconds a disconnected player's seat is held before it becomes a bot.
     *
     * §7 specified 90s, which was written for a laptop losing wifi. Phones are
     * the actual client: iOS auto-locks after 30s–2min, and a locked screen or
     * a backgrounded tab freezes timers and tears down the websocket within
     * seconds. Glancing at one notification routinely costs more than 90s, and
     * coming back to find yourself replaced by a bot is the single worst thing
     * this game can do to a player. Three minutes covers a normal glance-away;
     * it is still short enough that a table is not left waiting on someone who
     * actually walked off, and the seat is a bot — not empty — the whole time,
     * so play never stalls. Reclaiming works after conversion too, so this is
     * a comfort window rather than a hard deadline.
     */
    reconnectWindowSeconds: 180,
    /** Firestore room doc TTL (§6.4). */
    roomTtlHours: 6,
    /** §6.2 snapshot cadence for crash recovery. */
    snapshotEveryNEvents: 10,
  },
};

/** The engine consumes this shape; every field is mutable so sims can sweep it. */
export type Balance = typeof BALANCE;

/** Structural clone of the defaults. Safe to mutate. */
export function defaultBalance(): Balance {
  return structuredClone(BALANCE);
}

export type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

/**
 * Merge a partial override (e.g. the `/config/balance` Firestore doc) onto the
 * defaults. Arrays are replaced wholesale, objects merged key-by-key. Unknown
 * keys are ignored so a stale Firestore doc can never inject garbage.
 */
export function mergeBalance(override: DeepPartial<Balance> | null | undefined): Balance {
  const base = defaultBalance();
  if (!override) return base;
  return mergeInto(base, override) as Balance;
}

function mergeInto(base: unknown, over: unknown): unknown {
  if (over === null || over === undefined) return base;
  if (Array.isArray(base)) return Array.isArray(over) ? over : base;
  if (typeof base === 'object' && base !== null && typeof over === 'object') {
    const out = base as Record<string, unknown>;
    for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
      if (!(k in out)) continue; // ignore unknown keys
      out[k] = mergeInto(out[k], v);
    }
    return out;
  }
  return typeof over === typeof base ? over : base;
}

/**
 * Relative English letter frequency, used to build the noise slice of the deck
 * and as the prior for bot letter scoring. Values are percentages and need not
 * sum to exactly 100.
 */
export const ENGLISH_LETTER_FREQUENCY: Record<string, number> = {
  E: 12.7, T: 9.06, A: 8.17, O: 7.51, I: 6.97, N: 6.75, S: 6.33, H: 6.09,
  R: 5.99, D: 4.25, L: 4.03, C: 2.78, U: 2.76, M: 2.41, W: 2.36, F: 2.23,
  G: 2.02, Y: 1.97, P: 1.93, B: 1.49, V: 0.98, K: 0.77, J: 0.15, X: 0.15,
  Q: 0.1, Z: 0.07,
};

export const VOWELS = ['A', 'E', 'I', 'O', 'U'] as const;
export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
