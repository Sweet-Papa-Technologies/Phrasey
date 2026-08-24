/**
 * A believable fake server.
 *
 * This is NOT throwaway scaffolding. It powers two things:
 *
 *  1. The landing page hero — a live demo board mid-puzzle, tiles revealing on
 *     a loop, the bottle filling (§9).
 *  2. The whole client during development, so the UI can be built and walked
 *     end to end before (and independently of) the real server.
 *
 * It speaks exactly the wire protocol from `@phrasey/shared`, and it observes
 * the same masking invariant the real server does: `emitBoard()` is the only
 * way board state leaves this module, and it goes through `buildWords()` with
 * the revealed-letter set — so an unrevealed cell has no `ch` field to leak,
 * here or anywhere else.
 */
import {
  ACTION_CARD_META,
  AVATAR_COLORS,
  BALANCE,
  ENGLISH_LETTER_FREQUENCY,
  TURN_ACTION_KINDS,
  VOWELS,
  accessibleBoardText,
  buildWords,
  guessMatches,
  isLetter,
  normalizePuzzleText,
  type ActionCard,
  type ActionCardKind,
  type Card,
  type GameEvent,
  type LetterCard,
  type MaskedBoard,
  type MatchResult,
  type PlayerPublic,
  type RoomPublic,
  type RoomSettings,
  type RoundPublic,
  type RoundResult,
  type ServerToClientEvents,
  type TurnActionKind,
} from '@phrasey/shared';
import { MOCK_PUZZLES, type MockPuzzle } from './mockPuzzles';

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

/** Deterministic RNG so the demo loop is reproducible and tests are stable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Flat tile index of every occurrence of `letter`, counting all non-space
 * characters in reading order. Matches `letterPositions()` in
 * `@phrasey/shared`, which is the index space the client renders against.
 */
export function positionsOf(text: string, letter: string): number[] {
  const out: number[] = [];
  let i = 0;
  for (const ch of normalizePuzzleText(text)) {
    if (ch === ' ') continue;
    if (ch === letter) out.push(i);
    i++;
  }
  return out;
}

const BOT_NAMES: { name: string; persona: string }[] = [
  { name: 'Slushie', persona: 'Plays vowels like they cost money. They do not.' },
  { name: 'Big Gulp', persona: 'Has never once discarded. Not once.' },
  { name: 'Cap', persona: 'Solves early, apologises later.' },
  { name: 'Freezer Burn', persona: 'Cold reads the board. Colder reads you.' },
  { name: 'Two-Liter', persona: 'Committed to the bit and to the pressure gauge.' },
  { name: 'Sticky Floor', persona: 'Leaves every round slightly worse than they found it.' },
  { name: 'Nozzle', persona: 'Mixes all seven flavors. Every time.' },
];

// ---------------------------------------------------------------------------
// Mock game
// ---------------------------------------------------------------------------

export interface MockGameOptions {
  /** Demo mode: everyone is a bot, rounds loop forever, board starts partly revealed. */
  demo?: boolean;
  seed?: number;
  /** Multiplier on every scheduled delay. <1 is faster; the demo runs brisk. */
  speed?: number;
  /** Display name for the human seat. */
  selfName?: string;
  selfColor?: string;
}

type Emit = <E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>) => void;

const DEFAULT_SETTINGS: RoomSettings = {
  matchMode: BALANCE.match.defaultMode,
  rounds: BALANCE.match.defaultRounds,
  targetScore: BALANCE.match.defaultTargetScore,
  turnSeconds: BALANCE.turn.defaultSeconds,
  botCount: BALANCE.setup.defaultBots,
  botTier: 'sharp',
  interruptsEnabled: true,
};

export class MockGame {
  readonly code: string;
  readonly selfId = 'p-you';

  private emit: Emit;
  private rng: () => number;
  private demo: boolean;
  private speed: number;

  private timers = new Set<ReturnType<typeof setTimeout>>();
  private disposed = false;
  private cardSeq = 0;

  private settings: RoomSettings = { ...DEFAULT_SETTINGS };
  private players: PlayerPublic[] = [];
  private hands = new Map<string, Card[]>();
  private peeks: Record<number, string> = {};
  private status: RoomPublic['status'] = 'lobby';

  private puzzle: MockPuzzle = MOCK_PUZZLES[0]!;
  private puzzleIdx = 0;
  private revealed = new Set<string>();
  private guessed: string[] = [];
  private missed: string[] = [];
  private hintShown: string | null = null;

  private deck: Card[] = [];
  private pressure = 0;
  private roundNumber = 0;
  private direction: 1 | -1 = 1;
  private turnIdx = 0;
  private turnEndsAt: number | null = null;
  private idleCycles = 0;
  private revealsThisCycle = 0;
  private turnsThisCycle = 0;
  private skipNext = false;
  private openWindowId: string | null = null;
  private acting = false;

