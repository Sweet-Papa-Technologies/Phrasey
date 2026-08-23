# Corpus sourcing and rights posture

**Status:** engineering decision, recorded for a human legal review.
**Owner:** Sweet Papa Technologies
**Applies to:** everything under `packages/corpus-gen/corpus/` and everything seeded to `/puzzles/{puzzleId}` in Firestore.

## The decision

Design doc §4.2 identifies bundling a scraped corpus of song lyrics, film or television
dialogue, or modern quotations as the one real legal soft spot in this product — and notes
that it is avoidable at zero cost to the fun. This corpus is built to avoid it entirely.

Every entry in this corpus comes from exactly one of two places:

1. **Original phrases generated for this project.** Written by a local model
   (Qwen 3.8 27B on INFINITY, or Gemini via Vertex AI as a fallback) against the
   category briefs in `src/prompts.ts`, then filtered by the deterministic validator in
   `src/validator.ts`. These are observational, mundane, everyday lines — a grocery list,
   a sign at the DMV, a note on a windshield. They are not reproductions of anything.
   Recorded as `"source": "generated"`.

2. **Public-domain and common-property material.** Proverbs, idioms, nursery rhymes and
   folk sayings that have been in general circulation for generations and have no
   identifiable author or owner. This is confined to the `Idiom / proverb` category and is
   the smallest slice of the corpus by weight. Recorded as `"source": "public-domain"`.

## What is explicitly excluded

Nothing in this corpus was scraped, and none of the following are present or permitted:

- Song lyrics, in whole or in part.
- Film, television or theatrical dialogue.
- Modern quotations attributable to a named living or recent author, public figure or brand.
- Book, poem or article text under copyright.
- Advertising copy, slogans or taglines.
- Trademarked names: no brands, no products, no companies, no franchises, no venues.
- Real personal names and real place names.

The last two are enforced mechanically, not just by prompt: the validator's `PROPER_NOUN`
rule rejects any phrase containing a name, place, brand or franchise from
`data/proper-nouns.json` unless it appears in the explicit allowlist at
`data/proper-noun-allowlist.json`. The allowlist is deliberately tiny — calendar words, a
handful of generic institutional abbreviations, and the pronoun "I".

## Category note

Design doc §4.2 leaves the door open to a "famous quotes" category later. That is a
**separate sourcing and rights decision** and must not be added by extending this pipeline.
Nothing in the current prompts or validator would make such a category safe.

## Model output and ownership

Phrases are produced by generative models. Two things follow:

- The phrases are short, functional, non-expressive lines of everyday speech, deliberately
  written to be generic rather than distinctive. The prompts steer *away* from anything
  resembling an existing work.
- Copyright status of model output is unsettled in several jurisdictions. That affects what
  protection *we* can claim over the corpus. It does not create third-party infringement
  exposure on its own, but it is worth a lawyer's attention before anyone treats this corpus
  as a defensible asset.

## Human review — wanted before public launch

This file is an engineering record, not legal advice. Per design doc §4.2 and §8, a human
legal review is wanted before the game is publicly hosted. Specifically:

1. Confirm the exclusion list above is complete for the intended launch jurisdictions.
2. Spot-check a sample of the corpus for anything that reads as a recognizable quotation
   despite the prompts and the validator.
3. Confirm the position on model-generated text ownership.
4. Review `corpus/review-queue.json` — rejected candidates are kept for a human skim rather
   than being discarded silently (§4.3), and some are rejected precisely because they
   tripped the proper-noun rule. Nothing in the review queue ships without passing the
   validator first.

Until that review happens, treat the corpus as internal-playtest material.
