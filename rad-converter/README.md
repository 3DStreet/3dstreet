# rad-converter

Cloud Run service that converts a splat `.ply` into a Spark **RAD (LOD)** file —
the splat analog of the GLB "optimized" variant. It downloads the source `.ply`
from GCS, runs the bundled `build-lod` (Spark 2.1.0) binary, uploads the
resulting single `*-lod.rad` as an `assetRole: 'optimized'` artifact, and patches
the asset doc's `optimizedSource*` fields. The renderer and client placement
already prefer `optimizedSourceUrl`, so once the doc is patched, dragging the
splat in streams the `.rad`.

Full design: [`../docs/rad-cloud-run-pipeline.md`](../docs/rad-cloud-run-pipeline.md).

This is **sequencing step 2 — the manual one-shot**. The automatic trigger
(`onSplatAssetCreated`) + Cloud Tasks dispatch + reconciler `case 'cloudrun'` are
**not built yet**; prove the one-shot first.

## Contract

`POST /` with JSON:

```json
{ "uid": "<owner uid>", "assetId": "<asset doc id>", "plyPath": "users/<uid>/assets/splats/<file>.ply", "jobId": "<optional generationJobs doc id>" }
```

- `jobId` is **optional**. With it, the handler writes terminal status
  (`succeeded`/`failed`) to `users/{uid}/generationJobs/{jobId}` (queue path).
  Without it (the manual one-shot), it just converts + patches the asset doc.
- `GET /` is a health check.

On success the handler patches `users/{uid}/assets/{assetId}` with
`optimizedSourceUrl`, `optimizedSourcePath`, `optimizedSourceSize`, and
`optimizationMetadata: { format: 'rad', tool: 'build-lod', sparkVersion, lod }`.

## Deploy to dev (`dev-3dstreet`)

`--source` builds the image with Cloud Build and deploys. The Rust build of
`build-lod` takes a few minutes on the first build.

```bash
REGION=us-central1   # pick your region

gcloud run deploy rad-converter \
  --project dev-3dstreet \
  --region "$REGION" \
  --source . \
  --no-allow-unauthenticated \
  --memory 8Gi \
  --cpu 2 \
  --timeout 900 \
  --concurrency 1 \
  --set-env-vars STORAGE_BUCKET=dev-3dstreet.appspot.com
```

(Run from inside `rad-converter/`.)

### IAM the runtime service account needs

The Cloud Run runtime SA (default: the Compute Engine default SA) must read/write
the assets bucket and Firestore:

```bash
PROJECT=dev-3dstreet
SA="$(gcloud iam service-accounts list --project "$PROJECT" \
      --filter='displayName:Default compute' --format='value(email)')"

gcloud projects add-iam-policy-binding "$PROJECT" \
  --member="serviceAccount:$SA" --role=roles/datastore.user

gcloud storage buckets add-iam-policy-binding gs://dev-3dstreet.appspot.com \
  --member="serviceAccount:$SA" --role=roles/storage.objectAdmin
```

## One-shot test (by hand, on an existing splat)

### 1. Find a splat's `uid` / `assetId` / `plyPath`

Either grab them from the Firebase console (Firestore → `users/{uid}/assets`,
find a doc with `type: 'splat'`; `plyPath` = its `storagePath`), or list them:

```bash
# Storage side — the two existing .ply files:
gcloud storage ls -r 'gs://dev-3dstreet.appspot.com/users/**/assets/splats/*.ply' \
  --project dev-3dstreet
```

The path after the bucket is `plyPath`; the `<uid>` and `<assetId>` are in it
(`users/<uid>/assets/splats/<assetId>.ply`). Confirm the asset doc id matches
`<assetId>` (server-generated splats use the assetId as the filename).

### 2. POST it

The service is private, so authenticate with your own identity token. Your
gcloud identity needs `run.invoker` on the service:

```bash
gcloud run services add-iam-policy-binding rad-converter \
  --project dev-3dstreet --region "$REGION" \
  --member="user:$(gcloud config get-value account)" --role=roles/run.invoker
```

Then:

```bash
SERVICE_URL=$(gcloud run services describe rad-converter \
  --project dev-3dstreet --region "$REGION" --format='value(status.url)')

curl -X POST "$SERVICE_URL" \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{
    "uid": "<uid>",
    "assetId": "<assetId>",
    "plyPath": "users/<uid>/assets/splats/<assetId>.ply"
  }'
```

Watch logs: `gcloud run services logs read rad-converter --project dev-3dstreet --region "$REGION"`.

### 3. Verify

- **GCS:** `gcloud storage ls gs://dev-3dstreet.appspot.com/users/<uid>/assets/splats/<assetId>-lod.rad`
- **Asset doc:** now has `optimizedSourceUrl` (Firestore console).
- **In-app:** drag the gallery splat into a scene → it should stream the `.rad`
  (paged byte-range requests, fast first draw).

> ⚠️ **Byte-range CORS prerequisite.** For the in-browser streaming check, the
> bucket's CORS must expose `Accept-Ranges` and `Content-Range` (cross-origin JS
> can't read them otherwise). `../public/cors.json` does **not** include these
> yet — that's plan §3. Add them there and apply:
> `gsutil cors set ../public/cors.json gs://dev-3dstreet.appspot.com`.

## Notes

- `build-lod` is CPU-only — no GPU.
- `/tmp` on Cloud Run is tmpfs (memory). For multi-GB splats, mount a GCS FUSE
  volume and convert there instead of `/tmp` (see the handler comment).
- The `.rad` is written by the Admin SDK, which bypasses Storage rules — the
  100 MB octet-stream cap in `storage.rules` does not apply to it.
