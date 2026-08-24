/**
 * The real transport: socket.io-client against the Phrasey game server.
 *
 * Note what is deliberately absent — there is no client-side game logic here.
 * The server is authoritative (§6.2); this file moves bytes and nothing else.
 *
 * RECONNECTION POLICY — this is a party game people join from a phone, and a
 * phone is hostile to a websocket:
 *
 *   - Locking the screen or backgrounding the tab freezes timers and lets the
 *     OS tear the socket down. No JavaScript runs while that is true.
 *   - When the tab thaws, every `setTimeout` that came due while it was frozen
 *     fires in one burst. A *bounded* attempt budget is therefore not a budget
 *     at all: all of it can be spent in a few milliseconds against a radio that
 *     has not finished re-associating, after which socket.io emits
 *     `reconnect_failed` and never tries again. The tab looks connected and is
 *     permanently dead. That is the bug this policy exists to prevent.
 *
 * So: unlimited attempts, capped exponential backoff, and real jitter so a
 * whole table coming out of a tunnel does not stampede the server in lockstep.
 * Attempting a reconnect is always safe — the store re-presents the session
 * token afterwards, and `Room.reclaim` on the server is idempotent.
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

/**
 * Backoff floor and ceiling. The ceiling is what matters on mobile: a phone in
 * a lift or a lift-shaped dead spot should retry about every 10s forever rather
 * than backing off to minutes and missing the moment signal returns.
 */
const RECONNECT_DELAY_MS = 500;
const RECONNECT_DELAY_MAX_MS = 10_000;
/**
 * socket.io multiplies each delay by `1 ± randomizationFactor`. At 0.5 that is
 * a ±50% spread, which is enough to break up a table that all dropped together.
 */
const RECONNECT_JITTER = 0.5;
/** A single handshake attempt. Generous: a cold radio is slow, not broken. */
const CONNECT_TIMEOUT_MS = 20_000;

export interface SocketTransportOptions {
  url?: string;
  /**
   * Reconnect budget. Defaults to `Infinity` — see the policy note above. A
   * finite value is for tests that want to observe exhaustion, not for the app.
   */
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
      reconnectionAttempts: opts.reconnectionAttempts ?? Infinity,
      reconnectionDelay: RECONNECT_DELAY_MS,
      reconnectionDelayMax: RECONNECT_DELAY_MAX_MS,
      randomizationFactor: RECONNECT_JITTER,
      timeout: CONNECT_TIMEOUT_MS,
      autoConnect: false,
      withCredentials: false,
    });

    s.on('connect', () => setState('connected'));
    s.on('disconnect', (reason: string) => {
      // "io server disconnect" means the server hung up deliberately and
      // socket.io will NOT retry on its own — so ask it to, or the tab is dead.
      if (reason === 'io server disconnect') {
        setState('reconnecting', reason);
        s.connect();
        return;
      }
      setState(reason === 'io client disconnect' ? 'closed' : 'reconnecting', reason);
    });
    s.on('connect_error', (err: Error) => setState('error', err.message));
    s.io.on('reconnect_attempt', () => setState('reconnecting'));
    s.io.on('reconnect', () => setState('connected'));
    // With `Infinity` attempts this should be unreachable, which is exactly why
    // it is worth surfacing: if it ever fires, the policy above regressed.
    s.io.on('reconnect_failed', () => setState('error', 'reconnect budget exhausted'));

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

  /**
   * One connect attempt, shared by concurrent callers.
   *
   * The promise is cleared as soon as it settles — on success as well as on
   * failure. Caching a *resolved* promise was a real bug on mobile: the first
   * connect resolved, the phone slept, the socket died, and every later
   * `connect()` returned that stale resolved promise instead of dialling.
   */
  function dial(): Promise<void> {
    const s = ensureSocket();
    if (s.connected) return Promise.resolve();
    if (connectPromise) return connectPromise;
    setState('connecting');
    const p = new Promise<void>((resolve, reject) => {
      const done = () => {
        s.off('connect', onOk);
        s.off('connect_error', onErr);
        if (connectPromise === p) connectPromise = null;
      };
      const onOk = () => {
        done();
        resolve();
      };
      const onErr = (err: Error) => {
        done();
        reject(err);
      };
      s.once('connect', onOk);
      s.once('connect_error', onErr);
      s.connect();
    });
    connectPromise = p;
    return p;
  }

  return {
    kind: 'socket',

    connect() {
      return dial();
    },

    isHealthy() {
      return socket?.connected === true;
    },

    /**
     * Wake the link up. Called from every resume trigger, so it must be cheap
     * and safe when the socket is already fine.
     *
     * A rejection is swallowed: socket.io's own retry loop owns the retrying,
     * and a resume trigger firing while the radio is still down is normal, not
     * an error the UI should hear about.
     */
    async reconnect() {
      const s = ensureSocket();
      if (s.connected) return;
      // `Socket.connect()` is a NO-OP while the Manager is sitting out a
      // backoff delay (it checks `io._reconnecting` and returns), so on its own
      // it makes a woken phone wait out the rest of a delay that can be ten
      // seconds long — with the board frozen the entire time. A resume trigger
      // is positive evidence that the user is back and the radio probably is
      // too, so the Manager is opened directly to force an attempt NOW. If a
      // retry was already pending it finds the connection open and returns.
      try {
        (s.io as unknown as { open?: () => void }).open?.();
      } catch {
        /* older socket.io, or already opening */
      }
      // A manual `disconnect()` (or an exhausted budget on a finite policy)
      // leaves the manager's retry loop stopped. `connect()` restarts it.
      try {
        await dial();
      } catch {
        /* socket.io keeps trying; the state bus already reported it */
      }
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
