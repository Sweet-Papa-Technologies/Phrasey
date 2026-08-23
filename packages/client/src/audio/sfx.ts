/**
 * Phrasey — procedural sound effects.
 *
 * Everything here is synthesized with the Web Audio API at runtime: no sample
 * files, no network cost, no decode latency. A cap crack is ~120ms of filtered
 * noise; shipping that as an .ogg would cost more bytes than this whole module.
 *
 * Design constraints (design doc §9, §10):
 *   - Master mute lives in this module. Sound defaults ON at 40% volume.
 *   - `prefers-reduced-motion` skips the violent effects (the blowout BOOM) and
 *     tames the pressure hiss.
 *   - The AudioContext is created lazily on the first user gesture, because
 *     every browser blocks it otherwise.
 *   - Nothing in here may ever throw. If audio is unavailable the whole module
 *     degrades to a silent no-op.
 */

import { DEFAULT_MASTER_VOLUME, readAudioPrefs, writeAudioPrefs } from './prefs';

/** Design-doc default: audio on, but quiet. Re-exported; defined in `prefs.ts`. */
export { DEFAULT_MASTER_VOLUME };

export type SfxName =
  /** Card played — the crimped cap coming off a glass bottle. */
  | 'capCrack'
  /** Letter tile revealed — ice cubes knocking together. */
  | 'iceClink'
  /** BLOWOUT. Violent; skipped under prefers-reduced-motion. */
  | 'boom'
  /** Card hover — barely there. */
  | 'hover'
  /** Card snapping onto the board. */
  | 'snap'
  /** Your turn begins. */
  | 'turnChime'
  /** Turn timer, last five seconds. */
  | 'tick';

export interface SfxOptions {
  /** Per-shot gain multiplier, 0..1. Default 1. */
  volume?: number;
  /** Pitch multiplier, roughly 0.5..2. Default 1. Handy for reveal cascades. */
  rate?: number;
  /** Stereo position, -1..1. Ignored where StereoPannerNode is unavailable. */
  pan?: number;
  /** Delay before the shot fires, in seconds. Default 0. */
  delay?: number;
}

interface SfxDef {
  /** Skipped entirely when the user asks for reduced motion. */
  violent?: boolean;
}

