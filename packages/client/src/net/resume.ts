/**
 * "The phone woke up" detector.
 *
 * A backgrounded mobile tab is not slow — it is STOPPED. No timer runs, no
 * socket.io retry fires, nothing notices the websocket the OS closed. The only
 * thing the app gets is a burst of DOM events at the moment it thaws, and this
 * module turns that burst into exactly one "go and fix the connection" call.
 *
 * The four triggers, and why each one is here rather than being redundant:
 *
 *   - `visibilitychange` → visible. The tab came back to the foreground. The
 *     normal case: app switcher, notification dismissed, screen unlocked.
 *   - `pageshow`. Fires on a bfcache restore (`event.persisted === true`),
 *     which `visibilitychange` does NOT reliably precede on iOS Safari — a page
 *     restored from the back/forward cache can come back already "visible", so
 *     without this the tab silently stays on a dead socket. Also fires on a
 *     normal load, which is harmless: `shouldResume` finds a healthy link (or
 *     no session at all) and does nothing.
 *   - `online`. Airplane mode off, tunnel exited, wifi handed over to cellular.
 *     The tab may have been visible the whole time, so no visibility event ever
 *     fires — this is the only signal.
 *   - `focus`. iOS Safari's `visibilitychange` is genuinely unreliable when the
 *     screen locks with the tab already frontmost; `focus` covers that gap. It
 *     is the belt to visibility's braces, and the debounce makes the overlap free.
 *
 * DEBOUNCE: iOS routinely fires three of the four within a few milliseconds of
 * an unlock. The window is leading-edge — reconnect immediately, because every
 * millisecond of delay here is a millisecond of frozen board — and then
 * suppresses the rest of the burst. If more triggers arrived during the window
 * AND the link is still not healthy when it closes, one retry is fired. That
 * second call only happens when the first one demonstrably failed, so "three
 * events in a row cause one reconnect" holds for the case that matters.
 */

export type ResumeReason = 'visible' | 'pageshow' | 'online' | 'focus';

export interface ResumeTriggerOptions {
  /** What to do about it. Must itself be idempotent — it can be called again. */
  onResume: (reason: ResumeReason) => void;
  /**
   * "Is the link already fine?" When it returns true the trigger is dropped, so
   * an app-switch that did not actually break anything costs nothing.
   */
  isHealthy?: () => boolean;
  /** Burst-collapsing window. */
  debounceMs?: number;
  /** Injectable for tests. */
  window?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  document?: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  now?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (h: unknown) => void;
}

export const DEFAULT_RESUME_DEBOUNCE_MS = 750;

/**
 * Install the triggers. Returns an uninstall function; calling it twice is safe.
 * A no-op (and still returns a valid uninstall) outside a browser.
 */
export function installResumeTriggers(opts: ResumeTriggerOptions): () => void {
  const win = opts.window ?? (typeof window === 'undefined' ? null : window);
  const doc = opts.document ?? (typeof document === 'undefined' ? null : document);
  if (!win || !doc) return () => {};

  const debounceMs = opts.debounceMs ?? DEFAULT_RESUME_DEBOUNCE_MS;
  const now = opts.now ?? (() => Date.now());
  const setT = opts.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearT = opts.clearTimeout ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let windowEndsAt = 0;
  let trailing: unknown = null;
  let pending: ResumeReason | null = null;
  let stopped = false;

  const healthy = () => (opts.isHealthy ? opts.isHealthy() : false);

  function fire(reason: ResumeReason): void {
    if (stopped) return;
    windowEndsAt = now() + debounceMs;
    opts.onResume(reason);
  }

  function trigger(reason: ResumeReason): void {
    if (stopped) return;
    // A healthy link needs nothing done to it. This is the common case for an
    // app-switch that lasted two seconds.
    if (healthy()) return;

    if (now() >= windowEndsAt) {
      fire(reason);
      return;
    }

    // Inside the burst window: remember it, and retry once at the end — but
    // only if the leading call has not already fixed things by then.
    pending = reason;
    if (trailing !== null) return;
    trailing = setT(() => {
      trailing = null;
      const reasonAtEnd = pending;
      pending = null;
      if (stopped || reasonAtEnd === null || healthy()) return;
      fire(reasonAtEnd);
    }, Math.max(0, windowEndsAt - now()));
  }

  const onVisibility = () => {
    if (doc.visibilityState === 'visible') trigger('visible');
  };
  const onPageShow = () => trigger('pageshow');
  const onOnline = () => trigger('online');
  const onFocus = () => trigger('focus');

  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pageshow', onPageShow);
  win.addEventListener('online', onOnline);
  win.addEventListener('focus', onFocus);

  return () => {
    if (stopped) return;
    stopped = true;
    if (trailing !== null) clearT(trailing);
    trailing = null;
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pageshow', onPageShow);
    win.removeEventListener('online', onOnline);
    win.removeEventListener('focus', onFocus);
  };
}
