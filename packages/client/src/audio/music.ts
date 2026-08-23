/**
 * Phrasey — manifest-driven music player.
 *
 * Design doc §9: tracks live in `public/audio/music/` behind a `manifest.json`
 * the client reads at load, "so tracks can be dropped in without a rebuild".
 * Nothing here hard-codes a filename; drop an .ogg in, add a manifest row, done.
 *
 * ## Two playback backends, and why
 *
 * The beds are ~32s and they loop for the whole match, so the loop point is
 * heard dozens of times a round. `HTMLAudioElement.loop` jumps the playhead
 * from the last sample straight back to the first: there is no overlap, the
 * waveform is discontinuous at the join, and several browsers add a short
 * re-buffer on top. That is the jitter.
 *
 * So the preferred backend is Web Audio. The file is fetched and decoded once
 * into an AudioBuffer, then each pass through the loop is its own
 * `AudioBufferSourceNode` scheduled on the context's sample clock. Pass n+1 is
 * started `crossfadeSeconds` *before* pass n ends and the two are crossfaded
 * against each other with an **equal-power** (sin/cos) pair of curves, so the
 * summed power through the seam is constant instead of dipping ~3 dB the way a
 * linear pair would. The overlap length is per track, from the manifest, so a
 * human dropping in a Suno bed can tune it without touching this file.
 *
 * The HTMLAudioElement path is kept as the fallback for every case where Web
 * Audio can't be had — no AudioContext, no `fetch`, a 404, a codec the decoder
 * refuses. It behaves exactly as it always did. Nothing here throws, and audio
 * never degrades to an error: worst case it degrades to the old seam, and
 * worst-worst case to silence.
 */

import { getAudioContext, initAudio, onAudioSettingsChange } from './sfx';
import { DEFAULT_MUSIC_VOLUME, readAudioPrefs, writeAudioPrefs } from './prefs';

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
  /**
   * Seconds of overlap between one pass of the loop and the next. Tunable per
   * track from the manifest; `0` disables the playback overlap entirely (for a
   * bed whose seam is already baked into the file). Clamped to just under half
   * the real decoded duration.
   */
  loopCrossfadeSeconds: number;
  /** Free-form tag. The app looks for `lobby` and `gameplay`. */
  mood: string;
}

export interface MusicManifest {
  version: number;
  tracks: MusicTrack[];
}

export interface PlayMusicOptions {
  /** Track-to-track fade length in seconds. Default 1.5. */
  crossfadeSeconds?: number;
  /** Per-track trim, 0..1. Default 1. */
  gain?: number;
  /** Start position in seconds. Default 0. */
  startAt?: number;
  /**
   * Overlap the two tracks instead of handing off. Off by default: the beds
   * share a tempo, so overlapping them phases one against the other and sounds
   * like a doubled copy of the same track rather than a crossfade.
   */
  overlap?: boolean;
}

/**
 * How far the outgoing deck must fall before the incoming one starts rising.
 * Not zero — a hard gap between beds is its own kind of ugly — but low enough
 * that the two are never both audible at a level where they can beat against
 * each other.
 */
export const HANDOFF_LEVEL = 0.12;

export const DEFAULT_MANIFEST_URL = '/audio/music/manifest.json';
/** Music bus default. See `prefs.ts` — ~18% effective under the 40% master. */
export { DEFAULT_MUSIC_VOLUME };

/** Used when a manifest row omits `loopCrossfadeSeconds`. */
export const DEFAULT_LOOP_CROSSFADE_SECONDS = 1.5;

/** Samples in a fade curve. 128 is inaudibly smooth and costs nothing. */
const FADE_CURVE_STEPS = 128;
/** How far ahead of the playhead loop passes are scheduled. */
const LOOKAHEAD_SECONDS = 6;
/** How often the scheduler tops the queue back up. */
const SCHEDULER_INTERVAL_MS = 1000;
/** Track-to-track crossfade tick. */
const FADE_STEP_MS = 50;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Loop maths — pure, exported, and the part worth testing directly
// ---------------------------------------------------------------------------

