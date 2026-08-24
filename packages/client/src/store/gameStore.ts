/**
 * The single client-side source of truth.
 *
 * The server is authoritative (§6.2). Nothing in this file computes a game
 * outcome — no scoring, no hit/miss decision, no round-end condition. It stores
 * what the server said and schedules the animation that says it.
 */
import { create } from 'zustand';
import {
  BALANCE,
  type Card,
  type GameEvent,
  type InterruptWindowPayload,
  type MaskedBoard,
  type MatchResult,
  type PlayerPublic,
  type RoomPublic,
  type RoomSettings,
  type RoundPublic,
  type RoundResult,
  type SocketError,
  type JoinedPayload,
} from '@phrasey/shared';
import type { AckResult, ConnectionState, Transport } from '../net/transport';
import { createMockTransport } from '../net/mockTransport';
import { createSocketTransport } from '../net/socketTransport';
import { installResumeTriggers, type ResumeReason } from '../net/resume';
import { clearSession, readSession, sessionFor, writeSession } from '../net/session';
import { cascadeDelayMap, collectRevealPositions, planRevealCascade } from '../lib/reveal';
import { prefersReducedMotion } from '../lib/motion';
import {
  playRevealCascade,
  playSfx,
  setMuted as setSfxMuted,
  setMusicVolume as setSoundMusicVolume,
  setPressureLevel,
  setSameRoomContext,
  setSameRoomLocal,
  setVolume as setSfxVolume,
} from '../lib/sound';
import { feedItemsFor, type FeedItem } from './feed';
import { track } from '../compliance/analytics';

const IDENTITY_KEY = 'phrasey.identity.v1';
const AUDIO_KEY = 'phrasey.audio.v1';
const FEED_MAX = 60;

export interface Identity {
  name: string;
  color: string;
}

export interface RevealPlan {
  /** Tile index → flip delay in ms. */
  delays: Map<number, number>;
  /** Bumped every batch so components can restart an animation deliberately. */
  token: number;
}

export interface PressurePulse {
  value: number;
  delta: number;
  cause: string;
  token: number;
}

export type TransportKind = 'mock' | 'socket';

/**
 * What the player's LINK to their seat is doing — which is a different
 * question from what the socket is doing (`connection`), and the one the UI
 * actually has to answer.
 *
 * A socket can be `connected` while the player holds no seat at all: every
 * reconnect gets a brand-new socket id, and the server binds seats to socket
 * ids, so until the session token has been presented again the tab is a ghost.
 * That gap — socket up, seat not reclaimed — is exactly the frozen-board bug,
 * and it is only visible as its own state.
 *
 *   idle ──connect──▶ live ──drop──▶ reconnecting ──socket back──▶ resuming
 *                       ▲                                             │
 *                       └───────────── seat reclaimed ────────────────┤
 *                                                                     │
 *                            token no longer matches anything ──▶ seat-lost
 */
export type LinkPhase = 'idle' | 'live' | 'reconnecting' | 'resuming' | 'seat-lost';

export interface SeatLost {
  code: string;
  message: string;
  /**
   * True when we are back at the table, just not in the old seat (a fresh seat,
   * score reset, dealt in next round). False when we are not in the room at all
   * and the player has to make a decision.
   */
  recovered: boolean;
}

export interface GameStore {
  transport: Transport | null;
  transportKind: TransportKind;
  connection: ConnectionState;
  connectionDetail: string | null;

  /** The seat-level view of the connection. See `LinkPhase`. */
  linkPhase: LinkPhase;
  /** Why the last resume ran. Diagnostic; surfaced nowhere but the console. */
  lastResumeReason: string | null;
  /** Bumped on every successful reclaim, so the UI can flash "Reconnected". */
  resumeToken: number;
  /** Epoch ms of the last successful reclaim after an actual drop. */
  recoveredAt: number | null;
  /** Set when the old seat could not be reclaimed. Explains itself to the player. */
  seatLost: SeatLost | null;

  identity: Identity;
  playerId: string | null;
  sessionToken: string | null;
  /** The room credential (§6.6 anti-enumeration). Needed to build the share link. */
  roomKey: string | null;

  room: RoomPublic | null;
  round: RoundPublic | null;
  board: MaskedBoard | null;
  hand: Card[];
  peeks: Record<number, string>;

  pressure: number;
  pressureMax: number;
  pulse: PressurePulse | null;
  blownOut: boolean;

