/**
 * §7 reconnect, from the point of view of a phone.
 *
 * A laptop drops once and comes back once. A phone drops every time the screen
 * locks, comes back with a brand-new socket id every time, and does it several
 * times in the space of one round. So the property that matters is not "a
 * reconnect works" — it is that reconnecting is IDEMPOTENT: any number of
 * reclaims, in any order, land the same seat with the same hand and the same
 * score, and never produce a second seat at the table.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { HandUpdatePayload, JoinedPayload, RoomPublic } from '@phrasey/shared';
import { BALANCE } from '@phrasey/shared';
import { loadConfig } from '../config.js';
import { fixedPuzzles, startTestServer, TestClient, waitFor, type TestServer } from './helpers.js';

let server: TestServer;
const clients: TestClient[] = [];
const roomKeys = new Map<string, string>();

async function client(): Promise<TestClient> {
  const c = new TestClient(server.url).autoDeclineInterrupts();
  await c.connect();
  clients.push(c);
  return c;
}

async function createRoom(c: TestClient, settings?: Record<string, unknown>): Promise<RoomPublic> {
  const res = await c.call('room:create', { name: 'Host', color: '#FF5C1A', settings });
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  const data = res.data as JoinedPayload;
  c.playerId = data.playerId;
  c.token = data.sessionToken;
  roomKeys.set(data.room.code, data.key);
  return data.room;
}

async function join(c: TestClient, code: string, name = 'Guest'): Promise<JoinedPayload> {
  const res = await c.call('room:join', { code, key: roomKeys.get(code), name, color: '#B8FF3C' });
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  const data = res.data as JoinedPayload;
  c.playerId = data.playerId;
  c.token = data.sessionToken;
  return data;
}

/** Exactly what a woken phone sends: code + key + the token it kept. */
function reclaim(c: TestClient, code: string, token: string) {
  return c.call('room:join', {
    code,
    key: roomKeys.get(code),
    name: 'Guest',
    color: '#B8FF3C',
    sessionToken: token,
  });
}

/** Drop a client the way a locked screen does, and open a fresh socket. */
async function relink(c: TestClient): Promise<TestClient> {
  c.close();
  const i = clients.indexOf(c);
  if (i >= 0) clients.splice(i, 1);
  const next = new TestClient(server.url).autoDeclineInterrupts();
  await next.connect();
  clients.push(next);
  return next;
}

function roster(c: TestClient): RoomPublic['players'] {
  return ((c.of('room:state').at(-1) as RoomPublic | undefined)?.players ?? []) as RoomPublic['players'];
}

function seatOf(c: TestClient, id: string) {
  return roster(c).find((p) => p.id === id);
}

beforeEach(async () => {
  server = await startTestServer({}, fixedPuzzles(['p1', 'p7']));
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.close();
});

describe('the reconnect window', () => {
  it('is driven by the balance table rather than a second hardcoded number', () => {
    // The 90s in §7 used to live in `config.ts` while `balance.session` carried
    // its own copy that nothing read. Two sources of truth for one number is
    // how a tuned value silently stops applying.
    const cfg = loadConfig({ NODE_ENV: 'test' });
    expect(cfg.reconnectGraceMs).toBe(BALANCE.session.reconnectWindowSeconds * 1000);
  });

  it('is long enough for a phone to have been locked', () => {
    // A locked iOS screen routinely costs more than 90 seconds. This is the
    // assertion that stops it quietly regressing to a laptop-shaped number.
    expect(BALANCE.session.reconnectWindowSeconds).toBeGreaterThanOrEqual(180);
  });
});