/**
 * One half of an equal-power crossfade: `sin(p·π/2)` in, `cos(p·π/2)` out.
 *
 * The pair satisfies `in² + out² = 1` at every point, so two uncorrelated
 * passes summed through them hold constant *power* across the seam. The naive
 * linear pair (`p` / `1-p`) holds constant amplitude instead, which for
 * anything but perfectly correlated material dips to -3 dB at the midpoint —
 * an audible dent once a bar, which is exactly what "jittery on loop" means.
 */
export function equalPowerFadeCurve(
  direction: 'in' | 'out',
  steps: number = FADE_CURVE_STEPS,
): Float32Array<ArrayBuffer> {
  const n = Math.max(2, Math.floor(steps));
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const p = i / (n - 1);
    curve[i] = direction === 'in' ? Math.sin((p * Math.PI) / 2) : Math.cos((p * Math.PI) / 2);
  }
  return curve;
}

/** Hard ceiling on the overlap, as a fraction of the track's real duration. */
const MAX_CROSSFADE_FRACTION = 0.49;

/**
 * The manifest's `loopCrossfadeSeconds` for this track, clamped against the
 * real decoded duration.
 *
 * The ceiling is just under half the track: at exactly half, a pass's fade-in
 * window would end on the same instant its fade-out window begins, and Web
 * Audio throws `NotSupportedError` when two automation events touch.
 */
export function resolveLoopCrossfade(
  track: Pick<MusicTrack, 'loopCrossfadeSeconds'>,
  duration: number,
): number {
  const raw =
    typeof track.loopCrossfadeSeconds === 'number' && Number.isFinite(track.loopCrossfadeSeconds)
      ? track.loopCrossfadeSeconds
      : DEFAULT_LOOP_CROSSFADE_SECONDS;
  const d = Number.isFinite(duration) && duration > 0 ? duration : 0;
  if (d <= 0) return 0;
  return Math.max(0, Math.min(raw, d * MAX_CROSSFADE_FRACTION));
}

/**
 * Gap between the start of one pass and the start of the next. Passes overlap
 * by the crossfade, so the loop advances by `duration - crossfade` each time.
 */
export function loopPeriod(duration: number, crossfade: number): number {
  return Math.max(0.05, duration - Math.max(0, crossfade));
}

/**
 * Context time at which loop pass `index` starts.
 *
 * Deliberately computed from the anchor rather than accumulated off the
 * previous pass: a party game leaves this running for an hour, and adding a
 * float 100+ times drifts the seam off the sample grid.
 */
export function loopPassStartTime(
  anchor: number,
  index: number,
  duration: number,
  crossfade: number,
): number {
  return anchor + index * loopPeriod(duration, crossfade);
}

const FADE_IN_CURVE = equalPowerFadeCurve('in');
const FADE_OUT_CURVE = equalPowerFadeCurve('out');

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let manifest: MusicManifest | null = null;
let manifestPromise: Promise<MusicManifest> | null = null;

let musicVolume = readAudioPrefs().musicVolume;
let masterEffective = 0.4;

interface DeckCommon {
  track: MusicTrack;
  /** Per-track trim from PlayMusicOptions. */
  gain: number;
  /** 0..1 track-to-track fade position, multiplied into the deck output. */
  fade: number;
  /**
   * Wait for the outgoing deck to clear before fading in, rather than
   * overlapping it. Set for every track change unless the caller opted into
   * an overlap.
   */
  sequential?: boolean;
}

interface ElementDeck extends DeckCommon {
  kind: 'element';
  el: HTMLAudioElement;
}

interface LoopPass {
  src: AudioBufferSourceNode;
  g: GainNode;
  /** Context time this pass finishes. */
  endsAt: number;
}

interface BufferDeck extends DeckCommon {
  kind: 'buffer';
  ctx: AudioContext;
  buffer: AudioBuffer;
  /** Deck output: master × music × per-track gain × track-to-track fade. */
  out: GainNode;
  duration: number;
  crossfade: number;
  /** Context time pass 0 would have begun at offset 0. */
  anchor: number;
  nextPass: number;
  passes: LoopPass[];
  timer: ReturnType<typeof setInterval> | null;
}

