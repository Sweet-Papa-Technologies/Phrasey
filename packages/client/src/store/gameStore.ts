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
} from '@phrasey/shared';
import type { AckResult, ConnectionState, Transport } from '../net/transport';
import { createMockTransport } from '../net/mockTransport';
import { createSocketTransport } from '../net/socketTransport';
import { cascadeDelayMap, collectRevealPositions, planRevealCascade } from '../lib/reveal';
import { prefersReducedMotion } from '../lib/motion';
import {
  playRevealCascade,
  playSfx,
  setMuted as setSfxMuted,
  setPressureLevel,
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

export interface GameStore {
  transport: Transport | null;
  transportKind: TransportKind;
  connection: ConnectionState;
  connectionDetail: string | null;

  identity: Identity;
  playerId: string | null;
  sessionToken: string | null;

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
  solveOpen: boolean;

  // ---- actions ----
  setIdentity(patch: Partial<Identity>): void;
  connect(kind?: TransportKind): Promise<void>;
  disconnect(): void;
  createRoom(settings?: Partial<RoomSettings>): Promise<AckResult<unknown>>;
  joinRoom(code: string): Promise<AckResult<unknown>>;
  updateSettings(settings: Partial<RoomSettings>): Promise<void>;
  startGame(): Promise<void>;
  playLetterCard(cardId: string): Promise<void>;
  playActionCard(cardId: string, letter?: string, targetPlayerId?: string): Promise<void>;
  discard(cardIds: string[]): Promise<void>;
  solve(guess: string): Promise<void>;
  playInterrupt(cardId: string): Promise<void>;
  dismissError(): void;
  setCastView(on: boolean): void;
  setMuted(on: boolean): void;
  setVolume(v: number): void;
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

function readAudio(): { muted: boolean; volume: number } {
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (raw) {
      const p = JSON.parse(raw) as { muted?: boolean; volume?: number };
      return { muted: p.muted ?? false, volume: typeof p.volume === 'number' ? p.volume : 0.4 };
    }
  } catch {
    /* ignore */
  }
  // §9: sound on by default, at 40%.
  return { muted: false, volume: 0.4 };
}

function writeAudio(a: { muted: boolean; volume: number }): void {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify(a));
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

const audio0 = typeof window === 'undefined' ? { muted: false, volume: 0.4 } : readAudio();

export const useGameStore = create<GameStore>((set, get) => {
  let detach: (() => void) | null = null;

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

    offs.push(transport.onState((connection, detail) => set({ connection, connectionDetail: detail ?? null })));

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
    if (!transport) return { ok: false, error: { code: 'NO_TRANSPORT', message: 'Not connected.' } };
    const res = (await transport.emit(event as never, payload as never)) as AckResult<unknown>;
    if (!res.ok) set({ lastError: res.error });
    return res;
  }

  return {
    transport: null,
    transportKind: 'mock',
    connection: 'idle',
    connectionDetail: null,

    identity: typeof window === 'undefined' ? { name: '', color: '#FF5C1A' } : readIdentity(),
    playerId: null,
    sessionToken: null,

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
    solveOpen: false,

    setIdentity(patch) {
      const identity = { ...get().identity, ...patch };
      writeIdentity(identity);
      set({ identity });
    },

    async connect(kind) {
      const existing = get().transport;
      const want = kind ?? defaultTransportKind();
      if (existing && get().transportKind === want && get().connection === 'connected') return;
      detach?.();
      existing?.disconnect();

      const transport = want === 'socket' ? createSocketTransport() : createMockTransport();
      detach = wire(transport);
      set({ transport, transportKind: want, connection: 'connecting' });
      try {
        await transport.connect();
      } catch (err) {
        set({ connection: 'error', connectionDetail: err instanceof Error ? err.message : String(err) });
      }
    },

    disconnect() {
      detach?.();
      detach = null;
      get().transport?.disconnect();
      set({ transport: null, connection: 'closed', room: null, board: null, round: null, hand: [] });
    },

    async createRoom(settings) {
      const { name, color } = get().identity;
      const res = await send('room:create', { name, color, settings });
      if (res.ok) {
        const data = res.data as { sessionToken: string; playerId: string; room: RoomPublic };
        set({ sessionToken: data.sessionToken, playerId: data.playerId, room: data.room });
        track({
          name: 'room_created',
          params: { match_mode: data.room.settings.matchMode, bot_count: data.room.settings.botCount },
        });
      }
      return res;
    },

    async joinRoom(code) {
      const { name, color } = get().identity;
      const token = get().sessionToken;
      const res = await send('room:join', { code, name, color, ...(token ? { sessionToken: token } : {}) });
      if (res.ok) {
        const data = res.data as { sessionToken: string; playerId: string; room: RoomPublic };
        set({ sessionToken: data.sessionToken, playerId: data.playerId, room: data.room });
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

    dismissError() {
      set({ lastError: null });
    },

    setCastView(on) {
      set({ castView: on });
    },

    setMuted(on) {
      setSfxMuted(on);
      writeAudio({ muted: on, volume: get().volume });
      set({ muted: on });
    },

    setVolume(v) {
      const volume = Math.min(1, Math.max(0, v));
      setSfxVolume(volume);
      writeAudio({ muted: get().muted, volume });
      set({ volume });
    },

    setSolveOpen(open) {
      set({ solveOpen: open });
    },
  };
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
