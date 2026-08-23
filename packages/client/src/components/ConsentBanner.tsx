/**
 * Consent banner (design doc §8).
 *
 * "Accept all / Reject all / Manage — reject must be exactly as prominent and
 * as few clicks as accept." So the two are the same component with the same
 * size, weight, contrast and border. Do not make one of them a ghost button
 * later; that is the specific dark pattern this rule exists to forbid.
 */
import { useEffect, useRef } from 'react';
import { useConsentStore } from '../store/consentStore';

export function ConsentBanner() {
  const prompting = useConsentStore((s) => s.prompting);
  const managing = useConsentStore((s) => s.managing);
  const acceptAll = useConsentStore((s) => s.acceptAll);
  const rejectAll = useConsentStore((s) => s.rejectAll);
  const openManager = useConsentStore((s) => s.openManager);
  const first = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (prompting && !managing) first.current?.focus();
  }, [prompting, managing]);

  if (!prompting || managing) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="consent-title"
      aria-describedby="consent-body"
      className="fixed inset-x-0 bottom-0 z-50 border-t-2 border-ink/10 bg-chill/95 px-4 py-4 backdrop-blur-md sm:px-6"
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <p id="consent-title" className="font-display text-base font-extrabold">
            Cookies, briefly
          </p>
          <p id="consent-body" className="text-sm opacity-75">
            Phrasey needs a little browser storage to run a game. We&rsquo;d also like optional analytics to see what
            people play. No accounts, no email, and we never log puzzles or names.
          </p>
        </div>

        {/* Identical treatment on both. See the note at the top of this file. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            ref={first}
            type="button"
            onClick={acceptAll}
            className="min-w-[8.5rem] rounded-full border-2 border-ink bg-fanta px-5 py-2.5 text-sm font-bold text-ink shadow-pop"
          >
            Accept all
          </button>
          <button
            type="button"
            onClick={rejectAll}
            className="min-w-[8.5rem] rounded-full border-2 border-ink bg-fanta px-5 py-2.5 text-sm font-bold text-ink shadow-pop"
          >
            Reject all
          </button>
          <button
            type="button"
            onClick={openManager}
            className="rounded-full px-4 py-2.5 text-sm font-bold underline underline-offset-4 opacity-80 hover:opacity-100"
          >
            Manage
          </button>
        </div>
      </div>
    </div>
  );
}
