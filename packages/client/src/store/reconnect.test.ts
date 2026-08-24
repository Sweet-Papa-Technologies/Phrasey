/**
 * The mobile reconnect path, end to end on the client side.
 *
 * The scenario under test throughout is the one the product owner reported:
 * a phone's screen goes to sleep, the OS tears the websocket down, and the tab
 * comes back to a board that never moves again. Socket.io reconnecting is only
 * half of that story — the other half is that a reconnect gets a NEW socket id
 * and the server binds seats to socket ids, so the tab has to present its
 * session token again or it is connected to nothing.
 *
 * The fake below is a faithful stand-in for `packages/server/src/net/io.ts`'s
 * `room:join`: token first, key second, and a token that matches nothing falls
 * through to a brand-new seat.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClientToServerEvents, RoomPublic } from '@phrasey/shared';
import {
  Emitter,
  type AckDataOf,
  type AckResult,
  type ConnectionState,
  type PayloadOf,
  type Transport,
} from '../net/transport';
import { clearSession, readSession, writeSession } from '../net/session';
import { setTransportFactory, useGameStore } from './gameStore';

// ---------------------------------------------------------------------------
// A server that behaves like io.ts, and a link that can be cut.
// ---------------------------------------------------------------------------

interface Seat {
  playerId: string;
  token: string;
}

class FakeServer {
  readonly code = 'KABO';
  readonly key = 'M3XR';
  /** token → seat. Mirrors `Room.byToken`; a seat is never removed by a reclaim. */
  readonly seats = new Map<string, Seat>();
  /** Every `room:join` this server saw, so a test can prove the dedupe works. */
  readonly joins: { token?: string; reclaimed: boolean }[] = [];
  private nextId = 1;

  /** Simulates the §7 hold lapsing past the point of no return. */
  forgetToken(token: string): void {
    this.seats.delete(token);
  }

  /** Simulates the room being gone entirely (reaped, or the match ended). */
  closed = false;

  join(payload: { code: string; key?: string; sessionToken?: string }): AckResult<unknown> {
    if (this.closed || payload.code !== this.code) {
      this.joins.push({ token: payload.sessionToken, reclaimed: false });
      return { ok: false, error: { code: 'BAD_ROOM', message: 'That room code and key do not match.' } };
    }
    // Token first — a returning phone is not a join attempt.
    if (payload.sessionToken) {
      const seat = this.seats.get(payload.sessionToken);
      if (seat) {
        this.joins.push({ token: payload.sessionToken, reclaimed: true });
        // The SAME token comes back, never a fresh one.
        return { ok: true, data: this.payloadFor(seat, payload.sessionToken) };
      }
    }
    if (payload.key !== this.key) {
      this.joins.push({ token: payload.sessionToken, reclaimed: false });
      return { ok: false, error: { code: 'BAD_ROOM', message: 'That room code and key do not match.' } };
    }
    const token = `tok-${this.nextId}`;
    const seat: Seat = { playerId: `p-${this.nextId}`, token };
    this.nextId += 1;
    this.seats.set(token, seat);
    this.joins.push({ token: payload.sessionToken, reclaimed: false });
    return { ok: true, data: this.payloadFor(seat, token) };
  }

  private payloadFor(seat: Seat, token: string) {
    return { sessionToken: token, playerId: seat.playerId, key: this.key, room: this.room() };
  }

  room(): RoomPublic {
    return {
      code: this.code,
      status: 'lobby',
      hostId: [...this.seats.values()][0]?.playerId ?? '',
      settings: {} as RoomPublic['settings'],
      players: [...this.seats.values()].map((s) => ({ id: s.playerId, name: 'Phone' }) as RoomPublic['players'][number]),
      roundNumber: 0,
      createdAt: 0,
    };
  }
}

/** A transport whose link can be cut and restored, the way a sleeping phone's is. */
class FakeTransport implements Transport {
  readonly kind = 'socket';
  private healthy = false;
  private readonly stateBus = new Emitter<{ state: (s: ConnectionState, detail?: string) => void }>();
  /** True once the socket has been cut at least once — i.e. a REAL drop happened. */
  dropped = false;
  /** Set to keep `reconnect()` failing, standing in for a radio that is still down. */
  radioDown = false;

  constructor(private readonly server: FakeServer) {}

