# Asset credits & provenance

Everything in `public/` that is not a font, plus the audio code in
`src/audio/`. Kept honest so a human review before public launch has something
to review.

**Tooling:** the `assetforge` CLI against Google Vertex AI, on the
`sweet-papa-technologies` GCP project.

---

## Music — `public/audio/music/`

| file | bytes |
|---|---|
| `fountain-groove.ogg` | 368,823 |
| `fountain-groove.mp3` | 509,228 |
| `cooler-lights.ogg` | 423,968 |
| `cooler-lights.mp3` | 509,228 |
| `manifest.json` | 590 |

**Model:** `lyria-002` (Vertex AI). Three candidates were generated; one was
rejected by Vertex's recitation filter, and of the two survivors the tail-to-head
spectral match decided it — see "Selection" below.

Prompts, verbatim:

- **`fountain-groove`** (seed 33) — *"light funky game show bed, 110 BPM, muted
  funk guitar, tight kick and snare, vibraphone stabs, no vocals, playful and
  young, even energy all the way through so it loops seamlessly"*
- **`cooler-lights`** (seed 11) — *"upbeat playful instrumental party game loop,
  110 BPM, bright plastic marimba and glockenspiel, light shaker and rimshot
  percussion, bouncy synth bass, no vocals, cheerful convenience store soda
  fountain energy, loop-friendly, consistent tempo throughout"*
