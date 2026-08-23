/**
 * Room-level tests with a fake clock. Everything time-driven in this server —
 * the turn timer, the 4-second interrupt window, bot think-delays, the 90s
 * reconnect hold — is "is `now` past a deadline", so all of it is testable by
 * calling `tick(now)` with numbers instead of waiting.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionCard, Card, GameEvent, LetterCard, ServerToClientEvents } from '@phrasey/shared';
import { defaultBalance } from '@phrasey/shared';
import { letterStats } from '@phrasey/shared';
import { createMatch, createRng, type PlayerPolicy } from '@phrasey/engine';
import { loadConfig, type ServerConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { Fanout } from '../rooms/fanout.js';
import { Room, type RoomDeps } from '../rooms/room.js';
import { fixedPuzzles, memoryRoomStore, memorySessionStore } from './helpers.js';
import { thinkDelayMs } from '../bots/driver.js';

const log = createLogger({ level: 'silent', pretty: false });

interface Sent {
  socketId: string;
  event: keyof ServerToClientEvents;
  payload: any;
}

function harness(over: Partial<ServerConfig> = {}) {
  const sent: Sent[] = [];
  const cfg: ServerConfig = {
    ...loadConfig({ NODE_ENV: 'test', FIRESTORE_ENABLED: '0' }),
    leakGuard: true,
    debugInvariants: true,
    intermissionMs: 1000,
    ...over,
  };
  const rooms = memoryRoomStore();
  const sessions = memorySessionStore();
  const fanout = new Fanout((socketId, event, payload) => sent.push({ socketId, event, payload }), cfg.leakGuard, log);
  const deps: RoomDeps = {
    cfg,
    log,
    fanout,
    puzzles: fixedPuzzles(['p1', 'p7']),
    roomStore: rooms,
    sessionStore: sessions,
    botPolicies: { for: () => passthroughPolicy, origin: 'test' },
    instanceId: 'test-instance',
  };
  return { sent, cfg, deps, rooms, sessions };
}

/** A stand-in for M4's policy: always discards, so it is trivially legal. */
const passthroughPolicy: PlayerPolicy = {
  chooseTurnAction(view) {
    if (view.phase === 'awaiting-solve') return { type: 'pass', playerId: view.playerId };
    const first = view.hand[0];
    return first
      ? { type: 'discard', playerId: view.playerId, cardIds: [first.id] }
      : { type: 'timeout', playerId: view.playerId };
  },
  chooseInterrupt: () => null,
};

function makeRoom(over: Partial<ServerConfig> = {}, seats = 2) {
  const h = harness(over);
  const state = createMatch({
    seed: 12345,
    players: [],
    settings: { rounds: 1, matchMode: 'rounds', turnSeconds: 15, botCount: 0 },
    nowMs: 0,
  });
  const room = new Room('KABO', state, h.deps, 0);
  const ids: string[] = [];
  for (let i = 0; i < seats; i++) {
    const id = room.addHuman(`P${i}`, '#FF5C1A', `token-${i}`, 0);
    room.attachSocket(id, `sock-${i}`, 0);
    ids.push(id);
  }
  return { ...h, room, ids };
}

function eventsIn(sent: Sent[]): GameEvent[] {
  return sent.filter((s) => s.event === 'board:update').flatMap((s) => s.payload.events as GameEvent[]);
}

