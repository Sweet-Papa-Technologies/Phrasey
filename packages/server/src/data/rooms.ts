/**
 * Room persistence (§6.2, §6.4).
 *
 * `/rooms/{code}` → { instanceId, hostId, createdAt, status, ttl }
 *
 * `ttl` is a Firestore `Timestamp` of createdAt + 6h. The TTL policy in
 * `infra/main.tf` is armed on exactly that field name and nothing else, so the
 * type matters: a number here would silently never expire.
 *
 * The crash-recovery snapshot rides on the SAME document, as a gzipped base64
 * blob. That is deliberate — Firestore's TTL deletes a document but does not
 * cascade into subcollections, so a snapshot parked in a subcollection would
 * outlive its room forever. One doc, one TTL, no orphans.
 *
 * Session tokens are stored hashed. They are bearer credentials for a seat; the
 * server only ever needs to compare them.
 */
import { createHash } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { RoomStatus } from '@phrasey/shared';
import type { GameState } from '@phrasey/engine';
import { Timestamp, type Firestore } from './firestore.js';
import type { Logger } from '../logger.js';

export interface PersistedSeat {
  playerId: string;
  /** sha256 of the session token; never the token itself. */
  tokenHash: string;
  isBot: boolean;
}

export interface RoomDoc {
  instanceId: string;
  hostId: string;
  createdAt: Timestamp;
  status: RoomStatus;
  ttl: Timestamp;
  /** gzip+base64 of the engine GameState. Absent until the first snapshot. */
  snapshot?: string;
  snapshotSeq?: number;
  snapshotAt?: Timestamp;
  /** The room credential, so a restored room still validates joins. */
  key?: string;
  seats?: PersistedSeat[];
  puzzleIds?: string[];
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function encodeState(state: GameState): string {
  return gzipSync(Buffer.from(JSON.stringify(state), 'utf8')).toString('base64');
}

export function decodeState(blob: string): GameState {
  return JSON.parse(gunzipSync(Buffer.from(blob, 'base64')).toString('utf8')) as GameState;
}

export function ttlFrom(createdAtMs: number, hours: number): Timestamp {
  return Timestamp.fromMillis(createdAtMs + hours * 3_600_000);
}

export interface RoomStore {
  create(code: string, doc: Omit<RoomDoc, 'snapshot' | 'snapshotSeq' | 'snapshotAt'>): Promise<void>;
  snapshot(code: string, patch: Partial<RoomDoc>): Promise<void>;
  close(code: string, status: RoomStatus): Promise<void>;
  loadAll(): Promise<{ code: string; doc: RoomDoc }[]>;
  /** Codes already taken, so a restart cannot hand out a live code twice. */
  reserved(): Promise<Set<string>>;
}

const NOOP: RoomStore = {
  async create() {},
  async snapshot() {},
  async close() {},
  async loadAll() {
    return [];
  },
  async reserved() {
    return new Set();
  },
};

export function createRoomStore(db: Firestore | null, log: Logger): RoomStore {
  if (!db) return NOOP;
  const col = db.collection('rooms');

  const guard = async (what: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      // Persistence is best-effort; memory is the source of truth (§6.2).
      log.warn({ err: String(err), what }, 'room store write failed');
    }
  };

  return {
    create: (code, doc) => guard('create', async () => void (await col.doc(code).set(doc))),
    snapshot: (code, patch) => guard('snapshot', async () => void (await col.doc(code).set(patch, { merge: true }))),
    close: (code, status) =>
      guard('close', async () => void (await col.doc(code).set({ status, closedAt: Timestamp.now() }, { merge: true }))),
    async loadAll() {
      try {
        const snap = await col.get();
        return snap.docs.map((d) => ({ code: d.id, doc: d.data() as RoomDoc }));
      } catch (err) {
        log.warn({ err: String(err) }, 'room restore query failed');
        return [];
      }
    },
    async reserved() {
      try {
        const snap = await col.select().get();
        return new Set(snap.docs.map((d) => d.id));
      } catch {
        return new Set();
      }
    },
  };
}
