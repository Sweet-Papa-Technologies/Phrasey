/**
 * The "Manage" panel, and what the footer's Your Privacy Choices link reopens
 * (design doc §8).
 */
import { useEffect, useRef, useState } from 'react';
import { useConsentStore } from '../store/consentStore';
import { Link } from '../lib/router';

export function ConsentManager() {
  const managing = useConsentStore((s) => s.managing);
  const state = useConsentStore((s) => s.state);
  const gpc = useConsentStore((s) => s.gpc);
  const save = useConsentStore((s) => s.saveChoices);
  const rejectAll = useConsentStore((s) => s.rejectAll);
  const acceptAll = useConsentStore((s) => s.acceptAll);
  const close = useConsentStore((s) => s.closeManager);

  const [analytics, setAnalytics] = useState(state?.analytics ?? false);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => setAnalytics(state?.analytics ?? false), [state, managing]);

  useEffect(() => {
    if (!managing) return;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [managing, close]);

  if (!managing) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-ink/60 p-4 backdrop-blur-sm">
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cm-title"
        className="w-full max-w-lg rounded-3xl border-2 border-ink bg-chill p-6 shadow-pop"
      >
        <h2 id="cm-title" className="font-display text-2xl font-extrabold">
          Your privacy choices
        </h2>

        <div className="mt-5 space-y-4">
          <Purpose
            title="Strictly necessary"
            body="Remembers your consent choice, your seat if you get disconnected, and your sound settings. Cannot be switched off — without it the game can't run."
            checked
            locked
          />
          <Purpose
            title="Analytics"
            body={
              gpc
                ? 'Your browser is sending a Global Privacy Control signal, so analytics stays off. We honor that as an opt-out; you do not need to do anything else.'
                : 'Google Analytics, so we can see which parts of the game people actually play. We record event types only — never puzzle text, never display names.'
            }
            checked={gpc ? false : analytics}
            locked={gpc}
            onChange={setAnalytics}
          />
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => save(analytics)}
            className="rounded-full border-2 border-ink bg-grape px-5 py-2.5 text-sm font-bold text-chill shadow-pop"
          >
            Save choices
          </button>
          <button
            type="button"
            onClick={acceptAll}
            className="min-w-[7.5rem] rounded-full border-2 border-ink bg-chill px-5 py-2.5 text-sm font-bold"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={rejectAll}
            className="min-w-[7.5rem] rounded-full border-2 border-ink bg-chill px-5 py-2.5 text-sm font-bold"
          >
            Reject all
          </button>
          <button type="button" onClick={close} className="ml-auto px-3 py-2 text-sm underline underline-offset-4 opacity-70">
            Close
          </button>
        </div>

        <p className="mt-4 text-xs opacity-60">
          More detail in the{' '}
          <Link to="/privacy" className="tap underline">
            Privacy Policy
          </Link>{' '}
          and{' '}
          <Link to="/cookies" className="tap underline">
            Cookie Policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

function Purpose({
  title,
  body,
  checked,
  locked,
  onChange,
}: {
  title: string;
  body: string;
  checked: boolean;
  locked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className={`flex gap-3 rounded-2xl border-2 border-ink/15 p-4 ${locked ? 'opacity-70' : 'cursor-pointer'}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={locked}
        onChange={(e) => onChange?.(e.target.checked)}
        className="mt-1 size-5 shrink-0 accent-grape"
      />
      <span>
        <span className="block font-bold">
          {title}
          {locked ? <span className="ml-2 font-mono text-[0.6rem] uppercase opacity-60">Always on</span> : null}
        </span>
        <span className="block text-sm opacity-75">{body}</span>
      </span>
    </label>
  );
}
