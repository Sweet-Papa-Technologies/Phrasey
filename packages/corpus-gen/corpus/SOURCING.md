# Corpus sourcing and rights posture

**Status:** engineering decision, recorded for a human legal review. **Not legal advice.**
**Owner:** Sweet Papa Technologies
**Applies to:** everything under `packages/corpus-gen/corpus/`, the bundled wordlists under
`packages/corpus-gen/data/`, and everything seeded to `/puzzles/{puzzleId}` in Firestore.

---

## 1. The line design doc §4.2 draws, and where it actually falls

§4.2 is unambiguous and still governs: **do not bundle a scraped corpus of song lyrics, film
or television dialogue, or modern quotations into a publicly hosted product.** Nothing in
this corpus does. Nothing was scraped.

But §4.2's prohibition is about *reproducing expression*, and that leaves real room which is
worth stating precisely, because the game is materially better for it:

- **A title is not the work.** In US law titles of individual works are not protected by
  copyright (they are considered too short to carry protectable expression; see 37 CFR
  § 202.1(a), which excludes "words and short phrases such as names, titles, and slogans").
  Using `THE SOUND OF MUSIC` as a puzzle answer is a categorically different act from
  reproducing a line of the song. **Trademark** is the live question, not copyright: a title
  can function as a source identifier, particularly for a series or franchise, and the test
  there is likelihood of confusion as to source or sponsorship. Naming a well-known work as
  the answer to a quiz question is a referential use and is not how a mark ordinarily gets
  infringed — but it is a judgment, not a certainty, and it is the single item on this page
  most in need of a lawyer's eye.
- **Long-established idioms, proverbs and folk sayings** have no identifiable author, have
  been in general circulation for generations, and are individually too short to carry
  copyright regardless.
- **Nursery rhymes and pre-1930 material** are public domain in the US.
- **A modern catchphrase is a judgment call.** The rule applied here: include it only if it
  is in genuinely generic circulation with no identifiable owner, and leave it out otherwise.

Everything that turns on the first bullet is quarantined. See §4.

---

## 2. Where every entry comes from

Each entry carries a `source` and a `rightsTier`, and the pop-culture entries carry a
`rightsNote` as well, so the position on any single puzzle is readable from the data without
opening this file.

| `source` | What it means | Categories |
|---|---|---|
| `generated` | Original phrases written for this project by a local model (Qwen 3.8 27B on INFINITY) or Gemini via Vertex, against the briefs in `src/prompts.ts`, then filtered by the deterministic validator in `src/validator.ts`. Observational, mundane, everyday lines. Not reproductions of anything. | the 11 observational categories, plus `Common sign or public notice`, `Thing your GPS says`, `Thing on a restaurant menu` |
| `public-domain` | Long-established common-property material with no identifiable author: proverbs, idioms, folk sayings, traditional nursery rhymes published well before 1930. Produced from the model's own knowledge and cross-checked against public-domain collections rather than copied from a licensed source. | `Idiom / proverb`, `Nursery rhyme line` |
| `reference` | A **title** — of a film, a song, or a television series — used as a quiz answer, or a stock catchphrase in generic circulation. No lyric, no dialogue, no tagline, no plot text, no artwork. | the four pop-culture categories |

`reference` is wider than `Puzzle['source']` in `@phrasey/shared`, which still lists only the
original three values. The server casts rather than narrowing, so nothing breaks at runtime,
but whoever owns `packages/shared` should widen that union. Noted in `src/seed.ts`.

---

## 3. What is explicitly excluded, and how it is enforced

Nothing here was scraped, and none of the following is present or permitted:

- Song lyrics, in whole or in part — **including** where a title is also the first line. The
  brief instructs the model to skip such a song rather than write the line.
- Film, television or theatrical dialogue, catchphrases attributable to a performer or show,
  episode titles, and taglines.
- Modern quotations attributable to a named living or recent author or public figure.
- Book, poem or article text under copyright.
- Advertising copy, slogans, taglines.
- Trademarked names inside a phrase: no brands, no products, no companies, no venues.
- Real personal names and real place names.

The last two are enforced **mechanically**, not just by prompt: the validator's `PROPER_NOUN`
rule rejects any phrase containing a name, place, brand or franchise from
`data/proper-nouns.json` unless it is on the tiny explicit allowlist in
`data/proper-noun-allowlist.json`.

This has a useful side effect on the title categories that is worth calling out, because it
was not designed for that purpose and is now doing real work: **a title containing a personal
name, place name or brand cannot enter the corpus at all.** `HARRY POTTER`, `STAR WARS` and
`TOY STORY` are rejected by the same rule that rejects a grocery list mentioning a supermarket.
What survives is the subset of titles that are ordinary English phrases — which is also the
subset with the weakest claim to function as a distinctive source identifier.

One entry was removed by hand rather than by rule: `WHEEL OF FORTUNE`. It is a title like any
other, but this game is a Wheel-of-Fortune-shaped board, and putting that specific mark on it
as an answer invites a confusion-of-source argument that no other entry does. It is in
`corpus/review-queue.json` tagged `MANUAL_REVIEW_RIGHTS`.

---

## 4. The pop-culture tier is separable by one command

The four `reference` categories live in their own files and nothing else depends on them:

```
Movie title everyone knows      corpus/movie-title-everyone-knows.json
Song title everyone knows       corpus/song-title-everyone-knows.json
TV show title everyone knows    corpus/tv-show-title-everyone-knows.json
Catchphrase everyone knows      corpus/catchphrase-everyone-knows.json
```

