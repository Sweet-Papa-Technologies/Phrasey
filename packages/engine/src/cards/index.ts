/**
 * Action-card registry (§3.5). One module per effect so each is individually
 * testable; this file is only the lookup table.
 */
import type { InterruptActionKind, TurnActionKind } from '@phrasey/shared';
import { applyCrack } from './crack.js';
import { applyDoubleDown } from './doubleDown.js';
import { applyLockout } from './lockout.js';
import { applyPeek } from './peek.js';
import { applyReliefValve } from './reliefValve.js';
import { applyReverse } from './reverse.js';
import { applyShuffle } from './shuffle.js';
import { applySkip } from './skip.js';
import { applyVandal } from './vandal.js';
import { applyVowelRush } from './vowelRush.js';
import { applyWild } from './wild.js';
import { playBlock } from './block.js';
import { playBuzzIn } from './buzzIn.js';
import { playSwipe } from './swipe.js';
import type { CardEffect } from './types.js';
import type { InterruptContext, InterruptOutcome } from './interruptTypes.js';

export const TURN_CARD_EFFECTS: Record<TurnActionKind, CardEffect> = {
  SKIP: applySkip,
  REVERSE: applyReverse,
  DOUBLE_DOWN: applyDoubleDown,
  VOWEL_RUSH: applyVowelRush,
  SHUFFLE: applyShuffle,
  PEEK: applyPeek,
  CRACK: applyCrack,
  RELIEF_VALVE: applyReliefValve,
  VANDAL: applyVandal,
  WILD: applyWild,
  LOCKOUT: applyLockout,
};

export const INTERRUPT_CARD_EFFECTS: Record<InterruptActionKind, (ctx: InterruptContext) => InterruptOutcome> = {
  SWIPE: playSwipe,
  BLOCK: playBlock,
  BUZZ_IN: playBuzzIn,
};

export * from './types.js';
export * from './interruptTypes.js';
export {
  applyCrack, applyDoubleDown, applyLockout, applyPeek, applyReliefValve, applyReverse,
  applyShuffle, applySkip, applyVandal, applyVowelRush, applyWild, playBlock, playBuzzIn, playSwipe,
};