describe('repeated reclaims are idempotent', () => {
  it('lands the same seat, hand and score however many times the token is presented', async () => {
    const host = await client();
    const guest = await client();
    const room = await createRoom(host, { rounds: 1, turnSeconds: 25 });
    const joined = await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => guest.of('hand:update').length > 0);

    const handBefore = (guest.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id).sort();
    const scoreBefore = seatOf(host, joined.playerId)?.score ?? 0;
    const seatsBefore = roster(host).length;

    // Five reclaims back to back on a live socket. Nothing here is a
    // "consume the token" operation, so all five must be no-ops that answer
    // with the same seat.
    for (let i = 0; i < 5; i++) {
      const res = await reclaim(guest, room.code, joined.sessionToken);
      expect(res.ok, `reclaim ${i} failed: ${JSON.stringify(res.error)}`).toBe(true);
      const data = res.data as JoinedPayload;
      expect(data.playerId).toBe(joined.playerId);
      // The token is NOT rotated: a flapping phone would otherwise present a
      // token it never received and be locked out on the next attempt.
      expect(data.sessionToken).toBe(joined.sessionToken);
      expect(data.room.players.length).toBe(seatsBefore);
    }

    await waitFor(() => guest.of('hand:update').length > 1);
    const handAfter = (guest.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id).sort();
    expect(handAfter).toEqual(handBefore);
    expect(seatOf(host, joined.playerId)?.score).toBe(scoreBefore);
    expect(roster(host).length).toBe(seatsBefore);
  });

  it('never double-seats a phone that drops and returns three times in a row', async () => {
    const host = await client();
    let guest = await client();
    const room = await createRoom(host, { rounds: 1, turnSeconds: 25 });
    const joined = await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => guest.of('hand:update').length > 0);
    const handBefore = (guest.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id).sort();

    for (let i = 0; i < 3; i++) {
      guest = await relink(guest);
      const res = await reclaim(guest, room.code, joined.sessionToken);
      expect(res.ok, `cycle ${i}: ${JSON.stringify(res.error)}`).toBe(true);
      expect((res.data as JoinedPayload).playerId).toBe(joined.playerId);
      // Two seats at the table, every single time.
      expect((res.data as JoinedPayload).room.players.length).toBe(2);
    }

    await waitFor(() => guest.of('hand:update').length > 0);
    const handAfter = (guest.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id).sort();
    expect(handAfter).toEqual(handBefore);
    await waitFor(() => roster(host).length === 2);
  });

  it('tells the rest of the table the player is back, not just the player', async () => {
    const host = await client();
    let guest = await client();
    const room = await createRoom(host, { rounds: 1, turnSeconds: 25 });
    const joined = await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => guest.of('hand:update').length > 0);

    guest = await relink(guest);
    // Everyone watches the seat go grey...
    await waitFor(() => seatOf(host, joined.playerId)?.connection === 'disconnected');

    const res = await reclaim(guest, room.code, joined.sessionToken);
    expect(res.ok, JSON.stringify(res.error)).toBe(true);

    // ...so everyone has to watch it come back. Without a fan-out on the way
    // up, the returning player looks fine to themselves and stays greyed out
    // on every other device at the table.
    await waitFor(() => seatOf(host, joined.playerId)?.connection === 'connected');
  });

  it('works mid-round and pushes the whole board back down', async () => {
    const host = await client();
    let guest = await client();
    const room = await createRoom(host, { rounds: 1, turnSeconds: 25 });
    const joined = await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => guest.of('game:started').length > 0);

    guest = await relink(guest);
    expect(guest.received.length).toBe(0);

    const res = await reclaim(guest, room.code, joined.sessionToken);
    expect(res.ok, JSON.stringify(res.error)).toBe(true);

    // A resync, not a lobby: the board, the round and this player's own hand
    // all arrive without waiting for the next turn to tick.
    await waitFor(() => guest.of('board:update').length > 0 && guest.of('hand:update').length > 0);
    const hand = (guest.of('hand:update').at(-1) as HandUpdatePayload).cards;
    expect(hand.length).toBeGreaterThan(0);
  });
});