  async connect(): Promise<void> {
    if (this.radioDown) throw new Error('offline');
    this.healthy = true;
    this.stateBus.emit('state', 'connected');
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  async reconnect(): Promise<void> {
    if (this.healthy) return;
    try {
      await this.connect();
    } catch {
      /* socket.io owns the retry loop */
    }
  }

  /** The OS killed the socket while the tab was frozen. */
  cut(): void {
    this.healthy = false;
    this.dropped = true;
    this.stateBus.emit('state', 'reconnecting', 'transport close');
  }

  async emit<E extends keyof ClientToServerEvents>(
    event: E,
    payload: PayloadOf<E>,
  ): Promise<AckResult<AckDataOf<E>>> {
    const as = <T>(r: AckResult<unknown>): AckResult<T> => r as AckResult<T>;
    if (!this.healthy) {
      return as({ ok: false, error: { code: 'NOT_CONNECTED', message: 'Not connected to the game server.' } });
    }
    if (event === 'room:join') return as(this.server.join(payload as { code: string; key?: string }));
    if (event === 'room:create') {
      return as(this.server.join({ code: this.server.code, key: this.server.key }));
    }
    return as({ ok: true, data: { ok: true } });
  }

  on(): () => void {
    return () => {};
  }

  onState(cb: (s: ConnectionState, detail?: string) => void): () => void {
    return this.stateBus.on('state', cb);
  }

  disconnect(): void {
    this.healthy = false;
    this.stateBus.emit('state', 'closed');
  }
}

// ---------------------------------------------------------------------------

let server: FakeServer;
let link: FakeTransport;

/** Seat the phone the way the landing page does, then confirm it is live. */
async function seat(): Promise<void> {
  const store = useGameStore.getState();
  store.setIdentity({ name: 'Phone', color: '#FF5C1A' });
  await store.connect('socket');
  const res = await store.createRoom();
  expect(res.ok).toBe(true);
  expect(useGameStore.getState().linkPhase).toBe('live');
}

beforeEach(() => {
  clearSession();
  server = new FakeServer();
  link = new FakeTransport(server);
  setTransportFactory(() => link);
  useGameStore.setState({
    transport: null,
    transportKind: 'mock',
    connection: 'idle',
    linkPhase: 'idle',
    resumeToken: 0,
    recoveredAt: null,
    seatLost: null,
    room: null,
    roomKey: null,
    playerId: null,
    sessionToken: null,
    lastError: null,
  });
});

afterEach(() => {
  useGameStore.getState().disconnect();
  setTransportFactory(null);
  clearSession();
});

describe('reclaim after a drop', () => {
  it('re-presents the session token when the socket comes back, and lands the same seat', async () => {
    await seat();
    const before = useGameStore.getState();
    const seatId = before.playerId;
    const token = before.sessionToken;
    expect(seatId).toBeTruthy();

    // The phone sleeps: the OS closes the socket, nothing else happens.
    link.cut();
    expect(useGameStore.getState().linkPhase).toBe('reconnecting');

    // It wakes up. socket.io gets a socket back — which on its own leaves the
    // tab seatless, because the id is new.
    await link.connect();
    await useGameStore.getState().resume('test');

    const after = useGameStore.getState();
    expect(after.linkPhase).toBe('live');
    expect(after.playerId).toBe(seatId);
    expect(after.sessionToken).toBe(token);
    expect(after.resumeToken).toBe(1);
    expect(after.seatLost).toBeNull();

    // The seat was RECLAIMED, not re-created: still exactly one at the table.
    expect(server.seats.size).toBe(1);
    expect(server.joins.at(-1)).toEqual({ token, reclaimed: true });
  });

  it('reports "reconnecting" rather than claiming to be live while the radio is down', async () => {
    await seat();
    link.cut();
    link.radioDown = true;

    const ok = await useGameStore.getState().resume('test');
    expect(ok).toBe(false);
    expect(useGameStore.getState().linkPhase).toBe('reconnecting');
    // Nothing was sent, so nothing could have double-seated us.
    expect(server.seats.size).toBe(1);
  });

  it('recovers when the radio finally comes back, with no help from the caller', async () => {
    await seat();
    link.cut();
    link.radioDown = true;
    await useGameStore.getState().resume('attempt-1');
    expect(useGameStore.getState().linkPhase).toBe('reconnecting');

    link.radioDown = false;
    await useGameStore.getState().resume('attempt-2');
    expect(useGameStore.getState().linkPhase).toBe('live');
    expect(server.seats.size).toBe(1);
  });
});

describe('reclaim idempotence', () => {
  it('collapses concurrent resumes into a single room:join', async () => {
    await seat();
    link.cut();
    const joinsBefore = server.joins.length;
    await link.connect();

    const results = await Promise.all([
      useGameStore.getState().resume('a'),
      useGameStore.getState().resume('b'),
      useGameStore.getState().resume('c'),
      useGameStore.getState().resume('d'),
    ]);

    expect(results).toEqual([true, true, true, true]);
    expect(server.joins.length - joinsBefore).toBe(1);
    expect(server.seats.size).toBe(1);
  });

  it('lands the same seat however many times it is called in a row', async () => {
    await seat();
    const seatId = useGameStore.getState().playerId;
    const token = useGameStore.getState().sessionToken;

    for (let i = 0; i < 6; i++) {
      link.cut();
      await link.connect();
      await useGameStore.getState().resume(`round-${i}`);
      const s = useGameStore.getState();
      expect(s.playerId).toBe(seatId);
      expect(s.sessionToken).toBe(token);
      expect(s.linkPhase).toBe('live');
    }

    // Six reclaims, still one seat and one token. Double-seating is not
    // reachable from here.
    expect(server.seats.size).toBe(1);
    expect(server.joins.filter((j) => j.reclaimed).length).toBe(6);
  });

  it('is safe to resume while the link is already healthy and seated', async () => {
    await seat();
    const seatId = useGameStore.getState().playerId;
    await useGameStore.getState().resume('spurious');
    await useGameStore.getState().resume('spurious');
    expect(useGameStore.getState().playerId).toBe(seatId);
    expect(server.seats.size).toBe(1);
  });
});

describe('when the seat is really gone', () => {
  it('explains a lapsed seat instead of pretending nothing happened', async () => {
    await seat();
    const oldSeat = useGameStore.getState().playerId;

    // Asleep for longer than the hold: the server no longer knows the token.
    link.cut();
    server.forgetToken(useGameStore.getState().sessionToken as string);
    await link.connect();
    await useGameStore.getState().resume('long-sleep');

    const s = useGameStore.getState();
    // Back at the table, but honestly labelled as a NEW seat.
    expect(s.linkPhase).toBe('live');
    expect(s.playerId).not.toBe(oldSeat);
    expect(s.seatLost).not.toBeNull();
    expect(s.seatLost?.recovered).toBe(true);
    expect(s.seatLost?.message).toMatch(/next round/i);
    // ...and the new credential is what gets persisted from here on.
    expect(readSession()?.playerId).toBe(s.playerId);
  });

  it('says so plainly, and stops trying, when the room itself is gone', async () => {
    await seat();
    link.cut();
    server.closed = true;
    await link.connect();
    const ok = await useGameStore.getState().resume('room-gone');

    expect(ok).toBe(false);
    const s = useGameStore.getState();
    expect(s.linkPhase).toBe('seat-lost');
    expect(s.seatLost?.recovered).toBe(false);
    expect(s.seatLost?.message).toBeTruthy();
    // A credential that cannot possibly work is not kept.
    expect(readSession()).toBeNull();
  });

  it('lets the player dismiss the new-seat notice', async () => {
    await seat();
    link.cut();
    server.forgetToken(useGameStore.getState().sessionToken as string);
    await link.connect();
    await useGameStore.getState().resume('long-sleep');
    expect(useGameStore.getState().seatLost).not.toBeNull();
    useGameStore.getState().dismissSeatLost();
    expect(useGameStore.getState().seatLost).toBeNull();
  });
});

describe('cold reload into /room/:code', () => {
  it('reclaims from localStorage instead of bouncing to the join door', async () => {
    await seat();
    const seatId = useGameStore.getState().playerId;
    const token = useGameStore.getState().sessionToken;

    // The OS discarded the tab. Everything in memory is gone; the credential
    // in localStorage is not.
    const stored = readSession();
    expect(stored).not.toBeNull();
    expect(stored?.code).toBe(server.code);
    expect(stored?.key).toBe(server.key);

    link = new FakeTransport(server);
    setTransportFactory(() => link);
    useGameStore.setState({
      transport: null,
      transportKind: 'mock',
      connection: 'idle',
      linkPhase: 'idle',
      resumeToken: 0,
      room: null,
      roomKey: null,
      playerId: null,
      sessionToken: null,
      seatLost: null,
    });

    const ok = await useGameStore.getState().reclaimInto(server.code);

    expect(ok).toBe(true);
    const s = useGameStore.getState();
    expect(s.room?.code).toBe(server.code);
    expect(s.playerId).toBe(seatId);
    expect(s.sessionToken).toBe(token);
    expect(s.linkPhase).toBe('live');
    expect(server.seats.size).toBe(1);
  });

  it('declines to reclaim a room the stored credential is not for', async () => {
    await seat();
    const ok = await useGameStore.getState().reclaimInto('ZZZZ');
    expect(ok).toBe(false);
  });

  it('declines when there is no stored credential at all — a genuine first visit', async () => {
    clearSession();
    const ok = await useGameStore.getState().reclaimInto('KABO');
    expect(ok).toBe(false);
  });

  it('ignores a credential older than the room could possibly be', async () => {
    writeSession(
      { code: 'KABO', key: 'M3XR', sessionToken: 'tok-1', playerId: 'p-1' },
      Date.now() - 7 * 60 * 60 * 1000,
    );
    const ok = await useGameStore.getState().reclaimInto('KABO');
    expect(ok).toBe(false);
    expect(readSession()).toBeNull();
  });
});

/** Spin until the store settles, the way a real tab would just… carry on. */
async function settled(pred: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 2));
  }
  throw new Error('store never settled');
}

