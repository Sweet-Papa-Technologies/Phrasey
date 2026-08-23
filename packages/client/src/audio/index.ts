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
  startPressureHiss,
  updatePressureHiss,
  stopPressureHiss,
  getPressureLevel,
} from './sfx';
export type { SfxName, SfxOptions, AudioSettings } from './sfx';

export {
  DEFAULT_MANIFEST_URL,
  DEFAULT_MUSIC_VOLUME,
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
