/**
 * `/sessions/{sessionId}` — completed match summary (§6.4).
 *
 * "scores and puzzle ids, NO display names." Player ids are per-session random
 * uuids, so this document contains nothing that identifies a human (§8, §11).
 */
import type { MatchResult } from '@phrasey/shared';
import { Timestamp, type Firestore } from './firestore.js';
import type { Logger } from '../logger.js';

export interface SessionDoc {
  sessionId: string;
  endedAt: Timestamp;
  roundsPlayed: number;
  /** playerId → final score. Ids are ephemeral uuids, not identities. */
  scores: Record<string, number>;
  winnerIds: string[];
  puzzleIds: string[];
  playerCount: number;
  botCount: number;
}

export interface SessionStore {
  write(result: MatchResult, extra: { puzzleIds: string[]; playerCount: number; botCount: number }): Promise<void>;
}

export function createSessionStore(db: Firestore | null, log: Logger): SessionStore {
  if (!db) return { async write() {} };
  return {
    async write(result, extra) {
      const doc: SessionDoc = {
        sessionId: result.sessionId,
        endedAt: Timestamp.now(),
        roundsPlayed: result.roundsPlayed,
        scores: result.totals,
        winnerIds: result.winnerIds,
        puzzleIds: extra.puzzleIds,
        playerCount: extra.playerCount,
        botCount: extra.botCount,
      };
      try {
        await db.collection('sessions').doc(result.sessionId).set(doc);
      } catch (err) {
        log.warn({ err: String(err), sessionId: result.sessionId }, 'session write failed');
      }
    },
  };
}
