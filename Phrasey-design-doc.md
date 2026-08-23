# Phrasey — Requirements & Design Document

**Repo:** `git@github.com:Sweet-Papa-Technologies/Phrasey.git`
**Owner:** Forrester Terry / Sweet Papa Technologies
**Doc version:** 1.0 — 2026-08-23
**Status:** Ready for FOREMAN handoff
**Audience:** AI coding agents. Read the whole doc before writing code. Section 14 has the milestone breakdown and what can run in parallel.

---

## 1. One-line pitch

A word-guessing party game where you can only guess letters you're holding — Wheel of Fortune's board, Uno's hand, and a soda bottle that gets shaken harder every time somebody's wrong.

## 2. Why this works (the design thesis)

In hangman, every player has access to every letter, so the only skill is vocabulary and deduction. Phrasey's twist is **scarcity**: you often know the answer and physically cannot say it, or you hold the perfect letter and have to decide whether revealing it hands the round to the player after you.

Three tensions drive every turn:

1. **Feed vs. cash out.** Playing letters earns points. Solving earns more. Every letter you play makes it easier for someone else to solve before you.
2. **Hand vs. board.** Your hand is a private constraint nobody else can see. Bluffing is free.
3. **Shared consequence.** Wrong guesses fill one shared pressure gauge. Everyone loses when it blows, so a bad letter is a social act, not just a personal mistake.

If any build decision is ambiguous, resolve it toward preserving these three tensions.

---

## 3. Rules specification

### 3.1 Setup

- 2–8 players. Single-player = 1 human + 3 bots by default (configurable 1–7 bots).
- A **round** = one puzzle. A **match** = first player to reach the target score (default 300) after a completed round, or a fixed round count (default 5). Host picks at room creation.
- Each round: server selects a puzzle, builds a fresh deck, deals **7 cards** to each player.
- Board shows: category label, word/space structure, punctuation, and masked letter tiles. Apostrophes and hyphens are shown, not masked.

### 3.2 The deck (most important tuning knob in the game)

Do **not** deal from a uniform letter pool. It stalls the board and players sit on dead Q's forever.

Per-round deck construction:

