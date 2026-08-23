/**
 * Bot identities (design doc §5): "Give bots names and a one-line personality
 * shown on hover. Cheap, big payoff for single-player feel."
 *
 * Names are soda-fountain adjacent without being cute about it. The persona
 * line is flavor only — it must never change how a bot actually plays, which is
 * governed entirely by its tier config in balance.ts.
 */
import type { BotTier } from './balance.js';

export interface BotPersona {
  id: string;
  name: string;
  /** One line, shown on hover. */
  persona: string;
  /** The tier this persona reads as. Used only to pick a fitting name. */
  flavorTier: BotTier;
  color: string;
}

export const BOT_PERSONAS: BotPersona[] = [
  { id: 'slush', name: 'Slush', persona: 'Here for the vibes. Has never once counted a vowel.', flavorTier: 'chill', color: '#00C2FF' },
  { id: 'fizz', name: 'Fizz', persona: 'Plays fast, apologizes later, never learns.', flavorTier: 'chill', color: '#FF8AD8' },
  { id: 'straw', name: 'Straw', persona: 'Chews on the problem. Chews on everything, really.', flavorTier: 'chill', color: '#22D3A0' },
  { id: 'cap', name: 'Cap', persona: 'Reads the board twice before touching a card.', flavorTier: 'sharp', color: '#FF5C1A' },
  { id: 'nickel', name: 'Nickel', persona: 'Counts the letters. Counts your letters too.', flavorTier: 'sharp', color: '#FFC93C' },
  { id: 'lime', name: 'Lime', persona: 'Sharp, a little sour, weirdly good at idioms.', flavorTier: 'sharp', color: '#B8FF3C' },
  { id: 'brisk', name: 'Brisk', persona: 'Solves early and gambles on the hidden-letter bonus.', flavorTier: 'ruthless', color: '#6C3BFF' },
  { id: 'cherry', name: 'Cherry', persona: 'Will absolutely blow the gauge if it means you lose too.', flavorTier: 'ruthless', color: '#FF2E63' },
  { id: 'freon', name: 'Freon', persona: 'Cold. Patient. Holding a Block and waiting for you.', flavorTier: 'ruthless', color: '#EAF4F7' },
  { id: 'dregs', name: 'Dregs', persona: 'What is left at the bottom. Somehow still winning.', flavorTier: 'ruthless', color: '#14121F' },
];

/**
 * Pick `count` distinct personas for a room, preferring ones whose flavor
 * matches the requested tier, then filling from the rest. `taken` excludes
 * names already in use (including by dropped humans whose seat became a bot).
 */
export function pickPersonas(count: number, tier: BotTier, taken: ReadonlySet<string> = new Set()): BotPersona[] {
  const available = BOT_PERSONAS.filter((p) => !taken.has(p.name.toLowerCase()));
  const onTier = available.filter((p) => p.flavorTier === tier);
  const rest = available.filter((p) => p.flavorTier !== tier);
  return [...onTier, ...rest].slice(0, count);
}
