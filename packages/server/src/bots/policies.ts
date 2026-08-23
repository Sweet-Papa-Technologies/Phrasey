/**
 * BOT SEAM.
 *
 * M4 is writing the bot *brains* as `PlayerPolicy` implementations in
 * `packages/engine/src/bots/`, exported from `@phrasey/engine`. This server
 * owns the *driver* (bots/driver.ts) and nothing else: no decision logic lives
 * on this side of the seam.
 *
 * The import is defensive on purpose. Until the bots land, `@phrasey/engine`
 * exports no factory, and this falls back to the engine's own `randomPolicy` so
 * the server is never blocked on M4. When the factory appears it is picked up
 * with no change here.
 *
 * ---- REPLACE-ME MARKER -------------------------------------------------
 * The moment `@phrasey/engine` exports one of FACTORY_NAMES, delete nothing:
 * `resolveBotPolicies()` finds it and `origin` flips from 'fallback' to the
 * factory's name. `policies.test.ts` asserts the fallback path still works.
 * ------------------------------------------------------------------------
 */
import type { BotTier, Balance, Puzzle } from '@phrasey/shared';
import { randomPolicy, type PlayerPolicy } from '@phrasey/engine';
import type { Logger } from '../logger.js';

/** Names M4 might plausibly export, in preference order. */
const FACTORY_NAMES = ['policyForTier', 'createBotPolicy', 'makeBotPolicy', 'botPolicy', 'createPolicy'] as const;

export interface BotPolicies {
  for(tier: BotTier): PlayerPolicy;
  readonly origin: string;
}

/**
 * What M4's factory is handed. Both fields are optional on its side — an older
 * factory that ignores them still works, which is why this is passed
 * positionally-optional rather than required.
 */
export interface BotPolicyContext {
  /** The room's live balance, so `/config/balance` reaches the bots too. */
  balance?: Balance;
  /** The pool the round was dealt from — §5's "corpus subset" for deduction. */
  corpus?: readonly Puzzle[];
}

type Factory = (tier: BotTier, opts?: BotPolicyContext) => PlayerPolicy;

function isPolicy(v: unknown): v is PlayerPolicy {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as PlayerPolicy).chooseTurnAction === 'function' &&
    typeof (v as PlayerPolicy).chooseInterrupt === 'function'
  );
}

export async function resolveBotPolicies(log: Logger, ctx: BotPolicyContext = {}): Promise<BotPolicies> {
  const fallback: BotPolicies = { for: () => randomPolicy, origin: 'fallback:randomPolicy' };

  let mod: Record<string, unknown>;
  try {
    mod = (await import('@phrasey/engine')) as unknown as Record<string, unknown>;
  } catch (err) {
    log.warn({ err: String(err) }, 'engine import for bot policies failed; using randomPolicy');
    return fallback;
  }

  for (const name of FACTORY_NAMES) {
    const candidate = mod[name];
    if (typeof candidate !== 'function') continue;
    const factory = candidate as Factory;
    // Prove it before trusting it: a factory that throws or returns junk must
    // not take the server down mid-round.
    try {
      const probe = factory('sharp', ctx);
      if (!isPolicy(probe)) continue;
      log.info({ factory: name }, 'bot policy factory found');
      const cache = new Map<BotTier, PlayerPolicy>();
      return {
        origin: `engine:${name}`,
        for(tier) {
          const hit = cache.get(tier);
          if (hit) return hit;
          try {
            const p = factory(tier, ctx);
            if (!isPolicy(p)) throw new Error('not a PlayerPolicy');
            cache.set(tier, p);
            return p;
          } catch (err) {
            log.warn({ err: String(err), tier }, 'bot policy factory threw; using randomPolicy');
            cache.set(tier, randomPolicy);
            return randomPolicy;
          }
        },
      };
    } catch (err) {
      log.warn({ err: String(err), factory: name }, 'bot policy factory probe failed');
    }
  }

  log.info('no bot policy factory exported by @phrasey/engine; using randomPolicy');
  return fallback;
}
