#!/usr/bin/env bash
#
# Single source of truth for the needle-uploader infra: the Cloud Run service
# sizing, its secret binding, and the Cloud Tasks queue retry policy — same
# convention as rad-converter/deploy.sh (imperative gcloud, codified here).
#
# One-time prerequisites per project (not idempotent here on purpose):
#   1. Needle Cloud read/write token in Secret Manager:
#        printf '%s' "$TOKEN" | gcloud secrets create needle-cloud-token \
#          --project "$PROJECT" --data-file=-
#      (rotate with `gcloud secrets versions add needle-cloud-token --data-file=-`)
#   2. The Cloud Run runtime SA (default compute SA) needs roles/datastore.user,
#      storage.objectViewer on the assets bucket (it only READS originals) and
#      secretmanager.secretAccessor on the secret.
#   3. The Cloud Tasks invoker SA (rad-task-invoker@<project>) needs run.invoker
#      on this service:
#        gcloud run services add-iam-policy-binding needle-uploader \
#          --member="serviceAccount:rad-task-invoker@$PROJECT.iam.gserviceaccount.com" \
#          --role=roles/run.invoker --region "$REGION" --project "$PROJECT"
#   4. Put the deployed service URL into PROGRESSIVE_SERVICE_URLS
#      (public/functions/progressive-dispatch.js) or NEEDLE_UPLOADER_URL.
#
# Usage:
#   ./deploy.sh [PROJECT] [REGION] [NEEDLE_TEAM]
#   ./deploy.sh dev-3dstreet us-central1 3dstreet
#
# Run from inside needle-uploader/. Requires gcloud auth with deploy permissions.

set -euo pipefail

PROJECT="${1:-dev-3dstreet}"
REGION="${2:-us-central1}"
NEEDLE_TEAM="${3:-${NEEDLE_TEAM:-}}"
SERVICE="needle-uploader"
QUEUE="glb-progressive"
BUCKET="${PROJECT}.appspot.com"

# --- Cloud Run service config ------------------------------------------------
# The work is an upload, so the box is small: /tmp is tmpfs (counts against
# memory), and the largest file we accept is the PRO per-file cap (1 GB), so
# 4Gi keeps a 1 GB download plus Node comfortable. CPU-light.
MEMORY="4Gi"
CPU="1"
# Cloud Run request timeout: above the Cloud Tasks dispatchDeadline (1800s in
# progressive-dispatch.js) so Cloud Tasks, not Cloud Run, decides a retry.
TIMEOUT="2100"
CONCURRENCY="1"

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
  --set-env-vars "STORAGE_BUCKET=${BUCKET},SERVICE_REGION=${REGION},NEEDLE_TEAM=${NEEDLE_TEAM}" \
  --set-secrets "NEEDLE_CLOUD_TOKEN=needle-cloud-token:latest"

# --- Cloud Tasks queue retry policy ------------------------------------------
# A failed run re-uploads the whole file, so bound the attempts; a file Needle
# itself rejects is marked 'skipped' by the worker and never retried at all.
echo ">> Setting Cloud Tasks queue '$QUEUE' retry policy"
gcloud tasks queues describe "$QUEUE" --project "$PROJECT" --location "$REGION" >/dev/null 2>&1 \
  || gcloud tasks queues create "$QUEUE" --project "$PROJECT" --location "$REGION"
gcloud tasks queues update "$QUEUE" \
  --project "$PROJECT" \
  --location "$REGION" \
  --max-attempts=3 \
  --min-backoff=30s \
  --max-backoff=600s

echo ">> Done. Service URL:"
gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" --format='value(status.url)'