  constructor(emit: Emit, opts: MockGameOptions = {}) {
    this.emit = emit;
    this.demo = opts.demo ?? false;
    this.speed = opts.speed ?? (opts.demo ? 0.55 : 1);
    this.rng = mulberry32(opts.seed ?? (opts.demo ? 20260823 : Math.floor(Math.random() * 1e9)));
    this.code = this.demo ? 'DEMO' : this.makeCode();
    this.puzzleIdx = Math.floor(this.rng() * MOCK_PUZZLES.length);

    if (this.demo) {
      this.settings = { ...DEFAULT_SETTINGS, turnSeconds: null, botCount: 3, interruptsEnabled: false };
      this.players = [this.makeBot(0, true), this.makeBot(1), this.makeBot(2), this.makeBot(3)];
    } else {
      this.players = [
        {
          id: this.selfId,
          name: opts.selfName ?? 'You',
          color: opts.selfColor ?? AVATAR_COLORS[0],
          isHost: true,
          isBot: false,
          connection: 'connected',
          score: 0,
          roundScore: 0,
          handCount: 0,
          solveLocked: false,
          lockedNextTurn: false,
          doubleDownArmed: false,
          buzzInsLeft: BALANCE.interrupt.buzzInPerRound,
        },
      ];
      this.syncBots();
    }
  }