  turnPlayerId: string | null;
  turnEndsAt: number | null;

  interrupt: InterruptWindowPayload | null;
  reveal: RevealPlan;
  feed: FeedItem[];

  roundResult: RoundResult | null;
  matchResult: MatchResult | null;
  lastError: SocketError | null;

  castView: boolean;
  muted: boolean;
  volume: number;
  /** Music bus level, independent of `volume` (§9). */
  musicVolume: number;
  /**
   * This player's own Same-room switch. `null` = never touched, so the host's
   * room-level default (`RoomSettings.sameRoomAudio`) applies.
   */
  sameRoomLocal: boolean | null;
  solveOpen: boolean;

  // ---- actions ----
  setIdentity(patch: Partial<Identity>): void;
  connect(kind?: TransportKind): Promise<void>;
  /**
   * Get back to the seat. Idempotent and safe to call from anywhere, any
   * number of times: concurrent calls share one in-flight attempt, and the
   * server's `reclaim` is a lookup, not a mutation.
   */
  resume(reason?: string): Promise<boolean>;
  /** Cold load of `/room/:code`: try the stored credential before giving up. */
  reclaimInto(code: string): Promise<boolean>;
  dismissSeatLost(): void;
  disconnect(): void;
  createRoom(settings?: Partial<RoomSettings>): Promise<AckResult<unknown>>;
  joinRoom(code: string, key?: string): Promise<AckResult<unknown>>;
  updateSettings(settings: Partial<RoomSettings>): Promise<void>;
  startGame(): Promise<void>;
  playLetterCard(cardId: string): Promise<void>;
  playActionCard(cardId: string, letter?: string, targetPlayerId?: string): Promise<void>;
  discard(cardIds: string[]): Promise<void>;
  solve(guess: string): Promise<void>;
  playInterrupt(cardId: string): Promise<void>;
  declineInterrupt(): Promise<void>;
  passTurn(): Promise<void>;
  dismissError(): void;
  setCastView(on: boolean): void;
  setMuted(on: boolean): void;
  setVolume(v: number): void;
  setMusicVolume(v: number): void;
  setSameRoom(on: boolean): void;
  setSolveOpen(open: boolean): void;
}

// ---------------------------------------------------------------------------
// Persistence (no PII — a display name and a hex color, session-scoped, §7/§8)
// ---------------------------------------------------------------------------

function readIdentity(): Identity {
  const fallback: Identity = { name: '', color: '#FF5C1A' };
  try {
    const raw = localStorage.getItem(IDENTITY_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Identity>;
    return { name: parsed.name ?? '', color: parsed.color ?? fallback.color };
  } catch {
    return fallback;
  }
}

function writeIdentity(id: Identity): void {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(id));
  } catch {
    /* private browsing */
  }
}

/**
 * §9 defaults: sound on at 40%, and the music bed well under it so a cap crack
 * still lands. `sameRoom: null` means the player has not touched the switch.
 */
const AUDIO_DEFAULTS = { muted: false, volume: 0.4, musicVolume: 0.45, sameRoom: null } as const;

type AudioPrefs = {
  muted: boolean;
  volume: number;
  musicVolume: number;
  sameRoom: boolean | null;
};

function readAudio(): AudioPrefs {
  const out: AudioPrefs = { ...AUDIO_DEFAULTS };
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (!raw) return out;
    const p = JSON.parse(raw) as Partial<AudioPrefs> | null;
    if (!p || typeof p !== 'object') return out;
    if (typeof p.muted === 'boolean') out.muted = p.muted;
    if (typeof p.volume === 'number') out.volume = p.volume;
    if (typeof p.musicVolume === 'number') out.musicVolume = p.musicVolume;
    if (typeof p.sameRoom === 'boolean') out.sameRoom = p.sameRoom;
  } catch {
    /* ignore */
  }
  return out;
}

/** Merge, never overwrite: `src/audio/prefs.ts` owns fields under this key too. */
function writeAudio(patch: Partial<AudioPrefs>): void {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify({ ...readAudio(), ...patch }));
  } catch {
    /* ignore */
  }
}

/**
 * Which transport to use. `?transport=mock|socket` wins so the real server can
 * be exercised the moment it exists; otherwise a configured `VITE_SERVER_URL`
 * means socket, and its absence means the mock.
 */