describe('turn timers', () => {
  it('drives the engine timeout on expiry, which auto-plays the best held letter', () => {
    const { room, sent, ids } = makeRoom();
    room.start(ids[0]!, undefined, 0);
    const first = room.state.round!.currentPlayerId!;
    const endsAt = room.state.round!.turnEndsAt!;
    expect(endsAt).toBe(15_000);

    sent.length = 0;
    room.tick(endsAt - 1);
    // Not yet: the engine must not be handed a timeout early.
    expect(eventsIn(sent).some((e) => e.t === 'card:played' || e.t === 'discard')).toBe(false);

    room.tick(endsAt + 1);
    const evts = eventsIn(sent);
    expect(evts.some((e) => e.t === 'notice' && /timed out/.test(e.message))).toBe(true);
    expect(evts.some((e) => e.t === 'card:played' || e.t === 'discard')).toBe(true);
    // The auto-play satisfies the primary action; §3.3 still offers the solve,
    // so the seat only advances once the clock is checked again.
    expect(room.state.round!.turnActed || room.state.round!.currentPlayerId !== first).toBe(true);
    room.tick(endsAt + 2);
    expect(room.state.round!.currentPlayerId).not.toBe(first);
  });

  it('auto-passes rather than auto-solving when the clock runs out mid awaiting-solve', () => {
    const { room, ids, sent } = makeRoom();
    room.start(ids[0]!, undefined, 0);
    const round = room.state.round!;
    const me = round.currentPlayerId!;
    const card = room.state.players.find((p) => p.id === me)!.hand.find((c) => c.kind === 'letter') as LetterCard;
    room.playCard(me, { type: 'letter', cardId: card.id }, 1000);
    // The engine offers the optional solve, and does NOT restart the clock.
    if (room.state.round!.phase === 'awaiting-solve') {
      expect(room.state.round!.turnEndsAt).toBe(15_000);
      sent.length = 0;
      room.tick(15_001);
      expect(eventsIn(sent).some((e) => e.t === 'solve:attempt')).toBe(false);
      expect(room.state.round!.currentPlayerId).not.toBe(me);
    }
  });

  it('emits turn:timer on its own cadence', () => {
    const { room, sent, ids, cfg } = makeRoom({ timerEmitMs: 1000 });
    room.start(ids[0]!, undefined, 0);
    sent.length = 0;
    room.tick(1200);
    room.tick(1300);
    room.tick(2400);
    const timers = sent.filter((s) => s.event === 'turn:timer');
    expect(timers.length).toBe(4); // 2 emissions x 2 sockets
    expect(timers[0]!.payload.remainingMs).toBeLessThanOrEqual(15_000 - cfg.timerEmitMs);
  });

  it('never sets a deadline when the host turns the timer off', () => {
    const { room, ids } = makeRoom();
    room.setSettings(ids[0]!, { turnSeconds: null });
    room.start(ids[0]!, undefined, 0);
    expect(room.state.round!.turnEndsAt).toBeNull();
    room.tick(10_000_000);
    expect(room.state.round!.endedReason).toBeNull();
  });

  it('rejects a turn length the balance does not offer', () => {
    const { room, ids } = makeRoom();
    expect(() => room.setSettings(ids[0]!, { turnSeconds: 3 as 10 })).toThrow(/not offered/);
  });
});

describe('interrupt windows', () => {
  /** Force a SWIPE into the non-current player's hand and land a hit. */
  function riggedHit(room: Room, ids: string[]) {
    room.start(ids[0]!, undefined, 0);
    const round = room.state.round!;
    const answer = round.answer;
    const stats = letterStats(answer);
    const present = Object.keys(stats).find((l) => !round.revealed.includes(l))!;
    const current = round.currentPlayerId!;
    const other = ids.find((id) => id !== current)!;
    const hit: LetterCard = { id: 'rigged-hit', kind: 'letter', letter: present };
    const swipe: ActionCard = { id: 'rigged-swipe', kind: 'action', action: 'SWIPE' };
    // REPLACE rather than add: the engine's card-conservation invariant counts
    // every card in the round, so injecting extras would trip it.
    room.state.players.find((p) => p.id === current)!.hand[0] = hit;
    room.state.players.find((p) => p.id === other)!.hand[0] = swipe;
    return { current, other, hit };
  }

  it('opens a 4s window only for the player holding the card, and closes it on expiry', () => {
    const { room, sent, ids, cfg } = makeRoom();
    void cfg;
    const { current, other, hit } = riggedHit(room, ids);
    sent.length = 0;
    room.playCard(current, { type: 'letter', cardId: hit.id }, 1000);

    const window = room.state.round!.window;
    expect(window, 'a hit with a SWIPE at the table must open a window').not.toBeNull();
    expect(window!.kind).toBe('hit');
    expect(window!.expiresAt).toBe(1000 + defaultBalance().interrupt.windowMs);

    // interrupt:window is PRIVATE to the eligible player — it names their cards.
    const offers = sent.filter((s) => s.event === 'interrupt:window');
    expect(offers).toHaveLength(1);
    const otherSocket = `sock-${ids.indexOf(other)}`;
    expect(offers[0]!.socketId).toBe(otherSocket);
    expect(offers[0]!.payload.playableCardIds).toEqual(['rigged-swipe']);

    sent.length = 0;
    room.tick(window!.expiresAt - 1);
    expect(sent.some((s) => s.event === 'interrupt:closed')).toBe(false);

    room.tick(window!.expiresAt + 1);
    expect(sent.filter((s) => s.event === 'interrupt:closed')).toHaveLength(2); // both sockets
    expect(room.state.round!.window).toBeNull();
  });

  it('closes early when the eligible player declines', () => {
    const { room, sent, ids } = makeRoom();
    const { current, other, hit } = riggedHit(room, ids);
    room.playCard(current, { type: 'letter', cardId: hit.id }, 1000);
    const windowId = room.state.round!.window!.id;

    sent.length = 0;
    // Empty cardId == pass (the missing `interrupt:pass` in the protocol).
    room.declineInterrupt(other, windowId, 1100);
    expect(room.state.round!.window).toBeNull();
    expect(sent.some((s) => s.event === 'interrupt:closed')).toBe(true);
  });

  it('applies the SWIPE when the eligible player uses it', () => {
    const { room, ids } = makeRoom();
    const { current, other, hit } = riggedHit(room, ids);
    room.playCard(current, { type: 'letter', cardId: hit.id }, 1000);
    const windowId = room.state.round!.window!.id;
    const scoreBefore = room.state.players.find((p) => p.id === other)!.score;

    room.interrupt(other, { cardId: 'rigged-swipe', windowId }, 1100);
    room.tick(1200);
    expect(room.state.players.find((p) => p.id === other)!.score).toBeGreaterThan(scoreBefore);
  });
});

