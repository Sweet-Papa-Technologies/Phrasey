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
      mood: '',
    });
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