describe('a stored credential is scoped to the room it belongs to', () => {
  it('does not re-seat someone who has walked back to the landing page', async () => {
    await seat();
    const joinsBefore = server.joins.length;

    // They tapped the logo. The store still holds the room, so drop that too —
    // this is the state a discarded-and-reloaded tab on `/` would be in.
    useGameStore.setState({ room: null, roomKey: null, sessionToken: null, playerId: null });
    expect(readSession()).not.toBeNull();
    expect(window.location.pathname).toBe('/');

    link.cut();
    const ok = await useGameStore.getState().resume('visible');

    expect(ok).toBe(false);
    // Nothing was sent: a credential is not a standing instruction to rejoin.
    expect(server.joins.length).toBe(joinsBefore);
  });

  it('will not reclaim a seat in one room while the player is looking at another', async () => {
    await seat();
    useGameStore.setState({ room: null, roomKey: null, sessionToken: null, playerId: null });
    const joinsBefore = server.joins.length;

    // The stored credential is for KABO.
    const ok = await useGameStore.getState().reclaimInto('ZZZZ');
    expect(ok).toBe(false);
    expect(server.joins.length).toBe(joinsBefore);
  });
});

describe('wake-up triggers, wired to the store', () => {
  it('a real visibilitychange on a dropped link reclaims the seat', async () => {
    await seat();
    const seatId = useGameStore.getState().playerId;

    link.cut();
    // The tab thaws. This is the browser event, dispatched for real — nothing
    // in this test calls `resume()` itself.
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));

    await settled(() => useGameStore.getState().linkPhase === 'live');

    const s = useGameStore.getState();
    expect(s.linkPhase).toBe('live');
    expect(s.playerId).toBe(seatId);
    expect(server.seats.size).toBe(1);
  });

  it('a burst of wake-up events still produces a single seat', async () => {
    await seat();
    link.cut();
    const joinsBefore = server.joins.length;

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));

    await settled(() => useGameStore.getState().linkPhase === 'live');

    expect(server.seats.size).toBe(1);
    // One reclaim, not four. The debounce collapses the burst and the
    // in-flight guard catches whatever slips through it.
    expect(server.joins.length - joinsBefore).toBe(1);
  });
});

describe('a game action taken on a ghost tab', () => {
  it('fixes the link instead of blaming the player', async () => {
    await seat();
    link.cut();
    // The player taps a card on what looks like a live board.
    await useGameStore.getState().passTurn();
    // No scary red error — a reconnect.
    expect(useGameStore.getState().lastError).toBeNull();
    expect(['reconnecting', 'resuming', 'live']).toContain(useGameStore.getState().linkPhase);
  });
});
