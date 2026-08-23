/**
 * Landing (§9): "The hero is not a stat block with a gradient. The hero IS the
 * game … and a single Start a room button. Show the thing; don't describe it."
 *
 * So: a live demo board, a bottle that fills, one primary button, and a join
 * field. The prose underneath is three short lines and stays out of the way.
 */
import { useState } from 'react';
import { motion } from 'motion/react';
import { formatRoomHandle, isValidRoomCode, parseRoomHandle } from '@phrasey/shared';
import { DemoBoard } from '../components/DemoBoard';
import { Footer } from '../components/Footer';
import { IdentityForm } from '../components/IdentityForm';
import { TopBar } from '../components/TopBar';
import { navigate } from '../lib/router';
import { useReducedMotion } from '../lib/motion';
import { useGameStore } from '../store/gameStore';

export function Landing() {
  const reduced = useReducedMotion();
  const identity = useGameStore((s) => s.identity);
  const setIdentity = useGameStore((s) => s.setIdentity);
  const connect = useGameStore((s) => s.connect);
  const createRoom = useGameStore((s) => s.createRoom);
  const connection = useGameStore((s) => s.connection);
  const transportKind = useGameStore((s) => s.transportKind);
  const muted = useGameStore((s) => s.muted);
  const volume = useGameStore((s) => s.volume);
  const setMuted = useGameStore((s) => s.setMuted);
  const setVolume = useGameStore((s) => s.setVolume);

  const [hosting, setHosting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);

  async function startRoom() {
    setBusy(true);
    try {
      await connect();
      const res = await createRoom();
      if (res.ok) {
        const room = (res.data as { room: { code: string } }).room;
        navigate(`/room/${room.code}`);
      }
    } finally {
      setBusy(false);
    }
  }

  function submitCode(e: React.FormEvent) {
    e.preventDefault();
    const raw = code.trim();
    // Accept either a bare code ("KABO") or a whole pasted handle
    // ("KABO-M3XR"). Pasting the invite should not be the wrong move.
    const handle = parseRoomHandle(raw);
    if (handle) {
      navigate(`/join/${formatRoomHandle(handle.code, handle.key)}`);
      return;
    }
    const c = raw.toUpperCase();
    if (!isValidRoomCode(c)) {
      setCodeError('Room codes are four letters, alternating consonant and vowel — like KABO.');
      return;
    }
    navigate(`/join/${c}`);
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

      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 pb-10">
        <div className="flex flex-col gap-2 pt-2">
          <p className="sticker w-fit bg-grape text-chill">Now serving · 2–8 players · no download</p>
          <h1 className="max-w-3xl text-[clamp(2.25rem,6.5vw,4.5rem)] leading-[0.95] font-extrabold tracking-tight">
            You can only guess the letters you&apos;re <span className="text-fanta">holding</span>.
          </h1>
          <p className="max-w-xl text-lg opacity-70">
            Every wrong guess shakes the same bottle. Everybody loses when it blows.
          </p>
        </div>

        {/* The hero: an actual game, mid-round, on a loop. */}
        <motion.div
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.15 : 0.5, ease: [0.16, 1, 0.3, 1] }}
        >
          <DemoBoard />
        </motion.div>

        <div className="grid gap-6 rounded-slab border-2 border-ink/10 bg-white/60 p-5 sm:p-7 lg:grid-cols-2">
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-bold">Start a room</h2>
            {hosting ? (
              <IdentityForm
                autoFocus
                name={identity.name}
                color={identity.color}
                busy={busy}
                submitLabel="Open the room"
                onChange={setIdentity}
                onSubmit={() => void startRoom()}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setHosting(true)}
                  className="w-fit rounded-full bg-fanta px-8 py-4 font-display text-xl font-extrabold text-ink shadow-pop transition-transform hover:-translate-y-0.5"
                >
                  Start a room
                </button>
                <p className="text-sm opacity-65">
                  You get a four-letter code and a link. Share either one. Bots fill the empty seats.
                </p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-4 lg:border-l-2 lg:border-ink/10 lg:pl-7">
            <h2 className="font-display text-2xl font-bold">Got a code?</h2>
            <form className="flex flex-col gap-3" onSubmit={submitCode}>
              <label htmlFor="join-code" className="font-mono text-[0.625rem] tracking-[0.16em] uppercase opacity-65">
                Room code
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="join-code"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4));
                    setCodeError(null);
                  }}
                  placeholder="KABO"
                  autoComplete="off"
                  spellCheck={false}
                  aria-invalid={!!codeError}
                  aria-describedby={codeError ? 'join-code-error' : undefined}
                  className="w-40 rounded-card border-2 border-ink/15 bg-white px-3 py-3 font-mono text-2xl font-extrabold tracking-[0.2em] uppercase"
                />
                <button
                  type="submit"
                  className="rounded-full bg-grape px-6 py-3 font-display text-lg font-bold text-chill shadow-pop"
                >
                  Join
                </button>
              </div>
              {codeError && (
                <p id="join-code-error" className="text-sm text-cherry" role="alert">
                  {codeError}
                </p>
              )}
            </form>
          </div>
        </div>

        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            ['Play a letter you hold', 'Every occurrence flips. Ten points each.'],
            ['Or keep it and solve', 'Solving early, with the board still dark, is worth the most.'],
            ['Miss and the bottle fills', 'Twelve wrong guesses and it goes off on everybody.'],
          ].map(([title, body], i) => (
            <li key={title} className="rounded-card border-2 border-ink/10 bg-white/55 p-4">
              <p className="sticker mb-2 bg-ink text-chill">0{i + 1}</p>
              <h3 className="font-display text-lg font-bold">{title}</h3>
              <p className="text-sm opacity-70">{body}</p>
            </li>
          ))}
        </ol>
      </main>

      <Footer />
    </div>
  );
}