export function defaultTransportKind(): TransportKind {
  if (typeof window !== 'undefined') {
    const q = new URLSearchParams(window.location.search).get('transport');
    if (q === 'mock' || q === 'socket') return q;
  }
  const url = import.meta.env?.VITE_SERVER_URL;
  return typeof url === 'string' && url.length > 0 ? 'socket' : 'mock';
}

// ---------------------------------------------------------------------------

/**
 * How a transport gets built. Overridable so the reconnect behaviour can be
 * tested against a scripted link that can be dropped on demand — the one thing
 * neither the real socket nor the mock lets a test do.
 */
export type TransportFactory = (kind: TransportKind) => Transport;

const defaultTransportFactory: TransportFactory = (kind) =>
  kind === 'socket' ? createSocketTransport() : createMockTransport();

let transportFactory: TransportFactory = defaultTransportFactory;

/** Test seam. Pass `null` to restore the real factories. */
export function setTransportFactory(factory: TransportFactory | null): void {
  transportFactory = factory ?? defaultTransportFactory;
}

/** Ack codes that mean "try again in a moment", not "you are out". */
const RETRYABLE = new Set(['NOT_CONNECTED', 'TIMEOUT', 'EMPTY_ACK', 'RATE_LIMITED', 'TOO_MANY_ATTEMPTS', 'INTERNAL']);

/** Ack codes on a game action that mean "this socket holds no seat any more". */
const UNSEATED = new Set(['NOT_IN_ROOM', 'NO_SEAT', 'NOT_CONNECTED', 'NO_TRANSPORT']);

function seatLostMessage(error: { code: string }): string {
  switch (error.code) {
    case 'MATCH_OVER':
      return 'That match finished while you were away.';
    case 'ROOM_FULL':
      return 'Your seat expired and the room filled up while you were away.';
    default:
      return 'That room has closed.';
  }
}

const audio0: AudioPrefs = typeof window === 'undefined' ? { ...AUDIO_DEFAULTS } : readAudio();

