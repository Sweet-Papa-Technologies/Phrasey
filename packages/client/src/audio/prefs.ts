/**
 * Phrasey — the one owner of `phrasey.audio.v1`.
 *
 * Four separate things now persist under this key (master volume, mute, the
 * music bus level, and the player's Same-room choice) and they are written from
 * three places: `sfx.ts`, `music.ts`, and the store's boot-time snapshot. A
 * blind `setItem(JSON.stringify({volume, muted}))` from any one of them would
 * silently drop the other three, so every write goes through
 * `writeAudioPrefs`, which is read-modify-write.
 *
 * Nothing here throws. Private browsing, a disabled store, a hand-edited value
 * — all of it degrades to the defaults.
 */

export const AUDIO_STORAGE_KEY = 'phrasey.audio.v1';

/** Design doc §9: sound on by default, but quiet. */
export const DEFAULT_MASTER_VOLUME = 0.4;

/**
 * Music sits well under the effects so a cap crack still lands (§9). This is a
 * multiplier on the master, so the bed plays at 0.4 × 0.45 ≈ **18%** by
 * default and the player can push it up on its own slider.
 */
export const DEFAULT_MUSIC_VOLUME = 0.45;

export interface AudioPrefs {
  /** Master volume, 0..1. */
  volume: number;
  /** Master mute. Silences effects and music alike. */
  muted: boolean;
  /** Music bus level, 0..1, multiplied into the master. */
  musicVolume: number;
  /**
   * The player's own Same-room switch. `null` means they have never touched
   * it, which is the only state in which the host's room-level default applies.
   */
  sameRoom: boolean | null;
}

export const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  volume: DEFAULT_MASTER_VOLUME,
  muted: false,
  musicVolume: DEFAULT_MUSIC_VOLUME,
  sameRoom: null,
};

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Current stored prefs, with anything missing or hostile replaced by a default. */
export function readAudioPrefs(): AudioPrefs {
  const out: AudioPrefs = { ...DEFAULT_AUDIO_PREFS };
  const raw = safe(() => globalThis.localStorage?.getItem(AUDIO_STORAGE_KEY));
  if (!raw) return out;
  safe(() => {
    const p = JSON.parse(raw) as Partial<AudioPrefs> | null;
    if (!p || typeof p !== 'object') return;
    if (typeof p.volume === 'number' && Number.isFinite(p.volume)) out.volume = clamp01(p.volume);
    if (typeof p.muted === 'boolean') out.muted = p.muted;
    if (typeof p.musicVolume === 'number' && Number.isFinite(p.musicVolume)) {
      out.musicVolume = clamp01(p.musicVolume);
    }
    if (typeof p.sameRoom === 'boolean' || p.sameRoom === null) out.sameRoom = p.sameRoom;
  });
  return out;
}

/** Merge a patch into the stored prefs. Never clobbers a field it wasn't given. */
export function writeAudioPrefs(patch: Partial<AudioPrefs>): void {
  const next: AudioPrefs = { ...readAudioPrefs(), ...patch };
  safe(() => globalThis.localStorage?.setItem(AUDIO_STORAGE_KEY, JSON.stringify(next)));
}
