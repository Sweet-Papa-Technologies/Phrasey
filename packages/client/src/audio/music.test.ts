/**
 * @vitest-environment jsdom
 *
 * The music player is the one piece a non-programmer will interact with: they
 * drop a file in `public/audio/music/` and edit `manifest.json`. So the tests
 * that matter most are the ones about surviving a hand-edited manifest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MusicModule = typeof import('./music');

let created: FakeAudio[] = [];
let playShouldFail = false;
/** What the fake browser claims it can decode. */
let playable = new Set(['audio/ogg; codecs=vorbis', 'audio/mpeg']);

class FakeAudio {
  src = '';
  loop = false;
  preload = '';
  crossOrigin: string | null = null;
  volume = 1;
  currentTime = 0;
  paused = true;
  constructor() {
    created.push(this);
  }
  canPlayType(type: string) {
    return playable.has(type) ? 'probably' : '';
  }
  play() {
    if (playShouldFail) return Promise.reject(new Error('NotAllowedError'));
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

const GOOD_MANIFEST = {
  version: 1,
  tracks: [
    {
      id: 'fountain-groove',
      title: 'Fountain Groove',
      file: '/audio/music/fountain-groove.ogg',
      fallbackFile: '/audio/music/fountain-groove.mp3',
      durationSeconds: 31.768,
      bpm: 110,
      loop: true,
      mood: 'gameplay',
    },
    {
      id: 'cooler-lights',
      title: 'Cooler Lights',
      file: '/audio/music/cooler-lights.ogg',
      fallbackFile: '/audio/music/cooler-lights.mp3',
      durationSeconds: 31.768,
      bpm: 110,
      loop: true,
      mood: 'lobby',
    },
  ],
};

function stubFetch(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 404,
      json: async () => body,
      // The Web Audio path fetches the track itself, not just the manifest.
      arrayBuffer: async () => new ArrayBuffer(64),
    })),
  );
}

async function fresh(): Promise<MusicModule> {
  vi.resetModules();
  return import('./music');
}

beforeEach(() => {
  created = [];
  playShouldFail = false;
  playable = new Set(['audio/ogg; codecs=vorbis', 'audio/mpeg']);
  vi.stubGlobal('Audio', FakeAudio as unknown as typeof Audio);
  vi.stubGlobal('AudioContext', undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
  localStorage.clear();
});

describe('manifest loading', () => {
  it('parses a well-formed manifest', async () => {
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    const m = await music.loadMusicManifest();
    expect(m.version).toBe(1);
    expect(m.tracks).toHaveLength(2);
    expect(music.getTracks().map((t) => t.id)).toEqual(['fountain-groove', 'cooler-lights']);
  });

  it('caches, so the manifest is fetched once', async () => {
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await music.loadMusicManifest();
    await music.loadMusicManifest();
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls).toHaveLength(1);
  });

  it('returns an empty track list on a 404 instead of throwing', async () => {
    stubFetch(null, false);
    const music = await fresh();
    const m = await music.loadMusicManifest();
    expect(m.tracks).toEqual([]);
  });

  it('survives a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('offline');
    }));
    const music = await fresh();
    await expect(music.loadMusicManifest()).resolves.toMatchObject({ tracks: [] });
  });

  it('drops malformed rows and fills in missing fields', async () => {
    stubFetch({
      tracks: [
        null,
        { title: 'no id' },
        { id: 'no-file' },
        { id: 'minimal', file: '/a.ogg' },
      ],
    });
    const music = await fresh();
    const m = await music.loadMusicManifest();
    expect(m.tracks).toHaveLength(1);
    expect(m.tracks[0]).toEqual({
      id: 'minimal',
      title: 'minimal',
      file: '/a.ogg',
      fallbackFile: undefined,
      durationSeconds: 0,
      bpm: 0,
      loop: true,
      loopCrossfadeSeconds: 1.5,
      mood: '',
    });
  });

  it('reads loopCrossfadeSeconds, and defaults or repairs it', async () => {
    stubFetch({
      tracks: [
        { id: 'tuned', file: '/a.ogg', loopCrossfadeSeconds: 3 },
        { id: 'seamless', file: '/b.ogg', loopCrossfadeSeconds: 0 },
        { id: 'silly', file: '/c.ogg', loopCrossfadeSeconds: -4 },
        { id: 'hostile', file: '/d.ogg', loopCrossfadeSeconds: 'a lot' },
        { id: 'absent', file: '/e.ogg' },
      ],
    });
    const music = await fresh();
    const m = await music.loadMusicManifest();
    expect(m.tracks.map((t) => t.loopCrossfadeSeconds)).toEqual([3, 0, 0, 1.5, 1.5]);
  });

  it('tolerates outright garbage', async () => {
    stubFetch('not an object');
    const music = await fresh();
    await expect(music.loadMusicManifest()).resolves.toMatchObject({ tracks: [] });
  });
});

