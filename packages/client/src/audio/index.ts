/**
 * Phrasey audio. One import for the whole surface:
 *
 *   import { initAudio, playSfx, setMuted, playMusic } from './audio';
 *
 * Effects are synthesized (see `sfx.ts`); music streams from the manifest in
 * `public/audio/music/` (see `music.ts`). Everything is safe to call before the
 * AudioContext exists and safe to call on a machine with no audio device.
 */
export {
  DEFAULT_MASTER_VOLUME,
  initAudio,
  isAudioReady,
  getAudioContext,
  armAudioUnlock,
  disposeAudio,
  playSfx,
  setMasterVolume,
  getMasterVolume,
  setMuted,
  isMuted,
  toggleMuted,
  getEffectiveGain,
  onAudioSettingsChange,
  setSameRoomLocal,
  getSameRoomLocal,
  setSameRoomContext,
  getSameRoomContext,
  isSameRoomSilenced,
  resolveSameRoomSilence,
  startPressureHiss,
  updatePressureHiss,
  stopPressureHiss,
  getPressureLevel,
} from './sfx';
export type { SfxName, SfxOptions, AudioSettings, SameRoomInput } from './sfx';

export {
  DEFAULT_MANIFEST_URL,
  DEFAULT_MUSIC_VOLUME,
  DEFAULT_LOOP_CROSSFADE_SECONDS,
  equalPowerFadeCurve,
  resolveLoopCrossfade,
  loopPeriod,
  loopPassStartTime,
  getMusicBackend,
  getLoopSchedule,
  loadMusicManifest,
  getTracks,
  findTrack,
  playMusic,
  stopMusic,
  setMusicVolume,
  getMusicVolume,
  getCurrentTrack,
  isMusicPlaying,
  disposeMusic,
} from './music';
export type { MusicTrack, MusicManifest, PlayMusicOptions } from './music';

export {
  AUDIO_STORAGE_KEY,
  DEFAULT_AUDIO_PREFS,
  readAudioPrefs,
  writeAudioPrefs,
} from './prefs';
export type { AudioPrefs } from './prefs';