type Deck = ElementDeck | BufferDeck;

let current: Deck | null = null;
let outgoing: Deck[] = [];
let fadeTimer: ReturnType<typeof setInterval> | null = null;

/** Decoded buffers, keyed by URL. Decoding a 32s bed is not free; do it once. */
const buffers = new Map<string, AudioBuffer>();
const decoding = new Map<string, Promise<AudioBuffer | null>>();

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
      loopCrossfadeSeconds:
        typeof t.loopCrossfadeSeconds === 'number' && Number.isFinite(t.loopCrossfadeSeconds)
          ? Math.max(0, t.loopCrossfadeSeconds)
          : DEFAULT_LOOP_CROSSFADE_SECONDS,
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
// Source selection
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

function newAudioElement(): HTMLAudioElement | null {
  return (
    safe(() => {
      const Ctor = (globalThis as { Audio?: typeof Audio }).Audio;
      return Ctor ? new Ctor() : null;
    }) ?? null
  );
}

/** `canPlayType` on a throwaway element is the cheapest codec probe we have. */
let probe: HTMLAudioElement | null | undefined;
function pickSourceUrl(track: MusicTrack): string {
  if (probe === undefined) probe = newAudioElement();
  return probe ? sourceFor(probe, track) : track.file;
}

// ---------------------------------------------------------------------------
// Element deck (fallback backend)
// ---------------------------------------------------------------------------

function makeElementDeck(track: MusicTrack, gain: number, startAt: number): ElementDeck | null {
  return (
    safe(() => {
      const el = newAudioElement();
      if (!el) return null;
      el.src = sourceFor(el, track);
      el.loop = track.loop;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.volume = 0;
      if (startAt > 0) safe(() => (el.currentTime = startAt));
      return { kind: 'element', el, track, gain: clamp01(gain), fade: 0 } as ElementDeck;
    }) ?? null
  );
}

// ---------------------------------------------------------------------------
// Buffer deck (preferred backend) — the loop scheduler
// ---------------------------------------------------------------------------

function decodeAudio(ctx: AudioContext, bytes: ArrayBuffer): Promise<AudioBuffer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (b: AudioBuffer | null) => {
      if (!settled) {
        settled = true;
        resolve(b);
      }
    };
    const ok = safe(() => {
      // Both signatures: modern browsers return a promise, older Safari only
      // takes the success/failure callbacks.
      const r = ctx.decodeAudioData(
        bytes,
        (b) => done(b),
        () => done(null),
      ) as unknown as Promise<AudioBuffer> | undefined;
      if (r && typeof r.then === 'function') r.then(done, () => done(null));
      return true;
    });
    if (!ok) done(null);
  });
}

async function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = buffers.get(url);
  if (cached) return cached;
  const pending = decoding.get(url);
  if (pending) return pending;

  const job = (async () => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(String(res.status));
      const bytes = await res.arrayBuffer();
      const buf = await decodeAudio(ctx, bytes);
      if (buf) buffers.set(url, buf);
      return buf;
    } catch {
      return null;
    } finally {
      decoding.delete(url);
    }
  })();
  decoding.set(url, job);
  return job;
}

function setFadeCurve(
  param: AudioParam,
  curve: Float32Array<ArrayBuffer>,
  at: number,
  duration: number,
): void {
  const t = Math.max(0, at);
  const d = Math.max(0.001, duration);
  if (typeof param.setValueCurveAtTime === 'function') {
    const ok = safe(() => {
      param.setValueCurveAtTime(curve, t, d);
      return true;
    });
    if (ok) return;
  }
  // No curve support (or it threw against an overlapping event): a linear ramp
  // dips a little at the midpoint but is still a crossfade, not a seam.
  safe(() => param.linearRampToValueAtTime(curve[curve.length - 1]!, t + d));
}

