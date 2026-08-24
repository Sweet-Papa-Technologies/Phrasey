/**
 * Footer. Carries the §8 privacy controls: the consent-manager trigger with
 * the California opt-out icon, plus the two policy pages.
 */
import { Link } from '../lib/router';
import { PrivacyChoices } from './PrivacyChoices';

export function Footer({ className }: { className?: string }) {
  return (
    <footer className={`w-full px-4 py-6 text-center ${className ?? ''}`}>
      <nav
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[0.625rem] tracking-[0.12em] uppercase opacity-60"
        aria-label="Footer"
      >
        <PrivacyChoices />
        <span aria-hidden="true">·</span>
        <Link to="/privacy" className="tap hover:opacity-100 hover:underline">
          Privacy
        </Link>
        <Link to="/cookies" className="tap hover:opacity-100 hover:underline">
          Cookies
        </Link>
        <span aria-hidden="true">·</span>
        <span>13+</span>
        <span aria-hidden="true">·</span>
        <span>No account, no email, nothing kept</span>
      </nav>
    </footer>
  );
}
