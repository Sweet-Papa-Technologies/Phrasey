/**
 * The share link has to carry the room key, because the key is what actually
 * gates a join now. If this drifts, the invite link silently stops working and
 * the only symptom is "my friends can't get in".
 */
import { describe, expect, it } from 'vitest';
import { formatRoomHandle, parseRoomHandle } from '@phrasey/shared';
import { joinUrl } from './format';
import { parseRoute } from './router';

describe('joinUrl', () => {
  it('includes the key when there is one', () => {
    expect(joinUrl('KABO', 'M3XR')).toContain('/join/KABO-M3XR');
  });

  it('falls back to a bare code when the key is unknown', () => {
    expect(joinUrl('KABO')).toContain('/join/KABO');
    expect(joinUrl('KABO', null)).toContain('/join/KABO');
  });
});

describe('the /join route', () => {
  it('splits a share link into code and key', () => {
    expect(parseRoute('/join/KABO-M3XR')).toEqual({ name: 'join', code: 'KABO', key: 'M3XR' });
  });

  it('accepts a hand-typed code with no key, so the screen can ask for it', () => {
    expect(parseRoute('/join/KABO')).toEqual({ name: 'join', code: 'KABO', key: null });
  });

  it('is case-insensitive, the way a retyped URL arrives', () => {
    expect(parseRoute('/join/kabo-m3xr')).toEqual({ name: 'join', code: 'KABO', key: 'M3XR' });
  });

  it('does not mistake a malformed handle for a valid key', () => {
    expect(parseRoute('/join/KABO-M3X')).toEqual({ name: 'join', code: 'KABO', key: null });
  });

  it('round-trips a generated link back to the same room', () => {
    const url = joinUrl('MIRU', 'H7QP');
    const path = url.slice(url.indexOf('/join/'));
    expect(parseRoute(path)).toEqual({ name: 'join', code: 'MIRU', key: 'H7QP' });
  });

  it('agrees with the shared formatter', () => {
    const handle = formatRoomHandle('KABO', 'M3XR');
    expect(parseRoomHandle(handle)).toEqual({ code: 'KABO', key: 'M3XR' });
    expect(joinUrl('KABO', 'M3XR')).toContain(handle);
  });
});