/**
 * Schedule one pass through the loop.
 *
 * The envelope is the whole point:
 *  - pass 0 enters at full (its head has no predecessor to fade against; the
 *    track-to-track fade is a separate node),
 *  - every later pass fades **in** over the crossfade with the equal-power
 *    sine, arriving exactly as the previous pass fades **out** with the
 *    matching cosine,
 *  - and every pass fades out over the last `crossfade` seconds.
 *
 * Because pass n+1 starts at `duration - crossfade` after pass n, the two
 * ramps line up sample-for-sample on the context clock.
 */
function spawnPass(deck: BufferDeck, index: number): void {
  const now = safe(() => deck.ctx.currentTime) ?? 0;
  const at = loopPassStartTime(deck.anchor, index, deck.duration, deck.crossfade);
  const d = deck.duration;
  const x = deck.crossfade;

  // The head starts open (pass 0) or shut (every later pass) as a plain param
  // value rather than a scheduled event: Web Audio refuses any event that lands
  // inside a value-curve window, and the fade-in curve begins on this instant.
  const openAtHead = x <= 0 || index === 0;

  const built = safe(() => {
    const src = deck.ctx.createBufferSource();
    src.buffer = deck.buffer;
    const g = deck.ctx.createGain();
    g.gain.value = openAtHead ? 1 : 0;
    src.connect(g);
    g.connect(deck.out);
    return { src, g };
  });
  if (!built) return;
  const { src, g } = built;

  if (x > 0) {
    // Fade-in holds at 1 once the curve ends, so no explicit hold event.
    if (index > 0) setFadeCurve(g.gain, FADE_IN_CURVE, at, x);
    setFadeCurve(g.gain, FADE_OUT_CURVE, at + d - x, x);
  }

  // A pass whose nominal start is already behind us (pass 0 with a `startAt`,
  // or a tab that was backgrounded) joins mid-buffer instead of being skipped.
  const offset = at < now ? Math.min(Math.max(0, now - at), Math.max(0, d - 0.05)) : 0;
  const when = Math.max(at, now);
  safe(() => src.start(when, offset));
  safe(() => src.stop(at + d + 0.05));

  deck.passes.push({ src, g, endsAt: at + d });
}

/** Top the scheduled queue back up to the lookahead horizon, and reap dead passes. */
function ensureScheduled(deck: BufferDeck): void {
  const now = safe(() => deck.ctx.currentTime) ?? 0;
  const horizon = now + LOOKAHEAD_SECONDS;

  // A one-shot track gets exactly one pass, ever.
  if (deck.track.loop || deck.nextPass === 0) {
    // The bound is belt-and-braces: a pathological duration must not spin here.
    for (let guard = 0; guard < 64; guard++) {
      const at = loopPassStartTime(deck.anchor, deck.nextPass, deck.duration, deck.crossfade);
      if (at > horizon) break;
      spawnPass(deck, deck.nextPass);
      deck.nextPass++;
      if (!deck.track.loop) break;
    }
  }

  const live: LoopPass[] = [];
  for (const p of deck.passes) {
    if (p.endsAt < now - 0.5) {
      safe(() => p.src.disconnect());
      safe(() => p.g.disconnect());
    } else {
      live.push(p);
    }
  }
  deck.passes = live;
}

function makeBufferDeck(
  ctx: AudioContext,
  track: MusicTrack,
  buffer: AudioBuffer,
  gain: number,
  startAt: number,
): BufferDeck | null {
  const out = safe(() => {
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(ctx.destination);
    return g;
  });
  if (!out) return null;

  const duration =
    (Number.isFinite(buffer.duration) && buffer.duration > 0 ? buffer.duration : 0) ||
    track.durationSeconds ||
    0;
  if (duration <= 0) {
    safe(() => out.disconnect());
    return null;
  }

  const now = safe(() => ctx.currentTime) ?? 0;
  const offset = Math.max(0, Math.min(startAt, Math.max(0, duration - 0.05)));
  return {
    kind: 'buffer',
    track,
    gain: clamp01(gain),
    fade: 0,
    ctx,
    buffer,
    out,
    duration,
    crossfade: track.loop ? resolveLoopCrossfade(track, duration) : 0,
    anchor: now - offset,
    nextPass: 0,
    passes: [],
    timer: null,
  };
}

