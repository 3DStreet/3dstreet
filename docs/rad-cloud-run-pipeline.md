# RAD Cloud Run Pipeline — splat "optimized" variant via GCP

Server-side conversion of generated/uploaded splat `.ply` files into Spark
**RAD (LOD)** files, served with byte-range streaming for the "instant draw"
wow moment. RAD is the splat analog of the GLB optimized variant: it lands in
`optimizedSource*` on the asset doc, and the renderer already prefers it.

This replaces a **manual Hetzner box** (`~/dev/splat-ply-to-rad-hetzner-pipeline`,
which proved the concept) with an automated, scale-to-zero **GCP-native**
pipeline that lives next to Firebase/GCS.

Parent design: [`docs/generation-job-queue.md`](./generation-job-queue.md)
(RAD is described there as the splat "optimized variant — reuse the GLB
original/optimized schema as-is").

---

## Status

- ✅ **Spark bumped 2.0.0 → 2.1.0** (`package.json` + `public/splat-viewer.html`
  importmap). Peer dep `three >=0.180.0` is satisfied by our pinned `three@0.180.0`
  — **no Three.js bump needed**. Converter (`build-lod` 2.1.0) and reader are now
  the same version; the skew question is closed.
- ✅ **In-app streaming verified** on bundled Spark 2.1.0: loaded a 2.1.0-built
  `.rad` (190 MB) in the real editor splat component — `splat-loaded` in **405 ms**,
  **34+ range requests** (paged LOD, not a full download), no splat errors,
  rendered cleanly. The wow moment works at the version we ship.
- ✅ **Converter built + deployed to dev** (`rad-converter/`, Cloud Run service
  `rad-converter` in `dev-3dstreet`/us-central1). Manual one-shot proven on both
  existing splats: ~25–32s, 63 MB `.ply` → ~31 MB `.rad`, byte-range CORS verified
  (HTTP 206 + `Accept-Ranges`/`Content-Range` exposed).
- ✅ **Automation built + deployed to dev.** `onSplatAssetCreated` trigger +
  Cloud Tasks (`rad-convert` queue, OIDC via `rad-task-invoker` SA) +
  reconciler `case 'cloudrun'`. End-to-end auto-test passed: a fresh splat doc
  drove `queued → running → succeeded` and patched `optimizedSourceUrl` in ~20s
  with zero manual POST.
- ⬜ **Prod** not done: config in `rad-dispatch.js` is hardcoded to dev — lift to
  env/params, stand up the prod Cloud Run service + queue + SAs + IAM, and apply
  `cors.json` + the `firebase.json` hosting-ignore fix to prod.

---

## What's already done in the codebase (zero work — do NOT rebuild)

- **Client placement prefers the optimized variant for splats.**
  `placeCloudAsset` routes splats through `getServedUrl()` =
  `optimizedSourceUrl ?? storageUrl` (`src/editor/lib/asset-upload/uploadAndPlaceAsset.js:196,218`;
  helper at `src/shared/assets/utils.js:55`). The instant a splat asset doc has
  `optimizedSourceUrl`, dragging it in sets `splat: src: <rad-url>` automatically.
- **Renderer streams `.rad`.** The `splat` component branches `.rad` → `paged: true`
  byte-range streaming (`src/aframe-components/splat.js:142`).
- **Asset schema already has the fields.** `optimizedSourceUrl` /
  `optimizedSourcePath` / `optimizedSourceSize` + `assetRole: 'optimized'` exist
  (GLB). `optimizedSourceSize` is **already excluded** from the quota tally
  (`onAssetWritten`), matching GLB billing — so RAD bytes are platform cost, not
  user quota.
- **Queue + reconciler exist.** `users/{uid}/generationJobs/{jobId}`, the
  idempotent processor, and the reconciler's `switch (job.provider)` registry seam
  (`public/functions/replicate.js`, `public/functions/scheduled/generation-job-reconcile.js`).

So this work is **almost entirely backend**: produce the `.rad`, store it, write
`optimizedSource*` onto the splat asset doc.

---

## Architecture (decisions locked)

| Decision | Choice | Why |
| --- | --- | --- |
| Compute | **Cloud Run service** (container bundling the `build-lod` Rust binary) | Scale-to-zero, runs a custom binary, at-cost GCP, no cross-cloud egress, no idle box. Cheaper than Replicate on large files (egress dominates). |
| Build | **Cloud Build** → Artifact Registry, multi-stage Dockerfile | Reproducible binary build replaces the manual `cargo build` on Hetzner. |
| Trigger | **Firestore `onCreate`** on `users/{uid}/assets/{assetId}` where `type==='splat'` && no `optimizedSourceUrl` | One hook covers BOTH generated (server-saved) and drag-uploaded (client-saved) splats. |
| Dispatch | **Cloud Tasks** → Cloud Run (OIDC) | Durable delivery + retries; matches the queue's "survives anything" ethos. Needs new `@google-cloud/tasks` dep. |
| Queue integration | New **`provider: 'cloudrun'`**, **`kind: 'splat-rad'`** job in `generationJobs` | Reuses the queue schema + reconciler; first real exercise of the registry seam (proves the generalization for a non-Replicate provider). |
| Completion | **Worker writeback** (Cloud Run writes terminal status to the job doc via Admin SDK) | No webhook needed, unlike Replicate. |
| Tokens | **Non-charged** (`tokenCost: 0`) | RAD is a silent backend optimization (GLB-optimization analog), not a user-initiated generation. `refundSplatToken` becomes a no-op. |
| `.rad` storage | **Firebase Storage / GCS** (NOT Hetzner) as `assetRole: 'optimized'` | Durable, token-gated for private splats, consistent asset model. Hetzner is decommissioned for serving. |
| LOD setting | **`build-lod --quality`**, single `.rad` | Matches the Hetzner-validated files (bhatt-lod, single file, not `--rad-chunked`). |
| Serving | GCS with **byte-range CORS** | `cors.json` must expose `Accept-Ranges` + `Content-Range`. |

### Cost reference (approx, verify against current pricing)

Both are cents/conversion; Cloud Run wins on large files purely via egress:
- Small (~50 MB ply, ~60s): Cloud Run ~$0.003 (likely free tier) vs Replicate ~$0.02–0.03.
- Large (~1 GB ply, ~2 min): Cloud Run ~$0.03 vs Replicate ~$0.28 (~$0.24 of that is cross-cloud egress).

---

## Implementation pieces

### 1. Cloud Run converter service — `rad-converter/` (new dir)

- **`Dockerfile`** (multi-stage):
  - builder: `git clone --branch v2.1.0 --depth 1 https://github.com/sparkjsdev/spark.git`,
    then `cd rust && cargo build --release -p build-lod` (per the Hetzner README).
    Binary at `rust/target/release/build-lod`.
  - runtime: slim Debian + Node 22; copy the binary in.
- **Handler** (Node 22, Admin SDK): HTTP endpoint receiving
  `{ uid, assetId, plyPath, jobId }`:
  1. Download `.ply` from GCS (`plyPath`) to `/tmp` (or mount a **GCS FUSE volume**
     for multi-GB files so `/tmp`/memory isn't the ceiling).
  2. Run `build-lod --quality <ply>` → `*-lod.rad`.
  3. Upload to `users/{uid}/assets/splats/{assetId}-lod.rad`, contentType
     `application/octet-stream`, with `firebaseStorageDownloadTokens` +
     `assetRole: 'optimized'` metadata (mirror `saveSplatToGallery` URL scheme
     byte-for-byte — `public/functions/replicate.js:1157` is the reference).
  4. Read size back via `getMetadata()`.
  5. Patch the asset doc: `optimizedSourceUrl`, `optimizedSourcePath`,
     `optimizedSourceSize`, `optimizationMetadata` (record format=rad, spark
     version, lod=quality).
  6. Write terminal status to the `generationJobs` doc (`status: 'succeeded'` or
     `'failed'`).
- **Config:** start 2 vCPU / 4–8 GiB, request timeout 900s, concurrency 1
  (CPU-bound). Size memory up for large splats. Private — invoker = the Cloud
  Tasks service account.

### 2. Trigger + `provider: 'cloudrun'` adapter (Cloud Functions)

- **New `onSplatAssetCreated`** (Firestore v1 trigger, mirror `onAssetWritten` in
  `public/functions/asset-quota.js:95`): on create of
  `users/{uid}/assets/{assetId}` where `type==='splat'` && !`optimizedSourceUrl`:
  - write a `generationJobs` doc `{ kind:'splat-rad', provider:'cloudrun',
    status:'queued', tokenCost:0, assetId, plyPath: <storagePath> }`
  - enqueue a **Cloud Task** (OIDC token) targeting the Cloud Run service with
    `{ uid, assetId, plyPath, jobId }`.
- **Add dep** `@google-cloud/tasks` to `public/functions/package.json`.
- **Reconciler** (`generation-job-reconcile.js`): add `case 'cloudrun'` to
  `fetchProviderPrediction`. For cloudrun there is no external prediction to poll —
  the worker owns writeback — so the reconciler's job is: non-terminal past
  `RACE_GUARD_MS` with no progress → **re-enqueue the Cloud Task**; past
  `GIVE_UP_MS` → mark `failed`. `refundSplatToken` stays a no-op (tokenCost 0).

### 3. Serving / CORS

- Update `public/cors.json`: add `Accept-Ranges` and `Content-Range` to
  `responseHeader` (cross-origin JS can't read them otherwise; these are exactly
  the headers the Hetzner Caddy config exposed). Apply per project:
  `gsutil cors set public/cors.json gs://<bucket>`.

### 4. Deploy / IAM

- Functions: `cd public && firebase use <project> && firebase deploy --only
  functions:onSplatAssetCreated,functions:reconcileGenerationJobs`
  (hosting scripts are hosting-only; functions deploy separately).
- Cloud Run: `gcloud run deploy rad-converter --source rad-converter/ ...` (or via
  Cloud Build + Artifact Registry image).
- Cloud Tasks queue: create once (`gcloud tasks queues create`).
- IAM: Cloud Tasks SA → `run.invoker` on the service; Cloud Run SA → read/write
  the assets bucket + Firestore.
- Bucket CORS: `gsutil cors set` (above).

---

## Sequencing — smallest e2e slice first

1. ✅ **Verify Spark 2.1.0 reads a 2.1.0 `.rad` in-app.** DONE (405ms, streaming).
2. ✅ **One-shot, manual.** DONE — `rad-converter/` built + deployed to dev; both
   existing splats converted by hand; `.rad` in GCS; doc patched automatically by
   the handler; byte-range CORS applied + verified (206).
3. ✅ **Wire automation.** DONE — `onSplatAssetCreated` + Cloud Task enqueue +
   reconciler `case 'cloudrun'`, deployed to dev and proven via auto-test.
4. ✅ **Backfill** the 2 existing splats. DONE (via the manual one-shot in step 2).
   The remaining duplicate `.ply`s have no RAD; re-trigger only if needed.
5. ⬜ **Prod rollout** — see Status (lift hardcoded config, provision prod infra).

---

## Open decisions / inputs needed

- **Target project for the one-shot:** assume `dev-3dstreet` (staging) unless told
  otherwise.
- Confirm `--quality` (vs `--quick`) and single `.rad` (vs `--rad-chunked`) — plan
  assumes `--quality` single-file to match validated Hetzner output.

## Key files

| Concern | File |
| --- | --- |
| Renderer (.rad paged streaming) | `src/aframe-components/splat.js:142` |
| Client placement (prefers optimized) | `src/editor/lib/asset-upload/uploadAndPlaceAsset.js:196,218` |
| Served-url helper | `src/shared/assets/utils.js:55` |
| Generated-splat server save (URL scheme to mirror) | `public/functions/replicate.js:1157` (`saveSplatToGallery`) |
| Queue processor / refund | `public/functions/replicate.js` (`processTerminalPrediction`, `refundSplatToken`) |
| Reconciler (add `case 'cloudrun'`) | `public/functions/scheduled/generation-job-reconcile.js` |
| Quota trigger to mirror for `onSplatAssetCreated` | `public/functions/asset-quota.js:95` (`onAssetWritten`) |
| Bucket CORS | `public/cors.json` |
| Standalone viewer (already 2.1.0) | `public/splat-viewer.html` |
| Hetzner reference (concept proven, being replaced) | `~/dev/splat-ply-to-rad-hetzner-pipeline/README.md` |

## Notes

- `build-lod` is **CPU-only** (no GPU) — Cloud Run is sufficient; do NOT reach for GPU.
- The 100 MB octet-stream cap in `storage.rules` applies to user uploads, not the
  Admin-SDK write the worker does; confirm the worker's `.rad` write isn't blocked
  (Admin SDK bypasses rules, so fine — but the cap matters for the original `.ply`).
- Per-file size limits (separate punch-list item): soft-enforced — single generous
  ceiling in `storage.rules`, per-plan caps client-side + in `getUploadQuota`.
- Thumbnails (separate punch-list item): super-lazy client-side capture when the
  user opens `splat-viewer` (add `preserveDrawingBuffer` + `toBlob` + best-effort
  `thumbnailUrl` backfill). Not part of this RAD pipeline.
