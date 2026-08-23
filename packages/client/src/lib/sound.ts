/**
 * Adapter for the audio module owned by the sound agent (`src/audio/`).
 *
 * That directory and `public/audio/**` are not ours to write, so this file
 * binds to its documented API and degrades to silence if it is missing or
 * mid-edit. `import.meta.glob` is the only way to reference a maybe-absent
 * module without failing the bundle, and every call is wrapped: audio is never
 * allowed to break a render.
 */

/** Exactly the names `src/audio/sfx.ts` exports. */
export type SfxName = 'capCrack' | 'iceClink' | 'boom' | 'hover' | 'snap' | 'turnChime' | 'tick';

export interface SfxOptions {
  volume?: number;
  rate?: number;
  pan?: number;
  delay?: number;
}

/** The subset of the audio module this client actually uses. */
interface AudioApi {
  initAudio?: () => boolean;
  armAudioUnlock?: () => void;
  playSfx?: (name: SfxName, opts?: SfxOptions) => void;
  setMasterVolume?: (v: number) => void;
  setMuted?: (b: boolean) => void;
  startPressureHiss?: (level?: number) => void;
  updatePressureHiss?: (level: number) => void;
  stopPressureHiss?: (fade?: number) => void;
  loadMusicManifest?: (url?: string) => Promise<unknown>;
  playMusic?: (idOrMood?: string, opts?: { gain?: number }) => Promise<boolean>;
  stopMusic?: (fade?: number) => void;
}

const modules = import.meta.glob('../audio/index.{ts,tsx,js}');

let api: AudioApi | null = null;
let loading: Promise<void> | null = null;
let pendingVolume: number | null = null;
let pendingMuted: boolean | null = null;

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** Load the sound agent's module if it is there. Safe to call repeatedly. */
export function initSound(): Promise<void> {
  if (loading) return loading;
  const key = Object.keys(modules)[0];
  const load = key ? modules[key] : undefined;
  if (!load) {
    loading = Promise.resolve();
    return loading;
  }
  loading = Promise.resolve(load())
    .then((m) => {
      api = (m ?? null) as AudioApi | null;
      // The module arms its own unlock-on-first-gesture listeners on import.
      if (pendingVolume !== null) safe(() => api?.setMasterVolume?.(pendingVolume!));
      if (pendingMuted !== null) safe(() => api?.setMuted?.(pendingMuted!));
      void safe(() => api?.loadMusicManifest?.());
    })
    .catch(() => {
      api = null;
    });
  return loading;
}

export function playSfx(name: SfxName, opts?: SfxOptions): void {
  safe(() => api?.playSfx?.(name, opts));
}

/**
 * The reveal cascade, in sound: one ice clink per tile, on the same 40ms
 * stagger as the flips, pitched up a little as the run goes on (§9).
 */
export function playRevealCascade(delaysMs: readonly number[]): void {
  const ordered = [...delaysMs].sort((a, b) => a - b).slice(0, 12);
  ordered.forEach((delayMs, i) => {
    playSfx('iceClink', { delay: delayMs / 1000, rate: 0.94 + i * 0.045, volume: 0.9 });
  });
}

export function setMuted(next: boolean): void {
  pendingMuted = next;
  safe(() => api?.setMuted?.(next));
}

export function setVolume(next: number): void {
  const v = Math.min(1, Math.max(0, next));
  pendingVolume = v;
  safe(() => api?.setMasterVolume?.(v));
}

/** Shared pressure as a continuous hiss, 0–1. Silent at zero. */
export function setPressureLevel(level: number): void {
  const v = Math.min(1, Math.max(0, level));
  if (v <= 0.001) {
    safe(() => api?.stopPressureHiss?.());
    return;
  }
  safe(() => {
    api?.startPressureHiss?.(v);
    api?.updatePressureHiss?.(v);
  });
}

/** `lobby` or `gameplay` — the moods declared in the music manifest. */
export function setMusicMood(mood: 'lobby' | 'gameplay' | null): void {
  if (mood === null) {
    safe(() => api?.stopMusic?.());
    return;
  }
  void safe(() => api?.playMusic?.(mood));
}
