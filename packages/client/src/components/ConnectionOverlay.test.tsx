/**
 * The overlay's whole job is to never let the player sit in front of a frozen
 * board wondering. These tests are about what it SAYS, not how it looks.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ConnectionOverlay } from './ConnectionOverlay';
import { useGameStore } from '../store/gameStore';

function setLink(patch: Partial<ReturnType<typeof useGameStore.getState>>) {
  useGameStore.setState({ transportKind: 'socket', ...patch });
}

afterEach(() => {
  // Unmount BEFORE poking the store: a zustand update against a still-mounted
  // component is a React state update outside `act`, and the resulting warning
  // buries any real one.
  cleanup();
  useGameStore.setState({
    transportKind: 'mock',
    linkPhase: 'idle',
    seatLost: null,
    resumeToken: 0,
  });
});

describe('ConnectionOverlay', () => {
  it('says nothing while the link is fine', () => {
    setLink({ linkPhase: 'live', resumeToken: 0 });
    const { container } = render(<ConnectionOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('never covers the landing page demo, which runs on the mock', () => {
    useGameStore.setState({ transportKind: 'mock', linkPhase: 'reconnecting' });
    const { container } = render(<ConnectionOverlay />);
    expect(container.innerHTML).toBe('');
  });

  it('says it is reconnecting, and that the seat is being held', () => {
    setLink({ linkPhase: 'reconnecting' });
    render(<ConnectionOverlay />);
    expect(screen.getByRole('status').textContent).toMatch(/reconnecting/i);
    expect(screen.getByRole('status').textContent).toMatch(/seat is held/i);
  });

  it('distinguishes "socket is back, getting the seat" from "socket is down"', () => {
    setLink({ linkPhase: 'resuming' });
    render(<ConnectionOverlay />);
    expect(screen.getByRole('status').textContent).toMatch(/seat back/i);
  });

  it('confirms the recovery, so a reconnect is not invisible', () => {
    setLink({ linkPhase: 'live', resumeToken: 3 });
    render(<ConnectionOverlay />);
    expect(screen.getByRole('status').textContent).toMatch(/back in the game/i);
  });

  it('explains a fresh seat rather than silently zeroing the score', () => {
    setLink({
      linkPhase: 'live',
      resumeToken: 0,
      seatLost: { code: 'KABO', recovered: true, message: 'You are back in for the next round.' },
    });
    render(<ConnectionOverlay />);
    expect(screen.getByRole('status').textContent).toMatch(/next round/i);
    expect(screen.getByRole('button', { name: /got it/i })).toBeTruthy();
  });

  it('puts a real dialog up — with a way out — when the seat is gone for good', () => {
    setLink({
      linkPhase: 'seat-lost',
      seatLost: { code: 'KABO', recovered: false, message: 'That room has closed.' },
    });
    render(<ConnectionOverlay />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toMatch(/lost your seat/i);
    expect(dialog.textContent).toMatch(/that room has closed/i);
    // Two ways forward. A dead screen with no button is the thing being fixed.
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /new room/i })).toBeTruthy();
  });
});
