import { useEffect, useState } from 'react';
import { Landing } from './screens/Landing';
import { Join } from './screens/Join';
import { Room } from './screens/Room';
import { Legal } from './screens/Legal';
import { ConsentBanner } from './components/ConsentBanner';
import { ConsentManager } from './components/ConsentManager';
import { ConnectionOverlay } from './components/ConnectionOverlay';
import { useConsentStore } from './store/consentStore';
import { Link, useRoute, type Route } from './lib/router';
import { initSound, setMuted, setVolume } from './lib/sound';
import { useGameStore } from './store/gameStore';
import { sessionFor } from './net/session';

export function App() {
  const route = useRoute();
  const initConsent = useConsentStore((s) => s.init);
  const muted = useGameStore((s) => s.muted);
  const volume = useGameStore((s) => s.volume);

  // The audio module is owned by another agent and may not exist yet; this is
  // a no-op in that case (see lib/sound.ts).
  useEffect(() => {
    void initSound().then(() => {
      setVolume(volume);
      setMuted(muted);
    });
    // Intentionally once: later changes go through the store's setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Consent Mode defaults must be installed before anything could load GA4,
  // so this runs before any screen mounts (§8).
  useEffect(() => {
    initConsent();
  }, [initConsent]);

  return (
    <>
      {renderScreen(route)}
      <ConsentBanner />
      <ConsentManager />
      {/*
        Mounted at the app root rather than inside a screen: a connection can
        drop on any route, and an overlay that unmounts with the screen it was
        warning about is worse than none at all.
      */}
      <ConnectionOverlay />
    </>
  );
}

function renderScreen(route: Route) {
  switch (route.name) {
    case 'landing':
      return <Landing />;
    case 'join':
      return <Join code={route.code} routeKey={route.key} />;
    case 'room':
      return <RoomRoute code={route.code} />;
    case 'legal':
      return <Legal page={route.page} />;
    default:
      return (
        <div className="grid min-h-full place-items-center gap-4 px-4 text-center">
          <div>
            <p className="font-display text-6xl font-extrabold">404</p>
            <p className="mb-4 opacity-70">Nothing at {route.name === 'notfound' ? route.path : 'that address'}.</p>
            <Link to="/" className="tap rounded-full bg-fanta px-5 py-2.5 font-bold text-ink shadow-pop">
              Back to the front
            </Link>
          </div>
        </div>
      );
  }
}

/**
 * `/room/:code` on a COLD LOAD.
 *
 * This gate exists because of how mobile actually behaves: a backgrounded tab
 * is not just paused, it is routinely *discarded* by the OS and re-executed
 * from scratch when the player comes back to it. Everything in memory is gone
 * — but the server is still holding the seat, and the credential that reclaims
 * it (§7's session token, plus the room key from §6.6) is in localStorage.
 *
 * `Room` has always treated "no room in the store" as "you have never been
 * here" and bounced to `/join/:code`, which on a phone meant re-typing your
 * name and coming back as a stranger with no score. So the reclaim is
 * attempted BEFORE `Room` mounts: the bounce still exists and is still right,
 * it just no longer fires ahead of the one thing that can prevent it.
 *
 * The gate never blocks a genuine first visit — with no stored credential for
 * this code it renders `Room` on the first frame, exactly as before.
 */
function RoomRoute({ code }: { code: string }) {
  const room = useGameStore((s) => s.room);
  const reclaimInto = useGameStore((s) => s.reclaimInto);
  const [checking, setChecking] = useState(
    () => !useGameStore.getState().room && !!sessionFor(code),
  );

  useEffect(() => {
    if (!checking) return;
    let alive = true;
    void reclaimInto(code).finally(() => {
      if (alive) setChecking(false);
    });
    return () => {
      alive = false;
    };
  }, [checking, code, reclaimInto]);

  if (checking && !room) return <ReclaimingRoom code={code} />;
  return <Room code={code} />;
}

/**
 * Held for the length of the reclaim only. Deliberately plain — the connection
 * overlay is already on screen saying what is happening, and two competing
 * explanations is one too many.
 */
function ReclaimingRoom({ code }: { code: string }) {
  return (
    <main id="main" className="grid min-h-full place-items-center gap-3 px-4 text-center">
      <div>
        <p className="font-display text-3xl font-extrabold">Room {code}</p>
        <p className="mt-2 font-mono text-sm tracking-[0.16em] uppercase opacity-55">
          Getting you back in…
        </p>
      </div>
    </main>
  );
}
