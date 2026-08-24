/**
 * "Same room" — §9 sound, §10 accessibility.
 *
 * When a group is physically together, every device playing the same bed is a
 * mess. One switch, two meanings, depending on who is holding the phone:
 *
 *  - **Host:** it broadcasts "we're all in one room" as a room-level default,
 *    so players who join later start quiet. Nothing local changes: the host's
 *    device keeps its audio, because it is the one making the noise for the
 *    table. A host who wants quiet uses the mute button like anyone else.
 *  - **Everyone else:** it drops *their* device to silence, music and effects
 *    both, and it sticks — a local choice always beats the room default.
 *
 * It is a real control, so: a proper `switch` role with a checked state, a
 * visible label, a plain-English one-liner, and it is reachable and operable
 * from the keyboard like any button.
 */
export interface SameRoomToggleProps {
  /** Switch position. Player: "my device is quiet". Host: the room default. */
  on: boolean;
  /** True on the host's device, which changes what the switch means. */
  isHost: boolean;
  onChange: (v: boolean) => void;
  /** Set when the host has broadcast it and this player has not overridden. */
  fromRoomDefault?: boolean;
}

export function SameRoomToggle({ on, isHost, onChange, fromRoomDefault }: SameRoomToggleProps) {
  const hint = isHost
    ? 'Your device stays the speaker. Everyone else joins quiet.'
    : 'One device plays the sound. Others stay quiet.';
  const state = isHost
    ? on
      ? 'On — everyone else joins quiet.'
      : 'Off — every device plays its own sound.'
    : on
      ? 'On — this device is quiet.'
      : 'Off — this device plays sound.';

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-describedby="same-room-hint"
        onClick={() => onChange(!on)}
        title={`Same room — ${hint}`}
        className={[
          'flex items-center gap-2 rounded-full border-2 px-2.5 py-1',
          'font-mono text-[0.625rem] tracking-[0.14em] uppercase',
          on ? 'border-grape bg-grape text-chill' : 'border-ink/15 hover:bg-ink/6',
        ].join(' ')}
      >
        <span
          aria-hidden="true"
          className={[
            'relative h-3.5 w-6 rounded-full transition-colors',
            on ? 'bg-chill/35' : 'bg-ink/20',
          ].join(' ')}
        >
          <span
            className={[
              'absolute top-0.5 h-2.5 w-2.5 rounded-full transition-all',
              on ? 'left-3 bg-chill' : 'left-0.5 bg-ink/60',
            ].join(' ')}
          />
        </span>
        {/*
          On a phone the words "Same room" are the widest thing in the top bar
          and the reason it wraps onto an extra row. The label goes visually
          quiet below `sm` — the switch, its state and its accessible name are
          all unchanged, and the icon plus the `title` still say what it is.
        */}
        <span className="sr-only sm:not-sr-only">Same room</span>
        {/* Never state-by-styling alone: the switch's meaning is also words. */}
        <span className="sr-only">
          {state}
          {fromRoomDefault ? ' Set by the host for this room; you can change it.' : ''}
        </span>
      </button>
      <span
        id="same-room-hint"
        className="sr-only max-w-[13rem] text-[0.625rem] leading-tight opacity-60 lg:not-sr-only"
      >
        {hint}
      </span>
    </span>
  );
}