const SFX_DEFS: Record<SfxName, SfxDef> = {
  capCrack: {},
  iceClink: {},
  boom: { violent: true },
  hover: {},
  snap: {},
  turnChime: {},
  tick: {},
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let sfxBus: GainNode | null = null;
let noise: AudioBuffer | null = null;
let initFailed = false;

let masterVolume = DEFAULT_MASTER_VOLUME;
let muted = false;

// ---- Same-room (§9) -------------------------------------------------------
// When a group is physically together, every phone playing the same bed is a
// mess. One device — the host's — stays the speaker; everyone else can drop
// their own device to silence. Three inputs, resolved by
// `resolveSameRoomSilence` below.

/** This player's own switch. `null` = untouched, so the room default applies. */
let sameRoomLocal: boolean | null = null;
/** The host's broadcast room-level default (`RoomSettings.sameRoomAudio`). */
let sameRoomDefault = false;
/** True on the host's device. */
let sameRoomIsHost = false;

interface HissNodes {
  src: AudioBufferSourceNode;
  band: BiquadFilterNode;
  hp: BiquadFilterNode;
  gain: GainNode;
  lfo: OscillatorNode;
  lfoGain: GainNode;
}
let hiss: HissNodes | null = null;
let hissLevel = 0;

/** Notified whenever master volume or mute changes (the music player listens). */
const settingsListeners = new Set<(s: AudioSettings) => void>();

export interface AudioSettings {
  volume: number;
  muted: boolean;
  /** True when Same-room is silencing this device (see §9 / `setSameRoomLocal`). */
  sameRoom: boolean;
  /**
   * volume, or 0 when muted **or** Same-room silenced. What anything
   * downstream (the music player) should actually apply.
   */
  effective: number;
}

// ---------------------------------------------------------------------------
// Small safe helpers
// ---------------------------------------------------------------------------

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Swallow anything. Audio is never worth breaking a render for. */
function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

function prefersReducedMotion(): boolean {
  return (
    safe(() => {
      const mm = globalThis.matchMedia;
      if (typeof mm !== 'function') return false;
      return !!mm.call(globalThis, '(prefers-reduced-motion: reduce)').matches;
    }) ?? false
  );
}

function readStored(): void {
  const p = readAudioPrefs();
  masterVolume = p.volume;
  muted = p.muted;
  sameRoomLocal = p.sameRoom;
}

function writeStored(): void {
  // Merged, not overwritten: `music.ts` owns `musicVolume` under the same key.
  writeAudioPrefs({ volume: masterVolume, muted, sameRoom: sameRoomLocal });
}

readStored();

export interface SameRoomInput {
  /** The player's own switch. `null` = untouched. */
  local: boolean | null;
  /** The host's broadcast room-level default. */
  roomDefault: boolean;
  /** True on the host's device. */
  isHost: boolean;
}

/**
 * Should *this* device be silent because everyone is in one room?
 *
 * Two rules, in order:
 *  1. The host is the speaker for the table, so Same-room never silences them.
 *     A host who wants quiet uses the master mute like anyone else.
 *  2. Otherwise the player's own switch wins — in both directions. A local
 *     `false` beats a room default of `true`, and it sticks, because the local
 *     half is the half that gets persisted.
 */
export function resolveSameRoomSilence(s: SameRoomInput): boolean {
  if (s.isHost) return false;
  return typeof s.local === 'boolean' ? s.local : !!s.roomDefault;
}

function sameRoomSilenced(): boolean {
  return resolveSameRoomSilence({
    local: sameRoomLocal,
    roomDefault: sameRoomDefault,
    isHost: sameRoomIsHost,
  });
}

/** Master mute OR Same-room. Either one means this device makes no sound. */
function silenced(): boolean {
  return muted || sameRoomSilenced();
}

/** Effective linear gain on the master bus. */
function effectiveGain(): number {
  return silenced() ? 0 : masterVolume;
}

/**
 * Exponential AD envelope on a gain param. Exponential ramps can never touch
 * zero, hence the epsilon floor.
 */
function envelope(
  param: AudioParam,
  t0: number,
  peak: number,
  attack: number,
  decay: number,
): void {
  const p = Math.max(peak, 0.0002);
  param.cancelScheduledValues(t0);
  param.setValueAtTime(0.0001, t0);
  param.exponentialRampToValueAtTime(p, t0 + Math.max(attack, 0.0005));
  param.exponentialRampToValueAtTime(0.0001, t0 + attack + Math.max(decay, 0.01));
}

function makeNoise(c: AudioContext): AudioBuffer | null {
  return (
    safe(() => {
      const len = Math.floor(c.sampleRate * 2);
      const buf = c.createBuffer(1, len, c.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      return buf;
    }) ?? null
  );
}

/** A soft-clip curve. Gives the blowout some grit instead of a clean sine. */
function driveCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Create (or resume) the AudioContext. Safe to call repeatedly and safe to call
 * from anywhere, but it only actually succeeds inside a user gesture on most
 * browsers. Returns true if audio is live.
 */
export function initAudio(): boolean {
  if (ctx && masterGain) {
    if (ctx.state === 'suspended') safe(() => ctx!.resume());
    return true;
  }
  if (initFailed) return false;

  const built = safe(() => {
    const Ctor =
      (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
      (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;

    const c = new Ctor();
    const master = c.createGain();
    master.gain.value = effectiveGain();
    master.connect(c.destination);

    const sfx = c.createGain();
    sfx.gain.value = 1;
    sfx.connect(master);

    return { c, master, sfx };
  });

  if (!built) {
    initFailed = true;
    return false;
  }

  ctx = built.c;
  masterGain = built.master;
  sfxBus = built.sfx;
  noise = makeNoise(ctx);
  if (ctx.state === 'suspended') safe(() => ctx!.resume());
  return true;
}

/** True when a real AudioContext exists and is running. */
export function isAudioReady(): boolean {
  return !!ctx && !!masterGain && ctx.state !== 'closed';
}

/** The live AudioContext, or null. Exposed so the music player can share it. */
export function getAudioContext(): AudioContext | null {
  return ctx;
}

/**
 * Arm one-shot listeners so the AudioContext is created on the user's first
 * interaction. Called automatically on import; idempotent.
 */
export function armAudioUnlock(): void {
  safe(() => {
    if (typeof document === 'undefined' || !document.addEventListener) return;
    const unlock = () => {
      initAudio();
    };
    for (const evt of ['pointerdown', 'keydown', 'touchstart'] as const) {
      document.addEventListener(evt, unlock, { once: true, passive: true });
    }
  });
}

armAudioUnlock();

/** Release the audio device (e.g. on unmount). Safe if never initialized. */
export function disposeAudio(): void {
  stopPressureHiss();
  safe(() => ctx?.close());
  ctx = null;
  masterGain = null;
  sfxBus = null;
  noise = null;
  initFailed = false;
}

// ---------------------------------------------------------------------------
// Volume & mute
// ---------------------------------------------------------------------------

/** Set master volume. Clamped to 0..1; non-finite input is ignored. */
export function setMasterVolume(v: number): void {
  if (typeof v !== 'number' || !Number.isFinite(v)) return;
  masterVolume = clamp01(v);
  applyMasterGain();
  writeStored();
}

export function getMasterVolume(): number {
  return masterVolume;
}

/** Master mute. Volume is preserved across a mute/unmute cycle. */
export function setMuted(b: boolean): void {
  muted = !!b;
  if (muted) stopPressureHiss(0.12);
  applyMasterGain();
  writeStored();
}

export function isMuted(): boolean {
  return muted;
}

/** Flip mute and return the new state. For the top-bar button. */
export function toggleMuted(): boolean {
  setMuted(!muted);
  return muted;
}

// ---------------------------------------------------------------------------
// Same room
// ---------------------------------------------------------------------------

/**
 * Set this player's own Same-room switch. `true` drops this device to silence
 * (music and effects); `null` hands the decision back to the room default.
 * Persisted — a local choice is meant to stick across reloads.
 */
export function setSameRoomLocal(v: boolean | null): void {
  sameRoomLocal = typeof v === 'boolean' ? v : null;
  writeStored();
  applySilence();
}

export function getSameRoomLocal(): boolean | null {
  return sameRoomLocal;
}

/**
 * Room context, pushed in by the store whenever the roster changes. Not
 * persisted: it belongs to the room, not to this device.
 */
export function setSameRoomContext(ctx: { roomDefault?: boolean; isHost?: boolean }): void {
  if (typeof ctx.roomDefault === 'boolean') sameRoomDefault = ctx.roomDefault;
  if (typeof ctx.isHost === 'boolean') sameRoomIsHost = ctx.isHost;
  applySilence();
}

export function getSameRoomContext(): SameRoomInput {
  return { local: sameRoomLocal, roomDefault: sameRoomDefault, isHost: sameRoomIsHost };
}

/** True when Same-room is currently holding this device quiet. */
export function isSameRoomSilenced(): boolean {
  return sameRoomSilenced();
}

function applySilence(): void {
  if (silenced()) stopPressureHiss(0.12);
  applyMasterGain();
}

function emitSettings(): void {
  const snapshot: AudioSettings = {
    volume: masterVolume,
    muted,
    sameRoom: sameRoomSilenced(),
    effective: effectiveGain(),
  };
  for (const cb of Array.from(settingsListeners)) safe(() => cb(snapshot));
}

/**
 * Subscribe to master volume / mute changes. Returns an unsubscribe function.
 * The callback fires immediately with the current settings.
 */
export function onAudioSettingsChange(cb: (s: AudioSettings) => void): () => void {
  settingsListeners.add(cb);
  safe(() =>
    cb({ volume: masterVolume, muted, sameRoom: sameRoomSilenced(), effective: effectiveGain() }),
  );
  return () => {
    settingsListeners.delete(cb);
  };
}

function applyMasterGain(): void {
  emitSettings();
  if (!masterGain || !ctx) return;
  safe(() => {
    const t = ctx!.currentTime;
    masterGain!.gain.cancelScheduledValues(t);
    masterGain!.gain.setValueAtTime(masterGain!.gain.value, t);
    masterGain!.gain.linearRampToValueAtTime(effectiveGain(), t + 0.04);
  });
}

/** Subscribers can observe master gain without owning it. */
export function getEffectiveGain(): number {
  return effectiveGain();
}

// ---------------------------------------------------------------------------
// Voice construction
// ---------------------------------------------------------------------------

interface Voice {
  out: GainNode;
  /** Destination for the voice; already routed through the pan (if any). */
  connectTo: AudioNode;
}

function beginVoice(opts: SfxOptions): Voice | null {
  if (!ctx || !sfxBus) return null;
  return (
    safe(() => {
      const out = ctx!.createGain();
      out.gain.value = clamp01(opts.volume ?? 1);
      let tail: AudioNode = out;
      const pan = opts.pan;
      if (typeof pan === 'number' && pan !== 0 && typeof ctx!.createStereoPanner === 'function') {
        const p = ctx!.createStereoPanner();
        p.pan.value = Math.max(-1, Math.min(1, pan));
        out.connect(p);
        tail = p;
      }
      tail.connect(sfxBus!);
      return { out, connectTo: out };
    }) ?? null
  );
}

function noiseSource(): AudioBufferSourceNode | null {
  if (!ctx || !noise) return null;
  return (
    safe(() => {
      const s = ctx!.createBufferSource();
      s.buffer = noise;
      s.loop = true;
      return s;
    }) ?? null
  );
}

function osc(type: OscillatorType, freq: number): OscillatorNode | null {
  if (!ctx) return null;
  return (
    safe(() => {
      const o = ctx!.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      return o;
    }) ?? null
  );
}

function filter(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode | null {
  if (!ctx) return null;
  return (
    safe(() => {
      const f = ctx!.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      if (typeof q === 'number') f.Q.value = q;
      return f;
    }) ?? null
  );
}

function gainNode(v = 1): GainNode | null {
  if (!ctx) return null;
  return (
    safe(() => {
      const g = ctx!.createGain();
      g.gain.value = v;
      return g;
    }) ?? null
  );
}

// ---------------------------------------------------------------------------
// The effects
// ---------------------------------------------------------------------------

/** Bottle cap crack: a hard transient plus a short pitched pop. ~120ms. */
function renderCapCrack(v: Voice, t: number, rate: number): void {
  // Transient — bandpassed noise, very fast decay.
  const n = noiseSource();
  const band = filter('bandpass', 2600 * rate, 1.4);
  const ng = gainNode(0.0001);
  if (n && band && ng) {
    n.connect(band).connect(ng).connect(v.connectTo);
    envelope(ng.gain, t, 0.55, 0.001, 0.045);
    safe(() => band.frequency.exponentialRampToValueAtTime(900 * rate, t + 0.05));
    safe(() => n.start(t));
    safe(() => n.stop(t + 0.16));
  }
  // The pop — a square dropping fast, which is what reads as "crimped metal".
  const o = osc('square', 900 * rate);
  const og = gainNode(0.0001);
  const lp = filter('lowpass', 4200 * rate, 0.9);
  if (o && og && lp) {
    o.connect(lp).connect(og).connect(v.connectTo);
    safe(() => o.frequency.exponentialRampToValueAtTime(170 * rate, t + 0.055));
    envelope(og.gain, t, 0.3, 0.002, 0.06);
    safe(() => o.start(t));
    safe(() => o.stop(t + 0.16));
  }
}

/** Ice clink: three inharmonic partials with a tiny high transient. */
function renderIceClink(v: Voice, t: number, rate: number): void {
  const partials = [2080, 3170, 4390];
  partials.forEach((f, i) => {
    const detune = 1 + (Math.random() * 0.06 - 0.03);
    const o = osc(i === 0 ? 'triangle' : 'sine', f * rate * detune);
    const g = gainNode(0.0001);
    if (!o || !g) return;
    o.connect(g).connect(v.connectTo);
    envelope(g.gain, t, 0.16 / (i + 1), 0.002, 0.24 + i * 0.06);
    safe(() => o.start(t));
    safe(() => o.stop(t + 0.5));
  });
  const n = noiseSource();
  const hp = filter('highpass', 4800 * rate, 0.7);
  const ng = gainNode(0.0001);
  if (n && hp && ng) {
    n.connect(hp).connect(ng).connect(v.connectTo);
    envelope(ng.gain, t, 0.12, 0.001, 0.02);
    safe(() => n.start(t));
    safe(() => n.stop(t + 0.08));
  }
}

/** Blowout. Sub sweep + gritty noise body + a crack on the front. */
function renderBoom(v: Voice, t: number, rate: number): void {
  // Sub.
  const o = osc('sine', 150 * rate);
  const og = gainNode(0.0001);
  if (o && og) {
    let tail: AudioNode = og;
    const shaper = safe(() => ctx!.createWaveShaper());
    if (shaper) {
      safe(() => {
        shaper.curve = driveCurve(6);
        shaper.oversample = '2x';
      });
      og.connect(shaper);
      tail = shaper;
    }
    o.connect(og);
    tail.connect(v.connectTo);
    safe(() => o.frequency.exponentialRampToValueAtTime(34 * rate, t + 0.6));
    envelope(og.gain, t, 0.9, 0.004, 1.1);
    safe(() => o.start(t));
    safe(() => o.stop(t + 1.4));
  }
  // Body — foam and blast, a lowpass closing over a second.
  const n = noiseSource();
  const lp = filter('lowpass', 1800, 0.9);
  const ng = gainNode(0.0001);
  if (n && lp && ng) {
    n.connect(lp).connect(ng).connect(v.connectTo);
    safe(() => lp.frequency.exponentialRampToValueAtTime(140, t + 0.9));
    envelope(ng.gain, t, 0.55, 0.006, 0.95);
    safe(() => n.start(t));
    safe(() => n.stop(t + 1.4));
  }
  // Front-of-blast crack, so it lands hard rather than swelling.
  renderCapCrack(v, t, 0.7 * rate);
}

/** Card hover. Should be almost subliminal. */
function renderHover(v: Voice, t: number, rate: number): void {
  const o = osc('sine', 1500 * rate);
  const g = gainNode(0.0001);
  if (!o || !g) return;
  o.connect(g).connect(v.connectTo);
  envelope(g.gain, t, 0.05, 0.002, 0.03);
  safe(() => o.start(t));
  safe(() => o.stop(t + 0.09));
}

/** Card snapping to the board — a plastic thud with a click on top. */
function renderSnap(v: Voice, t: number, rate: number): void {
  const n = noiseSource();
  const lp = filter('lowpass', 1500 * rate, 1.1);
  const ng = gainNode(0.0001);
  if (n && lp && ng) {
    n.connect(lp).connect(ng).connect(v.connectTo);
    envelope(ng.gain, t, 0.3, 0.001, 0.055);
    safe(() => n.start(t));
    safe(() => n.stop(t + 0.14));
  }
  const o = osc('sine', 230 * rate);
  const g = gainNode(0.0001);
  if (o && g) {
    o.connect(g).connect(v.connectTo);
    safe(() => o.frequency.exponentialRampToValueAtTime(88 * rate, t + 0.09));
    envelope(g.gain, t, 0.28, 0.002, 0.1);
    safe(() => o.start(t));
    safe(() => o.stop(t + 0.2));
  }
}

/** Turn begin — a two-note bell, up. */
function renderTurnChime(v: Voice, t: number, rate: number): void {
  const notes = [1318.5, 1975.5];
  notes.forEach((f, i) => {
    const at = t + i * 0.085;
    const o = osc('triangle', f * rate);
    const g = gainNode(0.0001);
    const lp = filter('lowpass', 5200, 0.7);
    if (!o || !g || !lp) return;
    o.connect(lp).connect(g).connect(v.connectTo);
    envelope(g.gain, at, 0.2, 0.004, 0.42);
    safe(() => o.start(at));
    safe(() => o.stop(at + 0.7));
  });
}

/** Timer tick, last five seconds. Dry and a bit anxious. */
function renderTick(v: Voice, t: number, rate: number): void {
  const o = osc('square', 1050 * rate);
  const bp = filter('bandpass', 1600 * rate, 3);
  const g = gainNode(0.0001);
  if (!o || !bp || !g) return;
  o.connect(bp).connect(g).connect(v.connectTo);
  envelope(g.gain, t, 0.14, 0.001, 0.028);
  safe(() => o.start(t));
  safe(() => o.stop(t + 0.09));
}

const RENDERERS: Record<SfxName, (v: Voice, t: number, rate: number) => void> = {
  capCrack: renderCapCrack,
  iceClink: renderIceClink,
  boom: renderBoom,
  hover: renderHover,
  snap: renderSnap,
  turnChime: renderTurnChime,
  tick: renderTick,
};

/**
 * Fire a one-shot effect. No-ops silently when audio is unavailable, muted, or
 * when the effect is violent and the user asked for reduced motion.
 */
export function playSfx(name: SfxName, opts: SfxOptions = {}): void {
  const def = SFX_DEFS[name];
  if (!def) return;
  if (def.violent && prefersReducedMotion()) return;
  if (silenced()) return;
  if (!isAudioReady() && !initAudio()) return;
  if (!ctx || !sfxBus) return;

  safe(() => {
    const v = beginVoice(opts);
    if (!v) return;
    const rate = Math.max(0.25, Math.min(4, opts.rate ?? 1));
    const t = ctx!.currentTime + Math.max(0, opts.delay ?? 0);
    RENDERERS[name](v, t, rate);
  });
}

// ---------------------------------------------------------------------------
// Pressure hiss — the continuous one
// ---------------------------------------------------------------------------

/**
 * Maps 0..1 pressure onto the hiss. As the bottle fills the noise band narrows
 * and climbs, which is what makes it read as "about to go" rather than "louder".
 */
function hissParams(level: number) {
  const l = clamp01(level);
  const reduced = prefersReducedMotion();
  return {
    // Band centre climbs from a broad shhh to a thin whistle.
    freq: 700 + l * l * 4600,
    // And tightens, so the top end starts to sing.
    q: 0.7 + l * 7,
    // Gain rises faster than linear, capped hard under reduced motion.
    gain: Math.pow(l, 1.6) * (reduced ? 0.1 : 0.3),
    // Flutter speeds up with pressure.
    lfoHz: 5 + l * 14,
    lfoDepth: 0.1 + l * 0.18,
  };
}

/** Start the rising pressure hiss. Idempotent. */
export function startPressureHiss(level = hissLevel): void {
  hissLevel = clamp01(level);
  if (silenced()) return;
  if (hiss) {
    updatePressureHiss(hissLevel);
    return;
  }
  if (!isAudioReady() && !initAudio()) return;
  if (!ctx || !sfxBus) return;

  const built = safe(() => {
    const src = noiseSource();
    const hp = filter('highpass', 320, 0.7);
    const band = filter('bandpass', 700, 0.7);
    const g = gainNode(0.0001);
    const lfo = osc('sine', 6);
    const lfoGain = gainNode(0);
    if (!src || !hp || !band || !g || !lfo || !lfoGain) return null;

    src.connect(hp).connect(band).connect(g).connect(sfxBus!);
    // LFO modulates the hiss gain for a fizzing flutter.
    lfo.connect(lfoGain).connect(g.gain);

    src.start();
    lfo.start();
    return { src, band, hp, gain: g, lfo, lfoGain } as HissNodes;
  });

  if (!built) return;
  hiss = built;
  updatePressureHiss(hissLevel);
}

/**
 * Update the hiss for a 0..1 pressure level (i.e. `pressure / PRESSURE_MAX`).
 * Safe to call when the hiss is not running — the level is remembered.
 */
export function updatePressureHiss(level: number): void {
  const l = clamp01(typeof level === 'number' && Number.isFinite(level) ? level : 0);
  hissLevel = l;
  if (!hiss || !ctx) return;
  safe(() => {
    const t = ctx!.currentTime;
    const p = hissParams(l);
    // setTargetAtTime rather than a linear ramp: pressure should glug into
    // place, never slide.
    hiss!.band.frequency.setTargetAtTime(p.freq, t, 0.08);
    hiss!.band.Q.setTargetAtTime(p.q, t, 0.12);
    hiss!.gain.gain.setTargetAtTime(p.gain, t, 0.1);
    hiss!.lfo.frequency.setTargetAtTime(p.lfoHz, t, 0.2);
    hiss!.lfoGain.gain.setTargetAtTime(p.gain * p.lfoDepth, t, 0.2);
  });
}

/** Fade out and tear down the hiss. Safe if it was never started. */
export function stopPressureHiss(fadeSeconds = 0.25): void {
  const nodes = hiss;
  hiss = null;
  if (!nodes || !ctx) return;
  safe(() => {
    const t = ctx!.currentTime;
    const fade = Math.max(0.01, fadeSeconds);
    nodes.gain.gain.cancelScheduledValues(t);
    nodes.gain.gain.setValueAtTime(Math.max(nodes.gain.gain.value, 0.0002), t);
    nodes.gain.gain.exponentialRampToValueAtTime(0.0001, t + fade);
    nodes.src.stop(t + fade + 0.02);
    nodes.lfo.stop(t + fade + 0.02);
  });
}

/** Current 0..1 pressure level the hiss is tracking. */
export function getPressureLevel(): number {
  return hissLevel;
}

/** Exposed for tests and for a debug panel. */
export const __internals = {
  clamp01,
  hissParams,
  prefersReducedMotion,
  silenced,
  SFX_DEFS,
};
