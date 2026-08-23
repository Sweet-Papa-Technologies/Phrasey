/**
 * Keyboard-first play (§10).
 *
 *   - typing a letter plays that card if you hold it
 *   - Enter opens the solve box
 *   - Escape cancels
 *
 * The decision itself lives in `lib/keyboard.ts`; this hook only owns the
 * listener and the "am I typing into a field" guard.
 */
import { useEffect } from 'react';
import type { Card, LetterCard } from '@phrasey/shared';
import { isTypingTarget, resolveLetterKey, type KeyResolution } from '../lib/keyboard';

export interface UseKeyboardPlayOptions {
  enabled: boolean;
  hand: Card[];
  guessed: string[];
  onPlay: (card: LetterCard) => void;
  onOpenSolve: () => void;
  onCancel: () => void;
  /** Called for a keystroke that maps to a letter but cannot be played. */
  onBlocked?: (result: Extract<KeyResolution, { kind: 'blocked' }>) => void;
}

export function useKeyboardPlay({
  enabled,
  hand,
  guessed,
  onPlay,
  onOpenSolve,
  onCancel,
  onBlocked,
}: UseKeyboardPlayOptions): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }
      if (isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Enter') {
        e.preventDefault();
        onOpenSolve();
        return;
      }
      if (!enabled) return;

      const result = resolveLetterKey(e.key, hand, guessed);
      if (result.kind === 'play') {
        e.preventDefault();
        onPlay(result.card);
      } else if (result.kind === 'blocked') {
        onBlocked?.(result);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, hand, guessed, onPlay, onOpenSolve, onCancel, onBlocked]);
}