To remove them entirely:

```sh
pnpm --filter @phrasey/corpus-gen cli -- drop --tier pop-culture --dry-run   # see what goes
pnpm --filter @phrasey/corpus-gen cli -- drop --tier pop-culture             # delete the files
pnpm --filter @phrasey/corpus-gen cli -- seed --project <id> --deactivate-missing
```

The last step is the one that matters: seeding uses `merge: true`, so without
`--deactivate-missing` a deleted puzzle keeps serving to live games forever. With it, every
Firestore document no longer in the corpus is flipped to `active: false` — deactivated rather
than deleted, so the audit trail survives.

To ship without the tier but keep generating it for later, `seed --tier core` seeds only the
core tier and leaves the pop-culture documents untouched.

Removing the tier costs the corpus about 116 of 597 puzzles (~19%) and no code changes.

---

## 5. Bundled wordlists

`data/common-words.json` is a build-time-only vocabulary list backing the validator's
`UNCOMMON_VOCABULARY` rule and the difficulty derivation. It never reaches a client and never
forms part of any puzzle. Two components:

- **`core`** — the 6000 most frequent word types counted across 25 public-domain Project
  Gutenberg texts (2.42M tokens), keeping only words appearing in at least 3 of the 25 books.
  The book list is in the file. These are word counts **we measured ourselves over public
  domain texts** — facts about a public-domain corpus, not a licensed dataset.
- **`everyday`** — a hand-authored supplement of ~950 ordinary modern words that 1900s prose
  does not contain (microwave, voicemail, parking, hoodie). Written for this project.

**A note on what was deliberately *not* used.** The obvious source here is
`first20hours/google-10000-english`. Its own LICENSE says the data derives from the LDC's
Google Web Trillion Word Corpus and that the author "does not recommend using this data for
commercial purposes without licensing it from the Linguistic Data Consortium." That is a
weaker claim than a licence term, and word frequencies are arguably uncopyrightable facts —
but this file exists to *reduce* the number of arguments a lawyer has to have, so it was not
used. The Gutenberg-derived list cost an hour and has no such caveat.

`data/abstract-words.json` is a small hand-authored list used only by the `triage` command to
shortlist entries for human review. No rule fires on it.

`data/profanity.json`, `data/proper-nouns.json` and `data/proper-noun-allowlist.json` are
hand-authored for this project.

---

## 6. Model output and ownership

Phrases in the `generated` categories are produced by generative models. Two things follow:

- They are short, functional, non-expressive lines of everyday speech, deliberately written to
  be generic rather than distinctive. The prompts steer *away* from anything resembling an
  existing work, and now steer toward the most ordinary possible phrasing — the guessability
  requirement and the originality requirement happen to pull the same direction.
- Copyright status of model output is unsettled in several jurisdictions. That affects what
  protection *we* can claim over the corpus. It does not create third-party infringement
  exposure on its own, but it is worth a lawyer's attention before anyone treats this corpus
  as a defensible asset.

For `public-domain` and `reference` entries the model is being used as a **recall** mechanism,
not a writing one: it is naming a proverb or a title that already exists. The rights question
for those entries is about the underlying item, not about the model.

---

## 7. Human review checklist — wanted before public launch

This file is an engineering record. Per §4.2 and §8 of the design doc a human legal review is
wanted before the game is publicly hosted. Concretely, in priority order:

1. **Rule on the pop-culture tier.** This is the only genuinely new rights question. Decide
   whether film/song/TV titles as quiz answers are acceptable, and whether the answer changes
   for strongly-branded franchise titles. Present in the corpus and worth looking at first:
   `THE EMPIRE STRIKES BACK`, `THE FELLOWSHIP OF THE RING`, `THE HUNGER GAMES`,
   `THE DARK KNIGHT`, `GAME OF THRONES`, `THE WALKING DEAD`, `THE TWILIGHT ZONE`. If the
   answer is no, §4 is one command.
2. **Spot-check the song titles against their lyrics.** Several well-known songs are titled
   with their own opening line (`EVERY BREATH YOU TAKE`, `WE WILL ROCK YOU`,
   `I SAW HER STANDING THERE`). The corpus contains these **as titles**, which is the whole
   basis for including them, but if the distinction is not one the reviewer wants to rely on,
   these are the entries to pull.
3. **Confirm title accuracy.** A player has to type the answer back, so a title spelled
   differently from the real work is a gameplay bug as well as a sloppiness. The prompts
   require exact official spelling and require skipping works with dropped letters or unusual
   spellings, but this has not been verified entry by entry. `TWELVE YEARS A SLAVE` is
   deliberately spelled out, per the corpus-wide no-numerals rule.
4. **Confirm the exclusion list in §3** is complete for the intended launch jurisdictions.
5. **Skim the `Catchphrase everyone knows` category** specifically. It is the category where
   "generic stock phrase" and "someone's catchphrase" are hardest to tell apart. It is the
   smallest category (15 entries) and is in the droppable tier.
6. **Confirm the position on model-generated text ownership** (§6).
7. **Review `corpus/review-queue.json`.** Rejected and triaged candidates are kept for a human
   skim rather than discarded (§4.3). Some are there because they tripped the proper-noun rule
   and would be rights-relevant if anyone wanted to rescue them. Nothing in the review queue
   ships without passing the validator first.

Until that review happens, treat the corpus as internal-playtest material.