async function makeWebAudioDeck(
  track: MusicTrack,
  gain: number,
  startAt: number,
): Promise<BufferDeck | null> {
  const ctx = getAudioContext() ?? (initAudio() ? getAudioContext() : null);
  if (!ctx) return null;
  if (typeof ctx.createBufferSource !== 'function' || typeof ctx.decodeAudioData !== 'function') {
    return null;
  }
  if (typeof fetch !== 'function') return null;
  const buffer = await loadBuffer(ctx, pickSourceUrl(track));
  if (!buffer) return null;
  return makeBufferDeck(ctx, track, buffer, gain, startAt);
}

// ---------------------------------------------------------------------------
// Deck lifecycle shared by both backends
// ---------------------------------------------------------------------------

function rampGain(ctx: AudioContext, param: AudioParam, value: number): void {
  safe(() => {
    const t = ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + 0.05);
  });
}

function applyVolumes(): void {
  const set = (d: Deck) => {
    const v = clamp01(masterEffective * musicVolume * d.gain * d.fade);
    if (d.kind === 'element') {
      safe(() => {
        d.el.volume = v;
      });
    } else {
      rampGain(d.ctx, d.out.gain, v);
    }
  };
  if (current) set(current);
  for (const d of outgoing) set(d);
}

async function startDeck(deck: Deck): Promise<boolean> {
  if (deck.kind === 'element') {
    return (safe(() => deck.el.play()) ?? Promise.reject(new Error('no play')))
      .then(() => true)
      .catch(() => false);
  }
  if (deck.ctx.state === 'suspended') {
    await Promise.resolve(safe(() => deck.ctx.resume())).catch(() => undefined);
  }
  ensureScheduled(deck);
  if (deck.track.loop && !deck.timer) {
    deck.timer =
      safe(() => setInterval(() => ensureScheduled(deck), SCHEDULER_INTERVAL_MS)) ?? null;
  }
  // Everything is on the clock either way; a suspended context will simply
  // pick the schedule up when it resumes.
  return deck.ctx.state === 'running';
}

function stopDeck(deck: Deck): void {
  if (deck.kind === 'element') {
    safe(() => deck.el.pause());
    safe(() => {
      deck.el.src = '';
    });
    return;
  }
  if (deck.timer) safe(() => clearInterval(deck.timer!));
  deck.timer = null;
  for (const p of deck.passes) {
    safe(() => p.src.stop());
    safe(() => p.src.disconnect());
    safe(() => p.g.disconnect());
  }
  deck.passes = [];
  safe(() => deck.out.disconnect());
}