- **Rejected** (seed 22, `INVALID_ARGUMENT` — "all responses were blocked by
  recitation checks") — *"bubbly retro arcade lounge groove, 110 BPM, crisp
  claps and hi-hats, warm analog synth bass, plucky bell melody, no vocals, no
  build or drop, steady loopable groove, fizzy soda pop brightness"*

**Post-processing** (local, ffmpeg + numpy): 1.0 s equal-power crossfade of the
tail onto the head to make the loop point join, then peak-normalised to
−1.5 dBFS, then encoded to Vorbis `-q:a 3` and MP3 CBR 128k. The crossfade
shortens each track from 32.768 s to **31.768 s**, which is what the manifest
reports.

**Selection.** These cannot be auditioned from a terminal, so the choice was
made on measurements: `fountain-groove` scored a 0.79 cosine similarity between
its first and last second of spectrum versus 0.62 for `cooler-lights`, and
`cooler-lights` tapers in level toward the end (0.088 → 0.066 RMS) where
`fountain-groove` holds. Both have low energy variance across the piece, i.e.
neither builds or drops. `fountain-groove` is therefore tagged `gameplay` and
`cooler-lights` `lobby`. **Both are placeholders — a human should listen before
launch**, and the manifest exists precisely so Suno tracks can replace them
without a rebuild. See `audio/music/README.md`.

## Textures — `public/textures/`

| file | bytes | how to use |
|---|---|---|
| `condensation.png` | 128,906 | 512×512 greyscale, tiles seamlessly. White beads on black — composite with `mix-blend-mode: screen` (or as an alpha mask) over the bottle glass. Do **not** use it at full strength; ~25–40% is the read. |
| `plastic-grain.png` | 40,493 | 256×256 greyscale, tiles seamlessly and exactly. Board surface grain. `mix-blend-mode: overlay` at ~30%, or as a repeating background at very low opacity. |
| `price-burst.png` | 16,796 | 512×512 RGBA, transparent. The starburst price-sticker shape — category labels, the "+10" score pop, the blowout screen. Recolour with a CSS filter or use it as a `mask-image`. |

**`condensation.png`** — model `gemini-3.1-flash-image` ("nano banana"), via
`assetforge edit` with no input image. Prompt: *"seamless tileable square
texture: macro cold water condensation droplets and beads on glass, pure black
background, droplets as bright white and pale grey highlights, no color, evenly
scattered varied droplet sizes, flat even lighting, no vignette, no text"*.
Post-processed locally: 72 px wrap-around cross-fade on both axes to make it
genuinely tile, downscaled 1024→512, levels normalised.

**`price-burst.png`** — same model. Prompt: *"flat 2D vector sticker graphic: a
retro convenience store price starburst badge with many sharp spiky points
radiating from a round centre, solid bright orange #FF5C1A fill, thin white
inner outline ring, perfectly centered, crisp clean vector edges, completely
flat with no shading or drop shadow, no text, no numbers, on a solid pure chroma
green #00FF00 background filling the whole square"*. Post-processed locally:
chroma-keyed off the green (the spikes touch the frame edge, so `assetforge
cutout`'s edge flood-fill was not usable), green-spill suppressed, downscaled to
512, quantised to a 48-colour palette — that last step took it from 185 KB to
17 KB.

**`plastic-grain.png` was not generated.** Two attempts came back
`IMAGE_RECITATION` (not charged), and a generated grain would not have tiled
exactly anyway. It is synthesised locally instead with numpy — Gaussian noise
plus a wrap-around box blur, so it is seamless by construction — at a fixed seed
of `20260823`. The generator is ~12 lines; it is not checked in, but the
parameters are: 256², σ ≈ 9/255 around mid-grey, posterised to 3-level steps.

## Icons — `public/`

| file | bytes | notes |
|---|---|---|
| `favicon.svg` | 871 | Hand-authored. The primary favicon. |
| `favicon.png` | 3,614 | 48×48 raster fallback for browsers without SVG favicon support (Safari < 14). |
| `apple-touch-icon.png` | 6,527 | 180×180, full-bleed ink, artwork inset 20% so the iOS squircle mask cannot clip the cap. |
| `og-image.png` | 246,700 | 1200×630 social card. |

**The bottle mark is hand-authored SVG, not generated.** A generated raster was
produced first (`gemini-3.1-flash-image`, prompt: *"bold flat vector app icon on
a solid pure chroma green #00FF00 background: a simple chunky silhouette of a
classic glass soda bottle with a crimped bottle cap and a short neck, solid
bright orange #FF5C1A…"*) and **discarded for two reasons**: it came back as a
recognisable Coca-Cola contour bottle, which is a registered trade dress and not
something to ship as a product mark; and a hand-authored path reduces cleanly to
32 px where a downsampled raster goes muddy. The shipped shape is an original
straight-shouldered bottle with a crimped cap wider than the neck (so the
silhouette still reads as *soda* at 16 px), in `--fanta` on `--ink`, with a
`--lime` liquid line across the body that nods at the pressure gauge. Verified
legible at 32 px and 16 px.

`og-image.png` is composed locally with Pillow from: the hand-authored bottle
(rendered large), `price-burst.png` at 16% opacity behind it, `condensation.png`
masked to the bottle, a grape radial glow, and the project's own webfonts —
Bricolage Grotesque 800 for the wordmark, Martian Mono 600 for the eyebrow,
Figtree 400 for the tagline, all read straight out of `public/fonts/`. No model
was used, so the wordmark is actually the brand typeface rather than an
approximation of it.

### These are not wired up yet

`index.html` belongs to the client build. It needs:

```html
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="icon" href="/favicon.png" sizes="48x48" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<meta property="og:image" content="/og-image.png" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
```

## Sound effects — `src/audio/sfx.ts`

**Not generated. Synthesised in the browser at runtime**, with zero asset bytes
and zero network cost. Lyria produces ~30-second musical passages, which is the
wrong tool for a 120 ms cap crack, and TTS is wronger still. Each effect is a
few oscillators and filtered noise bursts:

| effect | what it is |
|---|---|
| `capCrack` | Bandpassed noise transient + a square dropping 900→170 Hz. Card play. |
| `iceClink` | Three inharmonic partials (2080/3170/4390 Hz, randomly detuned) + a high noise tick. Tile reveal. |
| `boom` | 150→34 Hz sine through a soft-clip shaper + a lowpass-closing noise body + a front crack. Blowout. |
| `snap` | Lowpassed noise thud + a 230→88 Hz sine. Card settling on the board. |
| `hover` | A 25 ms sine at 1500 Hz, almost subliminal. |
| `turnChime` | Two triangle notes, E6 then B6, 85 ms apart. |
| `tick` | Bandpassed square blip. Timer, last five seconds. |
| pressure hiss | A continuous noise loop through a bandpass that climbs 700→5300 Hz and tightens Q 0.7→7.7 as pressure goes 0→1, with a gain flutter LFO that speeds up with it. Takes a 0–1 argument; the *narrowing*, not just the loudness, is what makes it read as "about to go". |

Per §9 the master defaults to **on at 40%**. Per §10 `prefers-reduced-motion`
skips `boom` entirely and caps the hiss gain at a third of normal.

---

## Licensing posture

- **Model output (music, `condensation.png`, `price-burst.png`).** Generated
  with Google Vertex AI under the project's own service account. Google's
  Generative AI terms assign output to the customer and offer an IP indemnity
  for Imagen/Lyria output; Google does not claim ownership. Treat these as
  project-owned, and note that AI-generated work of this kind is generally not
  independently copyrightable in the US — good enough for a placeholder bed and
  two textures, not something to build a brand on.
- **`plastic-grain.png`, `favicon.svg`, `favicon.png`, `apple-touch-icon.png`,
  `og-image.png`, and all of `src/audio/`.** Authored for this project. No model
  output, no third-party source.
- **Deliberately avoided:** the generated Coca-Cola-shaped bottle (trade dress),
  and any sampled or scraped audio. This lines up with §4.2's stance on not
  bundling other people's material into a hosted product.
- **Fonts** in `public/fonts/` are not covered here — they are another agent's
  work. Bricolage Grotesque, Martian Mono and Figtree are all SIL OFL; that
  licence also covers rendering the wordmark into `og-image.png`.
- **Not legal advice.** §4.2 already calls for a human rights review before
  public launch; these assets should ride along with it.

## Things deliberately not generated

- **Sound effects** — synthesised (above).
- **A board grain texture** — synthesised (above).
- **The bottle mark** — hand-authored (above).
- **The signature bottle illustration.** §9's bottle is an *animated* element:
  liquid level, ascending bubbles, a rattling cap, an eruption. That is a
  component, not a picture, and generating a still of it would be art for its
  own sake — exactly what §9 warns against. `condensation.png` is the piece of
  it worth having as a raster.
- **Anything with Imagen.** Every Imagen model 404s for this project in
  `us-central1` (`imagen-4.0-generate-001`, `-fast-`, `-ultra-`, and
  `imagen-3.0-generate-002` were all probed; 404s are not billed). All images
  here came from `gemini-3.1-flash-image` via `assetforge edit` instead.
- **Lyria 3 Pro** — allowlist-gated for this project. Not attempted.
- **Video** — nothing in §9 asks for it.
