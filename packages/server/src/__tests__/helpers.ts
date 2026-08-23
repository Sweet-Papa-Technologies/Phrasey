/** Shared scaffolding for the server test suites. */
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket } from 'socket.io-client';
import type { Puzzle } from '@phrasey/shared';
import { SOCKET_PATH } from '@phrasey/shared';
import { TEST_PUZZLES } from '@phrasey/engine';
import { buildApp, type App } from '../app.js';
import { loadConfig, type ServerConfig } from '../config.js';
import { createLogger } from '../logger.js';
import type { PuzzleSource } from '../data/puzzles.js';
import type { RoomStore } from '../data/rooms.js';
import type { SessionStore } from '../data/sessions.js';

export function fixedPuzzles(ids: string[] = ['p1', 'p2', 'p3']): PuzzleSource {
  const list = ids.map((id) => TEST_PUZZLES.find((p) => p.id === id)).filter(Boolean) as Puzzle[];
  let cursor = 0;
  return {
    size: list.length,
    origin: 'fixtures',
    all: list,
    byId: (id) => list.find((p) => p.id === id),
    pick(used) {
      const pool = list.filter((p) => !used.includes(p.id));
      const from = pool.length > 0 ? pool : list;
      return from[cursor++ % from.length] as Puzzle;
    },
  };
}

export function memoryRoomStore(): RoomStore & { docs: Map<string, Record<string, unknown>> } {
  const docs = new Map<string, Record<string, unknown>>();
  return {
    docs,
    async create(code, doc) {
      docs.set(code, { ...doc } as Record<string, unknown>);
    },
    async snapshot(code, patch) {
      docs.set(code, { ...(docs.get(code) ?? {}), ...patch } as Record<string, unknown>);
    },
    async close(code, status) {
      docs.set(code, { ...(docs.get(code) ?? {}), status });
    },
    async loadAll() {
      return [];
    },
    async reserved() {
      return new Set();
    },
  };
}

export function memorySessionStore(): SessionStore & { written: unknown[] } {
  const written: unknown[] = [];
  return {
    written,
    async write(result, extra) {
      written.push({ result, extra });
    },
  };
}

export interface TestServer {
  app: App;
  url: string;
  rooms: ReturnType<typeof memoryRoomStore>;
  sessions: ReturnType<typeof memorySessionStore>;
  close(): Promise<void>;
}

export async function startTestServer(over: Partial<ServerConfig> = {}, puzzles = fixedPuzzles()): Promise<TestServer> {
  const cfg: ServerConfig = {
    ...loadConfig({ NODE_ENV: 'test', FIRESTORE_ENABLED: '0' }),
    port: 0,
    leakGuard: true,
    debugInvariants: true,
    intermissionMs: 300,
    tickMs: 40,
    timerEmitMs: 200,
    ...over,
  };
  const rooms = memoryRoomStore();
  const sessions = memorySessionStore();
  const app = await buildApp({
    cfg,
    log: createLogger({ level: 'silent', pretty: false }),
    puzzles,
    balance: undefined,
    roomStore: rooms,
    sessionStore: sessions,
  });
  await app.listen();
  const addr = app.fastify.server.address() as AddressInfo;
  return {
    app,
    rooms,
    sessions,
    url: `http://127.0.0.1:${addr.port}`,
    close: () => app.close(),
  };
}

/** A recording socket.io client with promise-based acks. */
export class TestClient {
  readonly socket: Socket;
  readonly received: { event: string; payload: unknown }[] = [];
  playerId = '';
  token = '';

  constructor(url: string) {
    this.socket = ioClient(url, { path: SOCKET_PATH, transports: ['websocket'], forceNew: true });
    for (const e of [
      'room:state',
      'game:started',
      'board:update',
      'hand:update',
      'turn:begin',
      'turn:timer',
      'pressure:update',
      'interrupt:window',
      'interrupt:closed',
      'round:end',
      'match:end',
      'chat:emote',
      'error',
    ]) {
      this.socket.on(e, (payload: unknown) => this.received.push({ event: e, payload }));
    }
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('connect timeout')), 10_000);
      this.socket.once('connect', () => {
        clearTimeout(t);
        resolve();
      });
      this.socket.once('connect_error', (e: Error) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }

  call(event: string, payload: unknown): Promise<{ ok: boolean; data?: any; error?: { code: string; message?: string } }> {
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve({ ok: false, error: { code: 'ACK_TIMEOUT' } }), 8000);
      this.socket.emit(event, payload, (res: { ok: boolean; data?: unknown; error?: { code: string; message?: string } }) => {
        clearTimeout(t);
        resolve(res as { ok: boolean; data?: any; error?: { code: string; message?: string } });
      });
    });
  }

  /** Decline every interrupt window automatically (empty cardId == pass). */
  autoDeclineInterrupts(): this {
    this.socket.on('interrupt:window', (p: { windowId: string }) => {
      this.socket.emit('interrupt:pass', { windowId: p.windowId }, () => undefined);
    });
    return this;
  }

  of(event: string): unknown[] {
    return this.received.filter((r) => r.event === event).map((r) => r.payload);
  }

  clear(): void {
    this.received.length = 0;
  }

  close(): void {
    this.socket.close();
  }
}

export async function waitFor(pred: () => boolean, ms = 15_000, step = 25): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('waitFor timed out');
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
