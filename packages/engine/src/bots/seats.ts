/**
 * Bot identity and pacing — the two things the server's bot driver needs that
 * are not the policy itself.
 *
 * §5: "Bots must have a visible thinking delay. Instant bot moves read as
 * cheating even when they aren't." The engine cannot sleep (it has no clock),
 * so it hands the driver a duration and the driver owns the timer.
 */
import type { Balance, BotTier, BotPersona } from '@phrasey/shared';
import { defaultBalance, pickPersonas } from '@phrasey/shared';
import type { Rng } from '../rng.js';
import type { NewPlayer } from '../state.js';

export interface ThinkRange {
  minMs: number;
  maxMs: number;
}

/** The tier's think-delay window, straight out of balance (§5, never baked in). */
export function botThinkRange(tier: BotTier, balance: Balance = defaultBalance()): ThinkRange {
  const cfg = balance.bots.tiers[tier];
  const minMs = Math.max(0, cfg.thinkMsMin);
  const maxMs = Math.max(minMs, cfg.thinkMsMax);
  return { minMs, maxMs };
}

/**
 * A think delay in milliseconds. Seeded, like everything else — replaying a
 * match reproduces the pauses too, which makes a "the bot moved too fast" bug
 * reproducible instead of anecdotal.
 */
export function botThinkDelayMs(tier: BotTier, balance: Balance, rng: Rng): number {
  const { minMs, maxMs } = botThinkRange(tier, balance);
  return Math.round(minMs + rng.next() * (maxMs - minMs));
}

export interface BotSeat extends NewPlayer {
  isBot: true;
  botTier: BotTier;
  botPersona: string;
  persona: BotPersona;
}

export interface BotSeatOptions {
  /** Names already in use at the table, lowercased. */
  taken?: ReadonlySet<string>;
  /** Prefix for generated seat ids. Defaults to 'bot'. */
  idPrefix?: string;
}

/**
 * §5: "Give bots names and a one-line personality shown on hover." Personas
 * come from @phrasey/shared so the client, the server and the sim all agree on
 * who Fizz is. The persona is flavor — it never touches how the bot plays.
 */
export function createBotSeats(count: number, tier: BotTier, opts: BotSeatOptions = {}): BotSeat[] {
  const prefix = opts.idPrefix ?? 'bot';
  const picked = pickPersonas(count, tier, opts.taken ?? new Set());
  const seats: BotSeat[] = [];
  for (let i = 0; i < count; i++) {
    const persona: BotPersona = picked[i] ?? {
      id: `bot-${i + 1}`,
      name: `Bot ${i + 1}`,
      persona: 'Plays the odds and nothing else.',
      flavorTier: tier,
      color: '#EAF4F7',
    };
    seats.push({
      id: `${prefix}-${persona.id}`,
      name: persona.name,
      color: persona.color,
      isBot: true,
      botTier: tier,
      botPersona: persona.persona,
      persona,
    });
  }
  return seats;
}
