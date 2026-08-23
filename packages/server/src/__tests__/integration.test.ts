/**
 * End-to-end over a real Socket.IO connection against an ephemeral server.
 *
 * §14 M2's exit criterion is "two browser tabs play a full round against each
 * other" — these are those two tabs, minus the browser.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { normalizeGuess } from '@phrasey/shared';
import type { BoardUpdatePayload, HandUpdatePayload, JoinedPayload, RoomPublic, RoundResult } from '@phrasey/shared';
import { fixedPuzzles, startTestServer, TestClient, waitFor, type TestServer } from './helpers.js';

let server: TestServer;
const clients: TestClient[] = [];

async function client(): Promise<TestClient> {
  const c = new TestClient(server.url).autoDeclineInterrupts();
  await c.connect();
  clients.push(c);
  return c;
}

beforeEach(async () => {
  server = await startTestServer({}, fixedPuzzles(['p1', 'p7']));
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.close();
  await server.close();
});

async function createRoom(c: TestClient, settings?: Record<string, unknown>): Promise<RoomPublic> {
  const res = await c.call('room:create', { name: 'Host', color: '#FF5C1A', settings });
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  const data = res.data as JoinedPayload;
  c.playerId = data.playerId;
  c.token = data.sessionToken;
  return data.room;
}

async function join(c: TestClient, code: string, name = 'Guest'): Promise<JoinedPayload> {
  const res = await c.call('room:join', { code, name, color: '#B8FF3C' });
  expect(res.ok, JSON.stringify(res.error)).toBe(true);
  const data = res.data as JoinedPayload;
  c.playerId = data.playerId;
  c.token = data.sessionToken;
  return data;
}

/** Play whatever is legal until the round ends. Mirrors the dev harness. */
async function playUntilRoundEnd(players: TestClient[], deadlineMs = 40_000): Promise<RoundResult> {
  const end = Date.now() + deadlineMs;
  const acted = new Map<string, boolean>();
  const begins = new Map<string, number>();

  while (Date.now() < end) {
    const ended = players.flatMap((p) => p.of('round:end') as RoundResult[]).at(-1);
    if (ended) return ended;

    let progressed = false;
    for (const p of players) {
      // Each client acts on ITS OWN latest view — exactly what a browser tab
      // does, and the only way to avoid acting on someone else's stale board.
      const board = (p.of('board:update') as BoardUpdatePayload[]).at(-1);
      const hand = (p.of('hand:update') as HandUpdatePayload[]).at(-1);
      if (!board || !hand) continue;
      if (board.round.currentPlayerId !== p.playerId) continue;

      const mine = (p.of('turn:begin') as { playerId: string }[]).filter((t) => t.playerId === p.playerId).length;
      if (begins.get(p.playerId) !== mine) {
        begins.set(p.playerId, mine);
        acted.set(p.playerId, false);
      }

      if (acted.get(p.playerId)) {
        // Decline the optional solve (empty guess == pass).
        const res = await p.call('turn:solve', { guess: '' });
        if (res.ok) acted.set(p.playerId, false);
        progressed = true;
        continue;
      }

      const guessed = new Set(board.board.guessedLetters);
      const letter = hand.cards.find((c) => c.kind === 'letter' && !guessed.has(c.letter));
      const plain = hand.cards.find(
        (c) =>
          c.kind === 'action' &&
          !['SWIPE', 'BLOCK', 'BUZZ_IN', 'WILD', 'VOWEL_RUSH', 'LOCKOUT'].includes(c.action),
      );
      let res;
      if (letter) res = await p.call('turn:playCard', { type: 'letter', cardId: letter.id });
      else if (plain) res = await p.call('turn:playCard', { type: 'action', cardId: plain.id });
      else if (hand.cards[0]) res = await p.call('turn:discard', { cardIds: [hand.cards[0].id] });
      else continue;
      if (res.ok) acted.set(p.playerId, true);
      progressed = true;
    }
    if (!progressed) await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('round did not end in time');
}

describe('create → join → start → play → reveal → solve', () => {
  it('plays a full round between two clients', async () => {
    const host = await client();
    const guest = await client();
    const room = await createRoom(host, { matchMode: 'rounds', rounds: 1, turnSeconds: 25 });
    expect(room.code).toMatch(/^[BDFGHJKLMNPRSTVZ][AEIOU][BDFGHJKLMNPRSTVZ][AEIOU]$/);

    await join(guest, room.code);
    await waitFor(() => (host.of('room:state').at(-1) as RoomPublic | undefined)?.players.length === 2);

    const started = await host.call('game:start', {});
    expect(started.ok, JSON.stringify(started.error)).toBe(true);

    await waitFor(() => host.of('game:started').length > 0 && guest.of('game:started').length > 0);
    // Both tabs see the same masked board, and it is masked.
    const opening = host.of('game:started')[0] as { board: { hiddenLetters: number; totalLetters: number } };
    expect(opening.board.hiddenLetters).toBe(opening.board.totalLetters);

    const result = await playUntilRoundEnd([host, guest]);
    expect(['solved', 'blowout', 'deck-exhausted']).toContain(result.reason);
    expect(result.answer.length).toBeGreaterThan(0);

    // Reveals happened along the way.
    const reveals = (host.of('board:update') as BoardUpdatePayload[]).flatMap((b) =>
      b.events.filter((e) => e.t === 'reveal'),
    );
    expect(reveals.length).toBeGreaterThan(0);

    // Adversarial: nothing before the round ended contained the answer.
    const answer = normalizeGuess(result.answer);
    for (const c of [host, guest]) {
      for (const rec of c.received) {
        if (rec.event === 'round:end' || rec.event === 'match:end') break;
        const payload = rec.payload as BoardUpdatePayload;
        if (rec.event === 'board:update' && payload.events.some((e) => e.t === 'round:end')) break;
        if (rec.event === 'board:update' && payload.board.hiddenLetters === 0) continue;
        expect(normalizeGuess(JSON.stringify(rec.payload)).includes(answer)).toBe(false);
      }
    }

    // A session summary was written, and it carries no display names.
    await waitFor(() => server.sessions.written.length > 0);
    expect(JSON.stringify(server.sessions.written)).not.toContain('Host');
    expect(JSON.stringify(server.sessions.written)).not.toContain('Guest');
  });

  it('never sends another player their hand', async () => {
    const host = await client();
    const guest = await client();
    const room = await createRoom(host, { rounds: 1, turnSeconds: 25 });
    await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => host.of('hand:update').length > 0 && guest.of('hand:update').length > 0);

    const hostHand = (host.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id);
    const guestHand = (guest.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id);
    expect(hostHand.length).toBe(7);
    expect(hostHand.some((id) => guestHand.includes(id))).toBe(false);

    // The guest never saw a card id belonging to the host.
    const guestBlob = JSON.stringify(guest.received.filter((r) => r.event !== 'hand:update'));
    for (const id of hostHand) expect(guestBlob.includes(id)).toBe(false);
  });
});

