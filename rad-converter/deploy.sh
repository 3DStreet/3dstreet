#!/usr/bin/env bash
#
# Single source of truth for the rad-converter infra: the Cloud Run service
# sizing AND the Cloud Tasks queue retry policy. These were previously set by
# ad-hoc `gcloud ... update` commands (ephemeral GCP state, not in version
# control) — this script makes the config declarative and reproducible. Re-run
# it to converge the live infra back to what's committed here.
#
# This is the project's IaC convention for now (imperative gcloud, codified in a
# committed script) — not Terraform. If RAD infra grows, promote to real IaC.
#
# Usage:
#   ./deploy.sh [PROJECT] [REGION]
#   ./deploy.sh dev-3dstreet us-central1   # defaults
#
# Run from inside rad-converter/. Requires gcloud auth with deploy permissions.

set -euo pipefail

PROJECT="${1:-dev-3dstreet}"
REGION="${2:-us-central1}"
SERVICE="rad-converter"
QUEUE="rad-convert"
BUCKET="${PROJECT}.appspot.com"

# --- Cloud Run service config (the canonical sizing) -------------------------
# build-lod loads the whole splat + grows the LOD tree in RAM. A 22M-splat
# (~368MB) file OOM'd at 8Gi, so 16Gi (which requires >=4 vCPU on Cloud Run).
#
# CPU rationale: upstream build-lod is single-threaded, so historically 8 vCPU
# measured NO faster than 4 vCPU on the 22M-splat build (the per-level LOD
# pass was the wall-clock floor). We now patch build-lod to parallelize the
# per-level grid population and the recurse_to_output tree walk via rayon
# (see ./patches/), so additional cores SHOULD now translate into measurable
# wall-clock wins — rayon picks up the CPU count automatically. The 4 vCPU
# floor is preserved here because 16Gi requires >=4 vCPU on Cloud Run; bump
# this to 8 once you've benchmarked the patched binary on a representative
# splat and confirmed the speedup is worth the price-per-second.
#
# /tmp is tmpfs (counts against memory) — for multi-GB splats, raise memory
# or move the scratch download to a GCS FUSE volume (see server.js).
MEMORY="16Gi"
CPU="4"
# seconds — Cloud Run request timeout. Headroom to the Cloud Run max (3600); the
# effective ceiling is the Cloud Tasks dispatchDeadline (1800s, set in
# rad-dispatch.js). 900s was too short for a 22M-splat build.
TIMEOUT="3600"
CONCURRENCY="1"    # CPU-bound: one conversion per instance

echo ">> Deploying Cloud Run service '$SERVICE' to $PROJECT/$REGION ($MEMORY, ${CPU} vCPU)"
gcloud run deploy "$SERVICE" \
  --project "$PROJECT" \
  --region "$REGION" \
  --source . \
  --no-allow-unauthenticated \
  --memory "$MEMORY" \
  --cpu "$CPU" \
  --timeout "$TIMEOUT" \
  --concurrency "$CONCURRENCY" \
  --set-env-vars "STORAGE_BUCKET=${BUCKET}"

# --- Cloud Tasks queue retry policy ------------------------------------------
# build-lod is DETERMINISTIC: a failure (e.g. OOM) repeats identically, so an
# unbounded retry (the gcloud default is maxAttempts=100, minBackoff=0.1s) just
# thrashes — re-downloading the source and rebuilding from scratch ~100x. Bound
# the attempts and space them out. After these attempts Cloud Tasks gives up;
# the scheduled reconciler then marks the job failed at its 30-min ceiling.
echo ">> Setting Cloud Tasks queue '$QUEUE' retry policy"
gcloud tasks queues describe "$QUEUE" --project "$PROJECT" --location "$REGION" >/dev/null 2>&1 \
  || gcloud tasks queues create "$QUEUE" --project "$PROJECT" --location "$REGION"
gcloud tasks queues update "$QUEUE" \
  --project "$PROJECT" \
  --location "$REGION" \
  --max-attempts=3 \
  --min-backoff=10s \
  --max-backoff=300s

echo ">> Done. Service + queue converged to committed config."
