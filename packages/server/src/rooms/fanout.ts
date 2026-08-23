/**
 * THE fan-out boundary (§6.2, §6.5: "Every server→client payload carrying board
 * state is masked. Write one maskBoard() function, use it everywhere").
 *
 * Two rules, enforced structurally rather than by convention:
 *
 *  1. Every socket emit in this server goes through `Fanout.send()`. There is
 *     no other call to `socket.emit` for game data anywhere in `src/rooms` or
 *     `src/net` — `fanout.test.ts` greps the tree to prove it.
 *
 *  2. `send()` runs `assertNoLeak` on the payload before it leaves. The guard
 *     knows what is currently secret (the answer, every still-hidden letter, an
 *     unrevealed hint) and throws rather than emitting. It is on outside
 *     production and on for every test.
 *
 * Board state is only ever built from `maskBoard`/`roundPublic`, and private
 * state only from `playerView`. The `GameEvent[]` inside `board:update` is
 * split per recipient by `eventsFor`, which fails CLOSED: an event kind that is
 * not explicitly public is withheld from everyone but its owner. That is what
 * keeps `peek` — which carries a hidden letter — on the peeking socket alone.
 */
import type {
  GameEvent,
  MaskedBoard,
  RoomPublic,
  RoundPublic,
  ServerToClientEvents,
} from '@phrasey/shared';
import { playerView, roundPublic, type GameState } from '@phrasey/engine';
import { assertNoLeak, eventsFor, secretsOf, type Secrets } from '../leakGuard.js';
import type { Logger } from '../logger.js';

export type EmitFn = <E extends keyof ServerToClientEvents>(
  socketId: string,
  event: E,
  payload: Parameters<ServerToClientEvents[E]>[0],
) => void;

export interface Recipient {
  playerId: string;
  socketId: string;
}

export class Fanout {
  constructor(
    private readonly emit: EmitFn,
    private readonly guardEnabled: boolean,
    private readonly log: Logger,
  ) {}

  /**
   * The single choke point. Nothing reaches a socket except through here.
   *
   * A leak is a bug, not a runtime condition: the payload is dropped and the
   * error is logged loudly. Dropping is the safe failure mode — a missing
   * animation beats a visible answer.
   */
  send<E extends keyof ServerToClientEvents>(
    to: Recipient,
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
    secrets: Secrets | null,
  ): void {
    if (this.guardEnabled) {
      try {
        assertNoLeak(String(event), payload, secrets);
      } catch (err) {
        this.log.error({ err: String(err), event, playerId: to.playerId }, 'LEAK GUARD blocked an emit');
        return;
      }
    }
    this.emit(to.socketId, event, payload);
  }

  sendAll<E extends keyof ServerToClientEvents>(
    recipients: readonly Recipient[],
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
    secrets: Secrets | null,
  ): void {
    for (const r of recipients) this.send(r, event, payload, secrets);
  }

  /** Roster/settings/status. Contains no board state. */
  roomState(recipients: readonly Recipient[], room: RoomPublic, secrets: Secrets | null): void {
    this.sendAll(recipients, 'room:state', room, secrets);
  }

  /**
   * Fan an engine step out to the table.
   *
   * Order matters for the client: board first (so a `turn:begin` never arrives
   * describing a board the client has not seen), then the private hand, then
   * the derived typed events.
   */
  game(state: GameState, recipients: readonly Recipient[], events: readonly GameEvent[]): void {
    const secrets = this.guardEnabled ? secretsOf(state) : null;
    const round: RoundPublic | null = state.round ? roundPublic(state) : null;
    const board: MaskedBoard | null = round?.board ?? null;

    // `game:started` carries the opening board; emit it before the first
    // board:update so a joining client is never handed events out of order.
    const started = events.find((e) => e.t === 'round:start');
    if (started && round && board) {
      this.sendAll(recipients, 'game:started', { round, board }, secrets);
    }

    for (const to of recipients) {
      const mine = eventsFor(to.playerId, events);
      if (round && board && (mine.length > 0 || events.length === 0)) {
        this.send(to, 'board:update', { board, round, events: mine }, secrets);
      }

      // PRIVATE. `playerView` is the only sanctioned source of per-player state
      // and it is the only thing that ever carries `peeks`.
      let view;
      try {
        view = playerView(state, to.playerId);
      } catch {
        continue; // seat removed mid-step
      }
      this.send(to, 'hand:update', { cards: view.hand, peeks: view.peeks }, secrets);

      if (view.window) {
        this.send(
          to,
          'interrupt:window',
          {
            windowId: view.window.windowId,
            kind: view.window.kind,
            sourcePlayerId: view.window.sourcePlayerId,
            expiresAt: view.window.expiresAt,
            playableCardIds: view.window.playableCardIds,
          },
          secrets,
        );
      }
    }

    this.derived(recipients, events, secrets, state);
  }

  /**
   * The typed server→client events the protocol calls for, derived from the
   * engine event stream. Every one of these is public by construction — none of
   * them can carry a hidden letter — but they still go through `send`.
   */
  private derived(
    recipients: readonly Recipient[],
    events: readonly GameEvent[],
    secrets: Secrets | null,
    state: GameState,
  ): void {
    for (const e of events) {
      switch (e.t) {
        case 'turn:begin':
          this.sendAll(
            recipients,
            'turn:begin',
            { playerId: e.playerId, endsAt: e.endsAt, roundNumber: state.roundNumber },
            secrets,
          );
          break;
        case 'pressure':
          this.sendAll(
            recipients,
            'pressure:update',
            {
              value: e.value,
              delta: e.delta,
              max: state.balance.pressure.max,
              cause: e.cause,
              byPlayerId: e.byPlayerId,
            },
            secrets,
          );
          break;
        case 'interrupt:close':
          this.sendAll(recipients, 'interrupt:closed', { windowId: e.windowId }, secrets);
          break;
        case 'round:end':
          // The round is over: `secretsOf` already returned null for this
          // state, so the answer inside the result is sanctioned (types.ts).
          this.sendAll(recipients, 'round:end', e.result, secrets);
          break;
        case 'match:end':
          this.sendAll(recipients, 'match:end', e.result, secrets);
          break;
        default:
          break;
      }
    }
  }

  /** Timer pings. Separate from `game()` because they carry no engine step. */
  timer(recipients: readonly Recipient[], playerId: string, remainingMs: number): void {
    this.sendAll(recipients, 'turn:timer', { playerId, remainingMs }, null);
  }
}