describe('§7 session flow', () => {
  it('reconnect reclaims the held seat with the same playerId, hand and score', async () => {
    const host = await client();
    const guest = await client();
    const room = await createRoom(host, { rounds: 1, turnSeconds: 25 });
    const joined = await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => guest.of('hand:update').length > 0);
    const handBefore = (guest.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id).sort();

    guest.close();
    clients.splice(clients.indexOf(guest), 1);
    await waitFor(() => {
      const players = (host.of('room:state').at(-1) as RoomPublic | undefined)?.players ?? [];
      return players.some((p) => p.id === joined.playerId && p.connection === 'disconnected');
    });

    const back = new TestClient(server.url).autoDeclineInterrupts();
    await back.connect();
    clients.push(back);
    const res = await back.call('room:join', {
      code: room.code,
      name: 'Guest',
      color: '#B8FF3C',
      sessionToken: joined.sessionToken,
    });
    expect(res.ok, JSON.stringify(res.error)).toBe(true);
    expect((res.data as JoinedPayload).playerId).toBe(joined.playerId);

    await waitFor(() => back.of('hand:update').length > 0);
    const handAfter = (back.of('hand:update').at(-1) as HandUpdatePayload).cards.map((c) => c.id).sort();
    expect(handAfter).toEqual(handBefore);
  });

  it('a bad session token does not reclaim a seat', async () => {
    const host = await client();
    const guest = await client();
    const room = await createRoom(host);
    const joined = await join(guest, room.code);

    const attacker = await client();
    const res = await attacker.call('room:join', {
      code: room.code,
      name: 'Mallory',
      color: '#B8FF3C',
      sessionToken: 'A'.repeat(32),
    });
    // Falls through to a NEW seat rather than stealing the existing one.
    expect(res.ok).toBe(true);
    expect((res.data as JoinedPayload).playerId).not.toBe(joined.playerId);
  });

  it('a late joiner waits for the next round instead of landing mid-round', async () => {
    const host = await client();
    const guest = await client();
    const room = await createRoom(host, { matchMode: 'rounds', rounds: 2, turnSeconds: 25 });
    await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => host.of('game:started').length > 0);

    const late = await client();
    const lateJoin = await join(late, room.code, 'Late');
    await waitFor(() => (host.of('room:state').at(-1) as RoomPublic).players.length === 3);

    // Seated, but not dealt in: no hand, and never the current player.
    const hands = late.of('hand:update') as HandUpdatePayload[];
    expect(hands.every((h) => h.cards.length === 0)).toBe(true);
    const boards = late.of('board:update') as BoardUpdatePayload[];
    expect(boards.every((b) => b.round.currentPlayerId !== lateJoin.playerId)).toBe(true);

    // ...and the engine rejects them if they try anyway.
    const cheat = await late.call('turn:discard', { cardIds: ['nope'] });
    expect(cheat.ok).toBe(false);

    // Next round deals them in.
    await playUntilRoundEnd([host, guest]);
    await waitFor(() => (late.of('hand:update') as HandUpdatePayload[]).some((h) => h.cards.length > 0), 20_000);
  });

  it('converts a held seat to a bot once the reconnect window lapses', async () => {
    await server.close();
    server = await startTestServer({ reconnectGraceMs: 400 }, fixedPuzzles(['p1']));
    const host = new TestClient(server.url).autoDeclineInterrupts();
    const guest = new TestClient(server.url).autoDeclineInterrupts();
    clients.push(host, guest);
    await host.connect();
    await guest.connect();
    const room = await createRoom(host, { rounds: 1, turnSeconds: 25 });
    const joined = await join(guest, room.code);
    await host.call('game:start', {});
    await waitFor(() => host.of('game:started').length > 0);

    guest.close();
    clients.splice(clients.indexOf(guest), 1);

    await waitFor(() => {
      const players = (host.of('room:state').at(-1) as RoomPublic | undefined)?.players ?? [];
      const seat = players.find((p) => p.id === joined.playerId);
      return seat?.isBot === true && seat.wasHuman === true;
    }, 12_000);

    // §7: same name, plus a `wasHuman` flag for the client's "(bot)" tag.
    const seat = (host.of('room:state').at(-1) as RoomPublic).players.find((p) => p.id === joined.playerId)!;
    expect(seat.name).toBe('Guest');
    expect(seat.wasHuman).toBe(true);
  });
});