export const useGameStore = create<GameStore>((set, get) => {
  let detach: (() => void) | null = null;
  /** Uninstaller for the wake-up listeners. Null when nothing is installed. */
  let stopResumeTriggers: (() => void) | null = null;
  /**
   * The single in-flight reclaim. THIS is what makes `resume()` safe to call
   * from four DOM events, a socket `connect`, a failed game action and a cold
   * page load all at once: they share one attempt instead of racing four
   * `room:join`s, which is how a client double-seats itself.
   */
  let resumeInFlight: Promise<boolean> | null = null;
  /**
   * Set by `reclaimInto` for a cold load, where the store is empty and the
   * route is the only thing that knows which room we are trying to get back to.
   */
  let reclaimTarget: string | null = null;

  function nameOf(playerId: string | null | undefined): string {
    if (!playerId) return 'Somebody';
    return get().room?.players.find((p) => p.id === playerId)?.name ?? 'Somebody';
  }

  function ingestEvents(events: readonly GameEvent[]): void {
    if (events.length === 0) return;
    const positions = collectRevealPositions(events);
    if (positions.length > 0) {
      const steps = planRevealCascade(positions, { reducedMotion: prefersReducedMotion() });
      set((s) => ({ reveal: { delays: cascadeDelayMap(steps), token: s.reveal.token + 1 } }));
      // The run of flips gets a matching run of clinks, same 40ms stagger.
      playRevealCascade(steps.map((s) => s.delayMs));
    }
    for (const e of events) {
      if (e.t === 'card:played') playSfx('capCrack');
      if (e.t === 'solve:success') playSfx('turnChime');
      if (e.t === 'solve:fail') playSfx('snap');
      if (e.t === 'blowout') {
        playSfx('boom');
        set({ blownOut: true });
        track({ name: 'blowout', params: { round_number: get().round?.roundNumber ?? 0 } });
      }
      if (e.t === 'solve:success') {
        track({ name: 'solve_success', params: { hidden_letters: e.hiddenAtSolve } });
      }
      if (e.t === 'round:start') {
        setPressureLevel(0);
        set({ blownOut: false, roundResult: null });
      }
    }
    const items = feedItemsFor(events, nameOf);
    if (items.length > 0) {
      set((s) => ({ feed: [...items.reverse(), ...s.feed].slice(0, FEED_MAX) }));
    }
  }

  function wire(transport: Transport): () => void {
    const offs: (() => void)[] = [];

    offs.push(
      transport.onState((connection, detail) => {
        set({ connection, connectionDetail: detail ?? null });
        const inRoom = !!get().room || !!readSession();

        if (connection === 'connected') {
          // THE fix for the frozen board. socket.io reconnecting is only half
          // the job: the new socket has a new id and the server binds seats to
          // socket ids, so until the token is presented again this tab is a
          // ghost — connected, receiving nothing, able to do nothing.
          if (inRoom) void get().resume('socket-connected');
          else set({ linkPhase: 'idle' });
          return;
        }

        if (connection === 'reconnecting' || connection === 'error') {
          if (inRoom && get().linkPhase !== 'seat-lost') set({ linkPhase: 'reconnecting' });
          return;
        }

        if (connection === 'closed') set({ linkPhase: 'idle' });
      }),
    );

    offs.push(
      transport.on('room:state', (room) => {
        // A seat that was a human and is now disconnected or a bot is a drop
        // (section 7). Diffed here rather than trusting a dedicated event, so it
        // works whichever way the server reports it. No ids leave this call.
        const before = get().room?.players ?? [];
        for (const p of room.players) {
          const was = before.find((q) => q.id === p.id);
          if (!was || was.isBot || was.connection === p.connection) continue;
          if (p.connection === 'disconnected' || (p.isBot && was.wasHuman !== true)) {
            track({ name: 'player_dropped', params: { became_bot: p.isBot } });
          }
        }
        set({ room, pressureMax: BALANCE.pressure.max });
      }),
    );

    offs.push(
      transport.on('game:started', ({ round, board }) => {
        const room = get().room;
        track({
          name: 'game_started',
          params: {
            player_count: room?.players.length ?? 0,
            bot_count: room?.players.filter((p) => p.isBot).length ?? 0,
            turn_seconds: room?.settings.turnSeconds ?? 0,
          },
        });
        set({
          round,
          board,
          pressure: round.pressure,
          pressureMax: round.pressureMax,
          blownOut: false,
          roundResult: null,
          matchResult: null,
          turnPlayerId: round.currentPlayerId,
          turnEndsAt: round.turnEndsAt,
          feed: [],
          reveal: { delays: new Map(), token: 0 },
        });
      }),
    );

    offs.push(
      transport.on('board:update', ({ board, round, events }) => {
        set({
          board,
          round,
          pressure: round.pressure,
          pressureMax: round.pressureMax,
          turnPlayerId: round.currentPlayerId,
          turnEndsAt: round.turnEndsAt,
        });
        ingestEvents(events);
      }),
    );

    offs.push(transport.on('hand:update', ({ cards, peeks }) => set({ hand: cards, peeks })));

    offs.push(
      transport.on('turn:begin', ({ playerId, endsAt }) => {
        if (playerId === get().playerId) playSfx('turnChime');
        set({ turnPlayerId: playerId, turnEndsAt: endsAt, solveOpen: false });
      }),
    );

    offs.push(
      transport.on('turn:timer', ({ playerId, remainingMs }) => {
        if (get().turnPlayerId !== playerId) return;
        set({ turnEndsAt: Date.now() + remainingMs });
      }),
    );

    offs.push(
      transport.on('pressure:update', ({ value, delta, max, cause }) => {
        set((s) => ({
          pressure: value,
          pressureMax: max,
          pulse: { value, delta, cause, token: (s.pulse?.token ?? 0) + 1 },
        }));
        // §9: "a hiss as pressure rises" — a continuous bed, not a one-shot.
        setPressureLevel(max > 0 ? value / max : 0);
      }),
    );

    offs.push(transport.on('interrupt:window', (w) => set({ interrupt: w })));
    offs.push(
      transport.on('interrupt:closed', ({ windowId }) => {
        if (get().interrupt?.windowId === windowId) set({ interrupt: null });
      }),
    );

    offs.push(
      transport.on('round:end', (result) => {
        // Reason and round number only. Never the answer, though it is in the
        // payload — a round-end result legitimately carries it (section 11).
        track({
          name: 'round_completed',
          params: { reason: result.reason, round_number: result.roundNumber, turns: get().feed.length },
        });
        set({ roundResult: result, interrupt: null, solveOpen: false });
      }),
    );
    offs.push(
      transport.on('match:end', (result) => {
        track({
          name: 'match_completed',
          params: { rounds_played: result.roundsPlayed, player_count: Object.keys(result.totals).length },
        });
        set({ matchResult: result });
      }),
    );
    offs.push(transport.on('error', (error) => set({ lastError: error })));

    return () => {
      for (const off of offs) off();
    };
  }

  async function send(
    event: Parameters<Transport['emit']>[0],
    payload: unknown,
  ): Promise<AckResult<unknown>> {
    const transport = get().transport;
    if (!transport) {
      const error = { code: 'NO_TRANSPORT', message: 'Not connected.' };
      void get().resume('no-transport');
      return { ok: false, error };
    }
    const res = (await transport.emit(event as never, payload as never)) as AckResult<unknown>;
    if (!res.ok) {
      // A tap that comes back "you are not in a room" is the ghost-tab
      // symptom, not a user error. Fix the link instead of accusing them: the
      // overlay is already saying "Reconnecting", and a red toast on top of it
      // would just be noise.
      if (UNSEATED.has(res.error.code) && (get().room || readSession())) {
        set({ linkPhase: 'reconnecting' });
        void get().resume(`unseated:${res.error.code}`);
      } else {
        set({ lastError: res.error });
      }
    }
    return res;
  }

  /** Remember the seat wherever the credential currently is. */
  function persistSeat(data: JoinedPayload): void {
    writeSession({
      code: data.room.code,
      key: data.key,
      sessionToken: data.sessionToken,
      playerId: data.playerId,
    });
  }

  /** The room code in the address bar, if the player is looking at a room. */
  function roomCodeInUrl(): string | null {
    if (typeof window === 'undefined') return null;
    const parts = window.location.pathname.split('/').filter(Boolean);
    return parts[0] === 'room' && parts[1] ? parts[1].toUpperCase() : null;
  }

  /**
   * The three things a reclaim needs. In-memory first (the normal reconnect —
   * the tab never died, only the socket did), then localStorage (the tab WAS
   * discarded and re-executed).
   *
   * The localStorage branch is gated on the player actually being at that
   * room's address. A stored credential outlives the visit that created it, so
   * without the gate a wake-up on the landing page would quietly re-seat
   * someone in a room they had walked away from, and a wake-up on `/room/ABCD`
   * would try to reclaim a seat in `WXYZ`.
   */
  function credentials(): { code: string; key: string; sessionToken: string; playerId: string } | null {
    const s = get();
    const code = s.room?.code;
    if (code && s.roomKey && s.sessionToken && s.playerId) {
      return { code, key: s.roomKey, sessionToken: s.sessionToken, playerId: s.playerId };
    }
    const stored = readSession();
    if (!stored) return null;
    const want = reclaimTarget ?? roomCodeInUrl();
    if (!want || want !== stored.code.toUpperCase()) return null;
    return { code: stored.code, key: stored.key, sessionToken: stored.sessionToken, playerId: stored.playerId };
  }

  /** Build (or reuse) a wired transport of the requested kind. */
  function ensureTransport(kind: TransportKind): Transport {
    const existing = get().transport;
    if (existing && get().transportKind === kind) return existing;
    detach?.();
    existing?.disconnect();
    const transport = transportFactory(kind);
    detach = wire(transport);
    set({ transport, transportKind: kind });
    return transport;
  }

  /**
   * Listen for the phone waking up. Installed once per connected session and
   * torn down on `disconnect()`, so it never outlives the store it drives.
   */
  function armResumeTriggers(): void {
    if (stopResumeTriggers) return;
    stopResumeTriggers = installResumeTriggers({
      isHealthy: () => get().transport?.isHealthy() === true && get().linkPhase === 'live',
      onResume: (reason: ResumeReason) => {
        void get().resume(reason);
      },
    });
  }

  /**
   * One reclaim attempt. Never call directly — go through `resume()`, which
   * owns the in-flight dedupe.
   */
  async function runResume(reason: string): Promise<boolean> {
    // The mock runs in this process. It cannot drop, and re-joining it would
    // restart the scripted demo, which is worse than doing nothing.
    if (get().transportKind === 'mock') {
      set({ linkPhase: 'live' });
      return true;
    }

    const cred = credentials();
    if (!cred) {
      set({ linkPhase: get().room ? 'reconnecting' : 'idle' });
      return false;
    }

    set({ linkPhase: 'resuming', lastResumeReason: reason });

    const transport = ensureTransport('socket');
    if (!transport.isHealthy()) await transport.reconnect();
    if (!transport.isHealthy()) {
      // socket.io owns the retry loop from here (unlimited attempts, capped
      // backoff, jitter) and its `connect` fires this function again.
      set({ linkPhase: 'reconnecting' });
      return false;
    }

    const { name, color } = get().identity;
    const res = (await transport.emit('room:join', {
      code: cred.code,
      key: cred.key,
      name,
      color,
      sessionToken: cred.sessionToken,
    } as never)) as AckResult<JoinedPayload>;

    if (res.ok) {
      const data = res.data;
      // A DIFFERENT playerId means the token matched nothing and the server
      // seated us fresh: same room, new seat, score back at zero, dealt in
      // next round (§7 late joiner). Not a failure, but not a silent one either.
      const sameSeat = data.playerId === cred.playerId;
      persistSeat(data);
      set((s) => ({
        sessionToken: data.sessionToken,
        roomKey: data.key,
        playerId: data.playerId,
        room: data.room,
        linkPhase: 'live',
        resumeToken: s.resumeToken + 1,
        recoveredAt: Date.now(),
        connectionDetail: null,
        seatLost: sameSeat
          ? null
          : {
              code: data.room.code,
              recovered: true,
              message: 'You were away long enough to lose your old seat. You are back in for the next round.',
            },
      }));
      track({ name: 'reconnected', params: { same_seat: sameSeat } });
      return true;
    }

    if (RETRYABLE.has(res.error.code)) {
      set({ linkPhase: 'reconnecting' });
      return false;
    }

    // Anything else is terminal for this seat: the room closed, the match
    // ended, or it filled up. Say so rather than sitting on a dead board.
    clearSession();
    set({
      linkPhase: 'seat-lost',
      seatLost: { code: cred.code, recovered: false, message: seatLostMessage(res.error) },
    });
    track({ name: 'seat_lost', params: { reason: res.error.code } });
    return false;
  }

  return {
    transport: null,
    transportKind: 'mock',
    connection: 'idle',
    connectionDetail: null,

    linkPhase: 'idle',
    lastResumeReason: null,
    resumeToken: 0,
    recoveredAt: null,
    seatLost: null,

    identity: typeof window === 'undefined' ? { name: '', color: '#FF5C1A' } : readIdentity(),
    playerId: null,
    sessionToken: null,
    roomKey: null,

    room: null,
    round: null,
    board: null,
    hand: [],
    peeks: {},

    pressure: 0,
    pressureMax: BALANCE.pressure.max,
    pulse: null,
    blownOut: false,

    turnPlayerId: null,
    turnEndsAt: null,

    interrupt: null,
    reveal: { delays: new Map(), token: 0 },
    feed: [],

    roundResult: null,
    matchResult: null,
    lastError: null,

    castView: false,
    muted: audio0.muted,
    volume: audio0.volume,
    musicVolume: audio0.musicVolume,
    sameRoomLocal: audio0.sameRoom,
    solveOpen: false,

    setIdentity(patch) {
      const identity = { ...get().identity, ...patch };
      writeIdentity(identity);
      set({ identity });
    },

    async connect(kind) {
      const want = kind ?? defaultTransportKind();
      const existing = get().transport;
      // Ask the SOCKET whether it is alive, not the last state event. A phone
      // that slept comes back with `connection === 'connected'` describing a
      // socket the OS closed while no JavaScript was running to hear about it;
      // trusting that flag here is what left the tab wedged.
      if (existing && get().transportKind === want && existing.isHealthy()) return;

      const transport = ensureTransport(want);
      set({ connection: 'connecting' });
      armResumeTriggers();
      try {
        await transport.connect();
      } catch (err) {
        set({ connection: 'error', connectionDetail: err instanceof Error ? err.message : String(err) });
      }
    },

    /**
     * Idempotent by construction:
     *
     *  - concurrent callers share `resumeInFlight`, so N triggers make one
     *    `room:join`;
     *  - that `room:join` carries the session token, and the server's
     *    `reclaim` is a map lookup plus an overwrite of `seat.socketId` — there
     *    is exactly one seat per player for the life of the room, so no number
     *    of calls can produce a second one;
     *  - the token is never rotated, so attempt N+1 presents the same
     *    credential attempt N did.
     */
    resume(reason = 'manual') {
      if (resumeInFlight) return resumeInFlight;
      // Deferred by one microtask so `resumeInFlight` is published BEFORE any
      // of `runResume` executes. Without that gap the attempt re-enters
      // itself: `runResume` asks the transport to reconnect, the transport
      // synchronously reports `connected`, the state handler calls `resume()`
      // again — and the guard it is supposed to hit has not been assigned yet.
      // That reentrancy is precisely how a wake-up burst turns into three
      // simultaneous `room:join`s.
      const p = Promise.resolve()
        .then(() => runResume(reason))
        .catch((err) => {
          set({
            linkPhase: 'reconnecting',
            connectionDetail: err instanceof Error ? err.message : String(err),
          });
          return false;
        })
        .finally(() => {
          if (resumeInFlight === p) resumeInFlight = null;
        });
      resumeInFlight = p;
      return p;
    },

    /**
     * A cold load of `/room/:code`. The tab was discarded (routine on mobile —
     * the OS reclaims backgrounded tabs) and everything in memory went with it,
     * but the seat is still held on the server and the credential is still in
     * localStorage. Try it before falling back to the join door.
     */
    async reclaimInto(code) {
      const stored = sessionFor(code);
      if (!stored) return false;
      reclaimTarget = stored.code.toUpperCase();
      set({
        sessionToken: stored.sessionToken,
        roomKey: stored.key,
        playerId: stored.playerId,
        linkPhase: 'resuming',
      });
      await get().connect('socket');
      return get().resume('cold-load');
    },

    dismissSeatLost() {
      set({ seatLost: null });
    },

    disconnect() {
      stopResumeTriggers?.();
      stopResumeTriggers = null;
      detach?.();
      detach = null;
      resumeInFlight = null;
      reclaimTarget = null;
      get().transport?.disconnect();
      // A deliberate leave gives up the seat, so the credential must go too —
      // otherwise the next visit to the landing page tries to reclaim a seat
      // the player walked away from.
      clearSession();
      set({
        transport: null,
        connection: 'closed',
        linkPhase: 'idle',
        seatLost: null,
        room: null,
        roomKey: null,
        board: null,
        round: null,
        hand: [],
      });
    },

    async createRoom(settings) {
      const { name, color } = get().identity;
      const res = await send('room:create', { name, color, settings });
      if (res.ok) {
        const data = res.data as JoinedPayload;
        persistSeat(data);
        set({
          sessionToken: data.sessionToken,
          roomKey: data.key,
          playerId: data.playerId,
          room: data.room,
          linkPhase: 'live',
          seatLost: null,
        });
        armResumeTriggers();
        track({
          name: 'room_created',
          params: { match_mode: data.room.settings.matchMode, bot_count: data.room.settings.botCount },
        });
      }
      return res;
    },

    async joinRoom(code, key) {
      const { name, color } = get().identity;
      // Prefer the credential stored FOR THIS ROOM. Someone whose phone slept
      // and who then re-opens the invite link is reconnecting, not joining, and
      // presenting the right token here is what gets them their seat and score
      // back instead of a second seat at zero.
      const stored = sessionFor(code);
      const token = stored?.sessionToken ?? get().sessionToken;
      const roomKey = key ?? stored?.key ?? get().roomKey ?? undefined;
      const res = await send('room:join', {
        code,
        name,
        color,
        ...(roomKey ? { key: roomKey } : {}),
        ...(token ? { sessionToken: token } : {}),
      });
      if (res.ok) {
        const data = res.data as JoinedPayload;
        persistSeat(data);
        set({
          sessionToken: data.sessionToken,
          roomKey: data.key,
          playerId: data.playerId,
          room: data.room,
          linkPhase: 'live',
          seatLost: null,
        });
        armResumeTriggers();
        track({ name: 'room_joined', params: { player_count: data.room.players.length } });
      }
      return res;
    },

    async updateSettings(settings) {
      await send('room:settings', { settings });
    },

    async startGame() {
      await send('game:start', {});
    },

    async playLetterCard(cardId) {
      playSfx('snap');
      // Section 11: card TYPE only. Never which letter — that is board state.
      track({ name: 'card_played', params: { card_type: 'letter' } });
      await send('turn:playCard', { type: 'letter', cardId });
    },

    async playActionCard(cardId, letter, targetPlayerId) {
      playSfx('snap');
      const card = get().hand.find((c) => c.id === cardId);
      track({
        name: 'card_played',
        params: { card_type: 'action', ...(card && card.kind === 'action' ? { action: card.action } : {}) },
      });
      await send('turn:playCard', { type: 'action', cardId, letter, targetPlayerId });
    },

    async discard(cardIds) {
      await send('turn:discard', { cardIds });
    },

    async solve(guess) {
      set({ solveOpen: false });
      // Never the guess itself, and never the puzzle. Just how far along the
      // board was, which is the only interesting part (section 11).
      const board = get().board;
      track({
        name: 'solve_attempt',
        params: {
          hidden_fraction: board && board.totalLetters > 0 ? Math.round((board.hiddenLetters / board.totalLetters) * 100) / 100 : 0,
        },
      });
      await send('turn:solve', { guess });
    },

    async playInterrupt(cardId) {
      const w = get().interrupt;
      if (!w) return;
      await send('interrupt:play', { cardId, windowId: w.windowId });
      set({ interrupt: null });
    },

    /**
     * Decline an open window. This has to reach the server: clearing it locally
     * only hides our own prompt, and the window then sits open for its full 4s
     * holding up the whole table.
     */
    async declineInterrupt() {
      const w = get().interrupt;
      set({ interrupt: null });
      if (w) await send('interrupt:pass', { windowId: w.windowId });
    },

    /**
     * Decline the optional solve (§3.3) and end the turn. Without this the
     * awaiting-solve beat runs out the full turn clock on every single turn.
     */
    async passTurn() {
      set({ solveOpen: false });
      await send('turn:pass', {});
    },

    dismissError() {
      set({ lastError: null });
    },

    setCastView(on) {
      set({ castView: on });
    },

    setMuted(on) {
      setSfxMuted(on);
      writeAudio({ muted: on });
      set({ muted: on });
    },

    setVolume(v) {
      const volume = Math.min(1, Math.max(0, v));
      setSfxVolume(volume);
      writeAudio({ volume });
      set({ volume });
    },

    setMusicVolume(v) {
      const musicVolume = Math.min(1, Math.max(0, v));
      setSoundMusicVolume(musicVolume);
      writeAudio({ musicVolume });
      set({ musicVolume });
    },

    /**
     * The Same-room switch (§9). It means two different things depending on
     * who flips it, which is the whole point:
     *
     *  - **Host:** "we are all in one room". Broadcast as a room-level default
     *    so players who join later start quiet without hunting for the toggle.
     *    The host's own device is unaffected — it is the speaker for the table.
     *  - **Player:** "keep my device quiet". Local, persisted, and it beats the
     *    room default in both directions.
     */
    setSameRoom(on) {
      if (selectIsHost(get())) {
        // For the host the switch is purely a broadcast. Their device is the
        // speaker, so nothing local changes — not their audio, not their
        // stored preference for the next room they join as a guest.
        void get().updateSettings({ sameRoomAudio: on });
        return;
      }
      setSameRoomLocal(on);
      writeAudio({ sameRoom: on });
      set({ sameRoomLocal: on });
    },

    setSolveOpen(open) {
      set({ solveOpen: open });
    },
  };
});