describe('a seat that lapsed past the hold', () => {
  it('is handed back — same player, same score — when the phone finally returns', async () => {
    await server.close();
    server = await startTestServer({ reconnectGraceMs: 300 }, fixedPuzzles(['p1']));
    const host = new TestClient(server.url).autoDeclineInterrupts();
    let guest = new TestClient(server.url).autoDeclineInterrupts();
    clients.push(host, guest);
    await host.connect();
    await guest.connect();

    const room = await createRoom(host, { rounds: 1, turnSeconds: 25 });
    const joined = await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => guest.of('hand:update').length > 0);
    const handBefore = (guest.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id).sort();

    guest = await relink(guest);
    // Asleep well past the hold: §7 converts the seat to a bot with the same name.
    await waitFor(() => seatOf(host, joined.playerId)?.isBot === true, 10_000);
    const scoreAsBot = seatOf(host, joined.playerId)?.score ?? 0;

    const res = await reclaim(guest, room.code, joined.sessionToken);
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    expect((res.data as JoinedPayload).playerId).toBe(joined.playerId);

    // Back to being a person, with everything that was theirs.
    await waitFor(() => seatOf(host, joined.playerId)?.isBot === false);
    const back = seatOf(host, joined.playerId);
    expect(back?.connection).toBe('connected');
    expect(back?.name).toBe('Guest');
    expect(back?.score).toBe(scoreAsBot);

    await waitFor(() => guest.of('hand:update').length > 0);
    const handAfter = (guest.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id).sort();
    expect(handAfter).toEqual(handBefore);
  });

  it('gives the host their room back rather than leaving a bot in charge', async () => {
    await server.close();
    server = await startTestServer({ reconnectGraceMs: 300 }, fixedPuzzles(['p1']));
    let host = new TestClient(server.url).autoDeclineInterrupts();
    clients.push(host);
    await host.connect();

    // The single worst version of this bug: a solo host with bots locks their
    // phone. `convertSeatToBot` reassigns the host to the first non-bot seat —
    // and on this table there is none, so the room ends up hosted by a bot and
    // can never be started, re-settinged or re-matched again.
    const room = await createRoom(host, { rounds: 2, turnSeconds: 25, botCount: 2 });
    const hostId = host.playerId;
    const token = host.token;
    await host.call('game:start', {});
    await waitFor(() => host.of('game:started').length > 0);

    host = await relink(host);
    const res = await reclaim(host, room.code, token);
    expect(res.ok, JSON.stringify(res.error)).toBe(true);

    const returned = (res.data as JoinedPayload).room;
    expect(returned.hostId).toBe(hostId);
    expect(returned.players.find((p) => p.id === hostId)?.isBot).toBe(false);

    // And host-only commands work again, which is the whole point.
    const settings = await host.call('room:settings', { settings: { sameRoomAudio: true } });
    expect(settings.ok, JSON.stringify(settings.error)).toBe(true);
  });

  it('can lapse and be reclaimed more than once', async () => {
    await server.close();
    server = await startTestServer({ reconnectGraceMs: 300 }, fixedPuzzles(['p1']));
    const host = new TestClient(server.url).autoDeclineInterrupts();
    let guest = new TestClient(server.url).autoDeclineInterrupts();
    clients.push(host, guest);
    await host.connect();
    await guest.connect();

    const room = await createRoom(host, { rounds: 1, turnSeconds: 25 });
    const joined = await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => guest.of('hand:update').length > 0);

    for (let i = 0; i < 2; i++) {
      guest = await relink(guest);
      await waitFor(() => seatOf(host, joined.playerId)?.isBot === true, 10_000);
      const res = await reclaim(guest, room.code, joined.sessionToken);
      expect(res.ok, `lapse ${i}: ${JSON.stringify(res.error)}`).toBe(true);
      expect((res.data as JoinedPayload).playerId).toBe(joined.playerId);
      await waitFor(() => seatOf(host, joined.playerId)?.isBot === false);
      expect(roster(host).length).toBe(2);
    }
  });
});

describe('a reclaim that cannot work', () => {
  it('answers a token for a room that no longer exists exactly like a bad key', async () => {
    const host = await client();
    const room = await createRoom(host);
    const missing = room.code === 'BABA' ? 'DEDE' : 'BABA';

    const phone = await client();
    const res = await phone.call('room:join', {
      code: missing,
      key: 'ZZZZ',
      name: 'Guest',
      color: '#B8FF3C',
      sessionToken: 'A'.repeat(32),
    });
    expect(res.ok).toBe(false);
    // Same answer as any other miss — a session token must not become a free
    // oracle for which room codes are live.
    expect(res.error?.code).toBe('BAD_ROOM');
  });
});
