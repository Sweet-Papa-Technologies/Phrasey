/**
 * /privacy and /cookies (design doc §8).
 *
 * The copy is the markdown in src/content/legal, imported raw so the document
 * a human reviews is literally the document that ships.
 */
import { Footer } from '../components/Footer';
import { Logo } from '../components/Logo';
import { Link } from '../lib/router';
import { Markdown } from '../lib/markdown';
import { useConsentStore } from '../store/consentStore';
import privacyMd from '../content/legal/privacy.md?raw';
import cookiesMd from '../content/legal/cookies.md?raw';
import termsMd from '../content/legal/terms.md?raw';

const DOCS = {
  privacy: privacyMd,
  cookies: cookiesMd,
  terms: termsMd,
} as const;

export type LegalPage = keyof typeof DOCS;

export function Legal({ page }: { page: LegalPage }) {
  const openManager = useConsentStore((s) => s.openManager);

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-4 py-3">
        <Link to="/" aria-label="Phrasey home" className="tap">
          <Logo />
        </Link>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">
        <Markdown source={DOCS[page]} />

        <div className="mt-10 flex flex-wrap gap-3 border-t border-ink/15 pt-6">
          <button
            type="button"
            onClick={openManager}
            className="rounded-full border-2 border-ink bg-grape px-5 py-2.5 text-sm font-bold text-chill shadow-pop"
          >
            Manage your privacy choices
          </button>
          <Link
            to="/"
            className="tap rounded-full border-2 border-ink bg-fanta px-5 py-2.5 text-sm font-bold text-ink shadow-pop"
          >
            Back to the game
          </Link>
        </div>
      </main>

      <Footer />
    </div>
  );
}
