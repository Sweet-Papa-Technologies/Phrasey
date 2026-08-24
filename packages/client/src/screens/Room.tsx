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
  const musicVolume = useGameStore((s) => s.musicVolume);
  const sameRoomLocal = useGameStore((s) => s.sameRoomLocal);
  const setMuted = useGameStore((s) => s.setMuted);
  const setVolume = useGameStore((s) => s.setVolume);
  const setMusicVolume = useGameStore((s) => s.setMusicVolume);
  const setSameRoom = useGameStore((s) => s.setSameRoom);
  const updateSettings = useGameStore((s) => s.updateSettings);
  const startGame = useGameStore((s) => s.startGame);
  const isHost = useGameStore(selectIsHost);

  // The switch means different things to the two roles (§9). For the host it
  // shows the room-level default they are broadcasting; for everyone else it
  // shows their own choice, falling back to that default until they make one.
  const roomDefaultSameRoom = room?.settings.sameRoomAudio === true;
  const sameRoom = isHost ? roomDefaultSameRoom : (sameRoomLocal ?? roomDefaultSameRoom);

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

  /*
   * Mid-round the screen stops being a page and becomes a fixed-height shell
   * (`app-shell`, styles/index.css): the viewport is the budget and the board
   * absorbs the remainder, so Solve and Pass can never end up under the fold.
   * The lobby is a normal scrolling page — it has a form on it, and a form that
   * cannot scroll is a worse bug than the one being fixed.
   */
  const inPlay = !!room && room.status !== 'lobby';

  return (
    <div className={inPlay ? 'app-shell' : 'flex min-h-full flex-col'}>
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
        musicVolume={musicVolume}
        onMusicVolume={setMusicVolume}
        sameRoom={sameRoom}
        sameRoomIsHost={isHost}
        sameRoomFromRoomDefault={!isHost && sameRoomLocal === null && roomDefaultSameRoom}
        onSameRoom={setSameRoom}
        dense={inPlay}
      />

      {!room ? (
        <main id="main" className="grid flex-1 place-items-center gap-3 px-4 text-center">
          <p className="font-mono text-sm tracking-[0.16em] uppercase opacity-55">Looking for room {code}…</p>
          <Link to={`/join/${code}`} className="tap rounded-full bg-fanta px-5 py-2.5 font-bold text-ink shadow-pop">
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

      {/*
        The privacy links belong on the landing page and the lobby, not
        mid-round: on a phone the footer was three rows of legal copy competing
        with the hand for the bottom of the screen. §8 is satisfied either way
        — the consent manager is reachable from every screen a player arrives
        on, and from the lobby they return to between rounds.
      */}
      {!castView && !inPlay && <Footer />}
    </div>
  );
}
