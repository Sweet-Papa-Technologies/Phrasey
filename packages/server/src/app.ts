/**
 * Assemble the server: Fastify for HTTP, Socket.IO on the same listener, one
 * RoomManager, one tick loop.
 *
 * Exported separately from `index.ts` so the integration tests can stand up a
 * real server on an ephemeral port and drive it with a real socket.io-client.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import type { Server as IoServer } from 'socket.io';
import type { Balance } from '@phrasey/shared';
import type { ServerConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { getFirestore } from './data/firestore.js';
import { loadBalance } from './data/balance.js';
import { loadPuzzles, refreshing, type PuzzleSource } from './data/puzzles.js';
import { createRoomStore, type RoomStore } from './data/rooms.js';
import { createSessionStore, type SessionStore } from './data/sessions.js';
import { resolveBotPolicies, type BotPolicies } from './bots/policies.js';
import { Fanout } from './rooms/fanout.js';
import { RoomManager } from './rooms/manager.js';
import { attachIo } from './net/io.js';

export interface App {
  fastify: FastifyInstance;
  io: IoServer;
  manager: RoomManager;
  log: Logger;
  cfg: ServerConfig;
  puzzles: PuzzleSource;
  balance: Balance;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export interface BuildOptions {
  cfg: ServerConfig;
  log?: Logger;
  /** Test seams. Left undefined, everything is wired for real. */
  puzzles?: PuzzleSource;
  balance?: Balance;
  roomStore?: RoomStore;
  sessionStore?: SessionStore;
  botPolicies?: BotPolicies;
}

const startedAt = Date.now();

export async function buildApp(opts: BuildOptions): Promise<App> {
  const { cfg } = opts;
  const log = opts.log ?? createLogger({ level: cfg.logLevel, pretty: cfg.nodeEnv === 'development' });

  const db = opts.puzzles && opts.balance ? null : getFirestore(cfg, log);
  const balance = opts.balance ?? (await loadBalance(db, log));
  // Wrapped so a `corpus-gen seed` reaches a running server without a deploy.
  const puzzles = opts.puzzles ?? refreshing(await loadPuzzles(db, log), db, log);
  const roomStore = opts.roomStore ?? createRoomStore(db, log);
  const sessionStore = opts.sessionStore ?? createSessionStore(db, log);
  const botPolicies =
    opts.botPolicies ?? (await resolveBotPolicies(log, { balance, corpus: puzzles.all }));

  const fastify = Fastify({ logger: false, trustProxy: true });
  await fastify.register(cors, {
    origin: cfg.corsOrigins.length > 0 ? cfg.corsOrigins : true,
    credentials: false,
  });

  const health = () => ({
    status: 'ok',
    uptimeMs: Date.now() - startedAt,
    rooms: manager.size,
    puzzles: puzzles.size,
    puzzleSource: puzzles.origin,
    bots: botPolicies.origin,
    instanceId: manager.instanceId,
    version: 1,
  });

  // BOTH paths, deliberately. Cloud Run's frontend reserves the exact path
  // `/healthz` and 404s it for external callers, while the container's own
  // startup and liveness probes DO reach it. `scripts/deploy.sh` gates on
  // `/health`. Serving one but not the other breaks either the probe or the
  // deploy. Verified empirically against the live service — see infra/README.
  fastify.get('/healthz', async () => health());
  fastify.get('/health', async () => health());
  fastify.get('/', async () => ({ service: 'phrasey-server', status: 'ok' }));

  const fanout = new Fanout(
    (socketId, event, payload) => {
      // The typed overloads are enforced at the `Fanout.send` boundary; this
      // adapter is the one place they are erased to reach socket.io's own
      // (differently shaped) generics.
      (io.to(socketId).emit as (e: string, p: unknown) => void)(event, payload);
    },
    cfg.leakGuard,
    log,
  );

  const manager = new RoomManager({
    cfg,
    log,
    fanout,
    puzzles,
    roomStore,
    sessionStore,
    botPolicies,
    balance,
  });

  // Fastify owns the HTTP server; Socket.IO attaches to the same one so a
  // single Cloud Run port serves both.
  const io = attachIo(fastify.server, { cfg, log, manager });

  return {
    fastify,
    io,
    manager,
    log,
    cfg,
    puzzles,
    balance,
    async listen() {
      // 0.0.0.0 — Cloud Run probes do not come from loopback.
      const address = await fastify.listen({ port: cfg.port, host: cfg.host });
      await manager.restore();
      manager.start();
      log.info(
        { address, puzzles: puzzles.size, source: puzzles.origin, bots: botPolicies.origin },
        'phrasey server listening',
      );
      return address;
    },
    async close() {
      await manager.drain();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await fastify.close();
    },
  };
}