describe('track resolution', () => {
  it('finds by id, then by mood', async () => {
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await music.loadMusicManifest();
    expect(music.findTrack('cooler-lights')?.title).toBe('Cooler Lights');
    expect(music.findTrack('lobby')?.id).toBe('cooler-lights');
    expect(music.findTrack('nonsense')).toBeNull();
  });
});

describe('playback', () => {
  it('plays a track and reports the current one', async () => {
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await expect(music.playMusic('gameplay')).resolves.toBe(true);
    expect(music.getCurrentTrack()?.id).toBe('fountain-groove');
    expect(music.isMusicPlaying()).toBe(true);
    expect(created[0]!.loop).toBe(true);
  });

  it('prefers the ogg, and falls back to the mp3 when vorbis is unsupported', async () => {
    stubFetch(GOOD_MANIFEST);
    let music = await fresh();
    await music.playMusic('fountain-groove');
    expect(created[0]!.src).toBe('/audio/music/fountain-groove.ogg');

    created = [];
    playable = new Set(['audio/mpeg']);
    stubFetch(GOOD_MANIFEST);
    music = await fresh();
    await music.playMusic('fountain-groove');
    expect(created[0]!.src).toBe('/audio/music/fountain-groove.mp3');
  });

  it('returns false for an unknown id and for an empty manifest', async () => {
    stubFetch({ version: 1, tracks: [] });
    const music = await fresh();
    await expect(music.playMusic('anything')).resolves.toBe(false);
    await expect(music.playMusic()).resolves.toBe(false);
    expect(music.getCurrentTrack()).toBeNull();
  });

  it('reports false rather than throwing when autoplay is blocked', async () => {
    stubFetch(GOOD_MANIFEST);
    playShouldFail = true;
    const music = await fresh();
    await expect(music.playMusic('gameplay')).resolves.toBe(false);
  });

  it('is a no-op when the requested track is already playing', async () => {
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await music.playMusic('gameplay');
    await music.playMusic('gameplay');
    expect(created).toHaveLength(1);
  });

  it('crossfades: the outgoing deck fades to zero and is released', async () => {
    vi.useFakeTimers();
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await music.playMusic('fountain-groove', { crossfadeSeconds: 0.5 });
    await music.playMusic('cooler-lights', { crossfadeSeconds: 0.5 });
    expect(created).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(created[0]!.volume).toBe(0);
    expect(created[0]!.paused).toBe(true);
    expect(created[1]!.volume).toBeGreaterThan(0);
    expect(music.getCurrentTrack()?.id).toBe('cooler-lights');
  });

  it('stopMusic fades everything out', async () => {
    vi.useFakeTimers();
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await music.playMusic('gameplay', { crossfadeSeconds: 0.2 });
    music.stopMusic(0.2);
    vi.advanceTimersByTime(600);
    expect(created[0]!.paused).toBe(true);
    expect(music.getCurrentTrack()).toBeNull();
    expect(() => music.stopMusic()).not.toThrow();
  });
});

