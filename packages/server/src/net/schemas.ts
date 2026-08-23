/**
 * Input validation. Every client→server payload is hostile until proven
 * otherwise: it arrives over a public websocket with no authentication of any
 * kind (§7 — no accounts, by design).
 *
 * Each schema is deliberately narrow. Strings are length-capped and
 * character-class-restricted, arrays are bounded, and nothing is passed through
 * unparsed — the engine receives only values that already type-check.
 */
import { z } from 'zod';
import { AVATAR_COLORS, ROOM_CODE_PATTERN, TURN_ACTION_KINDS } from '@phrasey/shared';

export const MAX_NAME_LENGTH = 20;
export const MAX_GUESS_LENGTH = 80;

/**
 * Display names are session-scoped and thrown away (§7), so the only job here
 * is to keep control characters and 4KB of zalgo out of other people's screens.
 */
export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_NAME_LENGTH)
  // Printable ASCII only. A party game read over Zoom does not need astral
  // planes, and it removes RTL-override and zero-width shenanigans wholesale.
  .regex(/^[ -~]+$/, 'name must be printable ASCII')
  .transform((s) => s.replace(/\s+/g, ' '));

/** Only the offered palette (§7, §9). Free-form CSS would be an injection seam. */
export const colorSchema = z.enum(AVATAR_COLORS as unknown as [string, ...string[]]).catch(AVATAR_COLORS[0]);

export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ROOM_CODE_PATTERN, 'not a room code');

const cardIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9:_-]+$/);
const playerIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9:_-]+$/);
const letterSchema = z.string().length(1).regex(/^[A-Z]$/);

export const settingsSchema = z
  .object({
    matchMode: z.enum(['rounds', 'score']),
    rounds: z.number().int().min(1).max(50),
    targetScore: z.number().int().min(10).max(10000),
    turnSeconds: z.union([z.literal(10), z.literal(15), z.literal(25), z.null()]),
    botCount: z.number().int().min(0).max(7),
    botTier: z.enum(['chill', 'sharp', 'ruthless']),
    interruptsEnabled: z.boolean(),
  })
  .partial();

export const createRoomSchema = z.object({
  name: nameSchema,
  color: colorSchema,
  settings: settingsSchema.optional(),
});

export const joinRoomSchema = z.object({
  code: codeSchema,
  name: nameSchema,
  color: colorSchema,
  sessionToken: z.string().min(8).max(200).regex(/^[A-Za-z0-9._-]+$/).optional(),
});

export const startGameSchema = z.object({ settings: settingsSchema.optional() }).default({});

export const playCardSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('letter'), cardId: cardIdSchema }),
  z.object({
    type: z.literal('action'),
    cardId: cardIdSchema,
    letter: letterSchema.optional(),
    targetPlayerId: playerIdSchema.optional(),
  }),
]);

export const discardSchema = z.object({
  // The engine enforces balance.turn.min/maxDiscard; this is only a sanity cap
  // so a 10,000-element array never reaches it.
  cardIds: z.array(cardIdSchema).min(1).max(8),
});

export const solveSchema = z.object({
  // Declining to solve is `turn:pass`, a distinct event. A blank guess here is
  // a real (losing) attempt, not a pass — conflating them made a mis-click
  // indistinguishable from a deliberate decline.
  guess: z.string().min(1).max(MAX_GUESS_LENGTH),
});

export const interruptSchema = z.object({
  cardId: z.string().min(1).max(64).regex(/^[A-Za-z0-9:_-]+$/),
  windowId: z.string().min(1).max(64).regex(/^[A-Za-z0-9:_-]+$/),
});

/** Declining an open window, so an uncontested one need not burn its full 4s. */
export const interruptPassSchema = z.object({
  windowId: z.string().min(1).max(64).regex(/^[A-Za-z0-9:_-]+$/),
});

/** A short allowlist. Free-form text would be an unmoderated chat channel (§12). */
export const EMOTES = ['👏', '😂', '😮', '🔥', '💀', '🧊', '🥤', '❓'] as const;
export const emoteSchema = z.object({ emote: z.enum(EMOTES) });

export const settingsEventSchema = z.object({ settings: settingsSchema });

/** Action kinds a client may name. Interrupt kinds are excluded on purpose. */
export const TURN_KINDS = new Set<string>(TURN_ACTION_KINDS);
