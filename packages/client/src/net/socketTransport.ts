/**
 * The real transport: socket.io-client against the Phrasey game server.
 *
 * Note what is deliberately absent — there is no client-side game logic here.
 * The server is authoritative (§6.2); this file moves bytes and nothing else.
 */
import { io, type Socket } from 'socket.io-client';
import { SOCKET_PATH, type ClientToServerEvents, type ServerToClientEvents } from '@phrasey/shared';
import {
  Emitter,
  transportError,
  type AckDataOf,
  type AckResult,
  type ConnectionState,
  type PayloadOf,
  type Transport,
} from './transport';

/** How long we wait for an ack before giving up on a single call. */
const ACK_TIMEOUT_MS = 10_000;

export interface SocketTransportOptions {
  url?: string;
  /** Reconnect budget. The server holds a dropped seat for 90s (§7). */
  reconnectionAttempts?: number;
}

type PhraseySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocketTransport(opts: SocketTransportOptions = {}): Transport {
  const url = opts.url ?? resolveServerUrl();
  const bus = new Emitter<ServerToClientEvents>();
  const stateBus = new Emitter<{ state: (s: ConnectionState, detail?: string) => void }>();

  let socket: PhraseySocket | null = null;
  let connectPromise: Promise<void> | null = null;

  function setState(s: ConnectionState, detail?: string) {
    stateBus.emit('state', s, detail);
  }

  function ensureSocket(): PhraseySocket {
    if (socket) return socket;
    const s: PhraseySocket = io(url, {
      path: SOCKET_PATH,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: opts.reconnectionAttempts ?? 12,
      reconnectionDelay: 400,
      reconnectionDelayMax: 4000,
      autoConnect: false,
      withCredentials: false,
    });

    s.on('connect', () => setState('connected'));
    s.on('disconnect', (reason: string) => setState(reason === 'io client disconnect' ? 'closed' : 'reconnecting', reason));
    s.on('connect_error', (err: Error) => setState('error', err.message));
    s.io.on('reconnect_attempt', () => setState('reconnecting'));

    // Re-broadcast every server→client event onto our own bus, so the store
    // never touches the socket object directly.
    const serverEvents: (keyof ServerToClientEvents)[] = [
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
    ];
    for (const name of serverEvents) {
      // socket.io's per-event typing does not survive the generic loop; the
      // payload is re-typed at the `on()` boundary below.
      (s as unknown as { on: (e: string, cb: (...a: unknown[]) => void) => void }).on(name, (...args: unknown[]) => {
        (bus as unknown as { emit: (e: string, ...a: unknown[]) => void }).emit(name, ...args);
      });
    }

    socket = s;
    return s;
  }

  return {
    kind: 'socket',

    connect() {
      if (connectPromise) return connectPromise;
      const s = ensureSocket();
      if (s.connected) return Promise.resolve();
      setState('connecting');
      connectPromise = new Promise<void>((resolve, reject) => {
        const done = () => {
          s.off('connect', onOk);
          s.off('connect_error', onErr);
        };
        const onOk = () => {
          done();
          resolve();
        };
        const onErr = (err: Error) => {
          done();
          connectPromise = null;
          reject(err);
        };
        s.once('connect', onOk);
        s.once('connect_error', onErr);
        s.connect();
      });
      return connectPromise;
    },

    emit<E extends keyof ClientToServerEvents>(event: E, payload: PayloadOf<E>): Promise<AckResult<AckDataOf<E>>> {
      const s = ensureSocket();
      if (!s.connected) {
        return Promise.resolve(transportError('NOT_CONNECTED', 'Not connected to the game server.'));
      }
      return new Promise((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve(transportError('TIMEOUT', 'The server did not answer in time.'));
        }, ACK_TIMEOUT_MS);

        (s as unknown as { emit: (e: string, p: unknown, ack: (r: unknown) => void) => void }).emit(
          event as string,
          payload,
          (res: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(
              (res ?? transportError('EMPTY_ACK', 'The server acknowledged with nothing.')) as AckResult<AckDataOf<E>>,
            );
          },
        );
      });
    },

    on<E extends keyof ServerToClientEvents>(event: E, cb: ServerToClientEvents[E]) {
      return bus.on(event, cb);
    },

    onState(cb) {
      return stateBus.on('state', cb);
    },

    disconnect() {
      connectPromise = null;
      socket?.disconnect();
      socket?.removeAllListeners();
      socket = null;
      bus.clear();
      setState('closed');
    },
  };
}

/** `VITE_SERVER_URL` in dev/prod env; same origin otherwise. */
export function resolveServerUrl(): string {
  const fromEnv = import.meta.env?.VITE_SERVER_URL;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;
}
