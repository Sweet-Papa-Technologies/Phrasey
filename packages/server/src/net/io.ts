/**
 * The socket surface. Exactly the events in `@phrasey/shared/protocol` — no
 * more, no fewer.
 *
 * Every handler follows the same four steps, in this order:
 *   1. rate limit          (one client cannot spin the engine)
 *   2. zod parse           (all client input is hostile)
 *   3. resolve the seat    (you may only act as yourself)
 *   4. hand to the Room    (which is the only thing that touches the engine)
 *
 * Errors are mapped through `toSocketError` so an engine message never leaks
 * internals, and every client→server call gets exactly one ack (protocol.ts).
 */
import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import type {
  Ack,
  ClientToServerEvents,
  ServerToClientEvents,
  SocketError,
} from '@phrasey/shared';
import { SOCKET_PATH } from '@phrasey/shared';
import { z, type ZodTypeAny } from 'zod';
import type { ServerConfig } from '../config.js';
import type { Logger } from '../logger.js';
import { AppError, toSocketError } from '../errors.js';
import type { RoomManager } from '../rooms/manager.js';
import type { Room } from '../rooms/room.js';
import { RateLimiter } from './rateLimit.js';
import {
  interruptPassSchema,
  createRoomSchema,
  discardSchema,
  emoteSchema,
  interruptSchema,
  joinRoomSchema,
  playCardSchema,
  settingsEventSchema,
  solveSchema,
  startGameSchema,
} from './schemas.js';

type PhraseySocket = Socket<ClientToServerEvents, ServerToClientEvents>;

/** The no-payload events: a client may legally send `{}` or nothing at all. */
const emptySchema = z.object({}).passthrough().default({});

/** 32 bytes of entropy. The only credential in the system (§7). */
export function newSessionToken(): string {
  return randomBytes(24).toString('base64url');
}

export interface IoDeps {
  cfg: ServerConfig;
  log: Logger;
  manager: RoomManager;
}

