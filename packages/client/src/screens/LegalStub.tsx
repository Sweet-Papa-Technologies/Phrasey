/**
 * `/privacy` and `/cookies` are M7. This stub exists only so the footer links
 * are never a hard 404 while that milestone lands; M7 replaces it wholesale.
 */
import { Footer } from '../components/Footer';
import { Link } from '../lib/router';
import { Logo } from '../components/Logo';

export function LegalStub({ page }: { page: 'privacy' | 'cookies' }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="px-4 py-3">
        <Link to="/" aria-label="Phrasey home">
          <Logo />
        </Link>
      </header>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-10">
        <h1 className="font-display text-3xl font-extrabold capitalize">{page}</h1>
        <p className="opacity-70">
          This page is being written as part of the compliance milestone. Phrasey has no accounts, asks for no email,
          and keeps no display names after a room closes.
        </p>
        <Link to="/" className="w-fit rounded-full bg-fanta px-5 py-2.5 font-bold text-ink shadow-pop">
          Back to the game
        </Link>
      </main>
      <Footer />
    </div>
  );
}
