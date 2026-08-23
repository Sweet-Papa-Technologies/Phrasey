/**
 * Phrasey — manifest-driven music player.
 *
 * Design doc §9: tracks live in `public/audio/music/` behind a `manifest.json`
 * the client reads at load, "so tracks can be dropped in without a rebuild".
 * Nothing here hard-codes a filename; drop an .ogg in, add a manifest row, done.
 *
 * Deliberately built on HTMLAudioElement rather than the Web Audio graph: it
 * streams instead of decoding the whole file up front, and it keeps working
 * before the user has produced the gesture that unlocks an AudioContext.
 * Master volume and mute still apply — we subscribe to them from `sfx.ts`.
 */

import { onAudioSettingsChange } from './sfx';

export interface MusicTrack {
  /** Stable key. `playMusic('lobby-bed')`. */
  id: string;
  title: string;
  /** Primary source, site-root-relative. Usually .ogg. */
  file: string;
  /** Played instead when the browser can't decode `file`. Usually .mp3. */
  fallbackFile?: string;
  durationSeconds: number;
  bpm: number;
  loop: boolean;
  /** Free-form tag. The app looks for `lobby` and `gameplay`. */
  mood: string;
}

export interface MusicManifest {
  version: number;
  tracks: MusicTrack[];
}

export interface PlayMusicOptions {
  /** Crossfade length in seconds. Default 1.5. */
  crossfadeSeconds?: number;
  /** Per-track trim, 0..1. Default 1. */
  gain?: number;
  /** Start position in seconds. Default 0. */
  startAt?: number;
}

export const DEFAULT_MANIFEST_URL = '/audio/music/manifest.json';
/** Music sits under the effects so a cap crack still cuts through. */
export const DEFAULT_MUSIC_VOLUME = 0.55;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let manifest: MusicManifest | null = null;
let manifestPromise: Promise<MusicManifest> | null = null;

let musicVolume = DEFAULT_MUSIC_VOLUME;
let masterEffective = 0.4;

interface Deck {
  el: HTMLAudioElement;
  track: MusicTrack;
  /** Per-track trim from PlayMusicOptions. */
  gain: number;
  /** 0..1 fade position, multiplied into the element volume. */
  fade: number;
}

let current: Deck | null = null;
let outgoing: Deck[] = [];
let fadeTimer: ReturnType<typeof setInterval> | null = null;

onAudioSettingsChange((s) => {
  masterEffective = s.effective;
  applyVolumes();
});

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function isTrack(t: unknown): t is MusicTrack {
  const o = t as Partial<MusicTrack> | null;
  return !!o && typeof o.id === 'string' && typeof o.file === 'string';
}

function normalize(raw: unknown): MusicManifest {
  const o = raw as Partial<MusicManifest> | null;
  const tracks = Array.isArray(o?.tracks) ? o!.tracks.filter(isTrack) : [];
  return {
    version: typeof o?.version === 'number' ? o!.version : 1,
    tracks: tracks.map((t) => ({
      id: t.id,
      title: typeof t.title === 'string' ? t.title : t.id,
      file: t.file,
      fallbackFile: typeof t.fallbackFile === 'string' ? t.fallbackFile : undefined,
      durationSeconds: Number.isFinite(t.durationSeconds) ? t.durationSeconds : 0,
      bpm: Number.isFinite(t.bpm) ? t.bpm : 0,
      loop: t.loop !== false,
      mood: typeof t.mood === 'string' ? t.mood : '',
    })),
  };
}

/**
 * Fetch and cache the manifest. A missing or malformed manifest yields an empty
 * track list rather than an error — the game is still playable in silence.
 */
export function loadMusicManifest(url: string = DEFAULT_MANIFEST_URL): Promise<MusicManifest> {
  if (manifestPromise) return manifestPromise;
  manifestPromise = (async () => {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      manifest = normalize(await res.json());
    } catch {
      manifest = { version: 0, tracks: [] };
    }
    return manifest;
  })();
  return manifestPromise;
}

/** Tracks from the last loaded manifest. Empty until `loadMusicManifest` resolves. */
export function getTracks(): MusicTrack[] {
  return manifest ? manifest.tracks.slice() : [];
}

