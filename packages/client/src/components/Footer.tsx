/**
 * Footer. The privacy controls (consent manager, /privacy, /cookies, the
 * California opt-out icon) are M7 and owned elsewhere — the slots are marked
 * with `data-m7` so that work has somewhere to land without touching layout.
 */
import { Link } from '../lib/router';

export function Footer({ className }: { className?: string }) {
  return (
    <footer className={`w-full px-4 py-6 text-center ${className ?? ''}`}>
      <nav
        className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 font-mono text-[0.625rem] tracking-[0.12em] uppercase opacity-60"
        aria-label="Footer"
      >
        {/* M7 mounts the consent manager trigger + California opt-out icon here. */}
        <span data-m7="privacy-choices" />
        <Link to="/privacy" className="hover:opacity-100 hover:underline">
          Privacy
        </Link>
        <Link to="/cookies" className="hover:opacity-100 hover:underline">
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
