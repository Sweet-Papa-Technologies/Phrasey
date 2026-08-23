/**
 * Firestore access. ADC only — no key files (deployment contract).
 *
 * Firestore is a convenience here, not a dependency: live room state lives in
 * server memory (§6.2). Every call in this package is best-effort and logs
 * rather than throws, so an unreachable Firestore degrades the server to
 * "works, loses crash recovery" instead of "does not boot".
 */
import { Firestore, Timestamp } from '@google-cloud/firestore';
import type { Logger } from '../logger.js';
import type { ServerConfig } from '../config.js';

export { Timestamp };
export type { Firestore };

let cached: Firestore | null = null;

export function getFirestore(cfg: ServerConfig, log: Logger): Firestore | null {
  if (!cfg.firestoreEnabled) return null;
  if (cached) return cached;
  try {
    cached = new Firestore({
      ...(cfg.projectId ? { projectId: cfg.projectId } : {}),
      // MUST NOT be the (default) database — that belongs to another app.
      databaseId: cfg.databaseId,
      ignoreUndefinedProperties: true,
    });
    log.info({ databaseId: cfg.databaseId, projectId: cfg.projectId }, 'firestore client created');
    return cached;
  } catch (err) {
    log.warn({ err: String(err) }, 'firestore unavailable; running memory-only');
    return null;
  }
}

/** For tests. */
export function resetFirestore(): void {
  cached = null;
}
