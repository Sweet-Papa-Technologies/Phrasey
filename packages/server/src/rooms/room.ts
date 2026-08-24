/**
 * One room = one in-memory match (§6.2: "Room state lives in memory on the
 * server, snapshotted to Firestore every 10 events for crash recovery").
 *
 * ROOM / TURN STATE MACHINE
 * -------------------------
 *   lobby ──game:start──▶ playing ──round ends──▶ round-end ──intermission──▶ playing
 *                                                     └── match complete ──▶ match-end
 *
 * Inside `playing`, the ENGINE owns the turn machine and this class only feeds
 * it time and intent:
 *
 *   turn ──playCard|discard──▶ awaiting-solve ──solve|pass|timeout──▶ (next seat)
 *     │                              │
 *     └──── interrupt ◀──────────────┘        (4s window, server-timed)
 *
 * The `awaiting-solve` beat is real and this class must respect it: the turn
 * clock is NOT restarted for it (the engine sets `turnEndsAt` once, at
 * `beginTurn`), so a player's solve decision runs out the remainder of their
 * own 15 seconds and then auto-passes via the engine's `timeout` action.
 *
 * Nothing in here decides a rule. Every state change goes through
 * `applyAction`, and every emit goes through `Fanout`.
 */
import type {
  BotTier,
  GameEvent,
  InterruptIntent,
  PlayCardIntent,
  RoomPublic,
  RoomSettings,
} from '@phrasey/shared';
import { EngineError, pickPersonas } from '@phrasey/shared';
import {
  activePlayers,
  applyAction,
  assertInvariants,
  createRng,
  playerView,
  toPublic,
  type EngineAction,
  type GameState,
  type Rng,
} from '@phrasey/engine';
import type { ServerConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { AppError } from '../errors.js';
import type { PuzzleSource } from '../data/puzzles.js';
import type { RoomStore } from '../data/rooms.js';
import { encodeState, hashToken, ttlFrom } from '../data/rooms.js';
import type { SessionStore } from '../data/sessions.js';
import type { BotPolicies } from '../bots/policies.js';
import { chooseBotAction, chooseBotInterrupt, thinkDelayMs } from '../bots/driver.js';
import { Fanout, type Recipient } from './fanout.js';

export interface Seat {
  playerId: string;
  tokenHash: string;
  socketId: string | null;
  /** Epoch ms the seat went dark; drives the 90s hold (§7). */
  disconnectedAt: number | null;
  /** The seat was created for a bot, or converted to one after the hold. */
  isBotSeat: boolean;
}

export interface RoomDeps {
  cfg: ServerConfig;
  log: Logger;
  fanout: Fanout;
  puzzles: PuzzleSource;
  roomStore: RoomStore;
  sessionStore: SessionStore;
  botPolicies: BotPolicies;
  instanceId: string;
}

interface BotBeat {
  key: string;
  deadline: number;
}

/** Heartbeat so a stalled room still gets `tick` into the engine occasionally. */
const HEARTBEAT_MS = 5000;

export class Room {
  state: GameState;
  readonly seats = new Map<string, Seat>();
  /** tokenHash → playerId. Reconnect (§7) is a lookup in here. */
  private readonly byToken = new Map<string, string>();
  private readonly bySocket = new Map<string, string>();
  readonly puzzleIds: string[] = [];

  private eventsSinceSnapshot = 0;
  private snapshotSeq = 0;
  private intermissionAt: number | null = null;
  private lastTimerEmit = 0;
  private lastHeartbeat = 0;
  private botBeat: BotBeat | null = null;
  private readonly rng: Rng;
  private sessionWritten = false;
  lastActivityAt: number;

  constructor(
    readonly code: string,
    /** The room's credential. Never broadcast; returned only on a successful join. */
    readonly key: string,
    state: GameState,
    private readonly deps: RoomDeps,
    now: number,
  ) {
    this.state = state;
    this.rng = createRng((state.seed ^ 0x9e3779b9) >>> 0);
    this.lastActivityAt = now;
  }

  // -------------------------------------------------------------- projections

  get status(): RoomPublic['status'] {
    return this.state.status;
  }

  roomPublic(): RoomPublic {
    return {
      code: this.code,
      status: this.state.status,
      hostId: this.state.hostId,
      settings: this.state.settings,
      players: activePlayers(this.state).map(toPublic),
      roundNumber: this.state.roundNumber,
      createdAt: this.state.createdAt,
    };
  }

  /** Connected human sockets. Bots and dark seats are not recipients. */
  recipients(): Recipient[] {
    const out: Recipient[] = [];
    for (const seat of this.seats.values()) {
      if (seat.socketId) out.push({ playerId: seat.playerId, socketId: seat.socketId });
    }
    return out;
  }

  connectedHumans(): number {
    return this.recipients().length;
  }

  // ------------------------------------------------------------------ commits

  /**
   * The ONLY way this class changes state. Applies, fans out, persists.
   * Returns the events so callers can react.
   */
  private commit(action: EngineAction, now: number): GameEvent[] {
    const { state, events } = applyAction(this.state, action, now);
    this.state = state;
    if (this.deps.cfg.debugInvariants) assertInvariants(this.state);
    this.lastActivityAt = now;
    this.afterCommit(events, now);
    return events;
  }

  private afterCommit(events: GameEvent[], now: number): void {
    const recipients = this.recipients();
    this.deps.fanout.game(this.state, recipients, events);

    let rosterChanged = false;
    // Round boundaries are the moments where losing state actually hurts, so
    // they snapshot immediately rather than waiting for the event counter.
    // This is what makes scaling to zero survivable: a recycled instance loses
    // at most part of one turn instead of up to snapshotEveryNEvents.
    let boundary = false;
    for (const e of events) {
      if (e.t === 'round:start') {
        this.botBeat = null;
        rosterChanged = true;
        boundary = true;
      }
      if (e.t === 'turn:begin') this.botBeat = null;
      if (e.t === 'interrupt:close' || e.t === 'interrupt:open') this.botBeat = null;
      if (e.t === 'notice') rosterChanged = true;
      if (e.t === 'round:end') {
        rosterChanged = true;
        boundary = true;
        // §3.1: a match is a sequence of rounds; deal the next one after a beat
        // so the table can read the answer and the scores.
        this.intermissionAt =
          this.state.status === 'match-end' ? null : now + this.deps.cfg.intermissionMs;
      }
      if (e.t === 'match:end') {
        this.intermissionAt = null;
        rosterChanged = true;
        boundary = true;
        void this.writeSession();
      }
    }
    if (rosterChanged) this.deps.fanout.roomState(recipients, this.roomPublic(), null);

    this.eventsSinceSnapshot += events.length;
    if (boundary || this.eventsSinceSnapshot >= this.state.balance.session.snapshotEveryNEvents) {
      this.eventsSinceSnapshot = 0;
      void this.persist();
    }
  }

  // ------------------------------------------------------------------- seating

  /**
   * Seat a human. §7: no account, no PII — the display name is session-scoped
   * and the returned token is the only thing that reclaims the seat.
   */
  addHuman(name: string, color: string, token: string, now: number): string {
    const seated = activePlayers(this.state).length;
    if (seated >= this.state.balance.setup.maxPlayers) {
      throw new AppError('ROOM_FULL', 'That room is full.');
    }
    const playerId = `p-${randomId()}`;
    const isFirst = this.seats.size === 0;
    this.commit(
      { type: 'addPlayer', player: { id: playerId, name, color, isHost: isFirst } },
      now,
    );
    // ENGINE GAP: `addPlayer` honours `isHost` on the seat but does not adopt
    // it as `state.hostId`, so a match created with an empty roster keeps
    // `hostId === ''` forever. Claim it here for the very first seat only.
    if (isFirst && this.state.hostId === '') this.state.hostId = playerId;
    const tokenHash = hashToken(token);
    this.seats.set(playerId, { playerId, tokenHash, socketId: null, disconnectedAt: now, isBotSeat: false });
    this.byToken.set(tokenHash, playerId);
    return playerId;
  }

  /**
   * §7 reconnect: the sessionToken in JoinRoomPayload reclaims a held seat.
   *
   * IDEMPOTENT BY CONSTRUCTION, because a phone reconnects far more often than
   * once. The token is a *lookup key*, never a consumable: it stays valid, it
   * is never rotated, and every step below is a write of a known value rather
   * than a mutation of a counter.
   *
   *   - `byToken` is only ever read here; nothing is deleted.
   *   - `attachSocket` overwrites `seat.socketId`, so calling it twice with the
   *     same socket is a no-op and calling it with a new socket MOVES the seat
   *     rather than creating a second one. There is exactly one `Seat` per
   *     `playerId` for the life of the room, so double-seating is not
   *     representable.
   *   - No engine action is dispatched, so no hand is dealt and no score moves.
   *
   * Safe mid-round: the seat is already inside `round.order`, so the caller
   * just needs to `resync` and the player is back on their own turn clock.
   */
  reclaim(token: string, socketId: string, now: number): string | null {
    const playerId = this.byToken.get(hashToken(token));
    if (!playerId) return null;
    const seat = this.seats.get(playerId);
    const player = this.state.players.find((p) => p.id === playerId);
    if (!seat || !player || player.removed) return null;

    const wasBot = seat.isBotSeat;
    if (wasBot) {
      // The hold expired and the seat became a bot. Hand it back: the score and
      // the hand are still theirs.
      // ENGINE GAP: there is no `convertSeatFromBot` action, so these three
      // presentation fields are set directly. No rule state is touched.
      player.isBot = false;
      player.botTier = undefined;
      player.botPersona = undefined;
      seat.isBotSeat = false;
      // `convertSeatToBot` reassigns the host away from a botified seat, and
      // its pick is `activePlayers().find(p => !p.isBot)` — which on a solo
      // host + bots table is a BOT. Left alone, the human comes back to a room
      // whose host is a bot: settings frozen, next match unstartable. Give it
      // back if nobody human is holding it.
      const host = this.state.players.find((p) => p.id === this.state.hostId);
      if (!host || host.removed || host.isBot) {
        for (const p of this.state.players) p.isHost = false;
        player.isHost = true;
        this.state.hostId = playerId;
      }
    }
    player.connection = 'connected';
    this.attachSocket(playerId, socketId, now);
    // The rest of the table watched this player go grey (`detachSocket` fans
    // out on the way down). Without a matching fan-out on the way back up they
    // stay grey — or worse, stay tagged "(bot)" — on every other device.
    this.deps.fanout.roomState(this.recipients(), this.roomPublic(), null);
    return playerId;
  }

  attachSocket(playerId: string, socketId: string, now: number): void {
    const seat = this.seats.get(playerId);
    if (!seat) throw new AppError('NO_SEAT', 'That seat is gone.');
    if (seat.socketId && seat.socketId !== socketId) this.bySocket.delete(seat.socketId);
    seat.socketId = socketId;
    seat.disconnectedAt = null;
    this.bySocket.set(socketId, playerId);
    const player = this.state.players.find((p) => p.id === playerId);
    if (player && !player.isBot) player.connection = 'connected';
    this.lastActivityAt = now;
  }

  playerIdForSocket(socketId: string): string | undefined {
    return this.bySocket.get(socketId);
  }

  /** Socket dropped. §7: hold the seat for 90 seconds before botifying it. */
  detachSocket(socketId: string, now: number): void {
    const playerId = this.bySocket.get(socketId);
    this.bySocket.delete(socketId);
    if (!playerId) return;
    const seat = this.seats.get(playerId);
    if (!seat || seat.socketId !== socketId) return;
    seat.socketId = null;
    seat.disconnectedAt = now;
    const player = this.state.players.find((p) => p.id === playerId);
    // ENGINE GAP: no `setConnection` action exists. `connection` is display
    // metadata, not rule state, so it is written directly and nowhere else.
    if (player && !player.isBot) player.connection = 'disconnected';
    this.deps.fanout.roomState(this.recipients(), this.roomPublic(), null);
  }

  /** Deliberate leave. The seat is gone; no hold, no bot. */
  leave(playerId: string, now: number): void {
    const seat = this.seats.get(playerId);
    if (seat?.socketId) this.bySocket.delete(seat.socketId);
    this.seats.delete(playerId);
    if (seat) this.byToken.delete(seat.tokenHash);
    try {
      this.commit({ type: 'removePlayer', playerId }, now);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
    }
  }

  // ------------------------------------------------------------------ settings

  setSettings(playerId: string, patch: Partial<RoomSettings>): void {
    this.requireHost(playerId);

    // `sameRoomAudio` is the one setting that is not a game rule — it says
    // "we are all sitting in the same room, so one device should make the
    // noise". Changing it mid-round affects nothing about play, and a table
    // that discovers the echo problem two rounds in should not have to wait
    // for a round boundary to fix it. Everything else stays gated.
    const onlyComfort = Object.keys(patch).every((k) => k === 'sameRoomAudio');
    if (!onlyComfort && this.state.status !== 'lobby' && this.state.status !== 'round-end') {
      throw new AppError('NOT_IN_LOBBY', 'Settings can only change between rounds.');
    }
    const b = this.state.balance;
    const next: RoomSettings = { ...this.state.settings };
    if (typeof patch.sameRoomAudio === 'boolean') next.sameRoomAudio = patch.sameRoomAudio;
    if (patch.matchMode === 'rounds' || patch.matchMode === 'score') next.matchMode = patch.matchMode;
    if (typeof patch.rounds === 'number') next.rounds = clamp(patch.rounds, b.match.minRounds, b.match.maxRounds);
    if (typeof patch.targetScore === 'number') {
      next.targetScore = clamp(patch.targetScore, b.match.minTargetScore, b.match.maxTargetScore);
    }
    if (patch.turnSeconds !== undefined) {
      // Host-configurable 10/15/25/off — anything else is rejected outright.
      if (!b.turn.allowedSeconds.includes(patch.turnSeconds)) {
        throw new AppError('BAD_SETTING', 'That turn length is not offered.');
      }
      next.turnSeconds = patch.turnSeconds;
    }
    if (typeof patch.botCount === 'number') next.botCount = clamp(Math.trunc(patch.botCount), 0, b.setup.maxBots);
    if (patch.botTier) next.botTier = patch.botTier;
    if (typeof patch.interruptsEnabled === 'boolean') next.interruptsEnabled = patch.interruptsEnabled;
    this.state.settings = next;
    this.deps.fanout.roomState(this.recipients(), this.roomPublic(), null);
  }

  // ----------------------------------------------------------------- gameplay

  start(playerId: string, patch: Partial<RoomSettings> | undefined, now: number): void {
    this.requireHost(playerId);
    if (this.state.status === 'match-end') throw new AppError('MATCH_OVER', 'That match is over.');
    if (this.state.status === 'playing') throw new AppError('ALREADY_PLAYING', 'A round is already running.');
    if (patch) this.setSettings(playerId, patch);
    this.seatBots(now);
    if (activePlayers(this.state).length < this.state.balance.setup.minPlayers) {
      throw new AppError('NOT_ENOUGH_PLAYERS', 'Two players are needed to start.');
    }
    this.dealNextRound(now);
  }

  private dealNextRound(now: number): void {
    const puzzle = this.deps.puzzles.pick(this.puzzleIds, () => this.rng.next());
    this.puzzleIds.push(puzzle.id);
    this.intermissionAt = null;
    // Only the puzzle ID is ever logged (§11).
    this.deps.log.info({ code: this.code, puzzleId: puzzle.id, round: this.state.roundNumber + 1 }, 'round dealt');
    this.commit({ type: 'startRound', puzzle }, now);
    void this.persist();
  }

  /**
   * Fill bot seats. `settings.botCount` is what the host asked for; the table
   * is also topped up to `minPlayers` so a solo host can always start.
   */
  private seatBots(now: number): void {
    const seated = activePlayers(this.state);
    const humans = seated.filter((p) => !p.isBot).length;
    const bots = seated.filter((p) => p.isBot).length;
    const wanted = Math.max(this.state.settings.botCount, this.state.balance.setup.minPlayers - humans);
    const room = this.state.balance.setup.maxPlayers - seated.length;
    const toAdd = Math.max(0, Math.min(wanted - bots, room));
    if (toAdd === 0) return;
    const taken = new Set(seated.map((p) => p.name.toLowerCase()));
    const personas = pickPersonas(toAdd, this.state.settings.botTier, taken);
    for (let i = 0; i < toAdd; i++) {
      const persona = personas[i];
      const id = `b-${randomId()}`;
      this.commit(
        {
          type: 'addPlayer',
          player: {
            id,
            name: persona?.name ?? `Bot ${i + 1}`,
            color: persona?.color ?? '#6C3BFF',
            isBot: true,
            botTier: this.state.settings.botTier,
            botPersona: persona?.persona,
          },
        },
        now,
      );
      this.seats.set(id, { playerId: id, tokenHash: `bot:${id}`, socketId: null, disconnectedAt: null, isBotSeat: true });
    }
  }

  playCard(playerId: string, intent: PlayCardIntent, now: number): void {
    this.commit({ type: 'playCard', playerId, intent }, now);
  }

  discard(playerId: string, cardIds: string[], now: number): void {
    this.commit({ type: 'discard', playerId, cardIds }, now);
  }

  /**
   * PROTOCOL GAP: `ClientToServerEvents` has no `turn:pass`, but the engine's
   * `awaiting-solve` beat needs one — otherwise declining to solve costs the
   * player the rest of their turn clock every single turn. An empty guess is
   * read as "I decline", which is also the intuitive meaning of submitting an
   * empty solve box. See the report; the fix belongs in @phrasey/shared.
   */
  solve(playerId: string, guess: string, now: number): void {
    this.commit({ type: 'solve', playerId, guess }, now);
  }

  /** Decline the optional solve (§3.3) and end the turn. */
  pass(playerId: string, now: number): void {
    this.commit({ type: 'pass', playerId }, now);
  }

  /**
   * PROTOCOL GAP, same shape: there is no `interrupt:pass`. An empty `cardId`
   * declines the window, which lets it close early instead of burning 4s.
   */
  interrupt(playerId: string, intent: InterruptIntent, now: number): void {
    this.commit({ type: 'playInterrupt', playerId, cardId: intent.cardId, windowId: intent.windowId }, now);
  }

  /** Decline an open window so it can close early instead of expiring. */
  declineInterrupt(playerId: string, windowId: string, now: number): void {
    this.commit({ type: 'passInterrupt', playerId, windowId }, now);
  }

  emote(playerId: string, emote: string): void {
    for (const to of this.recipients()) {
      this.deps.fanout.send(to, 'chat:emote', { playerId, emote }, null);
    }
  }

  /** Full state push to one socket — used right after a join or a reclaim. */
  resync(playerId: string, now: number): void {
    const seat = this.seats.get(playerId);
    if (!seat?.socketId) return;
    const to: Recipient = { playerId, socketId: seat.socketId };
    this.deps.fanout.roomState([to], this.roomPublic(), null);
    if (this.state.round) this.deps.fanout.game(this.state, [to], []);
    this.lastActivityAt = now;
  }

  // --------------------------------------------------------------------- tick

  /**
   * The single loop. Everything time-driven happens here and nowhere else:
   * intermissions, the 90s reconnect hold, the turn clock, the 4s interrupt
   * window, bot think-delays, and `turn:timer`.
   */
  tick(now: number): void {
    this.expireHeldSeats(now);

    if (this.intermissionAt !== null && now >= this.intermissionAt && this.state.status === 'round-end') {
      this.intermissionAt = null;
      try {
        this.dealNextRound(now);
      } catch (err) {
        this.deps.log.warn({ code: this.code, err: String(err) }, 'next round could not be dealt');
      }
      return;
    }

    const round = this.state.round;
    if (!round || round.endedReason !== null) return;

    // Hand time to the engine only when something is actually due. `tick`
    // clones the whole state, so firing it 5x a second for nothing is waste.
    const windowDue = round.window !== null && now >= round.window.expiresAt;
    const turnDue =
      (round.phase === 'turn' || round.phase === 'awaiting-solve') &&
      round.turnEndsAt !== null &&
      now >= round.turnEndsAt;
    if (windowDue || turnDue || now - this.lastHeartbeat >= HEARTBEAT_MS) {
      this.lastHeartbeat = now;
      try {
        this.commit({ type: 'tick' }, now);
      } catch (err) {
        this.deps.log.warn({ code: this.code, err: String(err) }, 'tick failed');
      }
      if (windowDue || turnDue) return;
    }

    this.driveBots(now);
    this.emitTimer(now);
  }

  private expireHeldSeats(now: number): void {
    const grace = this.deps.cfg.reconnectGraceMs;
    if (grace === null) return;
    for (const seat of this.seats.values()) {
      if (seat.isBotSeat || seat.socketId || seat.disconnectedAt === null) continue;
      if (now - seat.disconnectedAt < grace) continue;
      const player = this.state.players.find((p) => p.id === seat.playerId);
      if (!player || player.removed) {
        this.seats.delete(seat.playerId);
        continue;
      }
      seat.isBotSeat = true;
      // §7: same name, and `wasHuman` (set by the engine) is what draws the
      // "(bot)" tag client-side. The name is NOT rewritten here.
      this.commit(
        { type: 'convertSeatToBot', playerId: seat.playerId, tier: this.state.settings.botTier },
        now,
      );
      this.deps.log.info({ code: this.code, playerId: seat.playerId }, 'held seat converted to bot');
    }
  }

  /**
   * The BOT DRIVER (§5: "Bots must have a visible thinking delay. Instant bot
   * moves read as cheating even when they aren't").
   *
   * This waits the tier's delay, asks the policy, and applies what it returns.
   * It makes no decisions — the policy comes from `@phrasey/engine`.
   */
  private driveBots(now: number): void {
    const round = this.state.round;
    if (!round || round.endedReason !== null) return;

    const window = round.window;
    if (window) {
      const pending = window.eligible.find((id) => !window.passed.includes(id) && this.isBot(id));
      if (!pending) return;
      const key = `w:${window.id}:${pending}`;
      if (!this.beatReady(key, pending, now, true)) return;
      const action = chooseBotInterrupt(
        this.policyFor(pending),
        playerView(this.state, pending),
        this.rng,
      ) ?? { type: 'passInterrupt' as const, playerId: pending, windowId: window.id };
      this.applyBotAction(action, pending, now);
      return;
    }

    const current = round.currentPlayerId;
    if (!current || !this.isBot(current)) return;
    const key = `t:${current}:${round.phase}:${round.turnActed ? 1 : 0}`;
    if (!this.beatReady(key, current, now, false)) return;
    const action = chooseBotAction(this.policyFor(current), playerView(this.state, current), this.rng);
    this.applyBotAction(action, current, now);
  }

  /** True once the think delay for this beat has elapsed. */
  private beatReady(key: string, playerId: string, now: number, inWindow: boolean): boolean {
    if (!this.botBeat || this.botBeat.key !== key) {
      const player = this.state.players.find((p) => p.id === playerId);
      const tier: BotTier = player?.botTier ?? this.state.settings.botTier;
      const cap = inWindow ? this.state.balance.interrupt.windowMs * 0.6 : undefined;
      const solveBeat = !inWindow && this.state.round?.phase === 'awaiting-solve';
      this.botBeat = {
        key,
        deadline: now + thinkDelayMs(this.state.balance, tier, this.rng, { cap, solveBeat }),
      };
      return false;
    }
    return now >= this.botBeat.deadline;
  }

  private applyBotAction(action: EngineAction, playerId: string, now: number): void {
    this.botBeat = null;
    try {
      this.commit(action, now);
    } catch (err) {
      if (!(err instanceof EngineError)) throw err;
      // A policy that proposes an illegal move must not stall the table. The
      // engine's own timeout autoplay is the safe fallback.
      this.deps.log.warn({ code: this.code, playerId, err: err.code }, 'bot action rejected; timing out');
      try {
        this.commit({ type: 'timeout', playerId }, now);
      } catch (err2) {
        this.deps.log.error({ code: this.code, playerId, err: String(err2) }, 'bot fallback failed');
      }
    }
  }

  private policyFor(playerId: string) {
    const player = this.state.players.find((p) => p.id === playerId);
    return this.deps.botPolicies.for(player?.botTier ?? this.state.settings.botTier);
  }

  private isBot(playerId: string): boolean {
    return this.state.players.find((p) => p.id === playerId)?.isBot === true;
  }

  private emitTimer(now: number): void {
    const round = this.state.round;
    if (!round || round.turnEndsAt === null || !round.currentPlayerId) return;
    if (round.phase !== 'turn' && round.phase !== 'awaiting-solve') return;
    if (now - this.lastTimerEmit < this.deps.cfg.timerEmitMs) return;
    this.lastTimerEmit = now;
    this.deps.fanout.timer(this.recipients(), round.currentPlayerId, Math.max(0, round.turnEndsAt - now));
  }

  // ------------------------------------------------------------- persistence

  /** §6.2 crash-recovery snapshot. Best effort; memory stays authoritative. */
  async persist(): Promise<void> {
    this.snapshotSeq += 1;
    await this.deps.roomStore.snapshot(this.code, {
      instanceId: this.deps.instanceId,
      key: this.key,
      hostId: this.state.hostId,
      status: this.state.status,
      ttl: ttlFrom(this.state.createdAt, this.state.balance.session.roomTtlHours),
      snapshot: encodeState(this.state),
      snapshotSeq: this.snapshotSeq,
      seats: [...this.seats.values()].map((s) => ({
        playerId: s.playerId,
        tokenHash: s.tokenHash,
        isBot: s.isBotSeat,
      })),
      puzzleIds: this.puzzleIds,
    });
  }

  private async writeSession(): Promise<void> {
    if (this.sessionWritten || !this.state.matchResult) return;
    this.sessionWritten = true;
    const seated = activePlayers(this.state);
    await this.deps.sessionStore.write(this.state.matchResult, {
      puzzleIds: [...this.puzzleIds],
      playerCount: seated.length,
      botCount: seated.filter((p) => p.isBot).length,
    });
  }

  /** Rehydrate the seat table from a snapshot (boot-time restore). */
  restoreSeats(seats: { playerId: string; tokenHash: string; isBot: boolean }[], now: number): void {
    for (const s of seats) {
      this.seats.set(s.playerId, {
        playerId: s.playerId,
        tokenHash: s.tokenHash,
        socketId: null,
        disconnectedAt: s.isBot ? null : now,
        isBotSeat: s.isBot,
      });
      // Register the token even for a seat that had already botified. `reclaim`
      // un-botifies, so dropping the mapping here is the difference between
      // "the server restarted while my phone was locked and I got my seat and
      // score back" and "…and I am gone forever".
      this.byToken.set(s.tokenHash, s.playerId);
    }
    for (const p of this.state.players) {
      if (!p.isBot && !p.removed) p.connection = 'disconnected';
    }
  }

  private requireHost(playerId: string): void {
    if (this.state.hostId !== playerId) throw new AppError('NOT_HOST', 'Only the host can do that.');
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function randomId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
}
