#!/usr/bin/env bash
#
# Phrasey — deploy everything.
#
#   scripts/deploy.sh              # client + server
#   scripts/deploy.sh client       # static SPA -> Firebase Hosting only
#   scripts/deploy.sh server       # container -> Artifact Registry + Cloud Run only
#   scripts/deploy.sh rules        # Firestore security rules only
#
# Idempotent: re-running with no code changes re-uploads the same artifacts and
# lands in the same state. Infrastructure itself lives in infra/ (Terraform) and
# is NOT touched here.
#
# Requires: pnpm, gcloud (authenticated), firebase-tools. No service-account
# keys — this uses your own gcloud/firebase login.

set -euo pipefail

PROJECT_ID="${PROJECT_ID:-fofoapps-934be}"
REGION="${REGION:-us-central1}"
SERVICE="${SERVICE:-phrasey-server}"
REPO="${REPO:-phrasey}"
HOSTING_TARGET="${HOSTING_TARGET:-phrasey}"

# Baked into the client bundle at build time. Without VITE_SERVER_URL the client
# silently falls back to its in-memory mock transport — the deployed site would
# look fine and play a fake game against nobody. Resolved from the live Cloud Run
# service unless overridden.
SERVER_URL="${SERVER_URL:-}"
# GA4 stays unset by default: analytics is inert without it, which is the
# correct default until a property exists (design doc section 8).
GA4_ID="${GA4_ID:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "error: '$1' is not installed or not on PATH" >&2; exit 1; }
}

tag() {
  if git rev-parse --short HEAD >/dev/null 2>&1; then
    local sha dirty=""
    sha="$(git rev-parse --short HEAD)"
    git diff --quiet 2>/dev/null || dirty="-dirty"
    printf '%s%s' "$sha" "$dirty"
  else
    date -u +%Y%m%d-%H%M%S
  fi
}

resolve_server_url() {
  if [[ -n "$SERVER_URL" ]]; then return; fi
  require gcloud
  SERVER_URL="$(gcloud run services describe "$SERVICE" \
    --project "$PROJECT_ID" --region "$REGION" \
    --format 'value(status.url)' 2>/dev/null || true)"
  if [[ -z "$SERVER_URL" ]]; then
    echo "error: could not resolve the Cloud Run URL for '$SERVICE'." >&2
    echo "       Deploy the server first, or pass SERVER_URL=https://..." >&2
    exit 1
  fi
}

deploy_client() {
  require pnpm
  require firebase
  resolve_server_url

  # Build the workspace deps first. `--filter @phrasey/client build` does NOT
  # rebuild @phrasey/shared, so a change to a shared constant would compile
  # against a stale dist and ship silently wrong values.
  say "Building workspace dependencies (@phrasey/shared, @phrasey/engine)"
  pnpm --filter @phrasey/shared build
  pnpm --filter @phrasey/engine build

  say "Building the client (@phrasey/client -> packages/client/dist)"
  echo "    VITE_SERVER_URL=${SERVER_URL}"
  echo "    VITE_GA4_MEASUREMENT_ID=${GA4_ID:-<unset, analytics inert>}"
  VITE_SERVER_URL="$SERVER_URL" VITE_GA4_MEASUREMENT_ID="$GA4_ID" \
    pnpm --filter @phrasey/client build

  # The bundle must actually carry the origin, or we just shipped the mock.
  if ! grep -rqF "$SERVER_URL" packages/client/dist/assets/*.js; then
    echo "error: built bundle does not contain ${SERVER_URL}." >&2
    echo "       The client would fall back to the mock transport. Aborting." >&2
    exit 1
  fi

  if [[ ! -f packages/client/dist/index.html ]]; then
    echo "error: packages/client/dist/index.html missing after build" >&2
    exit 1
  fi

  say "Deploying to Firebase Hosting target '$HOSTING_TARGET'"
  firebase deploy --only "hosting:${HOSTING_TARGET}" --project "$PROJECT_ID"
  echo "client live at https://${HOSTING_TARGET}.web.app"
}

deploy_server() {
  require gcloud

  local t; t="$(tag)"
  say "Building + pushing ${SERVICE}:${t} and deploying to Cloud Run"
  echo "    project=${PROJECT_ID} region=${REGION} repo=${REPO}"

  # Cloud Build does the docker work: it builds linux/amd64 regardless of the
  # machine you run this from (Apple Silicon would otherwise produce an
  # arm64 image Cloud Run cannot start), and no local Docker daemon is needed.
  gcloud builds submit . \
    --config cloudbuild.yaml \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --substitutions="_TAG=${t},_REGION=${REGION},_REPO=${REPO},_SERVICE=${SERVICE}"

  local url
  url="$(gcloud run services describe "$SERVICE" \
          --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)')"

  say "Verifying ${url}/health"
  # /health, not /healthz: Cloud Run's frontend reserves the exact path
  # /healthz and 404s it for external callers (the container's probes still
  # use it internally).
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "${url}/health" || echo 000)"
  if [[ "$code" != "200" ]]; then
    echo "error: ${url}/health returned HTTP ${code}" >&2
    exit 1
  fi
  echo "server live at ${url} (health 200)"
}

deploy_rules() {
  require firebase
  say "Deploying Firestore security rules to database '${REPO}'"
  firebase deploy --only firestore:rules --project "$PROJECT_ID"
}

main() {
  local what="${1:-all}"
  case "$what" in
    client) deploy_client ;;
    server) deploy_server ;;
    rules)  deploy_rules ;;
    all)    deploy_client; deploy_server ;;
    *) echo "usage: scripts/deploy.sh [all|client|server|rules]" >&2; exit 2 ;;
  esac
  say "Done."
}

main "$@"
