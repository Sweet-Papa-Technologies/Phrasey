/**
 * The mock transport. Same interface, same event names, same ack envelope as
 * the socket transport — the UI cannot tell them apart, which is the point.
 */
import type { ClientToServerEvents, ServerToClientEvents } from '@phrasey/shared';
import {
  Emitter,
  transportError,
  type AckDataOf,
  type AckResult,
  type ConnectionState,
  type PayloadOf,
  type Transport,
} from './transport';
import { MockGame, type MockGameOptions } from './mockGame';

const ERROR_MESSAGES: Record<string, string> = {
  NOT_YOUR_TURN: "It isn't your turn.",
  CARD_NOT_IN_HAND: "That card isn't in your hand.",
  LETTER_ALREADY_GUESSED: 'That letter has already been played this round.',
  LETTER_REQUIRED: 'Pick a letter for that card.',
  TARGET_REQUIRED: 'Pick a player to target.',
  SOLVE_LOCKED: "You're locked out of solving this round.",
  ALREADY_ACTED: "You've already acted this turn.",
  ROUND_NOT_ACTIVE: 'The round is not running.',
  INVALID_DISCARD: 'Discard between 1 and 3 cards.',
  NO_INTERRUPT_WINDOW: 'That interrupt window has closed.',
  INTERRUPT_NOT_ALLOWED: "That card can't be played right now.",
};

export interface MockTransportOptions extends MockGameOptions {
  /** Simulated one-way latency, so the UI is exercised against real async. */
  latencyMs?: number;
}

export function createMockTransport(opts: MockTransportOptions = {}): Transport {
  const bus = new Emitter<ServerToClientEvents>();
  const stateBus = new Emitter<{ state: (s: ConnectionState, detail?: string) => void }>();
  const latency = opts.latencyMs ?? (opts.demo ? 0 : 45);

  let game: MockGame | null = null;

  const emitToBus = <E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void => {
    bus.emit(event, ...args);
  };

  function ensureGame(): MockGame {
    if (!game) game = new MockGame(emitToBus, opts);
    return game;
  }

  function ok<T>(data: T): AckResult<T> {
    return { ok: true, data };
  }

  function fail(code: string): AckResult<never> {
    return transportError(code, ERROR_MESSAGES[code] ?? code);
  }

  function delay<T>(value: T): Promise<T> {
    if (latency <= 0) return Promise.resolve(value);
    return new Promise((resolve) => setTimeout(() => resolve(value), latency));
  }

  return {
    kind: 'mock',

    async connect() {
      stateBus.emit('state', 'connecting');
      ensureGame();
      await delay(null);
      stateBus.emit('state', 'connected');
      if (opts.demo) {
        // The demo needs no lobby: it starts playing the moment it connects.
        ensureGame().startMatch();
      }
    },

    async emit<E extends keyof ClientToServerEvents>(
      event: E,
      payload: PayloadOf<E>,
    ): Promise<AckResult<AckDataOf<E>>> {
      const g = ensureGame();
      type Res = AckResult<AckDataOf<E>>;
      const done = (r: AckResult<unknown>) => delay(r as Res);

      switch (event) {
        case 'room:create':
        case 'room:join': {
          const p = payload as { name: string; color: string; settings?: Record<string, unknown> };
          g.setSelf(p.name || 'You', p.color);
          if (p.settings) g.updateSettings(p.settings as never);
          const res = ok({ sessionToken: `mock-${g.code}`, playerId: g.selfId, room: g.roomPublic() });
          setTimeout(() => g.pushRoom(), latency + 5);
          return done(res);
        }
        case 'room:settings': {
          const p = payload as { settings: Record<string, unknown> };
          g.updateSettings(p.settings as never);
          return done(ok({ ok: true }));
        }
        case 'game:start': {
          setTimeout(() => g.continueMatch(), latency);
          return done(ok({ ok: true }));
        }
        case 'turn:playCard': {
          const p = payload as { type: 'letter' | 'action'; cardId: string; letter?: string; targetPlayerId?: string };
          const err = g.playCard(g.selfId, p.cardId, p.letter, p.targetPlayerId);
          return done(err ? fail(err) : ok({ ok: true }));
        }
        case 'turn:discard': {
          const p = payload as { cardIds: string[] };
          const err = g.discard(g.selfId, p.cardIds);
          return done(err ? fail(err) : ok({ ok: true }));
        }
        case 'turn:solve': {
          const p = payload as { guess: string };
          const err = g.solve(g.selfId, p.guess);
          return done(err ? fail(err) : ok({ ok: true }));
        }
        case 'interrupt:play': {
          const p = payload as { cardId: string; windowId: string };
          const err = g.playInterrupt(g.selfId, p.cardId, p.windowId);
          return done(err ? fail(err) : ok({ ok: true }));
        }
        case 'turn:pass': {
          const err = g.passTurn?.(g.selfId);
          return done(err ? fail(err) : ok({ ok: true }));
        }
        case 'interrupt:pass': {
          const p = payload as { windowId: string };
          const err = g.declineInterrupt?.(g.selfId, p.windowId);
          return done(err ? fail(err) : ok({ ok: true }));
        }
        case 'chat:emote':
          return done(ok({ ok: true }));
        case 'room:leave':
          return done(ok({ ok: true }));
        case 'ping_':
          return done(ok({ t: Date.now() }));
        default:
          return done(fail('UNKNOWN_EVENT'));
      }
    },

    on<E extends keyof ServerToClientEvents>(event: E, cb: ServerToClientEvents[E]) {
      return bus.on(event, cb);
    },

    onState(cb) {
      return stateBus.on('state', cb);
    },

    disconnect() {
      game?.dispose();
      game = null;
      bus.clear();
      stateBus.emit('state', 'closed');
    },
  };
}
