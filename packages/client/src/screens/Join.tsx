/** `/join/:code` — name and avatar color, then in (§7). */
import { useState } from 'react';
import { ROOM_KEY_LENGTH, isValidRoomCode, isValidRoomKey } from '@phrasey/shared';
import { Footer } from '../components/Footer';
import { IdentityForm } from '../components/IdentityForm';
import { TopBar } from '../components/TopBar';
import { Link, navigate } from '../lib/router';
import { useGameStore } from '../store/gameStore';

export function Join({ code, routeKey }: { code: string; routeKey: string | null }) {
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
  // A share link or QR carries the key; a hand-typed /join/KABO does not, so
  // we ask for it rather than letting a code alone into the room (§6.6).
  const [key, setKey] = useState(routeKey ?? '');
  const valid = isValidRoomCode(code);
  const keyOk = isValidRoomKey(key);

  async function join() {
    if (!keyOk) {
      setError('Enter the room key from the invite link.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await connect();
      const res = await joinRoom(code, key.toUpperCase());
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
            {/*
              Only shown when the link did not carry the key — i.e. someone
              typed the code by hand. The normal path (click the link, scan the
              QR) never sees this field.
            */}
            {!routeKey && (
              <div className="flex w-full max-w-md flex-col gap-1.5">
                <label htmlFor="room-key" className="font-mono text-[0.625rem] tracking-[0.16em] uppercase opacity-65">
                  Room key
                </label>
                <input
                  id="room-key"
                  value={key}
                  onChange={(e) => setKey(e.target.value.toUpperCase().slice(0, ROOM_KEY_LENGTH))}
                  maxLength={ROOM_KEY_LENGTH}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="M3XR"
                  aria-describedby="room-key-help"
                  className="w-full rounded-card border-2 border-ink/15 bg-white px-3 py-3 font-mono text-lg font-semibold tracking-[0.3em] uppercase"
                />
                <p id="room-key-help" className="text-xs opacity-55">
                  The four characters after the dash in the invite link.
                </p>
              </div>
            )}

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
