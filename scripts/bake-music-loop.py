#!/usr/bin/env python3
"""
Bake a seamlessly-looping music bed.

Why this exists
---------------
A runtime crossfade can hide a *click* at the loop point. It cannot hide a
*downbeat in the wrong place*. The Lyria placeholders are 31.768s at ~110 BPM,
which is 14.56 bars — so every loop the beat arrived roughly half a bar early
and the whole bed stumbled. No fade length fixes that; the loop period has to
be a whole number of bars.

What it does
------------
1. Estimates tempo from the onset envelope, disambiguating half/double time by
   scoring each candidate across its harmonics.
2. Picks a loop period that is a whole number of bars AND whose tail matches
   its head, so there is something sensible to crossfade. Both matter: bar
   alignment fixes the rhythm, spectral match fixes the timbre.
3. Bakes an equal-power crossfade into the file itself, so the shipped asset
   loops perfectly with a plain `loop = true` and no runtime scheduling.

Equal power (sin/cos), not linear: two decorrelated signals summed with a
linear pair dip ~3dB at the midpoint, which is audible as a dent once a bar.

Usage
-----
  python3 scripts/bake-music-loop.py IN.ogg -o OUT --bars 12 --crossfade-bars 2
  python3 scripts/bake-music-loop.py IN.ogg --analyse-only
"""
import argparse, json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np

ANALYSIS_SR = 22050


def decode(path: Path, sr: int, mono: bool) -> np.ndarray:
    cmd = ['ffmpeg', '-v', 'error', '-i', str(path), '-ar', str(sr),
           '-ac', '1' if mono else '2', '-f', 'f32le', '-']
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    a = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    return a if mono else a.reshape(-1, 2)


def onset_envelope(y, sr, hop=256, win=1024):
    n = 1 + (len(y) - win) // hop
    frames = np.stack([y[i * hop:i * hop + win] * np.hanning(win) for i in range(n)])
    spec = np.abs(np.fft.rfft(frames, axis=1))
    flux = np.maximum(0, np.diff(spec, axis=0)).sum(axis=1)
    return (flux - flux.mean()) / (flux.std() + 1e-9), sr / hop, spec


def estimate_tempo(env, fps, lo=60.0, hi=180.0):
    ac = np.correlate(env, env, 'full')[len(env) - 1:]
    ac[0] = 0
    peak = np.max(ac) or 1.0
    ac = ac / peak
    best, best_score = lo, -1e9
    for bpm in np.arange(lo, hi, 0.05):
        beat = 60.0 / bpm
        # Summing harmonics is what stops a shuffle reading as half time.
        score = sum(ac[int(round(beat * m * fps))] for m in (1, 2, 4, 8)
                    if int(round(beat * m * fps)) < len(ac))
        if score > best_score:
            best, best_score = bpm, score
    return float(best)


def window_spectrum(y, sr, start_s, length_s):
    a = int(start_s * sr)
    b = min(len(y), a + int(length_s * sr))
    seg = y[a:b]
    if len(seg) < 128:
        return None
    win = np.hanning(len(seg))
    mag = np.abs(np.fft.rfft(seg * win))
    # Log-spaced bands: perceptual enough for "do these two moments match".
    edges = np.logspace(np.log10(20), np.log10(sr / 2), 33)
    freqs = np.fft.rfftfreq(len(seg), 1 / sr)
    bands = np.array([mag[(freqs >= edges[i]) & (freqs < edges[i + 1])].sum()
                      for i in range(len(edges) - 1)])
    return bands / (np.linalg.norm(bands) + 1e-9)


def score_loop(y, sr, period_s, xfade_s):
    """How well does the material at `period` match the material at 0?"""
    head = window_spectrum(y, sr, 0.0, xfade_s)
    tail = window_spectrum(y, sr, period_s, xfade_s)
    if head is None or tail is None:
        return -1.0
    return float(np.dot(head, tail))


def equal_power(n):
    p = np.linspace(0.0, 1.0, n)
    return np.sin(p * np.pi / 2), np.cos(p * np.pi / 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input', type=Path)
    ap.add_argument('-o', '--out-base', type=Path, help='output base path, no extension')
    ap.add_argument('--bpm', type=float, default=None, help='override detected tempo')
    ap.add_argument('--beats-per-bar', type=int, default=4)
    ap.add_argument('--bars', type=int, default=None, help='loop length in bars')
    ap.add_argument('--crossfade-bars', type=float, default=2.0)
    ap.add_argument('--analyse-only', action='store_true')
    ap.add_argument('--sr', type=int, default=48000)
    args = ap.parse_args()

    mono = decode(args.input, ANALYSIS_SR, True)
    dur = len(mono) / ANALYSIS_SR
    env, fps, _ = onset_envelope(mono, ANALYSIS_SR)
    bpm = args.bpm or estimate_tempo(env, fps)
    bar = args.beats_per_bar * 60.0 / bpm

    print(f"{args.input.name}: {dur:.4f}s, tempo {bpm:.2f} BPM, bar {bar:.4f}s, "
          f"{dur / bar:.3f} bars")

    xf = args.crossfade_bars * bar
    # A candidate needs period + crossfade of real audio to draw from.
    candidates = [b for b in range(4, int(dur / bar) + 1) if b * bar + xf <= dur]
    if not candidates:
        sys.exit(f"no whole-bar loop fits with a {xf:.2f}s crossfade")

    scored = [(b, score_loop(mono, ANALYSIS_SR, b * bar, xf)) for b in candidates]
    for b, s in scored:
        print(f"   {b:2d} bars = {b * bar:7.4f}s   head/tail match {s:.4f}"
              f"{'   <-- best' if (b, s) == max(scored, key=lambda t: t[1]) else ''}")

    bars = args.bars or max(scored, key=lambda t: t[1])[0]
    period = bars * bar
    print(f"-> loop {bars} bars = {period:.4f}s, crossfade "
          f"{args.crossfade_bars} bars = {xf:.4f}s")
    if args.analyse_only:
        return

    # Bake at full quality/stereo.
    y = decode(args.input, args.sr, False)
    P, X = int(round(period * args.sr)), int(round(xf * args.sr))
    if P + X > len(y):
        sys.exit('not enough audio for that loop plus crossfade')

    out = y[:P].copy()
    tail = y[P:P + X]                      # what plays *past* the loop point
    fin, fout = equal_power(X)
    # Mix the tail into the head, so wrapping from P back to 0 is continuous.
    out[:X] = out[:X] * fin[:, None] + tail * fout[:, None]

    peak = float(np.max(np.abs(out)))
    if peak > 1.0:
        out /= peak
        print(f"   normalised, peak was {peak:.3f}")

    base = args.out_base or args.input.with_suffix('')
    with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tf:
        wav = Path(tf.name)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(args.sr),
                    '-ac', '2', '-i', '-', str(wav)],
                   input=out.astype(np.float32).tobytes(), check=True)
    for ext, extra in (('.ogg', ['-c:a', 'libvorbis', '-q:a', '4']),
                       ('.mp3', ['-c:a', 'libmp3lame', '-q:a', '4'])):
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(wav), *extra,
                        str(base.with_suffix(ext))], check=True)
        print(f"   wrote {base.with_suffix(ext)}")
    wav.unlink(missing_ok=True)

    print(json.dumps({'bpm': round(bpm, 2), 'bars': bars,
                      'durationSeconds': round(period, 4),
                      'bakedCrossfadeSeconds': round(xf, 4)}, indent=2))


if __name__ == '__main__':
    main()
