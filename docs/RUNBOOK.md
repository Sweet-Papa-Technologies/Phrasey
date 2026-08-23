# Runbook

## Live

| | |
|---|---|
| Client | https://phrasey.web.app |
| Server | https://phrasey-server-2ulse5y3hq-uc.a.run.app |
| GCP project | `fofoapps-934be` · `us-central1` |
| Firestore | named database **`phrasey`** (not `(default)`) |
| Registry | `us-central1-docker.pkg.dev/fofoapps-934be/phrasey` |
| TF state | `gs://fofoapps-934be-phrasey-tfstate`, prefix `phrasey` |

## Local development

```bash
pnpm install
pnpm build
pnpm test          # 603 tests across five packages
pnpm dev           # server :8080 + client :5173
```

The client picks its transport automatically: `VITE_SERVER_URL` set ⇒ real
socket, absent ⇒ the in-memory mock. Force either with `?transport=socket` or
`?transport=mock`. The mock is also what drives the landing page demo board, so
it stays exercised.

Firestore is optional locally — the server falls back to the engine's fixture
puzzles if it cannot reach it, so you can develop offline.

## Testing

```bash
pnpm test                                             # everything
pnpm --filter @phrasey/engine coverage                # thresholds enforced at 90%
pnpm --filter @phrasey/engine sim -- --matches 200 --corpus real
pnpm --filter @phrasey/engine sim -- --vs ruthless:chill --corpus real
pnpm --filter @phrasey/server tsx src/dev/harness.ts --url <url>
```

The harness works against localhost and against the deployed service — it is
the post-deploy smoke test.

## Deploying

```bash
scripts/deploy.sh            # client + server
scripts/deploy.sh server     # Cloud Build -> Artifact Registry -> Cloud Run
scripts/deploy.sh client     # vite build -> Firebase Hosting
scripts/deploy.sh rules      # firestore.rules only
```

Infrastructure is Terraform and is **not** touched by the deploy script:

```bash
cd infra && terraform init && terraform plan && terraform apply
```

## Corpus

```bash
pnpm --filter @phrasey/corpus-gen cli -- generate --category all --count 20
pnpm --filter @phrasey/corpus-gen cli -- validate
pnpm --filter @phrasey/corpus-gen cli -- stats
pnpm --filter @phrasey/corpus-gen cli -- seed --dry-run
pnpm --filter @phrasey/corpus-gen cli -- seed
```

Generation runs against INFINITY (`http://192.168.1.99:8080/v1`, Qwen 3.8 27B)
on the LAN, or `--provider vertex` for Gemini. Seeding is idempotent — the doc
id is a hash of the normalized text.

## Things that will bite you

**Cloud Run reserves the exact path `/healthz`.** External requests to it 404 at
the Google frontend while the internal probes still reach the container. The
server serves both `/healthz` and `/health`; use `/health` for anything you
check from outside.

**`BIND_HOST`, not `HOST`.** macOS sets `HOST`, which silently mis-bound the
server once.

**`VITE_SERVER_URL` is baked in at build time.** Without it the client falls
back to the mock and the deployed site looks perfectly healthy while playing a
fake game against nobody. `scripts/deploy.sh` resolves it from the live service
and fails the deploy if it is missing from the bundle.

**min-instances=1 with CPU always-allocated costs ~$50/month at zero players.**
That is the price of the single-instance design in §6.3 — CPU throttling would
freeze the turn timers between requests. `min_instances` is a Terraform
variable if you want it at 0 during idle stretches.

**Qwen returns an empty `content` with a populated `reasoning_content`** when
the token budget is too small, and about one call in eight returns its entire
think-aloud as `content`. corpus-gen treats both as retryable.

**Every Imagen model 404s on this project.** Images came from
`gemini-3.1-flash-image` instead. Re-check with
`python3 ~/code/assetforge/scripts/verify-models.py`.

## Before public launch

- [ ] Human legal review of `packages/client/src/content/legal/*.md` (§8)
- [ ] Replace the hand-authored California opt-out icon in
      `PrivacyChoices.tsx` with the canonical CPPA asset
- [ ] Set `VITE_GA4_MEASUREMENT_ID` once a GA4 property exists, then re-verify
      the reject-all path against it
- [ ] Audition the two placeholder music tracks; drop real ones into
      `public/audio/music/` and update `manifest.json` (no rebuild needed)
- [ ] Decide the pressure-gauge question in `docs/BALANCE-FINDINGS.md`
- [ ] Top the corpus up from 209 to the 500 ship target (§4.3)
- [ ] Confirm `privacy@` / `legal@` addresses route somewhere
