/**
 * `/config/balance` (§6.4, §15: "make them overridable from /config/balance").
 *
 * Loaded once at boot. `mergeBalance` ignores unknown keys, so a stale or
 * hand-edited doc can never inject garbage into the engine.
 */
import type { Balance, DeepPartial } from '@phrasey/shared';
import { mergeBalance } from '@phrasey/shared';
import type { Firestore } from './firestore.js';
import type { Logger } from '../logger.js';

export async function loadBalance(db: Firestore | null, log: Logger): Promise<Balance> {
  if (!db) return mergeBalance(null);
  try {
    const doc = await db.doc('config/balance').get();
    if (!doc.exists) {
      log.info('config/balance not present; using defaults');
      return mergeBalance(null);
    }
    const override = doc.data() as DeepPartial<Balance>;
    log.info({ keys: Object.keys(override ?? {}) }, 'config/balance applied');
    return mergeBalance(override);
  } catch (err) {
    log.warn({ err: String(err) }, 'config/balance load failed; using defaults');
    return mergeBalance(null);
  }
}
