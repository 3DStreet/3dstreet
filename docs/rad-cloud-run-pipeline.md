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
| SH degree | **`--max-sh=0`** (env `RAD_MAX_SH`, `rad-converter/deploy.sh`) | Degree-3 SH was over half of every streamed chunk; street scans get little from it. Halves bytes + decode for every future asset (#2047). Recorded as `optimizationMetadata.maxSh`. |
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
  2. Run `build-lod --quality --max-sh=<RAD_MAX_SH> <ply>` → `*-lod.rad`.
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
  `gcloud storage buckets update gs://<bucket> --cors-file=public/cors.json`.

### 4. Deploy / IAM

- Functions: `cd public && firebase use <project> && firebase deploy --only
  functions:onSplatAssetCreated,functions:reconcileGenerationJobs`
  (hosting scripts are hosting-only; functions deploy separately).
- Cloud Run: `gcloud run deploy rad-converter --source rad-converter/ ...` (or via
  Cloud Build + Artifact Registry image).
- Cloud Tasks queue: create once (`gcloud tasks queues create`).
- IAM: Cloud Tasks SA → `run.invoker` on the service; Cloud Run SA → read/write
  the assets bucket + Firestore.
- Bucket CORS: `gcloud storage buckets update --cors-file` (above).

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

## Steady-state streaming cost (#2047)

Time to first frame was never the problem; what a streamed `.rad` does *after*
that is. Spark's `SparkRenderer` LOD is a **fixed splat budget per platform**
(2.5M desktop, 1–1.5M mobile), not a bandwidth or frame-rate governor. Each
traversal picks the budget's worth of splats for the view and queues every
~3 MB chunk holding any of them; 3 parallel fetchers pull them with no pacing
and the pager re-drives its own queue after every landed chunk — even with no
frames rendering (tab hidden during a call). Measured on the 417 MB / 9.06M
splat scene from #1754 (static camera, desktop budget): 117 of 139 chunks,
352 MB. Capping the budget helps sub-linearly (0.5× budget → 256 MB, 0.25× →
176 MB) because the chunk is the unit of fetch.

Levers, in order of impact — policy in `src/tested/splat-streaming.js`
(unit-tested), applied by the `splat` **system** in
`src/aframe-components/splat.js`; all are live SparkRenderer / SplatPager
properties, no reload:

1. **Generation:** `--max-sh=0` (table above). The only lever that shrinks
   every chunk for every future asset.
2. **Hidden document:** `enableLodFetching = false` **and**
   `pager.autoDrive = false` on `visibilitychange` (both are needed: the
   renderer copies the flag onto the pager only on a traversal, and there are
   no traversals while hidden). In-flight chunks finish, the queue waits, and
   the pager is kicked on resume. Also in `public/splat-viewer.html`.
3. **Huge scans:** a `.rad` whose header `count` exceeds 5M splats halves the
   LOD budget on its own (`HUGE_SCAN_*`). Reported by the component from
   `PagedSplats.getRadMeta()` before any chunk is queued.
4. **On-demand rendering** (Spark maintainers' recommendation; needs Spark
   ≥ 2.3.1: 2.3.0 fixed `onDirty` for streamed chunks, and its published
   builds were broken, fixed in 2.3.1). Spark's sort, LoD
   traversal and chunk uploads all run from `SparkRenderer.onBeforeRender`,
   so an A-Frame scene that redraws every frame re-sorts and re-draws
   millions of splats 60 times a second while nothing changes. The
   `render-on-demand` system (`src/aframe-components/render-on-demand.js`,
   policy in `src/tested/render-on-demand.js`) is activated by the first
   splat and skips the **editor** viewport's draw when idle; A-Frame's loop
   and every tick keep running. A frame draws when the camera, projection or
   canvas size changed; for `SETTLE_MS` after input or a scene event; when
   Spark's `onDirty` asks for one; and on a `HEARTBEAT_MS` safety net for
   changes that raised no signal. Viewer mode, Play and WebXR draw every
   frame (the live scene animates). `public/splat-viewer.html` renders fully
   on demand (OrbitControls `change` + `onDirty`, no heartbeat).
   Measured in headless Chromium on a software GPU (177k-splat `.spz`): the
   loop went from under 1 fps with every frame drawn to about 37 fps with
   draws skipped, and an idle editor settles to heartbeat draws only (no
   `onDirty` loop). On a real GPU (M2 MacBook Air, Chrome, #2047 scene,
   2800×1560 canvas): idle GPU 99% → 44% and the editor loop 6 → 60 fps;
   the remaining 44% is the 500 ms heartbeat (a draw costs ~160 ms of GPU
   there). Details on PR #2048.

A user-facing data-saver profile (`lodSplatScale` 0.5, `numLodFetchers` 1,
`pager.fetchPause` between chunks) is the natural "I'm on a call" switch and
belongs with Low Power Mode (#1723) when that lands; it is not wired today.

Not levers: `lodRenderScale` (no bandwidth effect while the budget binds;
above ~1.5 distant splats vanish) and `maxPagedSplats` (a pool size, not a cap;
below the working set it evicts and re-fetches). `STREET.splatDebug.snapshot()`
shows the resolved settings and the live pager queue under `streaming`, and
frames drawn (by reason) vs skipped under `renderOnDemand`;
`STREET.splatDebug.setRenderOnDemand(false)` turns skipping off for an A/B.
Real-hardware test pass: [manual-test-plan-splat-on-demand.md](manual-test-plan-splat-on-demand.md).

### Future work: a smooth experience on big scans

The levers above stop idle and background waste. They do not bound the cost
while the user is looking around. That cost is mostly rendering, not
bandwidth: on the M2 Air above, one draw of the default 2.5M-splat budget at
a retina canvas takes ~160 ms, so camera motion runs at ~9 fps whatever the
streaming does. 3D Tiles stays smooth with the whole planet in the frustum
because it refines to a screen-space error and budgets work per frame and
memory per device. Spark instead fills a fixed splat budget. What is missing,
in priority order:

1. **Frame-time governor (planned).** Measure GPU time per frame and adjust
   `lodSplatScale` and render resolution to hold a target frame rate. The
   cheapest part: render at DPR 1 while the camera moves (4× fewer pixels
   on a retina screen) and redraw at full resolution when it stops, which
   pairs with on-demand rendering (the idle frame is the sharp one). Also
   consider a longer `HEARTBEAT_MS` (~2 s would take the idle GPU above from
   ~44% to ~15–20%).
2. **Foveation (planned).** Spark exposes LoD foveation we don't use
   (`coneFov`, `coneFoveate`, `behindFoveate`): less detail toward the edges
   and behind the camera. Measure the draw-cost and chunk-count effect on the
   #2047 scene.
3. **Device memory budget.** The page pool (`maxPagedSplats`, 16.7M) holds
   the whole 9M-splat file once the camera has looked around; nothing sizes
   it to the device or evicts least-recently-used pages. Matters on phones
   and 8 GB laptops. (Below the working set it evicts and re-fetches, so the
   budget has to follow the LoD budget, not replace it.)
4. **Smaller files at generation (untested).** Beyond `--max-sh=0`:
   `--csplat` (compact encoding), and a splat-count cap or quality tier for
   huge scans before conversion. Measure size and visual quality first.

Known limitation, not planned now: **chunk layout.** A chunk is 65,536
splats, and a view's splats are spread across chunks at every LoD level, so a
street-level view touches ~84% of this file even under a capped budget. The
3D Tiles fix (each chunk a spatial region at one LoD level) is a change to
Spark's `build-lod`, upstream. Client-side fetch pacing (a bytes-per-second
cap, center-of-screen priority, cancelling chunks the view no longer wants,
holding refinement while the camera moves) would soften it without that
change.

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
