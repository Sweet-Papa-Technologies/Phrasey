/**
 * The room registry: code allocation, lookup, boot-time restore, reaping, and
 * the single tick loop that drives every room.
 *
 * §6.3 scale posture — this is deliberately single-instance. Cloud Run runs
 * `min=max=1` and rooms live in this process. The documented multi-instance
 * path (a room registry in Memorystore with pub/sub, or a lobby director
 * mapping codes to instances) is NOT built, and session affinity is not relied
 * on for correctness. `instanceId` is stamped on every room doc so the day that
 * changes, a foreign room is recognizable.
 */
import { randomUUID } from 'node:crypto';
import type { Balance, RoomSettings } from '@phrasey/shared';
import { createMatch } from '@phrasey/engine';
import type { ServerConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { AppError } from '../errors.js';
import type { PuzzleSource } from '../data/puzzles.js';
import { decodeState, ttlFrom, type RoomStore } from '../data/rooms.js';
import { Timestamp } from '../data/firestore.js';
import type { SessionStore } from '../data/sessions.js';
import type { BotPolicies } from '../bots/policies.js';
import type { Fanout } from './fanout.js';
import { generateRoomCode, isWellFormedCode } from './codes.js';
import { Room, type RoomDeps } from './room.js';

export interface ManagerDeps {
  cfg: ServerConfig;
  log: Logger;
  fanout: Fanout;
  puzzles: PuzzleSource;
  roomStore: RoomStore;
  sessionStore: SessionStore;
  botPolicies: BotPolicies;
  balance: Balance;
  now?: () => number;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  /** socketId → room code, so a disconnect finds its room in O(1). */
  private readonly socketRooms = new Map<string, string>();
  /** Codes held by rooms this process does not own (restart, other instance). */
  private reservedCodes = new Set<string>();
  readonly instanceId = randomUUID();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: ManagerDeps) {}

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }

  private roomDeps(): RoomDeps {
    return {
      cfg: this.deps.cfg,
      log: this.deps.log,
      fanout: this.deps.fanout,
      puzzles: this.deps.puzzles,
      roomStore: this.deps.roomStore,
      sessionStore: this.deps.sessionStore,
      botPolicies: this.deps.botPolicies,
      instanceId: this.instanceId,
    };
  }

  get size(): number {
    return this.rooms.size;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  require(code: string): Room {
    if (!isWellFormedCode(code.toUpperCase())) throw new AppError('BAD_CODE', 'That is not a room code.');
    const room = this.rooms.get(code.toUpperCase());
    if (!room) throw new AppError('NO_ROOM', 'No room with that code.');
    return room;
  }

  /** Create a room and seat its host. */
  create(host: { name: string; color: string; token: string }, settings: Partial<RoomSettings> | undefined): {
    room: Room;
    playerId: string;
  } {
    const now = this.now();
    const taken = new Set<string>([...this.rooms.keys(), ...this.reservedCodes]);
    const code = generateRoomCode(taken);
    const state = createMatch({
      seed: (Math.random() * 0xffffffff) >>> 0,
      players: [],
      balance: this.deps.balance,
      // Bots are opt-in: a host who wants a solo game sets `botCount`. The
      // table is still topped up to minPlayers at start, so a solo host can
      // always play (see Room.seatBots).
      settings: { botCount: 0, ...(settings ?? {}) },
      sessionId: randomUUID(),
      nowMs: now,
    });
    const room = new Room(code, state, this.roomDeps(), now);
    const playerId = room.addHuman(host.name, host.color, host.token, now);
    this.rooms.set(code, room);

    void this.deps.roomStore.create(code, {
      instanceId: this.instanceId,
      hostId: playerId,
      createdAt: Timestamp.fromMillis(now),
      status: room.status,
      // MUST be a Timestamp: the TTL policy is armed on this exact field.
      ttl: ttlFrom(now, this.deps.balance.session.roomTtlHours),
    });
    this.deps.log.info({ code, instanceId: this.instanceId }, 'room created');
    return { room, playerId };
  }

  bindSocket(socketId: string, code: string): void {
    this.socketRooms.set(socketId, code.toUpperCase());
  }

  /** Called on socket disconnect: starts the §7 reconnect hold. */
  releaseSocket(socketId: string): void {
    const code = this.socketRooms.get(socketId);
    this.socketRooms.delete(socketId);
    if (!code) return;
    this.rooms.get(code)?.detachSocket(socketId, this.now());
  }

  roomForSocket(socketId: string): Room | undefined {
    const code = this.socketRooms.get(socketId);
    return code ? this.rooms.get(code) : undefined;
  }

  // -------------------------------------------------------------- boot restore

  /**
   * §6.2 crash recovery. Rooms are rebuilt from their last snapshot; every seat
   * comes back dark, so the reconnect hold decides whether a human reclaims it
   * or it becomes a bot.
   */
  async restore(): Promise<number> {
    const now = this.now();
    const docs = await this.deps.roomStore.loadAll();
    let restored = 0;
    for (const { code, doc } of docs) {
      this.reservedCodes.add(code);
      if (doc.status === 'match-end') continue;
      const expired = doc.ttl && typeof doc.ttl.toMillis === 'function' && doc.ttl.toMillis() < now;
      if (expired || !doc.snapshot) continue;
      try {
        const state = decodeState(doc.snapshot);
        const room = new Room(code, state, this.roomDeps(), now);
        room.restoreSeats(doc.seats ?? [], now);
        if (doc.puzzleIds) room.puzzleIds.push(...doc.puzzleIds);
        this.rooms.set(code, room);
        restored++;
      } catch (err) {
        this.deps.log.warn({ code, err: String(err) }, 'room snapshot could not be restored');
      }
    }
    this.deps.log.info({ restored, seen: docs.length }, 'room restore complete');
    return restored;
  }

  // ------------------------------------------------------------------ the loop

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.deps.cfg.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * ONE loop for every room, rather than a timer per room event. Turn clocks,
   * the 4s interrupt window, bot think-delays and the reconnect hold are all
   * just "is `now` past a deadline", which makes them trivial to test by
   * driving `tick(now)` with a fake clock.
   */
  tick(nowMs?: number): void {
    const now = nowMs ?? this.now();
    for (const room of [...this.rooms.values()]) {
      try {
        room.tick(now);
      } catch (err) {
        this.deps.log.error({ code: room.code, err: String(err) }, 'room tick threw');
      }
      if (this.shouldReap(room, now)) this.reap(room);
    }
  }

  private shouldReap(room: Room, now: number): boolean {
    if (room.connectedHumans() > 0) return false;
    return now - room.lastActivityAt > this.deps.cfg.idleRoomMs;
  }

  private reap(room: Room): void {
    this.rooms.delete(room.code);
    this.deps.log.info({ code: room.code }, 'idle room reaped');
    void this.deps.roomStore.close(room.code, room.status);
  }

  /** Snapshot everything on the way down so a redeploy keeps live rooms. */
  async drain(): Promise<void> {
    this.stop();
    await Promise.all([...this.rooms.values()].map((r) => r.persist().catch(() => undefined)));
  }
}
