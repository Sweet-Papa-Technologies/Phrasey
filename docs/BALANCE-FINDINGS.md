# Balance findings

Produced with `pnpm --filter @phrasey/engine sim`, against the real 209-puzzle
corpus. Design doc §15: every number in the spec is a starting value, and the
point of a pure seeded engine is that tuning is ten thousand sims rather than
playtest sessions. These are the sims.

Nothing here has been changed in `balance.ts`. These are findings for a human
to rule on.

## 1. The pressure gauge is inert against competent play

§9 calls the gauge "the game's emotional centerpiece" and §2 calls shared
consequence one of the three tensions the whole design rests on. Against a
table that plays reasonably, it currently never goes off.

Mixed table (2 Sharp + 2 Chill), 80 matches:

| Configuration | Blowout rate | Avg peak pressure |
|---|---|---|
| **As shipped** (max 12, +1/miss) | **0%** | 1.8 / 12 |
| `wrongLetter = 2` | 0% | 2.7 / 12 |
| `wrongLetter = 3` | 0% | 4.1 / 12 |
| `pressure.max = 8` | 0% | 1.8 / 8 |
| `pressure.max = 6` | 0% | 1.8 / 6 |
| `max = 8, wrongLetter = 2` | 0% | 2.8 / 8 |
| `max = 6, wrongLetter = 2` | 2% | 2.9 / 6 |
| `deck.puzzleLetterShare = 0.5` | 0% | 2.4 / 12 |
| `deck.puzzleLetterShare = 0.4` | 0% | 2.8 / 12 |

By contrast, a table of four players choosing at random blows out **50%** of
the time. So the mechanic works — it just only threatens bad play.

### Why, and it isn't the bots

It's arithmetic, and it's upstream of tuning:

- A round lasts about **10 turns** at four players.
- The gauge needs **12** pressure, at **+1** per wrong letter.
- So blowing it requires more wrong letters than there are turns in a round.
  It is close to impossible by construction, before anyone's skill enters.

The miss rate compounds it. §3.2 makes the deck **65% letters drawn from the
puzzle**, deliberately, so the board doesn't stall. But that same choice means
a player who plays their best held letter rarely misses — measured at 2.8%
(Ruthless) to 8.1% (Chill). Expected wrong letters per round is well under one.

Lowering `puzzleLetterShare` to 0.4 — a big change that risks the stalling the
70/30 split exists to prevent — moves peak pressure only 1.8 → 2.8.

### Options, in the order I'd consider them

1. **Accept it as designed.** The gauge is dread, not a live threat: it climbs
   visibly, it punishes the reckless, and blowout is a real risk for casual and
   chaotic tables (50% at the random floor, 5.2/12 peak with two weak seats).
   This is a defensible reading of §9 and costs nothing.
2. **Widen what fills the gauge.** The cleanest fix isn't a bigger miss penalty,
   it's more fill sources — e.g. +1 per completed turn cycle, so the gauge
   always rises and a slow round becomes dangerous on its own. This makes
   pressure a clock rather than a scoreboard of mistakes, and it makes CRACK,
   RELIEF VALVE and the solve-early gamble matter far more.
3. **Scale `pressure.max` to round length**, roughly 6 rather than 12, and put
   `wrongLetter` at 2. Gets to ~2% at the mixed table. Cheap, but it only moves
   the tail.

My recommendation is **(2)**, with (1) as a perfectly fine ship-as-is. (3) alone
doesn't buy much. All three are one-line changes in `balance.ts`, and the
simulator will tell you within seconds what any of them does.

## 2. Everything else is healthy

Mixed table, real corpus, 5-round matches:

| Table | Round len | Solve | Deck-out | Breath/rnd | Score spread |
|---|---|---|---|---|---|
| all Chill | 13.4 | 100% | 0% | 0.01 | 269 |
| all Sharp | 9.7 | 100% | 0% | 0.01 | 312 |
| all Ruthless | 8.8 | 100% | 0% | 0.00 | 331 |
| mixed R/S/C/C | 9.9 | 100% | 0% | 0.00 | 568 |
| 4 random (floor) | 53.6 | 0% | 50% | 1.50 | 189 |

- **Round length lands at 9–13 turns**, about three turns a seat. That is a
  good party-game pace and it orders correctly by skill.
- **The anti-stall "breath" is essentially never needed** against real play
  (≤0.02/round, versus 1.50 for the random floor). §3.6 is doing its job as a
  safety net rather than as a regular occurrence.
- **Tiers separate cleanly.** Ruthless beats Chill 100%, Sharp 86%; Sharp beats
  Chill 93%. Well past the >60% bar in §14. If Chill should occasionally steal
  one, that's `bots.tiers.chill.solveRoll` in `balance.ts`, not a code change.

## 3. Deduction had to be gated, and why it belongs in the bots

458 of the 667 distinct words in the corpus occur exactly **once**. So the board
skeleton — word count and letter counts, before a single card is played —
identifies the phrase outright. An ungated corpus-matching bot plays perfect
letters from turn one: 0.8% miss rate, peak pressure 0.1/12, rounds over in 3.5
turns.

Gating only the *solve* isn't enough; you get a bot that plays a phrase it
won't admit to recognizing. The gate is on the candidate pool itself, plus a
vocabulary floor requiring a word to recur before it can be pattern-matched —
matching a once-occurring word is memorizing an answer, not knowing English.

This is a bot-tuning correction and lives entirely in `packages/engine/src/bots`.
No engine rule and no balance constant was changed for it.

**This shrinks as the corpus grows.** At the §4.3 ship target of 500 puzzles the
once-only word fraction should fall considerably, and the gates should be
re-measured then — they may be able to loosen.
