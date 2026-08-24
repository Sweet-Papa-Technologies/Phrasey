/**
 * The wake-up triggers.
 *
 * These are the events a real phone actually delivers when it comes back, so
 * the tests fire them the way iOS does: several at once, out of order, and
 * sometimes while the link is already fine.
 */
import { describe, expect, it, vi } from 'vitest';
import { installResumeTriggers, type ResumeReason } from './resume';

/** A minimal stand-in for `window`/`document` that lets a test fire events. */
function harness(visibility: DocumentVisibilityState = 'visible') {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const target = {
    addEventListener(type: string, cb: unknown) {
      const set = listeners.get(type) ?? new Set();
      set.add(cb as (e: unknown) => void);
      listeners.set(type, set);
    },
    removeEventListener(type: string, cb: unknown) {
      listeners.get(type)?.delete(cb as (e: unknown) => void);
    },
    visibilityState: visibility,
  };
  return {
    target,
    listeners,
    fire(type: string, e: unknown = {}) {
      for (const cb of [...(listeners.get(type) ?? [])]) cb(e);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

interface Rig {
  calls: ResumeReason[];
  fire: (type: string, e?: unknown) => void;
  count: (type: string) => number;
  advance: (ms: number) => void;
  runTimers: () => void;
  uninstall: () => void;
  setHealthy: (v: boolean) => void;
}

function rig(opts: { debounceMs?: number; healthy?: boolean; visibility?: DocumentVisibilityState } = {}): Rig {
  const h = harness(opts.visibility ?? 'visible');
  const calls: ResumeReason[] = [];
  let clock = 1000;
  let healthy = opts.healthy ?? false;
  const timers: { fn: () => void; due: number }[] = [];

  const uninstall = installResumeTriggers({
    onResume: (r) => calls.push(r),
    isHealthy: () => healthy,
    debounceMs: opts.debounceMs ?? 750,
    window: h.target as unknown as Window,
    document: h.target as unknown as Document,
    now: () => clock,
    setTimeout: (fn, ms) => {
      const t = { fn, due: clock + ms };
      timers.push(t);
      return t;
    },
    clearTimeout: (handle) => {
      const i = timers.indexOf(handle as { fn: () => void; due: number });
      if (i >= 0) timers.splice(i, 1);
    },
  });

  const runTimers = () => {
    for (const t of timers.splice(0).filter((t) => t.due <= clock)) t.fn();
  };

  return {
    calls,
    fire: h.fire,
    count: h.count,
    advance: (ms) => {
      clock += ms;
      runTimers();
    },
    runTimers,
    uninstall,
    setHealthy: (v) => {
      healthy = v;
    },
  };
}

describe('installResumeTriggers', () => {
  it('resumes when the tab becomes visible again', () => {
    const r = rig();
    r.fire('visibilitychange');
    expect(r.calls).toEqual(['visible']);
  });

  it('ignores a visibilitychange that means the tab went AWAY', () => {
    const r = rig({ visibility: 'hidden' });
    r.fire('visibilitychange');
    expect(r.calls).toEqual([]);
  });

  it('resumes on pageshow, including a bfcache restore', () => {
    const r = rig();
    r.fire('pageshow', { persisted: true });
    expect(r.calls).toEqual(['pageshow']);
  });

  it('resumes when the network comes back', () => {
    const r = rig();
    r.fire('online');
    expect(r.calls).toEqual(['online']);
  });

  it('resumes on focus, which is the only signal some iOS unlocks give', () => {
    const r = rig();
    r.fire('focus');
    expect(r.calls).toEqual(['focus']);
  });

  it('collapses a burst of three wake-up events into ONE reconnect', () => {
    const r = rig({ debounceMs: 750 });
    // Exactly what an iOS unlock delivers: all of them, immediately.
    r.fire('visibilitychange');
    r.setHealthy(true); // the first reconnect worked
    r.fire('pageshow');
    r.fire('online');
    r.fire('focus');
    expect(r.calls).toEqual(['visible']);

    // ...and the trailing edge does not add a second one, because by then the
    // link is healthy.
    r.advance(800);
    expect(r.calls).toEqual(['visible']);
  });

  it('retries once at the end of the window when the first attempt did not take', () => {
    const r = rig({ debounceMs: 750 });
    r.fire('visibilitychange');
    r.fire('online'); // still down — radio has not come back yet
    expect(r.calls).toEqual(['visible']);

    r.advance(800);
    expect(r.calls).toEqual(['visible', 'online']);
  });

  it('does nothing at all while the link is healthy', () => {
    const r = rig({ healthy: true });
    r.fire('visibilitychange');
    r.fire('pageshow');
    r.fire('online');
    r.fire('focus');
    expect(r.calls).toEqual([]);
  });

  it('allows a fresh reconnect once the debounce window has passed', () => {
    const r = rig({ debounceMs: 750 });
    r.fire('visibilitychange');
    r.advance(1000);
    r.fire('visibilitychange');
    expect(r.calls).toEqual(['visible', 'visible']);
  });

  it('removes every listener on uninstall, and is safe to call twice', () => {
    const r = rig();
    expect(r.count('visibilitychange')).toBe(1);
    expect(r.count('pageshow')).toBe(1);
    expect(r.count('online')).toBe(1);
    expect(r.count('focus')).toBe(1);

    r.uninstall();
    r.uninstall();

    expect(r.count('visibilitychange')).toBe(0);
    expect(r.count('pageshow')).toBe(0);
    expect(r.count('online')).toBe(0);
    expect(r.count('focus')).toBe(0);

    r.fire('visibilitychange');
    expect(r.calls).toEqual([]);
  });

  it('does not fire a pending trailing retry after uninstall', () => {
    const r = rig({ debounceMs: 750 });
    r.fire('visibilitychange');
    r.fire('online');
    r.uninstall();
    r.advance(1000);
    expect(r.calls).toEqual(['visible']);
  });

  it('is a no-op outside a browser rather than a crash', () => {
    const onResume = vi.fn();
    const stop = installResumeTriggers({
      onResume,
      window: undefined,
      document: undefined,
    });
    expect(typeof stop).toBe('function');
    stop();
    expect(onResume).not.toHaveBeenCalled();
  });
});