describe('bot driver', () => {
  it('waits the tier think delay before acting, then acts', () => {
    const { room, ids } = makeRoom();
    room.setSettings(ids[0]!, { botCount: 1, botTier: 'chill' });
    room.start(ids[0]!, undefined, 0);

    // Walk the table until it is a bot's turn.
    let now = 0;
    let guard = 0;
    while (guard++ < 40) {
      const cur = room.state.round!.currentPlayerId!;
      const player = room.state.players.find((p) => p.id === cur)!;
      if (player.isBot) break;
      const first = player.hand[0] as Card;
      room.discard(cur, [first.id], now);
      if (room.state.round!.phase === 'awaiting-solve') room.pass(cur, now);
      now += 10;
    }
    const bot = room.state.players.find((p) => p.id === room.state.round!.currentPlayerId)!;
    expect(bot.isBot).toBe(true);

    const tier = defaultBalance().bots.tiers.chill;
    // First tick only arms the timer. Nothing happens before thinkMsMin.
    room.tick(now);
    room.tick(now + tier.thinkMsMin - 50);
    expect(room.state.round!.currentPlayerId).toBe(bot.id);

    room.tick(now + tier.thinkMsMax + 10);
    // It has moved: either the seat advanced or the bot is in awaiting-solve.
    const stillWaiting =
      room.state.round!.currentPlayerId === bot.id && room.state.round!.phase === 'turn' && !room.state.round!.turnActed;
    expect(stillWaiting).toBe(false);
  });

  it('falls back to the engine timeout when a policy proposes an illegal move', () => {
    const h = harness();
    const broken: PlayerPolicy = {
      chooseTurnAction: (view) => ({ type: 'playCard', playerId: view.playerId, intent: { type: 'letter', cardId: 'nope' } }),
      chooseInterrupt: () => null,
    };
    h.deps.botPolicies = { for: () => broken, origin: 'broken' };
    const state = createMatch({
      seed: 99,
      players: [],
      settings: { rounds: 1, turnSeconds: 15, botCount: 1 },
      nowMs: 0,
    });
    const room = new Room('KABO', state, h.deps, 0);
    const a = room.addHuman('A', '#FF5C1A', 't-a', 0);
    room.attachSocket(a, 'sock-a', 0);
    room.setSettings(a, { botCount: 1 });
    room.start(a, undefined, 0);

    let now = 0;
    let guard = 0;
    while (guard++ < 40 && !room.state.players.find((p) => p.id === room.state.round!.currentPlayerId)!.isBot) {
      const cur = room.state.round!.currentPlayerId!;
      const first = room.state.players.find((p) => p.id === cur)!.hand[0] as Card;
      room.discard(cur, [first.id], now);
      if (room.state.round!.phase === 'awaiting-solve') room.pass(cur, now);
      now += 10;
    }
    const botId = room.state.round!.currentPlayerId!;
    room.tick(now);
    room.tick(now + 60_000);
    // The table moved despite the broken policy.
    expect(room.state.round!.currentPlayerId === botId && room.state.round!.phase === 'turn').toBe(false);
  });

  it('draws the think delay from the tier config and honours the window cap', () => {
    const balance = defaultBalance();
    const rng = createRng(1);
    for (const tier of ['chill', 'sharp', 'ruthless'] as const) {
      const cfg = balance.bots.tiers[tier];
      for (let i = 0; i < 50; i++) {
        const ms = thinkDelayMs(balance, tier, rng);
        expect(ms).toBeGreaterThanOrEqual(cfg.thinkMsMin);
        expect(ms).toBeLessThanOrEqual(cfg.thinkMsMax);
      }
      // An interrupt window is only 4s wide; a 4s think delay would never fire.
      expect(thinkDelayMs(balance, tier, rng, { cap: 500 })).toBeLessThanOrEqual(500);
      expect(thinkDelayMs(balance, tier, rng, { solveBeat: true })).toBeLessThan(cfg.thinkMsMax);
    }
  });
});

