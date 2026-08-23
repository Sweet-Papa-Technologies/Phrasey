/**
 * Scriptable smoke-test client.
 *
 *   pnpm --filter @phrasey/server tsx src/dev/harness.ts --url http://127.0.0.1:8080
 *   pnpm --filter @phrasey/server tsx src/dev/harness.ts --url https://phrasey-server-xxxx.a.run.app
 *
 * Drives two or more simulated players through a complete round headlessly with
 * a real socket.io-client, over the real protocol, against a real server. It is
 * the local stand-in for "two browser tabs play a full round against each other"
 * (§14 M2) and the post-deploy check.
 *
 * The players here are dumb on purpose — they are a protocol exerciser, not a
 * bot. Bot brains live in `@phrasey/engine`.
 *
 */
import { io, type Socket } from 'socket.io-client';
import {
  ENGLISH_LETTER_FREQUENCY,
  SOCKET_PATH,
  VOWELS,
  isActionCard,
  isLetterCard,
  type Ack,
  type BoardWord,
  type Card,
  type ClientToServerEvents,
  type MaskedBoard,
  type RoundPublic,
  type ServerToClientEvents,
  type SocketError,
} from '@phrasey/shared';

type S = Socket<ServerToClientEvents, ClientToServerEvents>;

interface Args {
  url: string;
  players: number;
  rounds: number;
  turnSeconds: number | null;
  bots: number;
  timeoutMs: number;
  verbose: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, dflt?: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
  };
  const ts = get('--turn-seconds', '10');
  return {
    url: get('--url', 'http://127.0.0.1:8080') as string,
    players: Number(get('--players', '2')),
    rounds: Number(get('--rounds', '1')),
    turnSeconds: ts === 'off' ? null : Number(ts),
    bots: Number(get('--bots', '0')),
    timeoutMs: Number(get('--timeout', '180000')),
    verbose: argv.includes('--verbose'),
  };
}

const COLORS = ['#FF5C1A', '#B8FF3C', '#6C3BFF', '#FF2E63', '#00C2FF', '#FFC93C', '#22D3A0', '#FF8AD8'];

function stamp(): string {
  return new Date().toISOString().slice(11, 23);
}

function log(who: string, msg: string): void {
  console.log(`${stamp()} [${who}] ${msg}`);
}

function render(words: BoardWord[]): string {
  return words
    .map((w) => w.map((c) => (c.t === 'punct' ? c.ch : c.revealed ? c.ch : '_')).join(''))
    .join(' ');
}

/** Best-effort reconstruction; only correct once every tile is face-up. */
function readBoard(words: BoardWord[]): string {
  return words
    .map((w) => w.map((c) => (c.t === 'punct' ? c.ch : c.revealed ? c.ch : '?')).join(''))
    .join(' ');
}

class Player {
  socket: S;
  playerId = '';
  sessionToken = '';
  hand: Card[] = [];
  board: MaskedBoard | null = null;
  round: RoundPublic | null = null;
  awaitingSolve = false;
  private pending: NodeJS.Timeout | null = null;
  private retries = 0;

  constructor(
    readonly label: string,
    readonly url: string,
    private readonly verbose: boolean,
    private readonly onEvent: (p: Player, name: string, payload: unknown) => void,
  ) {
    this.socket = io(url, { path: SOCKET_PATH, transports: ['websocket'], forceNew: true }) as S;
    this.wire();
  }

