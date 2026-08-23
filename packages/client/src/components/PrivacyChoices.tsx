/**
 * The footer's "Your Privacy Choices" control (design doc §8), which reopens
 * the consent manager.
 *
 * The icon is the California opt-out mark: a two-tone toggle, blue half with a
 * white slider, white half with a blue X. This is a hand-authored likeness —
 * the mark is specified by regulation, so **before public launch, replace it
 * with the canonical SVG from the CPPA and have the human legal pass confirm
 * it.** Drawing an approximation is fine for development; shipping one is a
 * detail worth getting exactly right.
 */
import { useConsentStore } from '../store/consentStore';

export function PrivacyChoices({ className }: { className?: string }) {
  const openManager = useConsentStore((s) => s.openManager);

  return (
    <button
      type="button"
      onClick={openManager}
      className={`inline-flex items-center gap-1.5 hover:opacity-100 hover:underline ${className ?? ''}`}
    >
      <OptOutIcon />
      <span>Your Privacy Choices</span>
    </button>
  );
}

function OptOutIcon() {
  return (
    <svg viewBox="0 0 30 14" width="20" height="10" aria-hidden="true" focusable="false" className="shrink-0">
      {/* left half — blue with the toggle knob */}
      <path d="M0 7a7 7 0 0 1 7-7h8v14H7a7 7 0 0 1-7-7Z" fill="#0066FF" />
      <circle cx="7.4" cy="7" r="3.6" fill="#fff" />
      {/* right half — white with the X */}
      <path d="M15 0h8a7 7 0 0 1 0 14h-8V0Z" fill="#fff" stroke="#0066FF" strokeWidth="1.2" />
      <path d="m19.4 4.6 5 4.8M24.4 4.6l-5 4.8" stroke="#0066FF" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
