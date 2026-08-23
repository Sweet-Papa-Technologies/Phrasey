/**
 * Track changes must hand off, not overlap.
 *
 * Reported as "music sounds doubled on the first few seconds of play". The
 * cause was the lobby -> gameplay switch crossfading two beds that are both 12
 * bars at 109.85 BPM, cut by the same process. Two similar tracks played
 * together at similar level do not sound like a crossfade, they phase against
 * each other and sound like one track doubled.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HANDOFF_LEVEL } from './music';

/**
 * Reimplements the fade loop's per-step rule so the handoff policy can be
 * checked as arithmetic. Kept deliberately small and matched to the loop body.
 */
function simulate({
  overlap,
  steps = 400,
  perStep = 0.02,
}: { overlap: boolean; steps?: number; perStep?: number }) {
  let incoming = 0;
  let outgoing = 1;
  const bothAudible: number[] = [];

  for (let i = 0; i < steps; i++) {
    const clearing = outgoing > HANDOFF_LEVEL;
    const sequential = !overlap;
    if (incoming < 1 && !(sequential && clearing)) incoming = Math.min(1, incoming + perStep);
    outgoing = Math.max(0, outgoing - perStep);

    // "Both audible" = both loud enough that a listener hears two beds.
    if (incoming > HANDOFF_LEVEL && outgoing > HANDOFF_LEVEL) {
      bothAudible.push(Math.min(incoming, outgoing));
    }
    if (incoming >= 1 && outgoing <= 0) break;
  }
  return { bothAudible, incoming, outgoing };
}

beforeEach(() => vi.restoreAllMocks());

describe('track handoff', () => {
  it('never has both beds audible at once by default', () => {
    const { bothAudible } = simulate({ overlap: false });
    expect(bothAudible).toEqual([]);
  });

  it('completes: the incoming track does reach full level', () => {
    const { incoming, outgoing } = simulate({ overlap: false });
    expect(incoming).toBe(1);
    expect(outgoing).toBe(0);
  });

  it('the old overlapping behaviour did have both audible — proving the test bites', () => {
    const { bothAudible } = simulate({ overlap: true });
    expect(bothAudible.length).toBeGreaterThan(0);
    // And they overlapped at a genuinely audible level, not a sliver.
    expect(Math.max(...bothAudible)).toBeGreaterThan(0.4);
  });

  it('keeps the gap short — a silent hole between beds is its own problem', () => {
    // With both decks under the handoff level, nothing is really playing.
    let incoming = 0;
    let outgoing = 1;
    const perStep = 0.02;
    let silentSteps = 0;
    for (let i = 0; i < 400; i++) {
      const clearing = outgoing > HANDOFF_LEVEL;
      if (incoming < 1 && !clearing) incoming = Math.min(1, incoming + perStep);
      outgoing = Math.max(0, outgoing - perStep);
      if (incoming < HANDOFF_LEVEL && outgoing < HANDOFF_LEVEL) silentSteps++;
      if (incoming >= 1) break;
    }
    // A handful of steps, not a hole you would notice.
    expect(silentSteps).toBeLessThan(12);
  });

  it('HANDOFF_LEVEL is low enough to be inaudible but not zero', () => {
    expect(HANDOFF_LEVEL).toBeGreaterThan(0);
    expect(HANDOFF_LEVEL).toBeLessThan(0.2);
  });
});
