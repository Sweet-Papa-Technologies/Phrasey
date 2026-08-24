/**
 * The QR bitmap size. The playtest failure was a code that could not be read
 * off a TV from across the room, and the two things that fix that are display
 * size (CSS, per surface) and module sharpness — which is this: the bitmap has
 * to be generated larger than it is drawn, never upscaled into it.
 */
import { describe, expect, it } from 'vitest';
import { qrRenderPx } from './JoinQr';

describe('qrRenderPx', () => {
  it('never renders smaller than the old fixed 320px bitmap', () => {
    for (const display of [0, 24, 96, 128, 176, 320, 352, 800]) {
      expect(qrRenderPx(display)).toBeGreaterThan(320);
    }
  });

  it('renders well above the display size, so nothing is ever upscaled', () => {
    for (const display of [96, 128, 176, 224, 320, 352, 420]) {
      expect(qrRenderPx(display)).toBeGreaterThanOrEqual(display * 2);
    }
  });

  it('is capped so a lobby never ships a needlessly huge data URI', () => {
    expect(qrRenderPx(4000)).toBe(1280);
  });

  it('is monotonic and finite for any input, including junk', () => {
    let previous = 0;
    for (const display of [0, 10, 100, 200, 300, 400, 500, 2000]) {
      const px = qrRenderPx(display);
      expect(Number.isFinite(px)).toBe(true);
      expect(px).toBeGreaterThanOrEqual(previous);
      previous = px;
    }
    expect(qrRenderPx(-100)).toBe(640);
  });
});
