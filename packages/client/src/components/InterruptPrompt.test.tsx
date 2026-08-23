/** The 4-second out-of-turn window, rendered (§3.5). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import type { Card } from '@phrasey/shared';
import { InterruptPrompt } from './InterruptPrompt';

const hand: Card[] = [
  { id: 'c1', kind: 'action', action: 'SWIPE' },
  { id: 'c2', kind: 'letter', letter: 'E' },
];

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('InterruptPrompt', () => {
  it('counts the window down and offers only the playable cards', () => {
    render(
      <InterruptPrompt
        expiresAt={NOW + 4000}
        playableCardIds={['c1']}
        hand={hand}
        sourceName="Slushie"
        onPlay={() => {}}
        onDismiss={() => {}}
      />,
    );

    expect(screen.getByRole('alertdialog', { name: 'Interrupt window' })).toBeTruthy();
    expect(screen.getByLabelText('4 seconds left').textContent).toBe('4');
    expect(screen.getByRole('button', { name: 'Swipe' })).toBeTruthy();
    // The letter card in hand is not a legal interrupt, so it is not offered.
    expect(screen.queryByRole('button', { name: 'E' })).toBeNull();

    act(() => {
      vi.setSystemTime(NOW + 2200);
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByLabelText('2 seconds left').textContent).toBe('2');
  });

  it('disappears once the window has closed', () => {
    const { container } = render(
      <InterruptPrompt
        expiresAt={NOW - 1}
        playableCardIds={['c1']}
        hand={hand}
        sourceName="Slushie"
        onPlay={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the player holds no legal interrupt', () => {
    const { container } = render(
      <InterruptPrompt
        expiresAt={NOW + 4000}
        playableCardIds={[]}
        hand={hand}
        sourceName="Slushie"
        onPlay={() => {}}
        onDismiss={() => {}}
      />,
    );
    expect(container.textContent).toBe('');
  });
});
