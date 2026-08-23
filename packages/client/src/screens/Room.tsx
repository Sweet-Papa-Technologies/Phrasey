/** Everything after the join: lobby until the match starts, then the game. */
import { useEffect } from 'react';
import { Footer } from '../components/Footer';
import { TopBar } from '../components/TopBar';
import { Link, navigate } from '../lib/router';
import { setMusicMood } from '../lib/sound';
import { selectIsHost, useGameStore } from '../store/gameStore';
import { Game } from './Game';
import { Lobby } from './Lobby';

export function Room({ code }: { code: string }) {
  const room = useGameStore((s) => s.room);
  const playerId = useGameStore((s) => s.playerId);
  const connection = useGameStore((s) => s.connection);
  const transportKind = useGameStore((s) => s.transportKind);
  const castView = useGameStore((s) => s.castView);
  const setCastView = useGameStore((s) => s.setCastView);
  const muted = useGameStore((s) => s.muted);
  const volume = useGameStore((s) => s.volume);
  const setMuted = useGameStore((s) => s.setMuted);
  const setVolume = useGameStore((s) => s.setVolume);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const startGame = useGameStore((s) => s.startGame);
  const isHost = useGameStore(selectIsHost);

  // §9 music: the manifest ships lobby and gameplay beds; swap on room status.
  const status = room?.status;
  useEffect(() => {
    if (!status) return;
    setMusicMood(status === 'lobby' ? 'lobby' : 'gameplay');
  }, [status]);

  useEffect(() => () => setMusicMood(null), []);

  // A cold load of /room/CODE has no seat yet — send them through the join door.
  useEffect(() => {
    if (!room) {
      const id = setTimeout(() => {
        if (!useGameStore.getState().room) navigate(`/join/${code}`, { replace: true });
      }, 400);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [room, code]);

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        room={room}
        connection={connection}
        transportKind={transportKind}
        castView={castView}
        onCastView={setCastView}
        muted={muted}
        volume={volume}
        onMuted={setMuted}
        onVolume={setVolume}
      />

      {!room ? (
        <main id="main" className="grid flex-1 place-items-center gap-3 px-4 text-center">
          <p className="font-mono text-sm tracking-[0.16em] uppercase opacity-55">Looking for room {code}…</p>
          <Link to={`/join/${code}`} className="rounded-full bg-fanta px-5 py-2.5 font-bold text-ink shadow-pop">
            Join it
          </Link>
        </main>
      ) : room.status === 'lobby' ? (
        <Lobby
          room={room}
          selfId={playerId}
          isHost={isHost}
          onSettings={(patch) => void updateSettings(patch)}
          onStart={() => void startGame()}
        />
      ) : (
        <Game />
      )}

      {!castView && <Footer />}
    </div>
  );
}
