/**
 * The honest answer to "is this thing still on?".
 *
 * A phone that loses its socket used to give the player nothing: the board
 * simply stopped moving and stayed that way. A frozen board is the worst
 * possible failure, because it is indistinguishable from a slow turn — people
 * sit there tapping a dead screen waiting for bots that are never going to
 * move. This component makes the link state impossible to mistake.
 *
 * Three shapes, deliberately different weights:
 *
 *  1. RECONNECTING — a small banner pinned to the bottom. Non-blocking on
 *     purpose: the board is still worth looking at, and the reconnect needs no
 *     input. After ten seconds it starts saying how long, because silence past
 *     that reads as "broken" even when it is working.
 *  2. BACK — a brief green flash. Being told you are back matters as much as
 *     being told you left; without it the reconnect is invisible and the player
 *     never learns to trust it. Auto-dismisses.
 *  3. SEAT LOST — a real dialog. This one has to be read, because the outcome
 *     is not what the player expects and there is a decision to make.
 *
 * Bottom-anchored and safe-area padded: on a phone the top of the screen is
 * the room code and the bottom is where the thumb already is.
 */
import { useEffect, useState } from 'react';
import { useGameStore } from '../store/gameStore';

/** How long "Back in the game" stays up. Long enough to read, short enough to ignore. */
const RECOVERED_FLASH_MS = 2600;
/** Past this, a bare "Reconnecting…" starts to look like a hang. */
const PATIENCE_MS = 10_000;

export function ConnectionOverlay(): React.ReactElement | null {
  const linkPhase = useGameStore((s) => s.linkPhase);
  const transportKind = useGameStore((s) => s.transportKind);
  const resumeToken = useGameStore((s) => s.resumeToken);
  const seatLost = useGameStore((s) => s.seatLost);
  const room = useGameStore((s) => s.room);
  const resume = useGameStore((s) => s.resume);
  const dismissSeatLost = useGameStore((s) => s.dismissSeatLost);

  const [flash, setFlash] = useState(false);
  const [waitedMs, setWaitedMs] = useState(0);
  const [retrying, setRetrying] = useState(false);

  const down = linkPhase === 'reconnecting' || linkPhase === 'resuming';

  // "Back in the game", but only after a reclaim that actually followed a drop.
  // The very first connect also lands on `live`, and congratulating someone for
  // connecting normally is noise.
  useEffect(() => {
    if (resumeToken === 0) return;
    setFlash(true);
    const id = setTimeout(() => setFlash(false), RECOVERED_FLASH_MS);
    return () => clearTimeout(id);
  }, [resumeToken]);

  // A ticking count, not a spinner alone: "12s" tells the player the app is
  // still awake. Reset every time the link goes down again.
  useEffect(() => {
    if (!down) {
      setWaitedMs(0);
      return;
    }
    const started = Date.now();
    const id = setInterval(() => setWaitedMs(Date.now() - started), 1000);
    return () => clearInterval(id);
  }, [down]);

  // The landing page's demo board runs on the in-memory mock, which cannot
  // drop. Never put a connection banner over it.
  if (transportKind !== 'socket') return null;

  if (linkPhase === 'seat-lost' || (seatLost && !seatLost.recovered)) {
    return (
      <SeatLostDialog
        message={seatLost?.message ?? 'That room has closed.'}
        code={seatLost?.code ?? room?.code ?? ''}
        retrying={retrying}
        onRetry={() => {
          setRetrying(true);
          void resume('manual-retry').finally(() => setRetrying(false));
        }}
      />
    );
  }

  if (down) {
    const secs = Math.floor(waitedMs / 1000);
    return (
      <Banner tone="warn">
        <Pulse />
        <span className="font-semibold">
          {linkPhase === 'resuming' ? 'Getting your seat back…' : 'Reconnecting…'}
        </span>
        <span className="opacity-75">
          {waitedMs >= PATIENCE_MS
            ? `Still trying (${secs}s). Your seat is held.`
            : 'Your seat is held.'}
        </span>
      </Banner>
    );
  }

  if (seatLost?.recovered) {
    return (
      <Banner tone="warn">
        <span className="font-semibold">New seat</span>
        <span className="opacity-80">{seatLost.message}</span>
        <button
          type="button"
          onClick={dismissSeatLost}
          className="ml-auto shrink-0 rounded-full border-2 border-ink/25 px-3 py-1 text-xs font-bold"
        >
          Got it
        </button>
      </Banner>
    );
  }

  if (flash) {
    return (
      <Banner tone="ok">
        <span className="font-semibold">Back in the game</span>
        <span className="opacity-80">Nothing was lost — same seat, same score.</span>
      </Banner>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------

function Banner({ tone, children }: { tone: 'ok' | 'warn'; children: React.ReactNode }) {
  const skin = tone === 'ok' ? 'bg-lime text-ink' : 'bg-soda text-ink';
  return (
    <div
      // `pointer-events-none` on the rail so the banner never eats a tap meant
      // for a card underneath it; the button inside re-enables its own.
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div
        role="status"
        aria-live="polite"
        className={`pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-x-2 gap-y-1 rounded-card border-2 border-ink/20 px-3 py-2.5 text-sm shadow-pop ${skin}`}
      >
        {children}
      </div>
    </div>
  );
}

/** A soft breathing dot. Motion, but nothing that jumps. */
function Pulse() {
  return (
    <span aria-hidden className="relative inline-flex size-2.5 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-ink/50" />
      <span className="relative inline-flex size-2.5 rounded-full bg-ink" />
    </span>
  );
}

function SeatLostDialog({
  message,
  code,
  retrying,
  onRetry,
}: {
  message: string;
  code: string;
  retrying: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-ink/55 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-6 sm:place-items-center sm:pb-6 backdrop-blur-sm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="seat-lost-title"
        aria-describedby="seat-lost-body"
        className="w-full max-w-md rounded-slab border-2 border-ink/15 bg-chill p-5 text-ink shadow-slab"
      >
        <p className="sticker mb-2 bg-cherry text-white">Disconnected</p>
        <h2 id="seat-lost-title" className="font-display text-2xl font-extrabold">
          You lost your seat
        </h2>
        <p id="seat-lost-body" className="mt-2 text-sm opacity-80">
          {message} {code && <>Room {code} is no longer holding a place for you.</>}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="rounded-full bg-fanta px-5 py-2.5 font-bold text-ink shadow-pop disabled:opacity-60"
          >
            {retrying ? 'Trying…' : 'Try again'}
          </button>
          <a
            href="/"
            className="rounded-full border-2 border-ink/25 px-5 py-2.5 font-bold text-ink"
          >
            Start a new room
          </a>
        </div>
      </div>
    </div>
  );
}
