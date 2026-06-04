# rad-converter

Cloud Run service that converts a splat `.ply` into a Spark **RAD (LOD)** file —
the splat analog of the GLB "optimized" variant. It downloads the source `.ply`
from GCS, runs the bundled `build-lod` (Spark 2.1.0) binary, uploads the
resulting single `*-lod.rad` as an `assetRole: 'optimized'` artifact, and patches
the asset doc's `optimizedSource*` fields. The renderer and client placement
already prefer `optimizedSourceUrl`, so once the doc is patched, dragging the
splat in streams the `.rad`.

Full design: [`../docs/rad-cloud-run-pipeline.md`](../docs/rad-cloud-run-pipeline.md).

### Patched build-lod

We carry a small **parallelism patch** that the Dockerfile applies on top
of Spark v2.1.0 during the image build (see [`./patches/`](./patches/)).

Profiling (callgrind) of a real conversion showed the single largest cost
in `build-lod` is **deflate compression of the `.rad` output** — ~28% of
total instructions, more than all the similarity FP math combined, and it
grows with output size. It's also embarrassingly parallel: within each
chunk the ~10 properties (center, alpha, rgb, scales, orientation, SH…)
are compressed independently.

The patch (`rad.rs`) makes the per-property encoders return **raw**
(uncompressed) bytes and compresses them via `par_iter_mut` just before
chunk assembly. The output is **byte-identical** to upstream — same bytes,
same `GZ_LEVEL=6` — so there's no quality question; only wall time changes.

**Measured (4 vCPU, 2.8 GHz Xeon):** 1.27× on a 22.3M-splat file
(1022s → 805s), 1.16× on a 1.18M-splat file. The full benchmark and the
profile that motivated it are in
[`../docs/rad-conversion-perf.md`](../docs/rad-conversion-perf.md).

> **Note:** LOD *construction* (the merge loop) is still single-threaded
> and is the larger remaining cost. Compression is the part that scales
> with cores today; parallelizing the merge loop is scoped as follow-up
> work in the perf doc. A trivial one-line alternative to this patch —
> `GZ_LEVEL=6 → 3` in `rad.rs` — gets ~1.25× on the big file for +0.4%
> output size, if you'd prefer a smaller patch to maintain.

Re-base on a future Spark tag: clone Spark at the new tag, `git am`
`patches/*.patch`, resolve any conflicts, regenerate the patch with
`git format-patch -1 --stdout > patches/0001-rad-parallel-compress.patch`.

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

## Deploy

**Use [`deploy.sh`](./deploy.sh) — it is the single source of truth** for the
Cloud Run sizing (memory/CPU/timeout/concurrency) and the Cloud Tasks queue
retry policy. Don't set these with ad-hoc `gcloud ... update` calls; change them
in `deploy.sh` and re-run, so the committed config and the live infra never
drift.

```bash
cd rad-converter
./deploy.sh                      # defaults: dev-3dstreet, us-central1
./deploy.sh <project> <region>   # other targets
```

`--source` builds the image with Cloud Build and deploys; the Rust build of
`build-lod` takes a few minutes on the first build. Current sizing: **16Gi /
4 vCPU / 3600s / concurrency 1** (a ~368MB / 22M-splat file OOM'd at 8Gi, so
16Gi, which needs >=4 vCPU; 8 vCPU measured no faster so we stay at the floor —
the old 900s timeout, not core count, was what killed the 22M build). Queue
retry: **3 attempts, 10s–300s backoff** (the gcloud default of 100 attempts at
0.1s thrashes on a deterministic OOM — re-downloading and rebuilding ~100×). The
Cloud Task's `dispatchDeadline` is raised to the 1800s max in `rad-dispatch.js`
so Cloud Tasks doesn't give up mid-build (the conversion runs inside the POST).

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
