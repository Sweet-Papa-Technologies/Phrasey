/**
 * @vitest-environment jsdom
 *
 * The audio layer's contract is mostly negative: it must be callable at any
 * time, in any order, on a machine with no audio device, without ever throwing.
 * These tests hold it to that, and check the two things that are easy to get
 * silently wrong — clamping, and the reduced-motion opt-out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// A stub AudioContext. Records what was built so we can assert that an effect
// actually did something, and flags the classic Web Audio footgun: an
// exponential ramp to zero, which throws in real browsers.
// ---------------------------------------------------------------------------

interface Recorder {
  sourcesStarted: number;
  oscillatorsStarted: number;
  nodesCreated: number;
  connections: number;
  badExponentialRamps: number;
  contexts: number;
}

function makeRecorder(): Recorder {
  return {
    sourcesStarted: 0,
    oscillatorsStarted: 0,
    nodesCreated: 0,
    connections: 0,
    badExponentialRamps: 0,
    contexts: 0,
  };
}

function installFakeAudio(rec: Recorder) {
  class FakeParam {
    value = 0;
    constructor(initial = 0) {
      this.value = initial;
    }
    setValueAtTime(v: number) {
      this.value = v;
      return this;
    }
    linearRampToValueAtTime(v: number) {
      this.value = v;
      return this;
    }
    exponentialRampToValueAtTime(v: number) {
      if (!(v > 0)) rec.badExponentialRamps++;
      this.value = v;
      return this;
    }
    setTargetAtTime(v: number) {
      this.value = v;
      return this;
    }
    cancelScheduledValues() {
      return this;
    }
  }

  class FakeNode {
    connect(dest: unknown) {
      rec.connections++;
      return dest as FakeNode;
    }
    disconnect() {}
  }

  class FakeGain extends FakeNode {
    gain = new FakeParam(1);
  }
  class FakeBiquad extends FakeNode {
    type = 'lowpass';
    frequency = new FakeParam(350);
    Q = new FakeParam(1);
    detune = new FakeParam(0);
  }
  class FakePanner extends FakeNode {
    pan = new FakeParam(0);
  }
  class FakeShaper extends FakeNode {
    curve: Float32Array | null = null;
    oversample = 'none';
  }
  class FakeOsc extends FakeNode {
    type = 'sine';
    frequency = new FakeParam(440);
    detune = new FakeParam(0);
    start() {
      rec.oscillatorsStarted++;
    }
    stop() {}
  }
  class FakeBufferSource extends FakeNode {
    buffer: unknown = null;
    loop = false;
    playbackRate = new FakeParam(1);
    start() {
      rec.sourcesStarted++;
    }
    stop() {}
  }

  class FakeAudioContext {
    sampleRate = 48000;
    currentTime = 0;
    state: AudioContextState = 'running';
    destination = new FakeNode();
    constructor() {
      rec.contexts++;
    }
    resume() {
      this.state = 'running';
      return Promise.resolve();
    }
    close() {
      this.state = 'closed';
      return Promise.resolve();
    }
    createGain() {
      rec.nodesCreated++;
      return new FakeGain();
    }
    createBiquadFilter() {
      rec.nodesCreated++;
      return new FakeBiquad();
    }
    createOscillator() {
      rec.nodesCreated++;
      return new FakeOsc();
    }
    createBufferSource() {
      rec.nodesCreated++;
      return new FakeBufferSource();
    }
    createStereoPanner() {
      rec.nodesCreated++;
      return new FakePanner();
    }
    createWaveShaper() {
      rec.nodesCreated++;
      return new FakeShaper();
    }
    createBuffer(channels: number, length: number) {
      const data = new Float32Array(length);
      return { getChannelData: () => data, length, numberOfChannels: channels };
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext);
}

function setReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));
}

type SfxModule = typeof import('./sfx');
const ALL_SFX = [
  'capCrack',
  'iceClink',
  'boom',
  'hover',
  'snap',
  'turnChime',
  'tick',
] as const;

async function freshSfx(): Promise<SfxModule> {
  vi.resetModules();
  return import('./sfx');
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  localStorage.clear();
});

// ---------------------------------------------------------------------------

describe('with no audio device at all', () => {
  let sfx: SfxModule;

  beforeEach(async () => {
    // jsdom has no AudioContext; make sure nothing sneaks one in.
    vi.stubGlobal('AudioContext', undefined);
    vi.stubGlobal('webkitAudioContext', undefined);
    sfx = await freshSfx();
  });

  it('reports that audio is not ready and refuses to initialise', () => {
    expect(sfx.isAudioReady()).toBe(false);
    expect(sfx.initAudio()).toBe(false);
    expect(sfx.getAudioContext()).toBeNull();
  });

  it('plays every effect without throwing', () => {
    for (const name of ALL_SFX) {
      expect(() => sfx.playSfx(name)).not.toThrow();
      expect(() => sfx.playSfx(name, { volume: 0.5, rate: 1.3, pan: -0.4, delay: 0.1 })).not.toThrow();
    }
    expect(sfx.isAudioReady()).toBe(false);
  });

  it('runs the whole pressure-hiss lifecycle without throwing', () => {
    expect(() => sfx.startPressureHiss()).not.toThrow();
    expect(() => sfx.updatePressureHiss(0.5)).not.toThrow();
    expect(() => sfx.stopPressureHiss()).not.toThrow();
    // and out of order, which the UI will absolutely do
    expect(() => sfx.stopPressureHiss()).not.toThrow();
    expect(() => sfx.updatePressureHiss(1)).not.toThrow();
  });

  it('still tracks volume and mute so the UI has something to render', () => {
    sfx.setMasterVolume(0.8);
    expect(sfx.getMasterVolume()).toBe(0.8);
    sfx.setMuted(true);
    expect(sfx.isMuted()).toBe(true);
    expect(sfx.getEffectiveGain()).toBe(0);
  });

  it('disposes cleanly having never initialised', () => {
    expect(() => sfx.disposeAudio()).not.toThrow();
  });
});

describe('defaults', () => {
  it('starts unmuted at 40% (design doc §9)', async () => {
    const sfx = await freshSfx();
    expect(sfx.DEFAULT_MASTER_VOLUME).toBe(0.4);
    expect(sfx.getMasterVolume()).toBe(0.4);
    expect(sfx.isMuted()).toBe(false);
    expect(sfx.getEffectiveGain()).toBeCloseTo(0.4);
  });
});

describe('volume and mute clamping', () => {
  let sfx: SfxModule;
  beforeEach(async () => {
    sfx = await freshSfx();
  });

  it('clamps volume into 0..1', () => {
    sfx.setMasterVolume(-3);
    expect(sfx.getMasterVolume()).toBe(0);
    sfx.setMasterVolume(17);
    expect(sfx.getMasterVolume()).toBe(1);
    sfx.setMasterVolume(0.33);
    expect(sfx.getMasterVolume()).toBeCloseTo(0.33);
  });

  it('ignores non-finite volumes rather than corrupting the gain', () => {
    sfx.setMasterVolume(0.6);
    sfx.setMasterVolume(Number.NaN);
    sfx.setMasterVolume(Number.POSITIVE_INFINITY);
    sfx.setMasterVolume(undefined as unknown as number);
    expect(sfx.getMasterVolume()).toBeCloseTo(0.6);
  });

  it('mute zeroes the effective gain but preserves the volume', () => {
    sfx.setMasterVolume(0.7);
    sfx.setMuted(true);
    expect(sfx.getEffectiveGain()).toBe(0);
    expect(sfx.getMasterVolume()).toBeCloseTo(0.7);
    sfx.setMuted(false);
    expect(sfx.getEffectiveGain()).toBeCloseTo(0.7);
  });

  it('toggleMuted returns the new state', () => {
    expect(sfx.toggleMuted()).toBe(true);
    expect(sfx.toggleMuted()).toBe(false);
  });

  it('coerces non-boolean mute arguments', () => {
    sfx.setMuted(1 as unknown as boolean);
    expect(sfx.isMuted()).toBe(true);
    sfx.setMuted(0 as unknown as boolean);
    expect(sfx.isMuted()).toBe(false);
  });

  it('notifies subscribers and unsubscribes cleanly', () => {
    const seen: number[] = [];
    const off = sfx.onAudioSettingsChange((s) => seen.push(s.effective));
    expect(seen).toHaveLength(1); // fires immediately with current state
    sfx.setMasterVolume(0.9);
    sfx.setMuted(true);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen[seen.length - 1]!).toBe(0);
    off();
    const before = seen.length;
    sfx.setMasterVolume(0.2);
    expect(seen).toHaveLength(before);
  });
});

describe('with a stubbed AudioContext', () => {
  let sfx: SfxModule;
  let rec: Recorder;

  beforeEach(async () => {
    rec = makeRecorder();
    installFakeAudio(rec);
    setReducedMotion(false);
    sfx = await freshSfx();
  });

  it('initialises lazily and only once', () => {
    expect(rec.contexts).toBe(0);
    expect(sfx.initAudio()).toBe(true);
    expect(sfx.initAudio()).toBe(true);
    expect(rec.contexts).toBe(1);
    expect(sfx.isAudioReady()).toBe(true);
  });

  it('creates the context on the first playSfx if nobody called initAudio', () => {
    sfx.playSfx('capCrack');
    expect(rec.contexts).toBe(1);
    expect(rec.oscillatorsStarted + rec.sourcesStarted).toBeGreaterThan(0);
  });

  it('actually builds a voice for every effect, with no ramp-to-zero', () => {
    sfx.initAudio();
    for (const name of ALL_SFX) {
      const before = rec.oscillatorsStarted + rec.sourcesStarted;
      sfx.playSfx(name);
      expect(rec.oscillatorsStarted + rec.sourcesStarted).toBeGreaterThan(before);
    }
    expect(rec.badExponentialRamps).toBe(0);
  });

  it('makes no sound at all while muted', () => {
    sfx.initAudio();
    sfx.setMuted(true);
    const before = rec.oscillatorsStarted + rec.sourcesStarted;
    for (const name of ALL_SFX) sfx.playSfx(name);
    sfx.startPressureHiss(0.9);
    expect(rec.oscillatorsStarted + rec.sourcesStarted).toBe(before);
  });

  it('ignores an unknown effect name', () => {
    sfx.initAudio();
    const before = rec.oscillatorsStarted + rec.sourcesStarted;
    expect(() => sfx.playSfx('nope' as never)).not.toThrow();
    expect(rec.oscillatorsStarted + rec.sourcesStarted).toBe(before);
  });

  it('runs and tears down the pressure hiss', () => {
    sfx.initAudio();
    const before = rec.sourcesStarted;
    sfx.startPressureHiss(0.1);
    expect(rec.sourcesStarted).toBeGreaterThan(before);
    const afterStart = rec.sourcesStarted;
    sfx.startPressureHiss(0.4); // idempotent, must not stack a second noise loop
    expect(rec.sourcesStarted).toBe(afterStart);
    sfx.updatePressureHiss(0.9);
    expect(sfx.getPressureLevel()).toBe(0.9);
    sfx.stopPressureHiss();
    expect(rec.badExponentialRamps).toBe(0);
  });

  it('clamps the pressure level', () => {
    sfx.initAudio();
    sfx.startPressureHiss();
    sfx.updatePressureHiss(4);
    expect(sfx.getPressureLevel()).toBe(1);
    sfx.updatePressureHiss(-2);
    expect(sfx.getPressureLevel()).toBe(0);
    sfx.updatePressureHiss(Number.NaN);
    expect(sfx.getPressureLevel()).toBe(0);
  });

  it('can be disposed and re-initialised', () => {
    sfx.initAudio();
    sfx.startPressureHiss(0.5);
    sfx.disposeAudio();
    expect(sfx.isAudioReady()).toBe(false);
    expect(sfx.initAudio()).toBe(true);
    expect(rec.contexts).toBe(2);
  });
});

describe('prefers-reduced-motion', () => {
  let sfx: SfxModule;
  let rec: Recorder;

  beforeEach(async () => {
    rec = makeRecorder();
    installFakeAudio(rec);
    setReducedMotion(true);
    sfx = await freshSfx();
    sfx.initAudio();
  });

  it('skips the violent effects', () => {
    const before = rec.oscillatorsStarted + rec.sourcesStarted;
    sfx.playSfx('boom');
    expect(rec.oscillatorsStarted + rec.sourcesStarted).toBe(before);
  });

  it('still plays the ordinary feedback effects', () => {
    const before = rec.oscillatorsStarted + rec.sourcesStarted;
    sfx.playSfx('capCrack');
    sfx.playSfx('iceClink');
    sfx.playSfx('tick');
    expect(rec.oscillatorsStarted + rec.sourcesStarted).toBeGreaterThan(before);
  });

  it('attenuates the pressure hiss', () => {
    const loud = sfx.__internals.hissParams(1);
    setReducedMotion(false);
    const normal = sfx.__internals.hissParams(1);
    expect(loud.gain).toBeLessThan(normal.gain);
  });

  it('survives a browser with no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(sfx.__internals.prefersReducedMotion()).toBe(false);
    expect(() => sfx.playSfx('boom')).not.toThrow();
  });
});

describe('hiss mapping', () => {
  it('rises and tightens monotonically with pressure', async () => {
    setReducedMotion(false);
    const sfx = await freshSfx();
    const p = [0, 0.25, 0.5, 0.75, 1].map((l) => sfx.__internals.hissParams(l));
    for (let i = 1; i < p.length; i++) {
      expect(p[i]!.freq).toBeGreaterThan(p[i - 1]!.freq);
      expect(p[i]!.q).toBeGreaterThan(p[i - 1]!.q);
      expect(p[i]!.gain).toBeGreaterThan(p[i - 1]!.gain);
      expect(p[i]!.lfoHz).toBeGreaterThan(p[i - 1]!.lfoHz);
    }
    expect(p[0]!.gain).toBe(0);
    expect(p[p.length - 1]!.gain).toBeLessThanOrEqual(1);
  });

  it('clamps out-of-range pressure', async () => {
    const sfx = await freshSfx();
    expect(sfx.__internals.hissParams(-5)).toEqual(sfx.__internals.hissParams(0));
    expect(sfx.__internals.hissParams(99)).toEqual(sfx.__internals.hissParams(1));
  });
});

describe('localStorage', () => {
  it('restores volume and mute, and survives a hostile store', async () => {
    localStorage.setItem('phrasey.audio.v1', JSON.stringify({ volume: 0.15, muted: true }));
    let sfx = await freshSfx();
    expect(sfx.getMasterVolume()).toBeCloseTo(0.15);
    expect(sfx.isMuted()).toBe(true);

    localStorage.setItem('phrasey.audio.v1', 'not json {{{');
    sfx = await freshSfx();
    expect(sfx.getMasterVolume()).toBe(sfx.DEFAULT_MASTER_VOLUME);

    localStorage.setItem('phrasey.audio.v1', JSON.stringify({ volume: 99, muted: 'yes' }));
    sfx = await freshSfx();
    expect(sfx.getMasterVolume()).toBe(1);
    expect(sfx.isMuted()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Same room (§9). Everyone is in one kitchen; one device makes the noise.
// ---------------------------------------------------------------------------

describe('same room — resolution rules', () => {
  it('never silences the host, whatever anyone set', async () => {
    const sfx = await freshSfx();
    const r = sfx.resolveSameRoomSilence;
    expect(r({ local: true, roomDefault: true, isHost: true })).toBe(false);
    expect(r({ local: true, roomDefault: false, isHost: true })).toBe(false);
    expect(r({ local: null, roomDefault: true, isHost: true })).toBe(false);
  });

  it('applies the room default only while the player has not chosen', async () => {
    const sfx = await freshSfx();
    const r = sfx.resolveSameRoomSilence;
    expect(r({ local: null, roomDefault: true, isHost: false })).toBe(true);
    expect(r({ local: null, roomDefault: false, isHost: false })).toBe(false);
  });

  it('lets a local choice beat the room default in both directions', async () => {
    const sfx = await freshSfx();
    const r = sfx.resolveSameRoomSilence;
    // Opting out of a room the host declared "same room".
    expect(r({ local: false, roomDefault: true, isHost: false })).toBe(false);
    // Opting in when the host has not declared anything.
    expect(r({ local: true, roomDefault: false, isHost: false })).toBe(true);
  });
});

describe('same room — what it actually silences', () => {
  let rec: Recorder;

  beforeEach(() => {
    rec = makeRecorder();
    installFakeAudio(rec);
    setReducedMotion(false);
  });

  it('takes this device to zero without disturbing the volume setting', async () => {
    const sfx = await freshSfx();
    sfx.initAudio();
    sfx.setMasterVolume(0.7);
    sfx.setSameRoomContext({ roomDefault: false, isHost: false });

    sfx.setSameRoomLocal(true);
    expect(sfx.isSameRoomSilenced()).toBe(true);
    expect(sfx.getEffectiveGain()).toBe(0);
    // The player's volume is untouched, so unticking restores exactly it.
    expect(sfx.getMasterVolume()).toBeCloseTo(0.7);
    expect(sfx.isMuted()).toBe(false);

    sfx.setSameRoomLocal(false);
    expect(sfx.getEffectiveGain()).toBeCloseTo(0.7);
  });

  it('stops effects and the pressure hiss from firing at all', async () => {
    const sfx = await freshSfx();
    sfx.initAudio();
    sfx.setSameRoomContext({ roomDefault: false, isHost: false });
    sfx.setSameRoomLocal(true);

    const before = rec.oscillatorsStarted + rec.sourcesStarted;
    for (const name of ALL_SFX) sfx.playSfx(name);
    sfx.startPressureHiss(0.8);
    expect(rec.oscillatorsStarted + rec.sourcesStarted).toBe(before);

    sfx.setSameRoomLocal(false);
    sfx.playSfx('capCrack');
    expect(rec.oscillatorsStarted + rec.sourcesStarted).toBeGreaterThan(before);
  });

  it('leaves the host making noise even with the room default on', async () => {
    const sfx = await freshSfx();
    sfx.initAudio();
    sfx.setSameRoomContext({ roomDefault: true, isHost: true });
    expect(sfx.isSameRoomSilenced()).toBe(false);
    expect(sfx.getEffectiveGain()).toBe(sfx.getMasterVolume());

    const before = rec.oscillatorsStarted + rec.sourcesStarted;
    sfx.playSfx('capCrack');
    expect(rec.oscillatorsStarted + rec.sourcesStarted).toBeGreaterThan(before);
  });

  it('silences a guest the moment the host broadcasts the room default', async () => {
    const sfx = await freshSfx();
    sfx.initAudio();
    sfx.setSameRoomContext({ roomDefault: false, isHost: false });
    expect(sfx.getEffectiveGain()).toBeGreaterThan(0);

    sfx.setSameRoomContext({ roomDefault: true });
    expect(sfx.isSameRoomSilenced()).toBe(true);
    expect(sfx.getEffectiveGain()).toBe(0);

    // ...and a guest who says "no, leave mine on" wins, and keeps winning.
    sfx.setSameRoomLocal(false);
    expect(sfx.isSameRoomSilenced()).toBe(false);
    sfx.setSameRoomContext({ roomDefault: true });
    expect(sfx.isSameRoomSilenced()).toBe(false);
  });

  it('is orthogonal to the master mute — either one silences the device', async () => {
    const sfx = await freshSfx();
    sfx.initAudio();
    sfx.setSameRoomContext({ roomDefault: false, isHost: true });
    sfx.setMuted(true);
    // The host is exempt from same-room, but never from their own mute.
    expect(sfx.isSameRoomSilenced()).toBe(false);
    expect(sfx.getEffectiveGain()).toBe(0);
    sfx.setMuted(false);
    expect(sfx.getEffectiveGain()).toBeGreaterThan(0);
  });

  it('reports itself to subscribers so the music bus follows', async () => {
    const sfx = await freshSfx();
    const seen: { sameRoom: boolean; effective: number }[] = [];
    sfx.onAudioSettingsChange((s) => seen.push({ sameRoom: s.sameRoom, effective: s.effective }));
    sfx.setSameRoomContext({ roomDefault: false, isHost: false });
    sfx.setSameRoomLocal(true);
    expect(seen.at(-1)).toEqual({ sameRoom: true, effective: 0 });
    sfx.setSameRoomLocal(false);
    expect(seen.at(-1)!.sameRoom).toBe(false);
    expect(seen.at(-1)!.effective).toBeGreaterThan(0);
  });

  it('persists the local choice and restores it on the next load', async () => {
    let sfx = await freshSfx();
    sfx.setSameRoomLocal(true);
    expect(JSON.parse(localStorage.getItem('phrasey.audio.v1')!).sameRoom).toBe(true);

    sfx = await freshSfx();
    expect(sfx.getSameRoomLocal()).toBe(true);
    // Restored *before* any room context arrives, so a reload into a room the
    // host has since un-flagged still respects the player's choice.
    expect(sfx.isSameRoomSilenced()).toBe(true);

    sfx.setSameRoomLocal(null);
    sfx = await freshSfx();
    expect(sfx.getSameRoomLocal()).toBeNull();
    expect(sfx.isSameRoomSilenced()).toBe(false);
  });

  it('does not persist the room context — that belongs to the room', async () => {
    let sfx = await freshSfx();
    sfx.setSameRoomContext({ roomDefault: true, isHost: true });
    sfx = await freshSfx();
    expect(sfx.getSameRoomContext()).toEqual({ local: null, roomDefault: false, isHost: false });
  });

  it('survives nonsense input without throwing', async () => {
    const sfx = await freshSfx();
    expect(() => sfx.setSameRoomLocal(undefined as unknown as boolean)).not.toThrow();
    expect(sfx.getSameRoomLocal()).toBeNull();
    expect(() => sfx.setSameRoomContext({})).not.toThrow();
    expect(() =>
      sfx.setSameRoomContext({ roomDefault: 'yes' as unknown as boolean }),
    ).not.toThrow();
    expect(sfx.getSameRoomContext().roomDefault).toBe(false);
  });
});
