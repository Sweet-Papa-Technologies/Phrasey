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
| `loop` | boolean | yes | `true` loops the track for as long as the mood is active. |
| `loopCrossfadeSeconds` | number | no | **Seconds of overlap at the loop point.** Defaults to `1.5`. This is the knob to turn if a loop sounds jumpy — see below. Ignored when `loop` is `false`. |
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
      "loopCrossfadeSeconds": 1.5,
      "mood": "gameplay"
    }
  ]
}
```

Unknown fields are ignored and malformed rows are dropped, so an older client
will not break on a newer manifest.

## Tuning the loop point (`loopCrossfadeSeconds`)

The player does not restart the file at the loop point. It schedules the next
pass through the track to begin `loopCrossfadeSeconds` **before** the current
one ends, and crossfades the overlap with an equal-power (sine/cosine) pair of
curves — the two passes' gains satisfy `in² + out² = 1`, so loudness stays flat
through the seam instead of dipping the way a straight linear fade would.

**No rebuild, no code change: this is a number in this file.**

| value | when |
|---|---|
| `0` | The file's own head and tail already join perfectly (e.g. you baked the crossfade in with the `ffmpeg` recipe below). Plays the file end to end with no overlap. |
| `0.2`–`0.5` | Tight, percussive material where a long overlap would smear the downbeat. |
| `1.5` (default) | A general-purpose bed. What the two placeholder tracks use. |
| `2`–`4` | Pads, drones, anything with a long tail. |

It is clamped to just under half the track's real decoded duration, so an
absurd value cannot break playback. Set it too long and you will hear the track
"phasing" against itself; set it to `0` on material that does not actually join
and you get the click you were trying to remove. Try `1.5`, then move it.

> The two placeholder beds ship with the seam crossfaded into the file **and**
> `loopCrossfadeSeconds: 1.5`. If a future track is prepared the same way and
> the doubled overlap sounds soft, drop this field to `0` for that row.

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
- **Prefers Web Audio.** The file is fetched and decoded once into an
  `AudioBuffer` and each pass through the loop is its own
  `AudioBufferSourceNode`, scheduled on the audio clock so the overlap at the
  loop point is sample-accurate. If there is no `AudioContext`, no `fetch`, or
  the decode fails, it falls back to a streaming `<audio>` element with
  `loop = true` — the old behaviour, seam and all, but never silence and never
  an error.
- Crossfades between tracks (`playMusic(id, { crossfadeSeconds })`) as well as
  across the loop point (`loopCrossfadeSeconds`, above). They are separate
  fades on separate nodes and both work at once.
- Multiplies the deck gain by **master volume × mute × Same-room × music
  volume**, so the top-bar mute in `sfx.ts` covers music too, and so does a
  player's "Same room" switch.
- Music has its own bus level (default `0.45`, i.e. ~18% once the 40% master is
  applied) so the bed sits under the effects. The player can raise it on its
  own slider in the top bar; it persists under `phrasey.audio.v1`.
- Resolves `false` instead of throwing when autoplay is blocked, the manifest is
  missing, or the id is unknown.

## Looping: bake it, don't fade it

**The loop period must be a whole number of bars.** This is the thing that
actually matters, and it is easy to miss.

The original placeholders were 31.768s at ~110 BPM — 14.54 bars. Every loop the
downbeat arrived roughly half a bar early, so the bed stumbled. A longer
crossfade does not help: a fade can hide a *click*, it cannot hide a *beat in
the wrong place*. Lengthening the fade just smears the stumble.

So the shipped tracks are **pre-baked**: cut to exactly 12 bars (26.2176s at
109.85 BPM) with a 2-bar equal-power crossfade mixed into the head of the file.
They loop correctly with plain back-to-back playback and need no runtime
crossfade, which is why they carry `"bakedLoop": true` and
`"loopCrossfadeSeconds": 0`.

### Re-cutting a track (this is the tuning knob)

`scripts/bake-music-loop.py` does the analysis and the bake:

```bash
# What are my options? Prints tempo and every whole-bar loop with a
# head/tail match score. Writes nothing.
python3 scripts/bake-music-loop.py mytrack.ogg --analyse-only

# Bake it. Longer --crossfade-bars = more runway over the join.
python3 scripts/bake-music-loop.py mytrack.ogg -o ./mytrack \
    --bars 12 --crossfade-bars 2
```

Then copy the printed `bpm` / `durationSeconds` into the manifest row.

Tuning guidance:

| Knob | Effect |
|---|---|
| `--bars` | Loop length. Longer = less repetitive but a longer wait to notice a bad join. Under ~8 bars gets obviously loopy on a lobby screen. |
| `--crossfade-bars` | Runway over the join. 1 is tight, 2 is comfortable, 4 is very soft but eats more of the source. |
| `--bpm` | Override if the detector picks half or double time. |

The source must be at least `bars + crossfade-bars` long — the crossfade is
drawn from the audio *past* the loop point, so a 12-bar loop with a 2-bar fade
needs 14 bars of material.

### Dropping in a Suno track

1. Export at 48kHz. Ask for a specific BPM and a whole number of bars if you can.
2. `--analyse-only` first and read the match scores; pick a bar count that is
   both long enough and scores well.
3. Bake, copy the two files in here, add a manifest row.
4. Keep `loopCrossfadeSeconds: 0` and `bakedLoop: true` for a baked file. Set a
   non-zero `loopCrossfadeSeconds` only for a track you did *not* bake — the
   runtime scheduler will then overlap passes itself, which fixes a click but
   still cannot fix bar misalignment.

No rebuild is needed — the client reads this manifest at load.