function ensureFadeLoop(stepMs: number, perStep: number): void {
  if (fadeTimer) return;
  fadeTimer = setInterval(() => {
    let busy = false;
    // Sequential by default: hold the incoming deck at silence until the
    // outgoing one has nearly gone. Overlapping two beds that share a tempo
    // makes them phase against each other, which reads as the same track
    // playing doubled rather than as a crossfade.
    const clearing = outgoing.some((d) => d.fade > HANDOFF_LEVEL);
    if (current && current.fade < 1 && !(current.sequential && clearing)) {
      current.fade = Math.min(1, current.fade + perStep);
      busy = true;
    }
    if (clearing) busy = true;
    for (const d of outgoing) {
      d.fade = Math.max(0, d.fade - perStep);
      if (d.fade > 0) busy = true;
    }
    const dead = outgoing.filter((d) => d.fade <= 0);
    if (dead.length) {
      outgoing = outgoing.filter((d) => d.fade > 0);
      for (const d of dead) stopDeck(d);
    }
    applyVolumes();
    if (!busy && fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
  }, stepMs);
}

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

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

  const gain = opts.gain ?? 1;
  const startAt = typeof opts.startAt === 'number' && Number.isFinite(opts.startAt)
    ? Math.max(0, opts.startAt)
    : 0;

  // Web Audio first, because that is the backend that can crossfade the loop.
  // A failed fetch, a codec the decoder refuses, or no context at all falls
  // back to the streaming element rather than going silent.
  const deck: Deck | null =
    (await makeWebAudioDeck(track, gain, startAt)) ?? makeElementDeck(track, gain, startAt);
  if (!deck) return false;

  // Decoding is async, so another playMusic may have landed while we waited.
  if (current && current.track.id === track.id) {
    stopDeck(deck);
    return true;
  }

  // Overlap only when the caller explicitly asks for it. The default track
  // change is a handoff, not a crossfade — see the note in the fade loop.
  deck.sequential = opts.overlap !== true && current !== null;
  if (current) outgoing.push(current);
  current = deck;
  applyVolumes();

  const seconds = Math.max(0.05, opts.crossfadeSeconds ?? 1.5);
  ensureFadeLoop(FADE_STEP_MS, FADE_STEP_MS / (seconds * 1000));

  return startDeck(deck);
}

/** Fade out and release everything. Safe to call when nothing is playing. */
export function stopMusic(fadeSeconds = 1.0): void {
  if (current) {
    outgoing.push(current);
    current = null;
  }
  if (!outgoing.length) return;
  ensureFadeLoop(FADE_STEP_MS, FADE_STEP_MS / (Math.max(0.05, fadeSeconds) * 1000));
}

/**
 * Music bus level, 0..1, independent of master volume and persisted alongside
 * it. Non-finite is ignored.
 */
export function setMusicVolume(v: number): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) return;
  musicVolume = clamp01(v);
  writeAudioPrefs({ musicVolume });
  applyVolumes();
}

export function getMusicVolume(): number {
  return musicVolume;
}

export function getCurrentTrack(): MusicTrack | null {
  return current ? current.track : null;
}

export function isMusicPlaying(): boolean {
  const d = current;
  if (!d) return false;
  if (d.kind === 'element') return !!safe(() => !d.el.paused);
  return d.passes.length > 0;
}

/** Which backend the current deck is using. For tests and a debug panel. */
export function getMusicBackend(): 'buffer' | 'element' | null {
  return current ? current.kind : null;
}

/**
 * Scheduling snapshot for the current buffer deck: what the loop is doing right
 * now. `null` on the element fallback. Exposed so the browser check (and a
 * debug panel) can assert on the graph rather than on how it sounds.
 */
export function getLoopSchedule(): {
  trackId: string;
  duration: number;
  crossfade: number;
  period: number;
  anchor: number;
  scheduled: number;
  nextStart: number;
  passStarts: number[];
  /** Live gain of each scheduled pass. Two non-zero entries = mid-crossfade. */
  passGains: number[];
  deckGain: number;
} | null {
  const d = current;
  if (!d || d.kind !== 'buffer') return null;
  return {
    trackId: d.track.id,
    duration: d.duration,
    crossfade: d.crossfade,
    period: loopPeriod(d.duration, d.crossfade),
    anchor: d.anchor,
    scheduled: d.nextPass,
    nextStart: loopPassStartTime(d.anchor, d.nextPass, d.duration, d.crossfade),
    passStarts: d.passes.map((p) => p.endsAt - d.duration),
    passGains: d.passes.map((p) => safe(() => p.g.gain.value) ?? 0),
    deckGain: safe(() => d.out.gain.value) ?? 0,
  };
}

/** Tear down for tests / unmount. */
export function disposeMusic(): void {
  if (fadeTimer) {
    clearInterval(fadeTimer);
    fadeTimer = null;
  }
  for (const d of [current, ...outgoing]) {
    if (d) stopDeck(d);
  }
  current = null;
  outgoing = [];
  manifest = null;
  manifestPromise = null;
  buffers.clear();
  decoding.clear();
  probe = undefined;
}
