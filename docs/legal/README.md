# Legal copy

**The shipped source of truth is `packages/client/src/content/legal/*.md`.**

Those files are imported into the SPA with Vite's `?raw` and rendered by
`packages/client/src/lib/markdown.tsx`, so the copy a human reviews is the copy
that ships — there is no second, drifting JSX transcription of it.

Edit the markdown, not the components.

The copies in this directory are the originals kept for convenience; if they
ever disagree with `packages/client/src/content/legal/`, the client wins.

## Before public launch

Design doc §8: *"Have a human review the final copy before public launch."*
All three documents are marked as drafts pending that review. Also outstanding:

- Replace the hand-authored California opt-out icon in
  `packages/client/src/components/PrivacyChoices.tsx` with the canonical CPPA
  asset.
- Confirm the contact addresses (`privacy@` / `legal@`) actually route somewhere.
- Set `VITE_GA4_MEASUREMENT_ID` once a GA4 property exists, and re-verify the
  reject-all path against the live property.