export function attachIo(http: HttpServer, deps: IoDeps): Server<ClientToServerEvents, ServerToClientEvents> {
  const { cfg, log, manager } = deps;
  const limiter = new RateLimiter();

  const io = new Server<ClientToServerEvents, ServerToClientEvents>(http, {
    path: SOCKET_PATH,
    cors: { origin: cfg.corsOrigins.length > 0 ? cfg.corsOrigins : true, credentials: false },
    // A legitimate payload is a few hundred bytes. 16 KiB is generous.
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 20_000,
    pingTimeout: 25_000,
    connectionStateRecovery: { maxDisconnectionDuration: 0 },
  });

  const ok = <T>(ack: Ack<T> | undefined, data: T): void => ack?.({ ok: true, data });
  const fail = (ack: Ack<never> | undefined, error: SocketError): void => ack?.({ ok: false, error });

  /**
   * One wrapper for every handler: rate limit, validate, run, ack. A handler
   * that throws produces a clean error ack instead of a dead socket.
   */
  function handle<S extends ZodTypeAny, Out>(
    socket: PhraseySocket,
    event: keyof ClientToServerEvents,
    schema: S,
    raw: unknown,
    ack: Ack<Out> | undefined,
    run: (input: z.output<S>) => Out,
  ): void {
    if (!limiter.allow(socket.id, event)) {
      fail(ack as Ack<never>, { code: 'RATE_LIMITED', message: 'Slow down.' });
      return;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      fail(ack as Ack<never>, { code: 'BAD_REQUEST', message: 'That request was not valid.' });
      return;
    }
    try {
      ok(ack, run(parsed.data));
    } catch (err) {
      const e = toSocketError(err);
      if (e.code === 'INTERNAL') log.error({ err: String(err), event }, 'handler threw');
      fail(ack as Ack<never>, e);
    }
  }

  /** Resolve the room and seat this socket is acting as. Never trusts a client id. */
  function seatOf(socket: PhraseySocket): { room: Room; playerId: string } {
    const room = manager.roomForSocket(socket.id);
    if (!room) throw new AppError('NOT_IN_ROOM', 'You are not in a room.');
    const playerId = room.playerIdForSocket(socket.id);
    if (!playerId) throw new AppError('NO_SEAT', 'You do not hold a seat.');
    return { room, playerId };
  }

  io.on('connection', (socket: PhraseySocket) => {
    log.debug({ socketId: socket.id }, 'socket connected');

    socket.on('room:create', (p, ack) =>
      handle(socket, 'room:create', createRoomSchema, p, ack, (input) => {
        if (manager.roomForSocket(socket.id)) throw new AppError('ALREADY_IN_ROOM', 'Leave your room first.');
        const token = newSessionToken();
        const { room, playerId } = manager.create(
          { name: input.name, color: input.color, token },
          input.settings,
        );
        manager.bindSocket(socket.id, room.code);
        room.attachSocket(playerId, socket.id, Date.now());
        room.resync(playerId, Date.now());
        return { sessionToken: token, playerId, room: room.roomPublic() };
      }),
    );

    socket.on('room:join', (p, ack) =>
      handle(socket, 'room:join', joinRoomSchema, p, ack, (input) => {
        const room = manager.require(input.code);
        const now = Date.now();

        // §7 reconnect: the token reclaims the held seat, hand and score intact.
        if (input.sessionToken) {
          const reclaimed = room.reclaim(input.sessionToken, socket.id, now);
          if (reclaimed) {
            manager.bindSocket(socket.id, room.code);
            room.resync(reclaimed, now);
            log.info({ code: room.code, playerId: reclaimed }, 'seat reclaimed');
            return { sessionToken: input.sessionToken, playerId: reclaimed, room: room.roomPublic() };
          }
        }

        if (manager.roomForSocket(socket.id)) throw new AppError('ALREADY_IN_ROOM', 'Leave your room first.');
        if (room.status === 'match-end') throw new AppError('MATCH_OVER', 'That match has finished.');

        // §7: "Late joiners land in the next round, not mid-round." The engine
        // seats them outside `round.order`, so they sit out until the next deal.
        const token = newSessionToken();
        const playerId = room.addHuman(input.name, input.color, token, now);
        manager.bindSocket(socket.id, room.code);
        room.attachSocket(playerId, socket.id, now);
        room.resync(playerId, now);
        return { sessionToken: token, playerId, room: room.roomPublic() };
      }),
    );

    socket.on('room:leave', (p, ack) =>
      handle(socket, 'room:leave', emptySchema, p, ack, () => {
        const { room, playerId } = seatOf(socket);
        room.leave(playerId, Date.now());
        manager.releaseSocket(socket.id);
        return { ok: true as const };
      }),
    );

    socket.on('room:settings', (p, ack) =>
      handle(socket, 'room:settings', settingsEventSchema, p, ack, (input) => {
        const { room, playerId } = seatOf(socket);
        room.setSettings(playerId, input.settings);
        return { ok: true as const };
      }),
    );

    socket.on('game:start', (p, ack) =>
      handle(socket, 'game:start', startGameSchema, p ?? {}, ack, (input) => {
        const { room, playerId } = seatOf(socket);
        room.start(playerId, input?.settings, Date.now());
        return { ok: true as const };
      }),
    );

    socket.on('turn:playCard', (p, ack) =>
      handle(socket, 'turn:playCard', playCardSchema, p, ack, (input) => {
        const { room, playerId } = seatOf(socket);
        room.playCard(playerId, input, Date.now());
        return { ok: true as const };
      }),
    );

    socket.on('turn:discard', (p, ack) =>
      handle(socket, 'turn:discard', discardSchema, p, ack, (input) => {
        const { room, playerId } = seatOf(socket);
        room.discard(playerId, input.cardIds, Date.now());
        return { ok: true as const };
      }),
    );

    socket.on('turn:solve', (p, ack) =>
      handle(socket, 'turn:solve', solveSchema, p, ack, (input) => {
        const { room, playerId } = seatOf(socket);
        room.solve(playerId, input.guess, Date.now());
        return { ok: true as const };
      }),
    );

    socket.on('turn:pass', (p, ack) =>
      handle(socket, 'turn:pass', emptySchema, p, ack, () => {
        const { room, playerId } = seatOf(socket);
        room.pass(playerId, Date.now());
        return { ok: true as const };
      }),
    );

    socket.on('interrupt:play', (p, ack) =>
      handle(socket, 'interrupt:play', interruptSchema, p, ack, (input) => {
        const { room, playerId } = seatOf(socket);
        room.interrupt(playerId, input, Date.now());
        return { ok: true as const };
      }),
    );

    socket.on('interrupt:pass', (p, ack) =>
      handle(socket, 'interrupt:pass', interruptPassSchema, p, ack, (input) => {
        const { room, playerId } = seatOf(socket);
        room.declineInterrupt(playerId, input.windowId, Date.now());
        return { ok: true as const };
      }),
    );

    socket.on('chat:emote', (p, ack) =>
      handle(socket, 'chat:emote', emoteSchema, p, ack, (input) => {
        const { room, playerId } = seatOf(socket);
        room.emote(playerId, input.emote);
        return { ok: true as const };
      }),
    );

    socket.on('ping_', (p, ack) =>
      handle(socket, 'ping_', emptySchema, p ?? {}, ack, () => ({ t: Date.now() })),
    );

    socket.on('disconnect', (reason) => {
      log.debug({ socketId: socket.id, reason }, 'socket disconnected');
      // §7: the seat is HELD for 90 seconds, not vacated.
      manager.releaseSocket(socket.id);
      limiter.forget(socket.id);
    });
  });

  return io;
}