describe('input validation and rate limiting', () => {
  it('rejects malformed payloads on every event', async () => {
    const c = await client();
    const room = await createRoom(c);

    const bad: [string, unknown][] = [
      ['room:join', { code: 'zzzz', name: 'x', color: '#FF5C1A' }],
      ['room:join', { code: room.code, name: '', color: '#FF5C1A' }],
      ['room:join', { code: room.code, name: 'x'.repeat(500), color: '#FF5C1A' }],
      ['turn:playCard', { type: 'letter' }],
      ['turn:playCard', { type: 'letter', cardId: '../../etc/passwd' }],
      ['turn:discard', { cardIds: [] }],
      ['turn:discard', { cardIds: Array.from({ length: 50 }, (_, i) => `c${i}`) }],
      ['turn:solve', { guess: 'x'.repeat(5000) }],
      ['interrupt:play', { cardId: 'c1' }],
      ['chat:emote', { emote: '<script>alert(1)</script>' }],
      ['room:settings', { settings: { turnSeconds: 9999 } }],
    ];
    for (const [event, payload] of bad) {
      const res = await c.call(event, payload);
      expect(res.ok, `${event} accepted a bad payload`).toBe(false);
    }
  });

  it('rate-limits a client that floods one event', async () => {
    const c = await client();
    await createRoom(c);
    let limited = 0;
    for (let i = 0; i < 60; i++) {
      const res = await c.call('chat:emote', { emote: '👏' });
      if (!res.ok && res.error?.code === 'RATE_LIMITED') limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });

  it('will not let a socket act as a seat it does not hold', async () => {
    const host = await client();
    const stranger = await client();
    await createRoom(host);
    const res = await stranger.call('turn:playCard', { type: 'letter', cardId: 'anything' });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('NOT_IN_ROOM');
  });

  it('only the host can start or change settings', async () => {
    const host = await client();
    const guest = await client();
    const room = await createRoom(host);
    await join(guest, room.code);
    expect((await guest.call('game:start', {})).error?.code).toBe('NOT_HOST');
    expect((await guest.call('room:settings', { settings: { rounds: 3 } })).error?.code).toBe('NOT_HOST');
  });
});

describe('health endpoints', () => {
  it('serves both /health and /healthz with 200 JSON', async () => {
    for (const path of ['/health', '/healthz']) {
      const res = await fetch(`${server.url}${path}`);
      expect(res.status, path).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    }
  });
});
