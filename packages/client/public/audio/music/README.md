# Music

The client reads `manifest.json` at load. **Dropping a track in does not require
a rebuild** — copy the audio files into this folder, add a row to the manifest,
and redeploy the static site (design doc §9).

## Schema

`manifest.json`

| field | type | required | notes |
|---|---|---|---|
| `version` | number | yes | Manifest format version. Currently `1`. |
| `tracks` | array | yes | May be empty. The game runs fine in silence. |

Each entry in `tracks`:

| field | type | required | notes |
|---|---|---|---|
| `id` | string | yes | Stable key. `playMusic('cooler-lights')`. Must be unique. |
| `title` | string | yes | Human label, for a now-playing line or a credits screen. |
| `file` | string | yes | Site-root-relative path to the primary file. Prefer `.ogg`. |
| `fallbackFile` | string | no | Used when the browser can't decode `file`. Use `.mp3` — Safari does not play Vorbis. |
| `durationSeconds` | number | yes | Real duration. Used for scheduling and UI, not for playback. |
| `bpm` | number | yes | Informational; lets motion be beat-matched later. Use `0` if unknown. |
| `loop` | boolean | yes | `true` sets `HTMLAudioElement.loop`. Only mark `true` for a track whose head and tail actually join. |
| `mood` | string | yes | Free-form tag. `playMusic()` falls back to matching on this, and the app looks for **`lobby`** and **`gameplay`**. |

```jsonc
{
  "version": 1,
  "tracks": [
    {
      "id": "my-suno-track",
      "title": "My Suno Track",
      "file": "/audio/music/my-suno-track.ogg",
      "fallbackFile": "/audio/music/my-suno-track.mp3",
      "durationSeconds": 128.4,
      "bpm": 112,
      "loop": true,
      "mood": "gameplay"
    }
  ]
}
```

Unknown fields are ignored and malformed rows are dropped, so an older client
will not break on a newer manifest.

## Dropping in a Suno track

1. Export the track as WAV.
2. Prepare the loop point. Generative tracks almost never join cleanly end to
   start, so crossfade the tail over the head before encoding. This is exactly
   what was done to the two placeholder beds:

   ```bash
   IN=in.wav; X=1            # X = crossfade length in seconds
   D=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
   TS=$(python3 -c "print($D - $X)")
   ffmpeg -i "$IN" -filter_complex "
     [0:a]asplit=3[h][t][b];
     [h]atrim=0:$X,asetpts=N/SR/TB[head];
     [t]atrim=start=$TS,asetpts=N/SR/TB[tail];
     [b]atrim=start=$X:end=$TS,asetpts=N/SR/TB[body];
     [tail][head]acrossfade=d=$X:c1=qsin:c2=qsin[seam];
     [seam][body]concat=n=2:v=0:a=1[out]" -map "[out]" loop.wav
   ```

   The result is `X` seconds shorter than the source — put the **new** duration
   in `durationSeconds` and set `loop: true`.

3. Encode both formats:

   ```bash
   ffmpeg -i loop.wav -c:a libvorbis -q:a 3 my-track.ogg
   ffmpeg -i loop.wav -c:a libmp3lame -b:a 128k my-track.mp3
   ```
4. Add the manifest row. Keep tracks under ~1 MB each; they are fetched on
   demand, but this is a party game people join from a phone on hotel wifi.

## Playback contract

`packages/client/src/audio/music.ts` owns playback:

- Picks `file` or `fallbackFile` via `canPlayType`.
- Crossfades between tracks (`playMusic(id, { crossfadeSeconds })`).
- Multiplies the element volume by **master volume × mute × music volume**, so
  the top-bar mute in `sfx.ts` covers music too.
- Resolves `false` instead of throwing when autoplay is blocked, the manifest is
  missing, or the id is unknown.
