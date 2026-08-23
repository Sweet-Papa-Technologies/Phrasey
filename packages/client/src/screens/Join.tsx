/** `/join/:code` — name and avatar color, then in (§7). */
import { useState } from 'react';
import { isValidRoomCode } from '@phrasey/shared';
import { Footer } from '../components/Footer';
import { IdentityForm } from '../components/IdentityForm';
import { TopBar } from '../components/TopBar';
import { Link, navigate } from '../lib/router';
import { useGameStore } from '../store/gameStore';

export function Join({ code }: { code: string }) {
  const identity = useGameStore((s) => s.identity);
  const setIdentity = useGameStore((s) => s.setIdentity);
  const connect = useGameStore((s) => s.connect);
  const joinRoom = useGameStore((s) => s.joinRoom);
  const connection = useGameStore((s) => s.connection);
  const transportKind = useGameStore((s) => s.transportKind);
  const muted = useGameStore((s) => s.muted);
  const volume = useGameStore((s) => s.volume);
  const setMuted = useGameStore((s) => s.setMuted);
  const setVolume = useGameStore((s) => s.setVolume);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const valid = isValidRoomCode(code);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      await connect();
      const res = await joinRoom(code);
      if (res.ok) {
        const room = (res.data as { room: { code: string } }).room;
        navigate(`/room/${room.code}`);
      } else {
        setError(res.error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col">
      <TopBar
        room={null}
        connection={connection}
        transportKind={transportKind}
        castView={false}
        muted={muted}
        volume={volume}
        onMuted={setMuted}
        onVolume={setVolume}
      />

      <main id="main" className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
        <div className="text-center">
          <p className="sticker mb-2 bg-lime text-ink">Joining room</p>
          <p className="font-mono text-[clamp(2.5rem,12vw,5rem)] leading-none font-extrabold tracking-[0.08em]">
            {code}
          </p>
        </div>

        {valid ? (
          <>
            <IdentityForm
              autoFocus
              name={identity.name}
              color={identity.color}
              busy={busy}
              submitLabel="Join the room"
              onChange={setIdentity}
              onSubmit={() => void join()}
            />
            {error && (
              <p role="alert" className="rounded-card border-2 border-cherry/40 bg-cherry/10 px-3 py-2 text-sm text-cherry">
                {error}
              </p>
            )}
          </>
        ) : (
          <div className="text-center">
            <p className="mb-3 text-lg">That is not a Phrasey room code.</p>
            <Link to="/" className="rounded-full bg-fanta px-6 py-3 font-display font-bold text-ink shadow-pop">
              Back to the front
            </Link>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
