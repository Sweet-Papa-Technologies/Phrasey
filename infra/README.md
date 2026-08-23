# Phrasey infrastructure

Terraform for the Phrasey game in GCP project **`fofoapps-934be`** (FoFoApps),
region **`us-central1`**. The project is shared with several other apps —
everything here is Phrasey-specific and additive; nothing existing is imported
or modified.

## What Terraform owns

| Resource | Id |
|---|---|
| Enabled APIs | run, artifactregistry, cloudbuild, firestore, firebase, firebasehosting, secretmanager, iam, cloudresourcemanager |
| Artifact Registry (Docker) | `us-central1-docker.pkg.dev/fofoapps-934be/phrasey` |
| Firestore database | `phrasey` (Native, `us-central1`) — **not** `(default)` |
| Firestore TTL policy | `/rooms.ttl` — 6-hour room expiry (design doc 6.4) |
| Firestore composite indexes | `/puzzles` on `active`+`category` and `active`+`difficulty` |
| Runtime service account | `phrasey-server@fofoapps-934be.iam.gserviceaccount.com` + `roles/datastore.user` |
| Cloud Run service | `phrasey-server` — shape only: scaling, CPU, env, probes, timeout |
| Cloud Run IAM | `allUsers` → `roles/run.invoker` (players are anonymous) |
| Firebase Hosting site | `phrasey` → https://phrasey.web.app |

## What Terraform does NOT own

- **The container image.** Shipped by `cloudbuild.yaml` / `scripts/deploy.sh`.
  `google_cloud_run_v2_service.server` has
  `lifecycle { ignore_changes = [template[0].containers[0].image] }`, so a
  `terraform apply` after a deploy will not roll the running image back.
- **The client bundle.** Shipped by `firebase deploy --only hosting:phrasey`
  (see `firebase.json` at the repo root).
- **Firestore rules and data.** Rules are shipped by
  `firebase deploy --only firestore:rules` from `firestore.rules` at the repo
  root; documents are written by the server with admin credentials.
- **The state bucket.** Created out-of-band (below) so nothing bootstraps its
  own backend.

## Design decisions baked in here

- **`min_instances = 1`, `max_instances = 1`, `concurrency = 250`** (design doc
  6.3). Rooms live in the server process; a second instance would strand them
  and a scale-to-zero would drop them. Do not raise `max_instances` without a
  cross-instance room registry.
- **CPU always allocated** (`cpu_idle = false`, the v2 spelling of the
  `run.googleapis.com/cpu-throttling: "false"` annotation). Turn timers, bot
  think-delays and the 4-second interrupt window all run *between* requests;
  throttled CPU would freeze them mid-round.
  **Cost note:** one always-on 1-vCPU / 512 MiB instance is roughly **$50/month**
  even with zero players. That is the price of the single-instance design. Drop
  `min_instances` to 0 in `terraform.tfvars` for an idle dev period, accepting
  that in-flight rooms die.
- **Session affinity is on but is not load-bearing.** Design doc 6.3 says it must
  not be relied on for correctness. With `max_instances = 1` it is redundant.
- **Firestore is locked to nothing for clients.** `firestore.rules` denies all
  reads and writes. Live game state never leaves server memory (design doc 6.2).
- **`/healthz` is the probe path, `/health` is the curl-able one.** Cloud Run's
  frontend reserves the exact path `/healthz` and returns its own 404 to
  external callers — verified against this service. The internal startup and
  liveness probes on `/healthz` do reach the container. The server must serve
  **both** paths.

## Bootstrap from zero

```bash
P=fofoapps-934be
R=us-central1

# 1. State bucket (once, out-of-band — Terraform's backend points at it).
gcloud storage buckets create gs://$P-phrasey-tfstate \
  --project $P --location $R --uniform-bucket-level-access
gcloud storage buckets update gs://$P-phrasey-tfstate --versioning

# 2. Infrastructure.
cd infra
terraform init
terraform plan
terraform apply

# 3. A healthy service before packages/server exists: the `image` variable
#    defaults to Google's public hello-world container. That container 404s on
#    /healthz, so build the real placeholder instead:
gcloud builds submit placeholder --project $P --region $R \
  --tag $R-docker.pkg.dev/$P/phrasey/phrasey-server:placeholder
gcloud run deploy phrasey-server --project $P --region $R \
  --image $R-docker.pkg.dev/$P/phrasey/phrasey-server:placeholder --quiet

# 4. Firestore rules + the placeholder page.
cd ..
firebase deploy --only firestore:rules --project $P
mkdir -p packages/client/dist && cp infra/placeholder/index.html packages/client/dist/
firebase deploy --only hosting:phrasey --project $P

# 5. Once packages/server and packages/client are real:
scripts/deploy.sh
```

`infra/placeholder/` holds the coming-soon page **and** a ~10-line Node server
that serves it plus `/healthz` + `/health`. Both the Hosting placeholder and the
Cloud Run placeholder come from that one `index.html`. The real client build
(`packages/client/dist`) and the real server image replace them independently —
nothing in `infra/placeholder/` is referenced by the production path.

## Day-to-day

```bash
cd infra
terraform plan          # should be empty; image drift is ignored by design
terraform apply
terraform output        # server_url, hosting_url, registry_path, ...
```

Deploys are manual and human-run — CI has no cloud credentials on purpose. See
`scripts/deploy.sh`.

## Destroying

```bash
cd infra
terraform destroy
```

`terraform destroy` removes the Cloud Run service, the IAM bindings, the
Artifact Registry repo (**and every image in it**), the service account and the
Hosting site. Two things survive on purpose:

- **The Firestore database.** `deletion_policy = "ABANDON"` — Terraform releases
  it from state rather than dropping game data. Delete it deliberately:
  `gcloud firestore databases delete --database=phrasey --project=fofoapps-934be`
- **The enabled APIs.** `disable_on_destroy = false` — other apps in this shared
  project use them.

The state bucket is also out of scope; remove it by hand if you really mean it:
`gcloud storage rm -r gs://fofoapps-934be-phrasey-tfstate`