  // -- lifecycle -----------------------------------------------------------

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private later(fn: () => void, ms: number): void {
    if (this.disposed) return;
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (this.disposed) return;
      try {
        fn();
      } catch (err) {
        console.error('[mock] scheduled step threw', err);
      }
    }, Math.max(0, Math.round(ms * this.speed)));
    this.timers.add(t);
  }

  // -- room ----------------------------------------------------------------

  private makeCode(): string {
    const C = 'BDFGHJKLMNPRSTVZ';
    const V = 'AEIOU';
    const pick = (s: string) => s[Math.floor(this.rng() * s.length)]!;
    return pick(C) + pick(V) + pick(C) + pick(V);
  }

  private makeBot(i: number, isHost = false): PlayerPublic {
    const meta = BOT_NAMES[i % BOT_NAMES.length]!;
    return {
      id: `bot-${i}`,
      name: meta.name,
      color: AVATAR_COLORS[(i + 1) % AVATAR_COLORS.length]!,
      isHost,
      isBot: true,
      botTier: this.settings.botTier,
      botPersona: meta.persona,
      connection: 'bot',
      score: 0,
      roundScore: 0,
      handCount: 0,
      solveLocked: false,
      lockedNextTurn: false,
      doubleDownArmed: false,
      buzzInsLeft: BALANCE.interrupt.buzzInPerRound,
    };
  }

  /** Keep the bot seats in sync with `settings.botCount` while in the lobby. */
  private syncBots(): void {
    if (this.demo) return;
    const humans = this.players.filter((p) => !p.isBot);
    const want = Math.min(this.settings.botCount, BALANCE.setup.maxPlayers - humans.length);
    const bots: PlayerPublic[] = [];
    for (let i = 0; i < want; i++) {
      const existing = this.players.find((p) => p.id === `bot-${i}`);
      const bot = existing ?? this.makeBot(i);
      bot.botTier = this.settings.botTier;
      bots.push(bot);
    }
    this.players = [...humans, ...bots];
  }

  roomPublic(): RoomPublic {
    return {
      code: this.code,
      status: this.status,
      hostId: this.players.find((p) => p.isHost)?.id ?? this.selfId,
      settings: { ...this.settings },
      players: this.players.map((p) => ({ ...p, handCount: this.hands.get(p.id)?.length ?? p.handCount })),
      roundNumber: this.roundNumber,
      createdAt: Date.now(),
    };
  }

  pushRoom(): void {
    this.emit('room:state', this.roomPublic());
  }

  updateSettings(patch: Partial<RoomSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.syncBots();
    this.pushRoom();
  }

  setSelf(name: string, color: string): void {
    const me = this.players.find((p) => p.id === this.selfId);
    if (me) {
      me.name = name;
      me.color = color;
    }
  }

  // -- board ---------------------------------------------------------------

  board(): MaskedBoard {
    const words = buildWords(this.puzzle.text, this.revealed);
    let total = 0;
    let hidden = 0;
    for (const w of words) {
      for (const c of w) {
        if (c.t !== 'letter') continue;
        total++;
        if (!c.revealed) hidden++;
      }
    }
    return {
      category: this.puzzle.category,
      words,
      guessedLetters: [...this.guessed],
      missedLetters: [...this.missed],
      totalLetters: total,
      hiddenLetters: hidden,
      hint: this.hintShown,
      accessibleText: accessibleBoardText(words),
    };
  }

  round(): RoundPublic {
    return {
      roundNumber: this.roundNumber,
      board: this.board(),
      pressure: this.pressure,
      pressureMax: BALANCE.pressure.max,
      // The mock resolves the optional solve inline, so it is only ever in
      // 'turn' or, while a window is up, 'interrupt'.
      phase: this.status !== 'playing' ? 'ended' : this.openWindowId ? 'interrupt' : 'turn',
      currentPlayerId: this.status === 'playing' ? (this.players[this.turnIdx]?.id ?? null) : null,
      direction: this.direction,
      turnEndsAt: this.turnEndsAt,
      deckRemaining: this.deck.length,
      idleCycles: this.idleCycles,
    };
  }

  private pushBoard(events: GameEvent[]): void {
    this.emit('board:update', { board: this.board(), round: this.round(), events });
    this.pushRoom();
  }

  private pushHand(): void {
    // In demo mode there is no human seat, so show the first bot's hand: the
    // landing page hero wants a fan of real cards under the board.
    const owner = this.demo ? (this.players[0]?.id ?? this.selfId) : this.selfId;
    const cards = this.hands.get(owner) ?? [];
    this.emit('hand:update', { cards: [...cards], peeks: { ...this.peeks } });
  }

  // -- deck ----------------------------------------------------------------

  private buildDeck(): Card[] {
    const size = Math.max(BALANCE.deck.minDeckSize, this.players.length * BALANCE.deck.perPlayer);
    const letterCount = Math.round(size * BALANCE.deck.letterCardShare);
    const puzzleLetters: string[] = [];
    for (const ch of normalizePuzzleText(this.puzzle.text)) if (isLetter(ch)) puzzleLetters.push(ch);
    const inPuzzle = new Set(puzzleLetters);

    const noisePool: { ch: string; w: number }[] = [];
    for (const [ch, freq] of Object.entries(ENGLISH_LETTER_FREQUENCY)) {
      if (BALANCE.deck.rareNoiseExcluded.includes(ch) && !inPuzzle.has(ch)) continue;
      const vowel = (VOWELS as readonly string[]).includes(ch);
      noisePool.push({ ch, w: freq * (vowel ? BALANCE.deck.vowelWeightMultiplier : 1) });
    }

    const cards: Card[] = [];
    const fromPuzzle = Math.round(letterCount * BALANCE.deck.puzzleLetterShare);
    for (let i = 0; i < fromPuzzle; i++) {
      const ch = puzzleLetters[Math.floor(this.rng() * puzzleLetters.length)]!;
      cards.push(this.letterCard(ch));
    }
    for (let i = fromPuzzle; i < letterCount; i++) {
      cards.push(this.letterCard(this.weightedPick(noisePool)));
    }

    const actionEntries = Object.entries(BALANCE.deck.actionWeights)
      .filter(([k]) => this.settings.interruptsEnabled || !ACTION_CARD_META[k as ActionCardKind].interrupt)
      .map(([ch, w]) => ({ ch, w }));
    for (let i = cards.length; i < size; i++) {
      cards.push(this.actionCard(this.weightedPick(actionEntries) as ActionCardKind));
    }

    return this.shuffle(cards);
  }

  private weightedPick(pool: { ch: string; w: number }[]): string {
    const total = pool.reduce((s, p) => s + p.w, 0);
    let r = this.rng() * total;
    for (const p of pool) {
      r -= p.w;
      if (r <= 0) return p.ch;
    }
    return pool[pool.length - 1]?.ch ?? 'E';
  }

  private letterCard(letter: string): LetterCard {
    return { id: `c${++this.cardSeq}`, kind: 'letter', letter };
  }

  private actionCard(action: ActionCardKind): ActionCard {
    return { id: `c${++this.cardSeq}`, kind: 'action', action };
  }

  private shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      const ai = a[i]!;
      a[i] = a[j]!;
      a[j] = ai;
    }
    return a;
  }

  /**
   * Mirrors the engine's rule: never deal a letter the player already holds, or
   * one already played this round. A duplicate is dead weight — a hit reveals
   * every occurrence at once, so the second copy can never score — and the deck
   * is built from the puzzle's letter multiset, which makes duplicates common
   * rather than rare.
   *
   * The mock has to match, not just the engine: it drives the landing page demo
   * and local development, so a hand of two L's here reads as a real bug.
   */
  private draw(playerId: string, n: number): number {
    const hand = this.hands.get(playerId) ?? [];
    let drawn = 0;
    while (drawn < n && hand.length < BALANCE.setup.handCap) {
      const dead = new Set<string>([...this.revealed, ...this.missed]);
      for (const c of hand) if (c.kind === 'letter') dead.add(c.letter);

      // Prefer a usable card; fall back to the top so a hand can always fill.
      let idx = this.deck.length - 1;
      for (let j = this.deck.length - 1; j >= 0; j--) {
        const c = this.deck[j]!;
        if (c.kind !== 'letter' || !dead.has(c.letter)) {
          idx = j;
          break;
        }
      }
      const card = this.deck.splice(idx, 1)[0];
      if (!card) break;
      hand.push(card);
      drawn++;
    }
    this.hands.set(playerId, hand);
    return drawn;
  }

  private drawToMinimum(playerId: string): number {
    const hand = this.hands.get(playerId) ?? [];
    return this.draw(playerId, Math.max(0, BALANCE.setup.handMinimum - hand.length));
  }

  // -- round flow ----------------------------------------------------------

  startMatch(): void {
    this.roundNumber = 0;
    for (const p of this.players) {
      p.score = 0;
      p.roundScore = 0;
    }
    this.startRound(true);
  }

  private startRound(first = false): void {
    this.puzzleIdx = (this.puzzleIdx + 1) % MOCK_PUZZLES.length;
    this.puzzle = MOCK_PUZZLES[this.puzzleIdx]!;
    this.roundNumber += 1;
    this.revealed = new Set();
    this.guessed = [];
    this.missed = [];
    this.hintShown = null;
    this.pressure = BALANCE.pressure.start;
    this.direction = 1;
    this.idleCycles = 0;
    this.revealsThisCycle = 0;
    this.turnsThisCycle = 0;
    this.skipNext = false;
    this.peeks = {};
    this.status = 'playing';
    this.deck = this.buildDeck();
    this.hands.clear();

    for (const p of this.players) {
      p.roundScore = 0;
      p.solveLocked = false;
      p.lockedNextTurn = false;
      p.doubleDownArmed = false;
      p.buzzInsLeft = BALANCE.interrupt.buzzInPerRound;
      this.hands.set(p.id, []);
      this.draw(p.id, BALANCE.setup.startingHand);
    }

    // The demo hero starts mid-puzzle — §9 wants a board already in progress.
    if (this.demo) {
      const distinct = [...new Set(normalizePuzzleText(this.puzzle.text).split('').filter(isLetter))];
      const seed = this.shuffle(distinct).slice(0, Math.max(1, Math.floor(distinct.length * 0.3)));
      for (const ch of seed) {
        this.revealed.add(ch);
        this.guessed.push(ch);
      }
      this.pressure = 2 + Math.floor(this.rng() * 3);
    }

    this.turnIdx = Math.floor(this.rng() * this.players.length);
    this.emit('game:started', { round: this.round(), board: this.board() });
    this.pushRoom();
    this.pushHand();
    this.pushBoard([
      { t: 'round:start', roundNumber: this.roundNumber, category: this.puzzle.category, deckSize: this.deck.length },
    ]);
    this.later(() => this.beginTurn(), first ? 700 : 500);
  }

  private beginTurn(): void {
    if (this.status !== 'playing') return;
    const player = this.players[this.turnIdx];
    if (!player) return;

    if (this.skipNext) {
      this.skipNext = false;
      this.pushBoard([{ t: 'notice', message: `${player.name} loses a turn.` }]);
      this.advance();
      this.later(() => this.beginTurn(), 500);
      return;
    }

    this.acting = false;
    const secs = this.settings.turnSeconds;
    this.turnEndsAt = secs === null ? null : Date.now() + secs * 1000;
    this.emit('turn:begin', { playerId: player.id, endsAt: this.turnEndsAt, roundNumber: this.roundNumber });
    this.pushBoard([{ t: 'turn:begin', playerId: player.id, endsAt: this.turnEndsAt }]);

    if (this.turnEndsAt !== null) this.tickTimer(player.id, this.turnEndsAt);

    if (player.isBot) {
      const tier = BALANCE.bots.tiers[this.settings.botTier];
      const think = tier.thinkMsMin + this.rng() * (tier.thinkMsMax - tier.thinkMsMin);
      this.later(() => this.botTurn(player.id), think);
    } else if (this.turnEndsAt !== null) {
      this.later(() => {
        if (this.acting || this.status !== 'playing') return;
        if (this.players[this.turnIdx]?.id !== player.id) return;
        this.autoPlay(player.id);
      }, (this.settings.turnSeconds ?? 15) * 1000);
    }
  }

  private tickTimer(playerId: string, endsAt: number): void {
    if (this.status !== 'playing') return;
    if (this.players[this.turnIdx]?.id !== playerId) return;
    const remaining = endsAt - Date.now();
    this.emit('turn:timer', { playerId, remainingMs: Math.max(0, remaining) });
    if (remaining > 0) this.later(() => this.tickTimer(playerId, endsAt), 500);
  }

  private advance(): void {
    this.turnsThisCycle += 1;
    if (this.turnsThisCycle >= this.players.length) {
      this.turnsThisCycle = 0;
      if (this.revealsThisCycle === 0) this.idleCycles += 1;
      else this.idleCycles = 0;
      this.revealsThisCycle = 0;
    }
    const n = this.players.length;
    this.turnIdx = (this.turnIdx + this.direction + n * 2) % n;
  }

  private endTurn(extra: GameEvent[] = []): void {
    if (this.status !== 'playing') return;
    const player = this.players[this.turnIdx];
    const events = [...extra];
    if (player) {
      const drew = this.drawToMinimum(player.id);
      if (drew > 0) events.push({ t: 'draw', playerId: player.id, count: drew });
      if (player.lockedNextTurn) player.lockedNextTurn = false;
    }

    // §3.6 anti-stall: "the board breathes".
    if (this.idleCycles >= BALANCE.antiStall.idleCyclesBeforeBreath) {
      this.idleCycles = 0;
      const breath = this.breathe();
      if (breath) events.push(breath);
    }

    this.pushBoard(events);
    this.pushHand();
    if (this.checkRoundOver(player?.id ?? null)) return;

    this.advance();
    this.later(() => this.beginTurn(), 450);
  }

  private breathe(): GameEvent | null {
    const hidden = [...new Set(normalizePuzzleText(this.puzzle.text).split('').filter(isLetter))].filter(
      (ch) => !this.revealed.has(ch),
    );
    if (hidden.length === 0) return null;
    const ch = hidden[Math.floor(this.rng() * hidden.length)]!;
    this.revealed.add(ch);
    this.guessed.push(ch);
    this.revealsThisCycle += 1;
    return { t: 'breath', letter: ch, positions: positionsOf(this.puzzle.text, ch) };
  }

  private checkRoundOver(actorId: string | null): boolean {
    if (this.pressure >= BALANCE.pressure.max) {
      this.finishRound('blowout', null, actorId);
      return true;
    }
    if (this.board().hiddenLetters === 0) {
      this.finishRound('solved', actorId, null);
      return true;
    }
    if (this.deck.length === 0 && [...this.hands.values()].every((h) => h.length === 0)) {
      this.finishRound('deck-exhausted', null, null);
      return true;
    }
    return false;
  }

  private finishRound(reason: RoundResult['reason'], solvedBy: string | null, blownBy: string | null): void {
    this.status = 'round-end';
    this.turnEndsAt = null;

    if (reason === 'blowout' && blownBy) {
      const p = this.players.find((x) => x.id === blownBy);
      if (p) p.roundScore += BALANCE.scoring.blowoutPenalty;
    }

    // Reveal everything once the round is over — safe now, and only now.
    for (const ch of normalizePuzzleText(this.puzzle.text)) if (isLetter(ch)) this.revealed.add(ch);

    const roundScores: Record<string, number> = {};
    const totals: Record<string, number> = {};
    for (const p of this.players) {
      p.score += p.roundScore;
      roundScores[p.id] = p.roundScore;
      totals[p.id] = p.score;
    }

    const result: RoundResult = {
      roundNumber: this.roundNumber,
      reason,
      solvedBy,
      blownBy,
      answer: this.puzzle.text,
      category: this.puzzle.category,
      hint: this.puzzle.hint,
      roundScores,
      totals,
    };

    this.pushBoard([{ t: 'round:end', result }]);
    this.emit('round:end', result);
    this.pushRoom();

    const matchOver =
      !this.demo &&
      (this.settings.matchMode === 'rounds'
        ? this.roundNumber >= this.settings.rounds
        : this.players.some((p) => p.score >= this.settings.targetScore));

    if (matchOver) {
      this.later(() => this.finishMatch(), 4500);
    } else {
      this.later(() => this.startRound(), this.demo ? 3400 : 7000);
    }
  }

  private finishMatch(): void {
    this.status = 'match-end';
    const best = Math.max(...this.players.map((p) => p.score));
    const totals: Record<string, number> = {};
    for (const p of this.players) totals[p.id] = p.score;
    const result: MatchResult = {
      winnerIds: this.players.filter((p) => p.score === best).map((p) => p.id),
      totals,
      roundsPlayed: this.roundNumber,
      sessionId: `mock-${this.code}`,
    };
    this.emit('match:end', result);
    this.pushBoard([{ t: 'match:end', result }]);
    this.pushRoom();
  }

  /** Host asked to continue — either start the match or advance past a round end. */
  continueMatch(): void {
    if (this.status === 'lobby') this.startMatch();
    else if (this.status === 'round-end') this.startRound();
    else if (this.status === 'match-end') this.startMatch();
  }

  // -- actions -------------------------------------------------------------

  private takeCard(playerId: string, cardId: string): Card | null {
    const hand = this.hands.get(playerId);
    if (!hand) return null;
    const i = hand.findIndex((c) => c.id === cardId);
    if (i < 0) return null;
    const [card] = hand.splice(i, 1);
    return card ?? null;
  }

  playCard(playerId: string, cardId: string, letter?: string, targetPlayerId?: string): string | null {
    if (this.status !== 'playing') return 'ROUND_NOT_ACTIVE';
    if (this.players[this.turnIdx]?.id !== playerId) return 'NOT_YOUR_TURN';
    if (this.acting) return 'ALREADY_ACTED';
    const hand = this.hands.get(playerId) ?? [];
    const card = hand.find((c) => c.id === cardId);
    if (!card) return 'CARD_NOT_IN_HAND';

    if (card.kind === 'letter') {
      if (this.guessed.includes(card.letter)) return 'LETTER_ALREADY_GUESSED';
      this.acting = true;
      this.takeCard(playerId, cardId);
      this.resolveLetter(playerId, card, card.letter);
      return null;
    }

    if (card.action === 'WILD') {
      if (!letter || !isLetter(letter)) return 'LETTER_REQUIRED';
      if (this.guessed.includes(letter)) return 'LETTER_ALREADY_GUESSED';
      this.acting = true;
      this.takeCard(playerId, cardId);
      this.resolveLetter(playerId, card, letter);
      return null;
    }

    if (ACTION_CARD_META[card.action].targets && !targetPlayerId) return 'TARGET_REQUIRED';
    this.acting = true;
    this.takeCard(playerId, cardId);
    this.resolveAction(playerId, card, letter, targetPlayerId);
    return null;
  }

  private resolveLetter(playerId: string, card: Card, letter: string): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;
    const events: GameEvent[] = [{ t: 'card:played', playerId, card, letter }];
    const positions = positionsOf(this.puzzle.text, letter);
    this.guessed.push(letter);
    const dd = player.doubleDownArmed;
    player.doubleDownArmed = false;

    if (positions.length > 0) {
      this.revealed.add(letter);
      this.revealsThisCycle += 1;
      const points =
        BALANCE.scoring.perRevealedLetter * positions.length * (dd ? BALANCE.scoring.doubleDownMultiplier : 1);
      player.roundScore += points;
      events.push({ t: 'letter:hit', playerId, letter, occurrences: positions.length, points, positions });
      this.endTurnWithMaybeInterrupt(playerId, events, points);
      return;
    }

    this.missed.push(letter);
    const delta = BALANCE.pressure.wrongLetter * (dd ? BALANCE.pressure.doubleDownMissMultiplier : 1);
    events.push({ t: 'letter:miss', playerId, letter, pressureDelta: delta });
    this.addPressure(delta, `${player.name} missed ${letter}`, playerId, events);
    this.endTurn(events);
  }

  /** A hit opens the 4-second SWIPE window (§3.5) when interrupts are on. */
  private endTurnWithMaybeInterrupt(playerId: string, events: GameEvent[], points: number): void {
    const canSwipe =
      this.settings.interruptsEnabled &&
      !this.demo &&
      playerId !== this.selfId &&
      (this.hands.get(this.selfId) ?? []).some((c) => c.kind === 'action' && c.action === 'SWIPE');

    if (!canSwipe) {
      this.endTurn(events);
      return;
    }

    const windowId = `w${Date.now()}`;
    this.openWindowId = windowId;
    const expiresAt = Date.now() + BALANCE.interrupt.windowMs;
    events.push({ t: 'interrupt:open', windowId, kind: 'hit', sourcePlayerId: playerId, expiresAt });
    this.pushBoard(events);
    this.emit('interrupt:window', {
      windowId,
      kind: 'hit',
      sourcePlayerId: playerId,
      expiresAt,
      playableCardIds: (this.hands.get(this.selfId) ?? [])
        .filter((c) => c.kind === 'action' && c.action === 'SWIPE')
        .map((c) => c.id),
    });
    this.pendingSwipe = { fromPlayerId: playerId, points };
    this.later(() => {
      if (this.openWindowId !== windowId) return;
      this.closeWindow(windowId);
      this.endTurn([]);
    }, BALANCE.interrupt.windowMs);
  }

  private pendingSwipe: { fromPlayerId: string; points: number } | null = null;

  private closeWindow(windowId: string): void {
    this.openWindowId = null;
    this.pendingSwipe = null;
    this.emit('interrupt:closed', { windowId });
  }

  /**
   * Decline an open window. Mirrors the server: the window closes immediately
   * rather than idling out its full 4s, and the turn moves on.
   */
  declineInterrupt(_playerId: string, windowId: string): string | null {
    if (this.openWindowId !== windowId) return null;
    this.closeWindow(windowId);
    this.endTurn([]);
    return null;
  }

  /**
   * The mock resolves the optional solve inline rather than modelling a
   * separate awaiting-solve beat, so declining it is already the default and
   * this is a no-op. It exists so the mock answers the same protocol surface
   * the real server does.
   */
  passTurn(_playerId: string): string | null {
    return null;
  }

  playInterrupt(playerId: string, cardId: string, windowId: string): string | null {
    if (this.openWindowId !== windowId) return 'NO_INTERRUPT_WINDOW';
    const hand = this.hands.get(playerId) ?? [];
    const card = hand.find((c) => c.id === cardId);
    if (!card || card.kind !== 'action') return 'CARD_NOT_IN_HAND';
    if (card.action !== 'SWIPE') return 'INTERRUPT_NOT_ALLOWED';
    const swipe = this.pendingSwipe;
    if (!swipe) return 'NO_INTERRUPT_WINDOW';

    this.takeCard(playerId, cardId);
    const thief = this.players.find((p) => p.id === playerId);
    const victim = this.players.find((p) => p.id === swipe.fromPlayerId);
    if (thief && victim) {
      victim.roundScore -= swipe.points;
      thief.roundScore += swipe.points;
    }
    const events: GameEvent[] = [
      { t: 'swipe', playerId, fromPlayerId: swipe.fromPlayerId, points: swipe.points },
      { t: 'interrupt:close', windowId },
    ];
    this.closeWindow(windowId);
    this.pushHand();
    this.endTurn(events);
    return null;
  }

  private resolveAction(playerId: string, card: ActionCard, letter?: string, targetPlayerId?: string): void {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return;
    const events: GameEvent[] = [{ t: 'card:played', playerId, card, letter, targetPlayerId }];
    const kind = card.action as TurnActionKind;

    switch (kind) {
      case 'SKIP': {
        this.skipNext = true;
        const n = this.players.length;
        const next = this.players[(this.turnIdx + this.direction + n * 2) % n];
        events.push({ t: 'skip', playerId, skippedPlayerId: next?.id ?? '' });
        break;
      }
      case 'REVERSE': {
        if (this.players.length === 2) this.skipNext = true;
        else this.direction = (this.direction * -1) as 1 | -1;
        events.push({ t: 'reverse', playerId, direction: this.direction });
        break;
      }
      case 'DOUBLE_DOWN': {
        player.doubleDownArmed = true;
        events.push({ t: 'notice', message: `${player.name} doubles down.` });
        break;
      }
      case 'VOWEL_RUSH': {
        const vowel = letter && (VOWELS as readonly string[]).includes(letter) ? letter : this.bestVowel();
        const positions = positionsOf(this.puzzle.text, vowel);
        this.guessed.push(vowel);
        if (positions.length) {
          this.revealed.add(vowel);
          this.revealsThisCycle += 1;
        } else this.missed.push(vowel);
        events.push({ t: 'reveal', letters: [vowel], positions, reason: 'vowel-rush' });
        this.addPressure(BALANCE.pressure.vowelRush, `${player.name} rushed ${vowel}`, playerId, events);
        break;
      }
      case 'SHUFFLE': {
        const order = this.players.map((p) => p.id);
        const hands = order.map((id) => this.hands.get(id) ?? []);
        order.forEach((id, i) => {
          const from = hands[(i - this.direction + order.length * 2) % order.length] ?? [];
          this.hands.set(id, from);
        });
        events.push({ t: 'shuffle', order });
        break;
      }
      case 'PEEK': {
        const hiddenIdx = this.hiddenTileIndexes();
        const idx = hiddenIdx[Math.floor(this.rng() * hiddenIdx.length)];
        if (idx !== undefined) {
          const ch = this.charAtIndex(idx);
          if (playerId === this.selfId && ch) this.peeks[idx] = ch;
          events.push({ t: 'peek', playerId, index: idx, letter: playerId === this.selfId ? (ch ?? '') : '' });
        }
        break;
      }
      case 'CRACK': {
        this.hintShown = this.puzzle.hint;
        events.push({ t: 'crack', playerId, hint: this.puzzle.hint });
        break;
      }
      case 'RELIEF_VALVE': {
        this.addPressure(BALANCE.pressure.reliefValve, `${player.name} vented the bottle`, playerId, events);
        break;
      }
      case 'VANDAL': {
        const drew = this.draw(playerId, 2);
        events.push({ t: 'draw', playerId, count: drew });
        this.addPressure(BALANCE.pressure.vandal, `${player.name} shook the bottle`, playerId, events);
        break;
      }
      case 'LOCKOUT': {
        const target = this.players.find((p) => p.id === targetPlayerId);
        if (target) {
          target.lockedNextTurn = true;
          events.push({ t: 'lockout', playerId, targetPlayerId: target.id });
        }
        break;
      }
      case 'WILD':
        break;
    }

    this.endTurn(events);
  }

  private hiddenTileIndexes(): number[] {
    const out: number[] = [];
    let i = 0;
    for (const ch of normalizePuzzleText(this.puzzle.text)) {
      if (ch === ' ') continue;
      if (isLetter(ch) && !this.revealed.has(ch)) out.push(i);
      i++;
    }
    return out;
  }

  private charAtIndex(index: number): string | null {
    let i = 0;
    for (const ch of normalizePuzzleText(this.puzzle.text)) {
      if (ch === ' ') continue;
      if (i === index) return ch;
      i++;
    }
    return null;
  }

  private bestVowel(): string {
    const unguessed = VOWELS.filter((v) => !this.guessed.includes(v));
    return unguessed[Math.floor(this.rng() * unguessed.length)] ?? 'E';
  }

  private addPressure(delta: number, cause: string, byPlayerId: string | null, events: GameEvent[]): void {
    const next = Math.max(0, Math.min(BALANCE.pressure.max, this.pressure + delta));
    const applied = next - this.pressure;
    this.pressure = next;
    events.push({ t: 'pressure', value: this.pressure, delta: applied, cause, byPlayerId });
    this.emit('pressure:update', {
      value: this.pressure,
      delta: applied,
      max: BALANCE.pressure.max,
      cause,
      byPlayerId,
    });
    if (this.pressure >= BALANCE.pressure.max) {
      events.push({ t: 'blowout', byPlayerId, penalty: BALANCE.scoring.blowoutPenalty });
    }
  }

  discard(playerId: string, cardIds: string[]): string | null {
    if (this.status !== 'playing') return 'ROUND_NOT_ACTIVE';
    if (this.players[this.turnIdx]?.id !== playerId) return 'NOT_YOUR_TURN';
    if (cardIds.length < BALANCE.turn.minDiscard || cardIds.length > BALANCE.turn.maxDiscard) return 'INVALID_DISCARD';
    this.acting = true;
    let n = 0;
    for (const id of cardIds) if (this.takeCard(playerId, id)) n++;
    this.endTurn([{ t: 'discard', playerId, count: n }]);
    return null;
  }

  solve(playerId: string, guess: string): string | null {
    if (this.status !== 'playing') return 'ROUND_NOT_ACTIVE';
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return 'NOT_YOUR_TURN';
    if (player.solveLocked || player.lockedNextTurn) return 'SOLVE_LOCKED';

    const correct = guessMatches(guess, this.puzzle.text);
    const events: GameEvent[] = [{ t: 'solve:attempt', playerId, correct }];

    if (correct) {
      const hidden = this.board().hiddenLetters;
      const points = BALANCE.scoring.solveBase + BALANCE.scoring.solveHiddenBonus * hidden;
      player.roundScore += points;
      events.push({ t: 'solve:success', playerId, points, hiddenAtSolve: hidden });
      for (const ch of normalizePuzzleText(this.puzzle.text)) if (isLetter(ch)) this.revealed.add(ch);
      this.pushBoard(events);
      this.later(() => this.finishRound('solved', playerId, null), 900);
      return null;
    }

    player.solveLocked = true;
    events.push({ t: 'solve:fail', playerId, pressureDelta: BALANCE.pressure.wrongSolve });
    this.addPressure(BALANCE.pressure.wrongSolve, `${player.name} guessed wrong`, playerId, events);
    this.pushBoard(events);
    this.pushRoom();
    if (this.checkRoundOver(playerId)) return null;
    return null;
  }

  // -- bots ----------------------------------------------------------------

  private botTurn(playerId: string): void {
    if (this.status !== 'playing') return;
    if (this.players[this.turnIdx]?.id !== playerId) return;
    const player = this.players.find((p) => p.id === playerId);
    const hand = this.hands.get(playerId) ?? [];
    if (!player) return;

    const tier = BALANCE.bots.tiers[this.settings.botTier];
    const hidden = this.board().hiddenLetters;

    // Solve gamble: only when the board is meaningfully open, so the demo shows
    // real reveals rather than instant solves.
    if (!player.solveLocked && hidden > 0 && hidden <= 3 && this.rng() < tier.solveRoll) {
      this.solve(playerId, this.puzzle.text);
      return;
    }

    const letters = hand.filter((c): c is LetterCard => c.kind === 'letter' && !this.guessed.includes(c.letter));
    const actions = hand.filter(
      (c): c is ActionCard => c.kind === 'action' && !ACTION_CARD_META[c.action].interrupt && c.action !== 'WILD',
    );

    if (letters.length > 0 && (actions.length === 0 || this.rng() > tier.actionCardBias)) {
      let best = letters[0]!;
      let bestScore = -Infinity;
      for (const c of letters) {
        const score = (ENGLISH_LETTER_FREQUENCY[c.letter] ?? 1) + this.rng() * tier.scoreNoise * 12;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      this.playCard(playerId, best.id);
      return;
    }

    if (actions.length > 0) {
      const pick = actions[Math.floor(this.rng() * actions.length)]!;
      const target = this.players.find((p) => p.id !== playerId);
      this.playCard(playerId, pick.id, this.bestVowel(), target?.id);
      return;
    }

    const toss = hand.slice(0, Math.min(BALANCE.turn.maxDiscard, hand.length)).map((c) => c.id);
    if (toss.length > 0) this.discard(playerId, toss);
    else this.endTurn([{ t: 'notice', message: `${player.name} has nothing to play.` }]);
  }

  /** Turn timer expiry: play the statistically-best letter, else discard (§3.3). */
  private autoPlay(playerId: string): void {
    const hand = this.hands.get(playerId) ?? [];
    const letters = hand.filter((c): c is LetterCard => c.kind === 'letter' && !this.guessed.includes(c.letter));
    if (letters.length > 0) {
      const best = letters.reduce((a, b) =>
        (ENGLISH_LETTER_FREQUENCY[a.letter] ?? 0) >= (ENGLISH_LETTER_FREQUENCY[b.letter] ?? 0) ? a : b,
      );
      this.playCard(playerId, best.id);
      return;
    }
    if (hand.length > 0) this.discard(playerId, [hand[0]!.id]);
  }
}

/** Exposed for the interactive mock so the UI can name what it is talking to. */
export const MOCK_TURN_ACTIONS = TURN_ACTION_KINDS;