describe('volume', () => {
  it('is master × mute × music × per-track gain', async () => {
    vi.useFakeTimers();
    stubFetch(GOOD_MANIFEST);
    vi.resetModules();
    const sfx = await import('./sfx');
    const music = await import('./music');

    sfx.setMasterVolume(0.5);
    music.setMusicVolume(0.5);
    await music.playMusic('gameplay', { crossfadeSeconds: 0.1, gain: 0.5 });
    vi.advanceTimersByTime(400);
    expect(created[0]!.volume).toBeCloseTo(0.125, 5);

    sfx.setMuted(true);
    expect(created[0]!.volume).toBe(0);
    sfx.setMuted(false);
    expect(created[0]!.volume).toBeCloseTo(0.125, 5);
  });

  it('clamps and ignores non-finite music volume', async () => {
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    music.setMusicVolume(-1);
    expect(music.getMusicVolume()).toBe(0);
    music.setMusicVolume(5);
    expect(music.getMusicVolume()).toBe(1);
    music.setMusicVolume(Number.NaN);
    expect(music.getMusicVolume()).toBe(1);
  });
});

describe('no Audio constructor at all', () => {
  it('degrades to silence without throwing', async () => {
    vi.stubGlobal('Audio', undefined);
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await expect(music.playMusic('gameplay')).resolves.toBe(false);
    expect(music.isMusicPlaying()).toBe(false);
    expect(() => music.stopMusic()).not.toThrow();
    expect(() => music.disposeMusic()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The loop seam. A stub Web Audio graph that records every automation event and
// every scheduled start, because that is the only thing about a crossfade you
// can actually assert on in a test — you cannot listen to it.
// ---------------------------------------------------------------------------

interface ParamEvent {
  type: 'set' | 'linear' | 'curve';
  time: number;
  value?: number;
  curve?: number[];
  duration?: number;
}

class FakeParam {
  value: number;
  events: ParamEvent[] = [];
  constructor(initial = 1) {
    this.value = initial;
  }
  setValueAtTime(v: number, t: number) {
    this.events.push({ type: 'set', time: t, value: v });
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.events.push({ type: 'linear', time: t, value: v });
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.events.push({ type: 'linear', time: t, value: v });
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number, t: number) {
    this.events.push({ type: 'set', time: t, value: v });
    this.value = v;
    return this;
  }
  setValueCurveAtTime(curve: Float32Array, t: number, duration: number) {
    this.events.push({ type: 'curve', time: t, curve: Array.from(curve), duration });
    this.value = curve[curve.length - 1] ?? 0;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}

class FakeNode {
  connected: unknown[] = [];
  disconnected = 0;
  connect(dest: unknown) {
    this.connected.push(dest);
    return dest as FakeNode;
  }
  disconnect() {
    this.disconnected++;
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}

interface StartedSource {
  when: number;
  offset: number;
  gain: FakeParam;
  stoppedAt: number | null;
}

let started: StartedSource[] = [];

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  loop = false;
  private record: StartedSource | null = null;
  start(when = 0, offset = 0) {
    // The gain node this source feeds is the one connected to it.
    const g = this.connected[0] as FakeGain | undefined;
    this.record = { when, offset, gain: g ? g.gain : new FakeParam(), stoppedAt: null };
    started.push(this.record);
  }
  stop(when = 0) {
    if (this.record) this.record.stoppedAt = when;
  }
}

const FAKE_BUFFER_DURATION = 31.768;

class FakeWebAudioContext {
  sampleRate = 48000;
  currentTime = 0;
  state: AudioContextState = 'running';
  destination = new FakeNode();
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
  close() {
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain() {
    return new FakeGain();
  }
  createBufferSource() {
    return new FakeBufferSource();
  }
  createBiquadFilter() {
    const n = new FakeNode() as FakeNode & Record<string, unknown>;
    n.type = 'lowpass';
    n.frequency = new FakeParam(350);
    n.Q = new FakeParam(1);
    return n;
  }
  createOscillator() {
    const n = new FakeNode() as FakeNode & Record<string, unknown>;
    n.frequency = new FakeParam(440);
    n.start = () => {};
    n.stop = () => {};
    return n;
  }
  createBuffer(channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data, length, numberOfChannels: channels, duration: 0 };
  }
  decodeAudioData(_bytes: ArrayBuffer) {
    return Promise.resolve({
      duration: FAKE_BUFFER_DURATION,
      sampleRate: 48000,
      numberOfChannels: 2,
      length: Math.round(FAKE_BUFFER_DURATION * 48000),
    } as unknown as AudioBuffer);
  }
}

let fakeCtx: FakeWebAudioContext | null = null;

function stubWebAudio() {
  started = [];
  fakeCtx = null;
  class Ctor extends FakeWebAudioContext {
    constructor() {
      super();
      fakeCtx = this as unknown as FakeWebAudioContext;
    }
  }
  vi.stubGlobal('AudioContext', Ctor as unknown as typeof AudioContext);
}

describe('equal-power crossfade curve', () => {
  it('runs 0→1 in and 1→0 out', async () => {
    const music = await fresh();
    const fin = music.equalPowerFadeCurve('in', 33);
    const fout = music.equalPowerFadeCurve('out', 33);
    expect(fin[0]).toBeCloseTo(0, 6);
    expect(fin[fin.length - 1]).toBeCloseTo(1, 6);
    expect(fout[0]).toBeCloseTo(1, 6);
    expect(fout[fout.length - 1]).toBeCloseTo(0, 6);
  });

  it('is equal *power*, not equal amplitude — in² + out² === 1 throughout', async () => {
    const music = await fresh();
    const fin = music.equalPowerFadeCurve('in', 128);
    const fout = music.equalPowerFadeCurve('out', 128);
    for (let i = 0; i < fin.length; i++) {
      expect(fin[i]! ** 2 + fout[i]! ** 2).toBeCloseTo(1, 5);
    }
    // The midpoint is the tell. A linear pair would sum to 1.0 in amplitude and
    // 0.5 in power — the audible -3dB dent at every loop point.
    const mid = Math.floor(fin.length / 2);
    expect(fin[mid]!).toBeCloseTo(Math.SQRT1_2, 2);
    expect(fout[mid]!).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it('is monotonic and never leaves 0..1', async () => {
    const music = await fresh();
    const fin = music.equalPowerFadeCurve('in', 64);
    for (let i = 1; i < fin.length; i++) {
      expect(fin[i]!).toBeGreaterThanOrEqual(fin[i - 1]!);
      expect(fin[i]!).toBeLessThanOrEqual(1);
      expect(fin[i]!).toBeGreaterThanOrEqual(0);
    }
    // Degenerate step counts must still produce a usable curve.
    expect(music.equalPowerFadeCurve('in', 0).length).toBe(2);
    expect(music.equalPowerFadeCurve('out', 1).length).toBe(2);
  });
});

describe('loop scheduling maths', () => {
  it('starts each pass a crossfade before the previous one ends', async () => {
    const music = await fresh();
    const d = 31.768;
    const x = 1.5;
    expect(music.loopPeriod(d, x)).toBeCloseTo(30.268, 6);
    expect(music.loopPassStartTime(0, 0, d, x)).toBeCloseTo(0, 6);
    // Pass 1 begins 1.5s before pass 0's tail runs out at 31.768.
    expect(music.loopPassStartTime(0, 1, d, x)).toBeCloseTo(d - x, 6);
    expect(music.loopPassStartTime(0, 1, d, x)).toBeLessThan(d);
    expect(d - music.loopPassStartTime(0, 1, d, x)).toBeCloseTo(x, 6);
  });

  it('computes from the anchor so a long session cannot drift', async () => {
    const music = await fresh();
    const d = 31.768;
    const x = 1.5;
    const anchor = 12.5;
    // 500 passes ≈ 4 hours. Accumulating would have visibly drifted by now.
    expect(music.loopPassStartTime(anchor, 500, d, x)).toBeCloseTo(anchor + 500 * (d - x), 6);
  });

  it('honours the manifest value, and clamps a silly one', async () => {
    const music = await fresh();
    expect(music.resolveLoopCrossfade({ loopCrossfadeSeconds: 2.5 }, 30)).toBe(2.5);
    expect(music.resolveLoopCrossfade({ loopCrossfadeSeconds: 0 }, 30)).toBe(0);
    expect(music.resolveLoopCrossfade({ loopCrossfadeSeconds: -3 }, 30)).toBe(0);
    // Never as long as half the track, or the fade-in and fade-out windows on
    // one pass would touch, which Web Audio rejects.
    expect(music.resolveLoopCrossfade({ loopCrossfadeSeconds: 999 }, 30)).toBeLessThan(15);
    expect(music.resolveLoopCrossfade({ loopCrossfadeSeconds: 1.5 }, 0)).toBe(0);
    expect(
      music.resolveLoopCrossfade({ loopCrossfadeSeconds: Number.NaN }, 30),
    ).toBe(music.DEFAULT_LOOP_CROSSFADE_SECONDS);
  });
});

describe('web audio loop playback', () => {
  beforeEach(() => {
    stubWebAudio();
  });

  it('decodes into a buffer and reports the buffer backend', async () => {
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await expect(music.playMusic('gameplay')).resolves.toBe(true);
    expect(music.getMusicBackend()).toBe('buffer');
    expect(music.isMusicPlaying()).toBe(true);
    // No streaming element was built: the Web Audio path won.
    expect(created.filter((a) => a.src !== '')).toHaveLength(0);
  });

  it('schedules the next pass exactly one crossfade before the current one ends', async () => {
    vi.useFakeTimers();
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await music.playMusic('gameplay');

    const s0 = music.getLoopSchedule()!;
    expect(s0.trackId).toBe('fountain-groove');
    expect(s0.duration).toBeCloseTo(FAKE_BUFFER_DURATION, 5);
    expect(s0.crossfade).toBeCloseTo(1.5, 5);
    expect(s0.period).toBeCloseTo(FAKE_BUFFER_DURATION - 1.5, 5);
    // Only pass 0 is inside the lookahead horizon at t=0.
    expect(s0.scheduled).toBe(1);
    expect(s0.nextStart).toBeCloseTo(FAKE_BUFFER_DURATION - 1.5, 5);
    expect(started).toHaveLength(1);
    expect(started[0]!.when).toBeCloseTo(0, 5);

    // Roll the playhead up to the seam and let the scheduler tick.
    fakeCtx!.currentTime = 26;
    vi.advanceTimersByTime(1000);

    expect(started).toHaveLength(2);
    const pass1 = started[1]!;
    expect(pass1.when).toBeCloseTo(FAKE_BUFFER_DURATION - 1.5, 5);
    // ...which is to say: pass 1 is already playing for 1.5s while pass 0
    // finishes, instead of pass 0 snapping back to zero.
    expect(started[0]!.stoppedAt!).toBeGreaterThan(pass1.when);
    expect(started[0]!.stoppedAt! - pass1.when).toBeGreaterThanOrEqual(1.5);
  });

  it('crossfades the seam with the matching halves of the equal-power pair', async () => {
    vi.useFakeTimers();
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await music.playMusic('gameplay');
    fakeCtx!.currentTime = 26;
    vi.advanceTimersByTime(1000);

    const seam = FAKE_BUFFER_DURATION - 1.5;
    const outgoingCurves = started[0]!.gain.events.filter((e) => e.type === 'curve');
    const incomingCurves = started[1]!.gain.events.filter((e) => e.type === 'curve');

    // Pass 0 enters at full (nothing before it to fade against) and fades out
    // over the overlap; pass 1 fades in over the very same window.
    expect(outgoingCurves).toHaveLength(1);
    expect(outgoingCurves[0]!.time).toBeCloseTo(seam, 5);
    expect(outgoingCurves[0]!.duration).toBeCloseTo(1.5, 5);
    expect(outgoingCurves[0]!.curve![0]).toBeCloseTo(1, 5);
    expect(outgoingCurves[0]!.curve!.at(-1)).toBeCloseTo(0, 5);

    const fadeIn = incomingCurves.find((e) => Math.abs(e.time - seam) < 1e-6)!;
    expect(fadeIn).toBeTruthy();
    expect(fadeIn.duration).toBeCloseTo(1.5, 5);
    expect(fadeIn.curve![0]).toBeCloseTo(0, 5);
    expect(fadeIn.curve!.at(-1)).toBeCloseTo(1, 5);

    // The two curves are complementary in power at every sample.
    const out = outgoingCurves[0]!.curve!;
    const inn = fadeIn.curve!;
    expect(inn).toHaveLength(out.length);
    for (let i = 0; i < inn.length; i++) {
      expect(inn[i]! ** 2 + out[i]! ** 2).toBeCloseTo(1, 5);
    }
  });

  it('respects loopCrossfadeSeconds: 0 by scheduling passes back to back', async () => {
    stubFetch({
      version: 1,
      tracks: [
        { ...GOOD_MANIFEST.tracks[0], loopCrossfadeSeconds: 0 },
      ],
    });
    const music = await fresh();
    await music.playMusic('gameplay');
    const s = music.getLoopSchedule()!;
    expect(s.crossfade).toBe(0);
    expect(s.period).toBeCloseTo(FAKE_BUFFER_DURATION, 5);
    // No curves at all — just a plain full-gain pass.
    expect(started[0]!.gain.events.filter((e) => e.type === 'curve')).toHaveLength(0);
  });

  it('does not loop a one-shot track', async () => {
    vi.useFakeTimers();
    stubFetch({
      version: 1,
      tracks: [{ ...GOOD_MANIFEST.tracks[0], loop: false }],
    });
    const music = await fresh();
    await music.playMusic('gameplay');
    fakeCtx!.currentTime = 40;
    vi.advanceTimersByTime(5000);
    expect(started).toHaveLength(1);
  });

  it('still crossfades track to track, on top of the loop crossfade', async () => {
    vi.useFakeTimers();
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await music.playMusic('fountain-groove', { crossfadeSeconds: 0.5 });
    const first = music.getLoopSchedule()!;
    expect(first.trackId).toBe('fountain-groove');

    await music.playMusic('cooler-lights', { crossfadeSeconds: 0.5 });
    expect(music.getCurrentTrack()?.id).toBe('cooler-lights');
    vi.advanceTimersByTime(1000);
    const second = music.getLoopSchedule()!;
    expect(second.trackId).toBe('cooler-lights');
    // The incoming deck's own output gain has come up under master × music.
    expect(second.deckGain).toBeGreaterThan(0);
    // Both decks were live at once, so both scheduled a pass.
    expect(started.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to the streaming element when the track fetch fails', async () => {
    // The manifest loads; the audio file 404s.
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        if (call === 1) {
          return { ok: true, status: 200, json: async () => GOOD_MANIFEST } as unknown as Response;
        }
        return { ok: false, status: 404, json: async () => null } as unknown as Response;
      }),
    );
    const music = await fresh();
    await expect(music.playMusic('gameplay')).resolves.toBe(true);
    expect(music.getMusicBackend()).toBe('element');
    expect(music.getLoopSchedule()).toBeNull();
    // `created[0]` is the throwaway codec probe; the deck is the one with a src.
    expect(created.find((a) => a.src !== '')!.loop).toBe(true);
  });

  it('falls back to the streaming element when the decode fails', async () => {
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    // Every context this run refuses to decode.
    FakeWebAudioContext.prototype.decodeAudioData = () => Promise.reject(new Error('bad codec'));
    try {
      await expect(music.playMusic('gameplay')).resolves.toBe(true);
      expect(music.getMusicBackend()).toBe('element');
    } finally {
      FakeWebAudioContext.prototype.decodeAudioData = function () {
        return Promise.resolve({ duration: FAKE_BUFFER_DURATION } as unknown as AudioBuffer);
      };
    }
  });

  it('never throws, and releases the graph on dispose', async () => {
    stubFetch(GOOD_MANIFEST);
    const music = await fresh();
    await music.playMusic('gameplay');
    expect(() => music.disposeMusic()).not.toThrow();
    expect(music.getLoopSchedule()).toBeNull();
    expect(music.isMusicPlaying()).toBe(false);
    expect(started[0]!.stoppedAt).not.toBeNull();
  });

  it('mute takes the whole music bus to zero', async () => {
    vi.useFakeTimers();
    stubFetch(GOOD_MANIFEST);
    vi.resetModules();
    const sfx = await import('./sfx');
    const music = await import('./music');
    await music.playMusic('gameplay', { crossfadeSeconds: 0.1 });
    vi.advanceTimersByTime(400);
    expect(music.getLoopSchedule()!.deckGain).toBeGreaterThan(0);
    sfx.setMuted(true);
    expect(music.getLoopSchedule()!.deckGain).toBe(0);
    sfx.setMuted(false);
    expect(music.getLoopSchedule()!.deckGain).toBeGreaterThan(0);
  });

  it('same-room silences music without touching the master volume', async () => {
    vi.useFakeTimers();
    stubFetch(GOOD_MANIFEST);
    vi.resetModules();
    const sfx = await import('./sfx');
    const music = await import('./music');
    await music.playMusic('gameplay', { crossfadeSeconds: 0.1 });
    vi.advanceTimersByTime(400);
    expect(music.getLoopSchedule()!.deckGain).toBeGreaterThan(0);

    sfx.setSameRoomContext({ roomDefault: false, isHost: false });
    sfx.setSameRoomLocal(true);
    expect(music.getLoopSchedule()!.deckGain).toBe(0);
    expect(sfx.getMasterVolume()).toBe(sfx.DEFAULT_MASTER_VOLUME);

    sfx.setSameRoomLocal(false);
    expect(music.getLoopSchedule()!.deckGain).toBeGreaterThan(0);
  });
});

describe('the music bus is independent of the master', () => {
  it('defaults quiet — well under the effects — and persists a change', async () => {
    stubFetch(GOOD_MANIFEST);
    let music = await fresh();
    expect(music.getMusicVolume()).toBe(music.DEFAULT_MUSIC_VOLUME);
    // §9: the bed sits under the effects. 0.4 master × 0.45 ≈ 18% effective.
    expect(music.DEFAULT_MUSIC_VOLUME).toBeLessThan(0.5);
    expect(0.4 * music.DEFAULT_MUSIC_VOLUME).toBeGreaterThan(0.1);
    expect(0.4 * music.DEFAULT_MUSIC_VOLUME).toBeLessThan(0.21);

    music.setMusicVolume(0.8);
    expect(JSON.parse(localStorage.getItem('phrasey.audio.v1')!).musicVolume).toBe(0.8);

    stubFetch(GOOD_MANIFEST);
    music = await fresh();
    expect(music.getMusicVolume()).toBe(0.8);
  });

  it('does not clobber the master volume stored under the same key', async () => {
    localStorage.setItem(
      'phrasey.audio.v1',
      JSON.stringify({ volume: 0.9, muted: true, sameRoom: true }),
    );
    stubFetch(GOOD_MANIFEST);
    vi.resetModules();
    const sfx = await import('./sfx');
    const music = await import('./music');
    music.setMusicVolume(0.3);
    const stored = JSON.parse(localStorage.getItem('phrasey.audio.v1')!);
    expect(stored).toMatchObject({ volume: 0.9, muted: true, sameRoom: true, musicVolume: 0.3 });
    expect(sfx.getMasterVolume()).toBeCloseTo(0.9);
  });
});