  private wire(): void {
    const on = <E extends keyof ServerToClientEvents>(
      name: E,
      fn: (p: Parameters<ServerToClientEvents[E]>[0]) => void,
    ): void => {
      this.socket.on(name, fn as never);
    };

    on('hand:update', (p) => {
      this.hand = p.cards;
      if (this.verbose && Object.keys(p.peeks).length > 0) {
        log(this.label, `private peeks: ${JSON.stringify(p.peeks)}`);
      }
      this.onEvent(this, 'hand:update', p);
    });

    on('game:started', (p) => {
      this.board = p.board;
      this.round = p.round;
      log(this.label, `round ${p.round.roundNumber} — "${p.board.category}" · ${render(p.board.words)}`);
      this.onEvent(this, 'game:started', p);
      this.schedule(50);
    });

    on('board:update', (p) => {
      this.board = p.board;
      this.round = p.round;
      for (const e of p.events) {
        if (e.t === 'peek') log(this.label, `PEEK (private) tile ${e.index} = ${e.letter}`);
        if (this.verbose) log(this.label, `event ${e.t}`);
      }
      this.onEvent(this, 'board:update', p);
      this.schedule(50);
    });

    on('turn:begin', (p) => {
      this.awaitingSolve = false;
      this.retries = 0;
      if (p.playerId === this.playerId) log(this.label, `my turn (round ${p.roundNumber})`);
      this.onEvent(this, 'turn:begin', p);
      this.schedule(60);
    });

    on('interrupt:window', (p) => {
      log(this.label, `interrupt window ${p.windowId} (${p.kind}), ${p.playableCardIds.length} playable`);
      // Decline: empty cardId is the pass convention.
      this.emit('interrupt:pass', { windowId: p.windowId });
      this.onEvent(this, 'interrupt:window', p);
    });

    on('interrupt:closed', (p) => this.onEvent(this, 'interrupt:closed', p));
    on('pressure:update', (p) => {
      if (this.verbose) log(this.label, `pressure ${p.value}/${p.max} (${p.cause})`);
      this.onEvent(this, 'pressure:update', p);
    });
    on('round:end', (p) => {
      log(this.label, `round ${p.roundNumber} end — ${p.reason} — answer "${p.answer}"`);
      this.awaitingSolve = false;
      this.onEvent(this, 'round:end', p);
    });
    on('match:end', (p) => {
      log(this.label, `match end — winners ${p.winnerIds.join(', ')} — ${JSON.stringify(p.totals)}`);
      this.onEvent(this, 'match:end', p);
    });
    on('room:state', (p) => this.onEvent(this, 'room:state', p));
    on('error', (p) => log(this.label, `server error ${p.code}: ${p.message}`));
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.label}: connect timeout`)), 20000);
      this.socket.on('connect', () => {
        clearTimeout(t);
        resolve();
      });
      this.socket.on('connect_error', (e: Error) => {
        clearTimeout(t);
        reject(new Error(`${this.label}: ${e.message}`));
      });
    });
  }

  emit<E extends keyof ClientToServerEvents>(
    event: E,
    payload: Parameters<ClientToServerEvents[E]>[0],
  ): Promise<{ ok: boolean; error?: SocketError; data?: unknown }> {
    return new Promise((resolve) => {
      const ack: Ack<unknown> = (res) => resolve(res.ok ? { ok: true, data: res.data } : { ok: false, error: res.error });
      (this.socket.emit as (e: string, p: unknown, a: unknown) => void)(event, payload, ack);
    });
  }

  private schedule(ms: number): void {
    if (this.pending) clearTimeout(this.pending);
    this.pending = setTimeout(() => {
      this.pending = null;
      void this.act();
    }, ms);
  }

  /** Decide and send exactly one thing, if it is our move. */
  private async act(): Promise<void> {
    const round = this.round;
    const board = this.board;
    if (!round || !board) return;
    if (round.currentPlayerId !== this.playerId) return;

    if (this.awaitingSolve) {
      if (board.hiddenLetters === 0) {
        const guess = readBoard(board.words);
        log(this.label, `solving "${guess}"`);
        const res = await this.emit('turn:solve', { guess });
        if (!res.ok) this.onRejected(res.error);
        else this.awaitingSolve = false;
        return;
      }
      // Empty guess == decline (protocol gap; see header).
      const res = await this.emit('turn:pass', {});
      if (!res.ok) this.onRejected(res.error);
      else this.awaitingSolve = false;
      return;
    }

    const move = this.chooseMove(board);
    if (!move) return;
    const res = await this.emit(move.event, move.payload as never);
    if (!res.ok) {
      if (this.verbose) {
        log(this.label, `DBG move=${move.what} guessed=[${board.guessedLetters.join('')}] hand=${JSON.stringify(this.hand.map((c) => (c.kind === 'letter' ? c.letter : c.action)))}`);
      }
      this.onRejected(res.error);
      return;
    }
    log(this.label, `played ${move.what}`);
    this.awaitingSolve = true;
    this.retries = 0;
    this.schedule(80);
  }

  private onRejected(err: SocketError | undefined): void {
    // A rejection normally means an interrupt window owns the table, or the
    // turn moved on under us. Back off and re-read the board.
    if (this.retries++ > 20) {
      log(this.label, `giving up after repeated rejections (${err?.code})`);
      return;
    }
    log(this.label, `rejected (${err?.code}); retrying`);
    this.schedule(300);
  }

  private chooseMove(
    board: MaskedBoard,
  ): { event: keyof ClientToServerEvents; payload: unknown; what: string } | null {
    const guessed = new Set(board.guessedLetters);
    const letters = this.hand.filter(isLetterCard).filter((c) => !guessed.has(c.letter));
    if (letters.length > 0) {
      letters.sort((a, b) => (ENGLISH_LETTER_FREQUENCY[b.letter] ?? 0) - (ENGLISH_LETTER_FREQUENCY[a.letter] ?? 0));
      const pick = letters[0] as Card;
      return {
        event: 'turn:playCard',
        payload: { type: 'letter', cardId: pick.id },
        what: `letter ${(pick as { letter: string }).letter}`,
      };
    }

    const open = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => !guessed.has(l));
    for (const card of this.hand) {
      if (!isActionCard(card)) continue;
      switch (card.action) {
        case 'SWIPE':
        case 'BLOCK':
        case 'BUZZ_IN':
          continue;
        case 'WILD': {
          if (open.length === 0) continue;
          return {
            event: 'turn:playCard',
            payload: { type: 'action', cardId: card.id, letter: open[0] },
            what: `WILD as ${open[0]}`,
          };
        }
        case 'VOWEL_RUSH': {
          const v = (VOWELS as readonly string[]).find((x) => !guessed.has(x));
          if (!v) continue;
          return {
            event: 'turn:playCard',
            payload: { type: 'action', cardId: card.id, letter: v },
            what: `VOWEL_RUSH ${v}`,
          };
        }
        case 'LOCKOUT':
          continue; // needs a target; not worth the complexity for a smoke test
        default:
          return { event: 'turn:playCard', payload: { type: 'action', cardId: card.id }, what: card.action };
      }
    }

    const dump = this.hand[0];
    if (!dump) return null;
    return { event: 'turn:discard', payload: { cardIds: [dump.id] }, what: 'discard' };
  }

  close(): void {
    if (this.pending) clearTimeout(this.pending);
    this.socket.close();
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(`\n=== Phrasey harness → ${args.url} ===`);
  console.log(
    `players=${args.players} bots=${args.bots} rounds=${args.rounds} turnSeconds=${args.turnSeconds ?? 'off'}\n`,
  );

  let roundsSeen = 0;
  let matchEnded = false;
  let sawPeekLeak = false;
  const players: Player[] = [];

  const onEvent = (p: Player, name: string, payload: unknown): void => {
    if (name === 'board:update') {
      const evts = (payload as { events: { t: string; playerId?: string }[] }).events;
      for (const e of evts) {
        // The masking assertion, live: a peek must never reach another socket.
        if (e.t === 'peek' && e.playerId !== p.playerId) sawPeekLeak = true;
      }
    }
    if (name === 'round:end' && p === players[0]) roundsSeen++;
    if (name === 'match:end' && p === players[0]) matchEnded = true;
  };

  for (let i = 0; i < args.players; i++) {
    players.push(new Player(`P${i + 1}`, args.url, args.verbose, onEvent));
  }
  await Promise.all(players.map((p) => p.connect()));
  log('harness', 'all clients connected');

  const host = players[0] as Player;
  const created = await host.emit('room:create', {
    name: 'Host',
    color: COLORS[0] as string,
    settings: {
      matchMode: 'rounds',
      rounds: args.rounds,
      turnSeconds: args.turnSeconds as 10 | 15 | 25 | null,
      botCount: args.bots,
      interruptsEnabled: true,
    },
  });
  if (!created.ok) throw new Error(`room:create failed: ${JSON.stringify(created.error)}`);
  const room = created.data as { sessionToken: string; playerId: string; key: string; room: { code: string } };
  host.playerId = room.playerId;
  host.sessionToken = room.sessionToken;
  const code = room.room.code;
  const roomKey = room.key;
  log('harness', `room ${code} created`);

  for (let i = 1; i < players.length; i++) {
    const p = players[i] as Player;
    const joined = await p.emit('room:join', { code, key: roomKey, name: `Player${i + 1}`, color: COLORS[i % COLORS.length] as string });
    if (!joined.ok) throw new Error(`room:join failed: ${JSON.stringify(joined.error)}`);
    const d = joined.data as { sessionToken: string; playerId: string };
    p.playerId = d.playerId;
    p.sessionToken = d.sessionToken;
    log('harness', `${p.label} seated as ${d.playerId}`);
  }

  const started = await host.emit('game:start', {});
  if (!started.ok) throw new Error(`game:start failed: ${JSON.stringify(started.error)}`);
  log('harness', 'game started');

  const deadline = Date.now() + args.timeoutMs;
  while (Date.now() < deadline) {
    if (matchEnded || roundsSeen >= args.rounds) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  const okRounds = roundsSeen >= 1;
  console.log('');
  console.log('=== result ===');
  console.log(`rounds completed : ${roundsSeen}`);
  console.log(`match ended      : ${matchEnded}`);
  console.log(`peek leaked      : ${sawPeekLeak ? 'YES — FAIL' : 'no'}`);
  console.log(`verdict          : ${okRounds && !sawPeekLeak ? 'PASS' : 'FAIL'}`);

  for (const p of players) p.close();
  await new Promise((r) => setTimeout(r, 200));
  process.exit(okRounds && !sawPeekLeak ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('harness failed:', err);
  process.exit(1);
});
