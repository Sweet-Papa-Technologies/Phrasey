/**
 * The seam between the UI and the network.
 *
 * Everything above this file talks to a `Transport`. Two implementations ship:
 *
 *   - `socketTransport` — the real socket.io-client connection to the server.
 *   - `mockTransport`   — a scripted in-memory game. It powers the landing
 *                         page's live demo board and lets the whole client be
 *                         built and tested with no server running.
 *
 * The event names and payload shapes are taken structurally from
 * `@phrasey/shared`'s `ClientToServerEvents` / `ServerToClientEvents`, so the
 * protocol cannot drift out from under either implementation without a
 * typecheck failure.
 */
import type { Ack, ClientToServerEvents, ServerToClientEvents, SocketError } from '@phrasey/shared';

/** Payload argument of a client→server event. */
export type PayloadOf<E extends keyof ClientToServerEvents> = ClientToServerEvents[E] extends (
  p: infer P,
  ack: Ack<never>,
) => void
  ? P
  : never;

/** Data carried by the ack of a client→server event. */
export type AckDataOf<E extends keyof ClientToServerEvents> = ClientToServerEvents[E] extends (
  p: never,
  ack: Ack<infer D>,
) => void
  ? D
  : never;

/** Exactly the envelope `Ack<T>` delivers. */
export type AckResult<T> = { ok: true; data: T } | { ok: false; error: SocketError };

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed' | 'error';

export interface Transport {
  /** Human-readable id, surfaced in the UI so "am I on the mock?" is never a guess. */
  readonly kind: 'socket' | 'mock';
  connect(): Promise<void>;
  emit<E extends keyof ClientToServerEvents>(event: E, payload: PayloadOf<E>): Promise<AckResult<AckDataOf<E>>>;
  /** Subscribe. Returns an unsubscribe function. */
  on<E extends keyof ServerToClientEvents>(event: E, cb: ServerToClientEvents[E]): () => void;
  /** Connection-state changes, including transport-level errors. */
  onState(cb: (s: ConnectionState, detail?: string) => void): () => void;
  disconnect(): void;
}

export function transportError(code: string, message: string): { ok: false; error: SocketError } {
  return { ok: false, error: { code, message } };
}

/**
 * Minimal typed event bus shared by both implementations. Kept here rather than
 * duplicated so an event delivered by the mock is delivered exactly the way the
 * socket delivers it — same ordering, same "listener throwing does not kill the
 * fan-out" behaviour.
 */
export class Emitter<Events extends { [K in keyof Events]: (...args: never[]) => void }> {
  private listeners = new Map<keyof Events, Set<(...args: never[]) => void>>();

  on<E extends keyof Events>(event: E, cb: Events[E]): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(cb as (...args: never[]) => void);
    return () => {
      set?.delete(cb as (...args: never[]) => void);
    };
  }

  emit<E extends keyof Events>(event: E, ...args: Parameters<Events[E]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as (...a: unknown[]) => void)(...args);
      } catch (err) {
        // A broken listener must never stop the rest of the app from updating.
        console.error(`[transport] listener for "${String(event)}" threw`, err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