/** Resolve by exact id first, then by mood tag. */
export function findTrack(idOrMood: string): MusicTrack | null {
  if (!manifest) return null;
  return (
    manifest.tracks.find((t) => t.id === idOrMood) ??
    manifest.tracks.find((t) => t.mood === idOrMood) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function canPlay(el: HTMLAudioElement, file: string): boolean {
  if (typeof el.canPlayType !== 'function') return true;
  const type = file.endsWith('.ogg')
    ? 'audio/ogg; codecs=vorbis'
    : file.endsWith('.mp3')
      ? 'audio/mpeg'
      : file.endsWith('.m4a') || file.endsWith('.aac')
        ? 'audio/mp4'
        : '';
  if (!type) return true;
  return (safe(() => el.canPlayType(type)) ?? '') !== '';
}

function sourceFor(el: HTMLAudioElement, track: MusicTrack): string {
  if (canPlay(el, track.file)) return track.file;
  if (track.fallbackFile && canPlay(el, track.fallbackFile)) return track.fallbackFile;
  return track.fallbackFile ?? track.file;
}

function makeDeck(track: MusicTrack, gain: number): Deck | null {
  return (
    safe(() => {
      const Ctor = (globalThis as { Audio?: typeof Audio }).Audio;
      if (!Ctor) return null;
      const el = new Ctor();
      el.src = sourceFor(el, track);
      el.loop = track.loop;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.volume = 0;
      return { el, track, gain: clamp01(gain), fade: 0 } as Deck;
    }) ?? null
  );
}

function applyVolumes(): void {
  const set = (d: Deck) => {
    safe(() => {
      d.el.volume = clamp01(masterEffective * musicVolume * d.gain * d.fade);
    });
  };
  if (current) set(current);
  for (const d of outgoing) set(d);
}

function ensureFadeLoop(stepMs: number, perStep: number): void {
  if (fadeTimer) return;
  fadeTimer = setInterval(() => {
    let busy = false;
    if (current && current.fade < 1) {
      current.fade = Math.min(1, current.fade + perStep);
      busy = true;
    }
    for (const d of outgoing) {
      d.fade = Math.max(0, d.fade - perStep);
      if (d.fade > 0) busy = true;
    }
    const dead = outgoing.filter((d) => d.fade <= 0);
    if (dead.length) {
      outgoing = outgoing.filter((d) => d.fade > 0);
      for (const d of dead) {
        safe(() => d.el.pause());
        safe(() => {
          d.el.src = '';
        });
      }
    }
    applyVolumes();
    if (!busy && fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }, stepMs);
}

/**
 * Start a track, crossfading out whatever is playing. Accepts a track id or a
 * mood tag; with no argument it plays the first track in the manifest.
 *
 * Resolves `true` if playback actually started. It resolves `false` — it does
 * not throw — when the manifest is empty, the track is unknown, or the browser
 * refused autoplay because there has been no user gesture yet.
 */
export async function playMusic(
  idOrMood?: string,
  opts: PlayMusicOptions = {},
): Promise<boolean> {
  if (!manifest) await loadMusicManifest();
  const track = idOrMood ? findTrack(idOrMood) : (manifest?.tracks[0] ?? null);
  if (!track) return false;
  if (current && current.track.id === track.id) return true;

  const deck = makeDeck(track, opts.gain ?? 1);
  if (!deck) return false;
  if (typeof opts.startAt === 'number') {
    safe(() => {
      deck.el.currentTime = Math.max(0, opts.startAt!);
    });
  }

  if (current) outgoing.push(current);
  current = deck;
  applyVolumes();

  const seconds = Math.max(0.05, opts.crossfadeSeconds ?? 1.5);
  const stepMs = 50;
  ensureFadeLoop(stepMs, stepMs / (seconds * 1000));

  const started = await (safe(() => deck.el.play()) ?? Promise.reject(new Error('no play')))
    .then(() => true)
    .catch(() => false);

  if (!started) {
    // Autoplay was blocked. Keep the deck loaded so a later gesture can just
    // call playMusic again cheaply, but report the truth to the caller.
    return false;
  }
  return true;
}

/** Fade out and release everything. Safe to call when nothing is playing. */
export function stopMusic(fadeSeconds = 1.0): void {
  if (current) {
    outgoing.push(current);
    current = null;
  }
  if (!outgoing.length) return;
  const stepMs = 50;
  ensureFadeLoop(stepMs, stepMs / (Math.max(0.05, fadeSeconds) * 1000));
}

/** Music bus level, 0..1, independent of master volume. Non-finite is ignored. */
export function setMusicVolume(v: number): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) return;
  musicVolume = clamp01(v);
  applyVolumes();
}

export function getMusicVolume(): number {
  return musicVolume;
}

export function getCurrentTrack(): MusicTrack | null {
  return current ? current.track : null;
}

export function isMusicPlaying(): boolean {
  return !!current && !!safe(() => !current!.el.paused);
}

/** Tear down for tests / unmount. */
export function disposeMusic(): void {
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
  for (const d of [current, ...outgoing]) {
    if (!d) continue;
    safe(() => d.el.pause());
    safe(() => {
      d.el.src = '';
    });
  }
  current = null;
  outgoing = [];
  manifest = null;
  manifestPromise = null;
}
