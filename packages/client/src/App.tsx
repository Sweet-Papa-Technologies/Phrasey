import { useEffect } from 'react';
import { Landing } from './screens/Landing';
import { Join } from './screens/Join';
import { Room } from './screens/Room';
import { LegalStub } from './screens/LegalStub';
import { Link, useRoute } from './lib/router';
import { initSound, setMuted, setVolume } from './lib/sound';
import { useGameStore } from './store/gameStore';

export function App() {
  const route = useRoute();
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

  switch (route.name) {
    case 'landing':
      return <Landing />;
    case 'join':
      return <Join code={route.code} />;
    case 'room':
      return <Room code={route.code} />;
    case 'legal':
      return <LegalStub page={route.page} />;
    default:
      return (
        <div className="grid min-h-full place-items-center gap-4 px-4 text-center">
          <div>
            <p className="font-display text-6xl font-extrabold">404</p>
            <p className="mb-4 opacity-70">Nothing at {route.name === 'notfound' ? route.path : 'that address'}.</p>
            <Link to="/" className="rounded-full bg-fanta px-5 py-2.5 font-bold text-ink shadow-pop">
              Back to the front
            </Link>
          </div>
        </div>
      );
  }
}