- **70% letter cards, 30% action cards.**
- Of the letter cards: **65% are drawn from the multiset of letters actually present in the puzzle** (weighted by their occurrence count), **35% are noise** drawn from an English frequency table.
- Noise pool **excludes J, Q, X, Z** unless that letter appears in the puzzle.
- Vowels are present but under-weighted relative to natural English (they're powerful; make them feel like a find).
- Deck size scales with player count: `deckSize = max(60, players * 18)`.

Expose all of these as constants in a single `balance.ts`. Every number in this doc is a starting value, not a law.

### 3.3 A turn

Turn timer: **15 seconds** (host-configurable 10/15/25/off). On timeout, the server auto-plays the player's statistically-best letter, or discards if they hold none.

On your turn you take **one** primary action:

| Action | Effect |
|---|---|
| **Play a letter card** | Reveals every occurrence of that letter. Hit: `+10 × occurrences`. Miss: `+1 pressure`, 0 points. |
| **Play an action card** | See 3.5. |
| **Discard & draw** | Discard 1–3 cards, draw back to hand minimum. Ends your turn. No points, no pressure. |

Then, **optionally**, you may **Solve** — type the full phrase.

- **Correct:** `+50, plus 5 × (letters still hidden at moment of solve)`. Round ends.
- **Wrong:** `+3 pressure`, and you are **locked out of solving for the remainder of the round**.

The "still hidden" bonus is deliberate: a solve on a nearly-full board is worth almost nothing. This stops the endgame from being a free lunch and rewards the player who cracks it early and gambles.

At end of turn, draw back up to **hand minimum 5**. Hand cap **8** — if you're at 8 you cannot draw and must play or discard.

### 3.4 The pressure gauge

One shared gauge per round. Range 0–12.

Fills from: wrong letters (+1), wrong solves (+3), certain action cards.

At **12 → BLOWOUT**: round ends immediately. Nobody gets a solve bonus. Everyone keeps their banked reveal points. The player whose action tipped it takes **−20**.

The gauge is the game's emotional centerpiece — see Section 9.

### 3.5 Action cards

**Turn cards** (played on your turn as your primary action):

| Card | Effect |
|---|---|
| **SKIP** | Next player loses their turn. |
| **REVERSE** | Flip play direction. In a 2-player game, acts as SKIP. |
| **DOUBLE DOWN** | Your next letter this round scores 2×. If it misses, 2× pressure. |
| **VOWEL RUSH** | Reveal all instances of one vowel of your choice. You score nothing. `+2 pressure`. |
| **SHUFFLE** | Every player passes their hand to the next player in play direction. |
| **PEEK** | Server privately reveals the identity of one hidden tile to you only. |
| **CRACK** | Reveals the puzzle's pre-generated one-line hint to everyone. |
| **RELIEF VALVE** | `−3 pressure`. |
| **VANDAL** | `+2 pressure`, draw 2 cards. Pure chaos/spite. |
| **WILD** | Play as any letter of your choice. Scores as a normal letter play. |
| **LOCKOUT** | Target player cannot Solve on their next turn. |

**Interrupt cards** (playable *out of turn*, within a 4-second window — this is the anti-boredom mechanic; without it, 8-player games have 100+ seconds of dead time per turn cycle):

| Card | Window | Effect |
|---|---|---|
| **SWIPE** | Immediately after another player's letter hits | Steal the reveal points from that play. |
| **BLOCK** | When an action card targets you | Cancel it. Both cards discard. |
| **BUZZ IN** | Any time between turns, once per round per player | Take the next turn out of order. |

Interrupt resolution is LIFO — a BLOCK can be blocked. Cap the chain at 3 to prevent stalls.

### 3.6 Anti-stall

If two full turn cycles pass with no new letter revealed, the server auto-reveals one random hidden letter with no pressure cost and no points to anyone. Announce it as "the board breathes."

---

## 4. Puzzle corpus

### 4.1 Categories

The mundane categories are funnier than the quotes. Weight them accordingly.

- Grocery list
- Sign you'd see at the DMV
- Text from your mom
- Group chat message at 2am
- Error message
- Thing said at a wedding
- Idiom / proverb
- Instructions on the back of a box
- Yelp review, one star
- Voicemail from your landlord
- Note left on a windshield
- Overheard at Trader Joe's
- Bumper sticker

### 4.2 Sourcing — read this before scraping anything

**Do not bundle a scraped corpus of song lyrics, movie dialogue, or TV quotes into a publicly hosted product.** That's the one real legal soft spot in this concept, and it's avoidable at zero cost to the fun. Build the corpus from:

- **Original AI-generated phrases** in the categories above (the bulk of it)
- **Public-domain and common-property material** — proverbs, idioms, nursery rhymes, folk sayings
- **Observational/mundane phrases** — these carry the game

If a "famous quotes" category is wanted later, sourcing and rights are a separate decision. Not legal advice; flag for a human review pass before public launch.

### 4.3 Generation pipeline (offline, not runtime)

A Node CLI in `packages/corpus-gen`. Runtime **never** calls an LLM.

```
INFINITY (Qwen 3.8 27B, OpenAI-compatible)
  http://192.168.1.99:8080/v1
    ↓ batch generate per category
  validator (deterministic, no LLM)
    ↓
  corpus/<category>.json  →  review queue  →  seed to Firestore
```

**Validator rules** (reject on any failure):

- Length 12–60 characters
- ≥ 3 words, ≥ 6 distinct letters
- ASCII only; allowed punctuation `' - , . ! ?` only
- No proper nouns outside an explicit allowlist
- Profanity screen
- Normalized-hash dedupe against existing corpus
- Solvability check: simulate 40% random letter reveal, confirm the phrase isn't trivially guessable from 2 letters and isn't a near-duplicate pattern of an existing entry

Every generated puzzle also gets a **hint line** (used by the CRACK card) generated in the same pass and validated the same way.

Rejected candidates go to `corpus/review-queue.json` for a human skim rather than being discarded silently.

**Ship target: 500 validated puzzles minimum before public launch.** 80 is enough for internal playtesting.

---

## 5. Bots

Deterministic heuristics. **No LLM calls at runtime** — latency, cost, and nondeterminism all disqualify it.

Three tiers: **Chill / Sharp / Ruthless.**

**Letter selection:** from its hand, score each letter by expected occurrences given (a) English frequency, (b) the revealed pattern, (c) word-length constraints. Play the highest. Tier modifies how much noise is added to the score.

**Solving:** the server runs the revealed pattern as a regex against the corpus subset. If exactly one candidate matches, the bot rolls against a per-tier probability to solve. Bots are **never** given the answer — this is real deduction, and it's what a strong human does anyway.

| Tier | Solve roll | Action card use | Think delay |
|---|---|---|---|
| Chill | 25% | Rare, random | 2.5–4s |
| Sharp | 60% | Situational | 1.5–3s |
| Ruthless | 90% | Optimal, uses interrupts | 1.2–2.5s |

Bots **must** have a visible thinking delay. Instant bot moves read as cheating even when they aren't.

Give bots names and a one-line personality shown on hover. Cheap, big payoff for single-player feel.

---

## 6. Architecture

### 6.1 Stack

**Client:** React 19 + TypeScript + Vite · Tailwind v4 · Motion (framer-motion) · Zustand · Socket.IO client
**Server:** Node 22 + TypeScript · Fastify · Socket.IO · Cloud Run
**Data:** Firestore
**Hosting:** Firebase Hosting (static SPA) → Cloud Run (game server)
**IaC:** Terraform, targeting the **FoFoApps** GCP project
**Monorepo:** pnpm workspaces

```
packages/
  engine/        pure TS rules engine — no I/O, no network, seeded RNG
  server/        Fastify + Socket.IO, room lifecycle, bot driver
  client/        React SPA
  corpus-gen/    offline puzzle generation CLI
  shared/        types, protocol definitions, balance constants
infra/           Terraform
```

### 6.2 Server authority — non-negotiable

**The full puzzle string never leaves the server.** Not in a Firestore doc, not in a socket payload, not in a debug field. Clients receive only masked board state. A web party game where the answer is one F12 away is a dead game.

This is why live game state does **not** live in Firestore: client SDK access to Firestore makes hidden state very hard to guarantee, and per-turn writes are chatty and expensive.

Room state lives **in memory on the server**, snapshotted to Firestore every 10 events for crash recovery.

### 6.3 Scale posture

Launch with Cloud Run `min-instances=1`, `max-instances=1`, `concurrency=250`. A party game at friends-and-family scale fits comfortably in one instance, and one instance makes room routing trivially correct.

Cloud Run session affinity is best-effort and **must not be relied on for correctness**. Do not build multi-instance room routing now. Document the path — room registry in Memorystore/Redis with pub/sub, or a lobby director that maps room codes to instances — and move on.

### 6.4 Firestore schema

```
/rooms/{code}          → { instanceId, hostId, createdAt, status, ttl }
/sessions/{sessionId}  → completed match summary, scores, puzzle ids used
/puzzles/{puzzleId}    → { text, category, hint, difficulty, letterStats, active }
/config/balance        → live-tunable balance constants
```

Room docs get a TTL policy — 6 hours. No orphan rooms.

### 6.5 Socket protocol

Client → Server:
`room:create` `room:join` `room:leave` `game:start` `turn:playCard` `turn:discard` `turn:solve` `interrupt:play` `chat:emote`

Server → Client:
`room:state` `game:started` `board:update` `hand:update` *(private)* `turn:begin` `turn:timer` `pressure:update` `interrupt:window` `round:end` `match:end` `error`

Every server→client payload carrying board state is **masked**. Write one `maskBoard()` function, use it everywhere, unit test it.

### 6.6 Room codes

4 characters, consonant-vowel-consonant-vowel pattern so they're **pronounceable over Zoom** ("KABO", "MIRU"). Screen generated codes against a profanity list. Display them huge for screen sharing, with a QR code alongside for in-person play.

---

## 7. Join & session flow

1. Host lands on `/`, clicks **Start a room** → gets a code and a shareable link
2. Players open `/join/KABO` or enter the code at `/` → pick a display name and an avatar color → they're in
3. **No account. No email. No PII.** Display name is session-scoped and thrown away
4. Host sees a **Cast view** toggle — big board, no hand, designed for screen sharing on Zoom
5. Late joiners land in the next round, not mid-round
6. Disconnect: 90-second reconnect window with the seat held, then the seat converts to a bot with the same name and a small "(bot)" tag

---

## 8. Compliance

Not collecting anything is the single biggest compliance win available here, and it costs the product nothing. Ship with no accounts.

- **Consent banner** on first load: **Accept all / Reject all / Manage** — reject must be exactly as prominent and as few clicks as accept
- **Google Consent Mode v2**, all storage types defaulted to `denied`. GA4 loads only after consent
- Honor **Global Privacy Control** — check `navigator.globalPrivacyControl` and default analytics to denied when true
- Footer: **Your Privacy Choices** link + the California opt-out icon, reopening the consent manager
- `/privacy` and `/cookies` pages, standard industry wording
- Terms line stating the game is for users 13+
- Consent state in `localStorage`, versioned so a policy change re-prompts

Use conventional wording and UX patterns — this is not the place for originality. **Have a human review the final copy before public launch.**

---

## 9. Visual direction

**Brief:** clean, simple, and it should feel young. Not a SaaS dashboard with a game bolted on.

**World:** convenience-store soda fountain. Bright, cold, plastic, fluorescent, a little sticky. The materials of that world — bottle caps, condensation, ice, price stickers, chest coolers — are where the details come from. It's a specific place with its own vernacular, and it directly serves the pressure-gauge metaphor.

### Tokens

```css
--ink:     #14121F;  /* deep grape-black — never pure black */
--chill:   #EAF4F7;  /* cooler-white, the base surface */
--fanta:   #FF5C1A;  /* primary action */
--lime:    #B8FF3C;  /* reveal / success */
--grape:   #6C3BFF;  /* cards, accents */
--cherry:  #FF2E63;  /* pressure / danger */
```

Gauge liquid runs a cherry→fanta gradient as it fills.

### Type

- **Display:** Bricolage Grotesque — headlines, category labels, the blowout screen. Used with restraint.
- **Board tiles & numerals:** Martian Mono — fixed width is a requirement for the board, and it carries the arcade weight.
- **Body/UI:** Figtree — friendly, readable, doesn't try hard.

Avoid Inter/Anton. Avoid the cream-background-and-serif look entirely.

### Signature element

**The bottle.** A tall soda bottle on the right rail of the board, filling with fizzing liquid as pressure rises. Bubbles ascend. Condensation beads on the glass. The cap rattles — visibly harder the fuller it gets. At blowout it erupts, foam sheets across the board for a beat, and the round ends.

Spend the boldness here. Everything else stays quiet and disciplined.

### Cards

Letter cards are crisp white tiles, letter set large in Martian Mono, a small frequency pip in the corner. Action cards are saturated grape or fanta with a single bold icon and a short name. Hand fans across the bottom, cards lift and tilt on hover, and snap to the board with a satisfying settle.

### Motion

- Card play: arc from hand to board, ~350ms
- **Reveal cascade:** tiles flip in sequence, 40ms stagger. Revealing four E's produces a little run of flips — this is the game's best moment, make it feel good
- Pressure: liquid glugs up in a single weighted motion, never a linear fill
- Turn timer: a thin ring, not a number, until the last 5 seconds
- `prefers-reduced-motion`: cross-fades and instant fills, no shake, no foam

### Landing page

The hero is not a stat block with a gradient. The hero **is the game**: a live demo board already mid-puzzle, tiles revealing on a loop, the bottle filling, and a single **Start a room** button. Show the thing; don't describe it.

### Sound

Sound carries party games. Cap crack on card play, ice clink on reveal, hiss as pressure rises, a real BOOM on blowout. Master mute in the top bar, defaulted **on** but at 40% volume.

Music: bundle Suno tracks in `public/audio/music/` with a `manifest.json` the client reads at load, so tracks can be dropped in without a rebuild. For the placeholder, generate **one** track via Vertex — **Lyria 3 Pro** produces ~3-minute structured tracks and is the right fit for a loopable bed. Prompt direction: upbeat, playful, light percussion, no vocals, loop-friendly, ~110 BPM.

Any other generated assets via Vertex (Imagen for textures/icons) only where they measurably improve the feel. Don't generate art for its own sake.

---

## 10. Accessibility

- Colorblind-safe: pressure state is never conveyed by color alone — the fill height and the cap rattle both encode it
- **Keyboard-first:** typing a letter plays that card if you hold it; Enter opens the solve box; Escape cancels
- Board is a labeled region with an accessible text representation of revealed state
- Visible focus rings throughout
- Respect `prefers-reduced-motion`
- Turn timer can be disabled entirely by the host

---

## 11. Analytics

GA4, post-consent only. Events worth having:

`room_created` `room_joined` `game_started` `round_completed` `blowout` `solve_attempt` `solve_success` `card_played` (type only) `match_completed` `player_dropped`

Never log puzzle text, display names, or anything player-identifying.

---

## 12. Non-goals for v1

- Native mobile apps (responsive web only — the browser is the right surface for a link-join party game)
- Accounts, persistent profiles, friend lists
- Ranked play, ELO, global leaderboards
- Voice chat (Zoom/phone/in-person already solves this)
- Real-money anything
- Custom puzzle submission by players (moderation burden, ship later if wanted)

---

## 13. Open questions for Forrester

1. Match length default — first to 300, or best of 5 rounds?
2. Should BLOWOUT end the *round* only (current spec) or carry a match-level consequence?
3. Public rooms / matchmaking, or invite-only forever? (Invite-only is simpler and dodges a moderation problem entirely.)
4. Domain — subdomain under an existing property, or its own?

None of these block M0–M4. Defaults above are safe to build against.

---

## 14. Milestones

Definition of done for every milestone: tests pass, typecheck clean, deployed where applicable, exit criterion demonstrably met.

| ID | Milestone | Exit criterion | Depends on |
|---|---|---|---|
| **M0** | Repo scaffold, pnpm workspaces, Terraform, CI, Firebase Hosting + Cloud Run hello world | `terraform apply` provisions clean; a placeholder page is live | — |
| **M1** | **`packages/engine`** — pure rules engine, seeded RNG, zero I/O | Full round playable in unit tests. 200 seeded random matches complete without deadlock or illegal state. >90% coverage on the rules module | — |
| **M2** | Server: room lifecycle, socket protocol, turn timers, masking | Two browser tabs play a full round against each other. `maskBoard()` verified never to emit hidden letters | M1 |
| **M3** | Client: board, hand, play flow, join flow, cast view | A human can play a full match end to end in a browser | M2 |
| **M4** | Bots, three tiers | Single-player match completes; Ruthless wins >60% vs Chill over 100 sims | M1 |
| **M5** | Corpus pipeline + 80 validated puzzles seeded | CLI runs against INFINITY, validator rejects known-bad fixtures, corpus seeds to Firestore | — |
| **M6** | Visual direction, motion, sound, landing page | Section 9 implemented; Lighthouse ≥ 90 across the board | M3 |
| **M7** | Consent, GA4, privacy pages, analytics events | Reject-all provably blocks GA4 network calls; GPC honored | M3 |

**Parallelizable immediately:** M0, M1, M5 have no dependencies on each other. M4 needs only M1. M6 and M7 need M3 but not each other.

**Critical path:** M1 → M2 → M3 → M6.

M1 is the highest-value piece and the one most likely to be rushed. A pure, seeded, I/O-free engine means balance can be tuned by running ten thousand simulated matches instead of by playtesting sessions with actual humans. Do not let the rules leak into the server package.

---

## 15. Notes to the implementing agents

- Every balance number in this doc is a **starting value**. Put them all in `packages/shared/balance.ts` and make them overridable from `/config/balance` in Firestore.
- Build M1 with a seeded RNG from day one. Reproducible matches make every later debugging session cheap.
- Write `maskBoard()` once. Test it adversarially. Everything else in the security model rests on it.
- Prefer deterministic logic over model calls everywhere. The only LLM in this system is offline, in `corpus-gen`, and it produces reviewed artifacts.
- When a rule and this doc disagree with what's actually fun in playtest, fun wins — but say what changed and why in the PR.
