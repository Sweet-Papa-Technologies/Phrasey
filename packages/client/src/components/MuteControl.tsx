/**
 * Master mute lives in the top bar, defaulted on at 40% volume (§9).
 *
 * Two sliders, because music and effects are two buses: the master sets the
 * table for everything, and the music one trims the bed underneath it so a cap
 * crack still cuts through. The music slider is optional — screens without a
 * music bed simply omit it.
 */
export interface MuteControlProps {
  muted: boolean;
  volume: number;
  onMuted: (v: boolean) => void;
  onVolume: (v: number) => void;
  /** Music bus level, 0..1. Omit to hide the music slider. */
  musicVolume?: number;
  onMusicVolume?: (v: number) => void;
}

export function MuteControl({
  muted,
  volume,
  onMuted,
  onVolume,
  musicVolume,
  onMusicVolume,
}: MuteControlProps) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => onMuted(!muted)}
        aria-pressed={muted}
        aria-label={muted ? 'Unmute sound' : 'Mute sound'}
        title={muted ? 'Unmute' : 'Mute'}
        className="grid h-9 w-9 place-items-center rounded-full border-2 border-current/15 hover:bg-current/8"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" />
          {muted ? (
            <path d="M17 9l4 6M21 9l-4 6" strokeLinecap="round" />
          ) : (
            <path d="M17 8.5a5 5 0 0 1 0 7" strokeLinecap="round" />
          )}
        </svg>
      </button>
      {/*
        The sliders are a nicety; the mute button is the control that matters.
        On a phone they hide rather than wrapping the top bar onto a third row —
        the button still mutes, and both levels persist.
      */}
      <label className="hidden items-center gap-1.5 sm:flex">
        <span className="sr-only">Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => onVolume(Number(e.target.value) / 100)}
          className="h-1.5 w-20 accent-fanta"
          aria-label="Volume"
        />
      </label>
      {typeof musicVolume === 'number' && onMusicVolume && (
        <label className="hidden items-center gap-1 sm:flex" title="Music volume">
          <svg
            viewBox="0 0 24 24"
            className="h-3.5 w-3.5 opacity-55"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            aria-hidden="true"
          >
            <path d="M9 18V6l10-2v12" strokeLinejoin="round" />
            <circle cx="6.5" cy="18" r="2.5" />
            <circle cx="16.5" cy="16" r="2.5" />
          </svg>
          <span className="sr-only">Music volume</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(musicVolume * 100)}
            onChange={(e) => onMusicVolume(Number(e.target.value) / 100)}
            className="h-1.5 w-16 accent-grape"
            aria-label="Music volume"
          />
        </label>
      )}
    </div>
  );
}