describe('rounds and matches', () => {
  it('deals the next round after the intermission, and ends the match', () => {
    const { room, ids, sessions } = makeRoom({ intermissionMs: 500 });
    room.setSettings(ids[0]!, { rounds: 2 });
    room.start(ids[0]!, undefined, 0);
    expect(room.state.roundNumber).toBe(1);

    // Force the round to end.
    const cur = room.state.round!.currentPlayerId!;
    const card = room.state.players.find((p) => p.id === cur)!.hand[0] as Card;
    room.discard(cur, [card.id], 0);
    if (room.state.round!.phase === 'awaiting-solve') {
      room.solve(cur, room.state.round!.answer, 10);
    }
    expect(room.state.status).toBe('round-end');

    room.tick(400);
    expect(room.state.roundNumber).toBe(1); // intermission not over
    room.tick(600);
    expect(room.state.roundNumber).toBe(2);
    expect(room.puzzleIds).toHaveLength(2);
    expect(new Set(room.puzzleIds).size).toBe(2); // no repeat within a match

    const cur2 = room.state.round!.currentPlayerId!;
    const c2 = room.state.players.find((p) => p.id === cur2)!.hand[0] as Card;
    room.discard(cur2, [c2.id], 700);
    if (room.state.round!.phase === 'awaiting-solve') room.solve(cur2, room.state.round!.answer, 710);
    expect(room.state.status).toBe('match-end');
    expect(sessions.written).toHaveLength(1);
  });
});

describe('persistence', () => {
  it('snapshots every balance.session.snapshotEveryNEvents events', async () => {
    const { room, ids, rooms } = makeRoom();
    const doc = () => rooms.docs.get('KABO') as Record<string, unknown> | undefined;
    room.start(ids[0]!, undefined, 0);
    await vi.waitFor(() => expect(doc()?.snapshot).toBeTruthy());
    const seq = doc()!.snapshotSeq as number;

    for (let i = 0; i < 6; i++) {
      const cur = room.state.round!.currentPlayerId!;
      const card = room.state.players.find((p) => p.id === cur)!.hand[0] as Card;
      room.discard(cur, [card.id], i * 100);
      if (room.state.round!.phase === 'awaiting-solve') room.pass(cur, i * 100 + 10);
      if (room.state.round!.endedReason !== null) break;
    }
    await vi.waitFor(() => expect(doc()!.snapshotSeq as number).toBeGreaterThan(seq));
    // The room doc carries exactly the §6.4 shape plus the snapshot.
    const d = doc()!;
    expect(d.instanceId).toBe('test-instance');
    expect(typeof d.hostId).toBe('string');
    expect(d.status).toBeTruthy();
    expect(typeof (d.ttl as { toMillis(): number }).toMillis).toBe('function');
  });
});

describe('leak guard resilience', () => {
  it('does not choke on a puzzle with an empty hint', () => {
    const h = harness();
    h.deps.puzzles = {
      size: 1,
      origin: 'fixtures',
      all: [],
      byId: () => undefined,
      pick: () => ({
        id: 'no-hint',
        text: 'A WATCHED POT NEVER BOILS',
        category: 'Idiom / proverb',
        // An empty hint used to make `includes()` true for every string, which
        // dropped every board update the guard inspected.
        hint: '',
        difficulty: 1,
        letterStats: letterStats('A WATCHED POT NEVER BOILS'),
        active: true,
      }),
    };
    const state = createMatch({
      seed: 5,
      players: [],
      settings: { rounds: 1, turnSeconds: 15, botCount: 0 },
      nowMs: 0,
    });
    const room = new Room('KABO', state, h.deps, 0);
    const a = room.addHuman('A', '#FF5C1A', 't-a', 0);
    const b = room.addHuman('B', '#B8FF3C', 't-b', 0);
    room.attachSocket(a, 'sock-a', 0);
    room.attachSocket(b, 'sock-b', 0);
    h.sent.length = 0;
    room.start(a, undefined, 0);
    expect(h.sent.filter((s) => s.event === 'board:update').length).toBeGreaterThan(0);
    expect(h.sent.filter((s) => s.event === 'hand:update').length).toBe(2);
  });
});