// ---- audio slice: keep the sound module in step with the room ---------------
//
// Subscribed rather than wired into the room/join handlers so the whole
// Same-room feature stays in one place: the audio module resolves who is
// silenced, it just needs to be told the room default and who the host is.

function pushSameRoomContext(s: GameStore): void {
  setSameRoomContext({
    roomDefault: s.room?.settings.sameRoomAudio === true,
    isHost: !!s.room && !!s.playerId && s.room.hostId === s.playerId,
  });
}

setSameRoomLocal(useGameStore.getState().sameRoomLocal);
pushSameRoomContext(useGameStore.getState());

useGameStore.subscribe((s, prev) => {
  if (s.room === prev.room && s.playerId === prev.playerId) return;
  pushSameRoomContext(s);
});

// In dev only, expose the store so a browser console (or an automated
// walkthrough) can inspect and drive state. Never present in a production build.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __phrasey?: unknown }).__phrasey = useGameStore;
}

// ---- selectors -------------------------------------------------------------

export function selectMe(s: GameStore): PlayerPublic | null {
  if (!s.room || !s.playerId) return null;
  return s.room.players.find((p) => p.id === s.playerId) ?? null;
}

export function selectIsMyTurn(s: GameStore): boolean {
  return !!s.playerId && s.turnPlayerId === s.playerId;
}

export function selectIsHost(s: GameStore): boolean {
  return !!s.room && !!s.playerId && s.room.hostId === s.playerId;
}

export function selectPlayerName(s: GameStore, id: string | null | undefined): string {
  if (!id) return '';
  return s.room?.players.find((p) => p.id === id)?.name ?? '';
}
