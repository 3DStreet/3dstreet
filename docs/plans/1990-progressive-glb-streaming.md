# Progressive GLB streaming for large user uploads (issue #1990)

Implementation plan for [issue #1990](https://github.com/3DStreet/3dstreet/issues/1990):
integrate needle-tools' `gltf-progressive` so user-uploaded GLBs over 10MB stream
progressively (tiny low-LOD first, refined by screen-space density), reusing the
existing generationJobs/RAD cloud-job architecture. Delete this file once the work
lands (or fold what's durable into `docs/agent-context/`).

## State of work

- **Phase 0 spike: PASSED (2026-09-11, local, Meshy AI building GLB).** Results:
  - Source `1001SCapitolSt` Meshy export: 76.2 MB, 1.67M tris, 3x 2048 JPEG,
    no compression. Needle output: optimized (Draco+KTX2) 12.4 MB; progressive
    initial file **3.7 MB** (mesh LOD2 = 417k tris, 512px textures embedded),
    with mesh LOD0 (full 1.67M) and 1024/2048 texture LODs streamed on demand.
  - In the editor via our `gltf-model` loader: progressive `model-loaded` in
    **869 ms**; on close-up it fetched LOD0 + 2048 textures and refined to the
    full mesh. The original file took 32.8 s to download and then froze the
    main thread for >45 s while parsing.
  - No `Texture is immutable` / WebGL errors across LOD swaps: the library
    replaces the material's Texture and refcount-disposes the old one, which is
    the pattern our shared-texture extension requires.
  - Needle CLI upload+process round trip for 76 MB: ~2 min (upload ~1 min).
  - Duplicates (x2) loaded fine with their own LOD state; batching was not
    active in that editor session, so the BatchedMesh interaction is still
    unverified (Phase 1 excludes progressive URLs from batching regardless).
- **Needle deletion: NONE available (checked 2026-09-12, needle-cloud 2.5.0,
  the latest release; there is no 3.x).** The CLI has no delete/remove command
  (`settings, mcp, send-logs, login, logout, me, list, download, deploy,
optimize, generate-material, generate-3d, ask`), its bundle makes no
  `DELETE` request, its MCP server exposes no content-management tool, and
  the cloud docs (`engine.needle.tools/docs/cloud/`) document no REST API
  beyond outgoing webhooks. Deletion is web-UI only. Phase 2 GC therefore
  writes an orphan ledger (`needleOrphans` or a field on the purged asset's
  tombstone) and we ask Needle support for an API; the ledger is the manual
  purge list until then.
- **`--usecase world` works** on a fresh `--name`: `list --output json`
  returns `url: https://cloud.needle.tools/-/assets/<viewId>-world/file`
  (the spike's earlier "-product only" result was a name reuse). The worker
  reads `url` from `list --output json` filtered by `title` = the `--name`
  it passed (also `identifier`, `content_type: '3d-asset'`, `is_public`).
- **Needle CLI facts (needle-cloud 2.5.0):** the command is `optimize`, not
  `upload`: `npx needle-cloud optimize <file.glb> --token <t> --progressive true
--name <id>`. The env var `NEEDLE_CLOUD_TOKEN` was read but rejected as
  "not logged in"; `--token` works. `--usecase world` produced no `-world`
  variant; only `-product` exists. The CLI prints only the edit URL; get the
  served URL from `needle-cloud list --token <t> --output json` (`url` field):
  `https://cloud.needle.tools/-/assets/<viewId>-product/file`, with siblings
  `<viewId>-optimized/file` (Draco+KTX2) and `<viewId>/file` (original).
  Served with `access-control-allow-origin: *` and public `cache-control`
  even though the list shows `is_public: false`.
- **KTX2 is mandatory:** Needle output uses `KHR_texture_basisu`. A-Frame 1.8
  configures a default Draco path but no KTX2 transcoder, so without the hook
  the load fails with "setKTX2Loader must be called before loading KTX2
  textures". The hook fills the missing KTX2 loader from Needle's CDN
  (`cdn.needle.tools/static/three/0.179.1/basis2/`), a runtime third-party
  dependency to decide on in Phase 1 (self-host the transcoder, or set
  A-Frame's `ktx2TranscoderPath`).
- **Phase 1 runtime integration: DONE (2026-09-12, on this branch; editor
  pass passed the same day, see below).** The spike flag is gone; behavior is keyed purely off
  the src URL:
  - `src/tested/progressive-models.js` (in `src/tested/`, not `src/lib/`, so
    the mocha suite covers it: `test/core/progressive-models.test.js`):
    `isProgressiveModelUrl(src)` = hostname allowlist `PROGRESSIVE_MODEL_HOSTS`
    (`cloud.needle.tools`), accepting `url(...)`-wrapped srcs;
    `hookProgressiveLoader(loader, renderer)` = idempotent per-loader
    `useNeedleProgressive`, lazy-imports the library (still a separate webpack
    chunk; main bundle +0.5 KB), never rejects.
  - `gltf-model.js` `loadModel()`: hooks the loader only for progressive srcs
    (chained into `ready`), and skips the clone-template cache for them so each
    instance parses and refines with its own LOD state.
  - `batch-models.js` `getBatchProvider()`: `key: null` +
    `skipReason: 'progressive-streaming model'` for progressive srcs (excludes
    deferral, grouping and late repack; the reason shows in the batch log).
  - `asset-fallback-system.js`: candidate list `[optimizedSourceUrl,
storageUrl]`, tried per assetId per session, so an unreachable Needle CDN
    falls back to the Firebase original (generic: also heals a stale token).
  - **KTX2 transcoder decision:** keep the library default (Needle's CDN,
    `cdn.needle.tools/static/three/0.179.1/basis2/`). It is only fetched when a
    Needle-hosted model loads, so it adds no availability domain beyond the
    model itself. Revisit only if we self-host models.
  - `&debugprogressive` in the URL still enables the library's LOD logs.
  - **Editor pass (2026-09-12, local dev server, progressive-world URL
    `https://cloud.needle.tools/-/assets/Zp9qu81CtVaR-1CtVaR-world/file.glb`):**
    `model-loaded` in 608 ms at 58k tris with 128px textures; on close-up it
    streamed mesh LOD5→0 (1.67M tris) and the 2048 texture LODs through our
    loader, KTX2 transcoder fetched from Needle's CDN on demand. Three
    duplicates each parsed their own instance (no clone-cache entry), all
    stayed unbatched, no `Texture is immutable` / WebGL / uncaught errors;
    removing a duplicate tore down cleanly. **Not covered:** save/reload
    (URL persistence is unchanged by Phase 1) and the CDN-blocked → storageUrl
    fallback (needs a real asset doc with a Needle `optimizedSourceUrl`, i.e.
    Phase 2 writeback); test both on dev during Phase 2 end-to-end.
- **Open question raised by the numbers:** the >10 MB threshold may be too
  high; a ~5 MB cutoff is plausible. Decide after processing a mid-size
  (5-15 MB) upload and comparing against the client-side Draco+WebP result.
  Note #1978 / PR #1985 (merged) added a client-side meshopt `simplify` step
  and a 30 s timeout, which changes the small-file baseline.
- **Next:** Phase 2 processing pipeline (first: the Needle deletion-API
  question, and the `needle-uploader/` worker contract).

## Decisions already made

- Scope: **user-uploaded assets only** (not the `assets.3dstreet.app` catalog).
- Rule: uploads **>10MB** get Needle Cloud processing (~€50/mo); **<10MB** keep
  the existing client-side gltf-transform optimization.
- Processed files served **directly from Needle Cloud's CDN**.
- **Validation spike first**; the pipeline is built only if the spike passes.
- **Reuse the generic cloud-job architecture** — no Needle-specific data models.

## The generic architecture to reuse

The provider-agnostic async job queue `users/{uid}/generationJobs/{jobId}` with the
scheduled reconciler backstop (`docs/generation-job-queue.md`), and specifically the
**RAD splat pipeline** as the proven template (`docs/rad-cloud-run-pipeline.md`,
`public/functions/rad-dispatch.js`): asset-doc `onCreate` trigger → `generationJobs`
doc (`provider: 'cloudrun'`, `kind: 'splat-rad'`, `tokenCost: 0`) → Cloud Tasks →
worker converts → **writes back into the existing `optimizedSource*` fields on the
asset doc** → terminal job status; reconciler re-enqueues wedged jobs. RAD is
explicitly "the splat analog of the GLB optimized variant."

**Framing that eliminates new schema:** the Needle progressive output _is_ the
optimized variant for large GLBs. Large uploads skip the client-side worker (whose
15s timeout mostly defeats it on big files anyway) and the server-side job produces
the optimized variant instead. Consequences:

- **No new asset-doc fields.** Writeback = `optimizedSourceUrl` (Needle CDN URL) +
  `optimizedSourceSize` + provenance in the existing `optimizationMetadata` blob
  (`{ format: 'needle-progressive', needleAssetId, profile }`).
  `optimizedSourcePath` stays absent (nothing in our bucket).
- **No firestore.rules changes.** The update deny-list (`public/firestore.rules`
  assets block) already protects the quota fields; `optimizedSourceUrl` /
  `optimizationMetadata` are written via Admin SDK exactly as the RAD worker does.
- **No quota changes.** `onAssetWritten` counts only `size`; optimized bytes are
  already platform cost.
- **`getServedUrl` unchanged** (`optimizedSourceUrl ?? storageUrl`,
  `src/shared/assets/utils.js`) — placement and gallery drags pick up the
  progressive URL automatically, same as RAD.
- **Existing UI mostly free**: `MeshDetailsModal` already renders the
  optimized-variant row from `optimizationMetadata`.

## External facts (verified)

`@needle-tools/gltf-progressive` is MIT, stable **3.6.1**, peerDep
`three >= 0.160.0` (app pins `0.184.0`; webpack externalizes bare `three` to
`window.THREE`, so it patches the same loader classes A-Frame uses — but it also
bundles its own `three/examples/jsm` loader instances internally, which the spike
must validate). Integration: `useNeedleProgressive(gltfLoader, renderer)`; models
without LOD data load normally (no-op). Processing via the `needle-cloud` npm CLI
(auth `NEEDLE_CLOUD_TOKEN`), returning Progressive-World/Product URLs. Avoid
`4.0.0-alpha`.

## Key runtime constraint

User uploads ARE batchable — `BATCHABLE_SELECTOR` (`src/batch-models.js`) matches
`[gltf-model]`, and 2+ copies get folded into fixed-buffer `BatchedMesh`
(late-repack threshold 1), structurally incompatible with runtime LOD swaps. The
clone-template cache in `src/aframe-components/gltf-model.js` (2nd+ instance of a
src clones the parsed scene instead of loading) similarly bypasses the loader.
Both need exclusions for progressive URLs (Phase 1).

---

## Phase 0 — Validation spike (gates everything)

1. **Manual processing** (no repo changes): Needle Cloud team/trial + read/write
   token; `NEEDLE_CLOUD_TOKEN=… npx needle-cloud upload model.glb --team '…'` on
   1–2 real >10MB GLBs. Record: returned URLs, exact CLI output format (the
   worker parses it), CDN hostname(s) (for the URL predicate), and wall-clock CLI
   duration (sizes the Cloud Tasks dispatchDeadline / service timeout).
2. **Loader hook** — already on this branch (see State of work).
3. **Manual checks** (`verify` skill or by hand):
   - Progressive URL in `gltf-model`: fast low-LOD, refines on zoom, no errors.
     Catalog/small models unchanged with flag on.
   - **Shared-texture extension** (`GLTFSharedTextureSourceExtension` in
     gltf-model.js): watch for `glTexStorage2D: Texture is immutable` during LOD
     swaps — verify texture LODs swap the material's Texture, not a GPU-uploaded
     `Source`.
   - **Batching**: duplicate the entity 2-3× — expect LOD refinement to
     freeze/break inside `BatchedMesh` (evidence for Phase 1 exclusion). Repeat
     with batching off to check the clone cache (expect clones not to refine).
   - Module-instance mismatch: the library's internal LOD loads use its own
     bundled `three/examples` GLTFLoader (same 0.184 version, different module
     instance than `window.THREE`) — confirm parsed LOD geometry/textures render
     correctly through the super-three renderer.
4. **Measure** with `scripts/measure-load.mjs`: same scene, progressive URL vs
   Storage URL — time-to-loaded, FPS, bytes before first render.
5. **Gate**: proceed if ≥40% faster time-to-first-visible OR ≥60% fewer
   bytes-before-first-render, no texture-immutable errors, no three-compat
   failures, equivalent close-range quality, no FPS regression. Otherwise stop
   and report findings on the issue.

## Phase 1 — Runtime integration

- **New `src/tested/progressive-models.js`** (planned as `src/lib/`; moved so
  it is mocha-covered): `isProgressiveModelUrl(src)` (hostname
  test against the Needle CDN domains from Phase 0 — works for saved scenes with
  zero metadata, since scene JSON persists only the URL +
  `data-asset-id`/`data-asset-owner-uid`); `hookProgressiveLoader(loader, sceneEl)`
  (idempotent `useNeedleProgressive` wrapper); optional `LODsManager` tuning knob.
- **`src/aframe-components/gltf-model.js`**: replace the spike flag — in
  `loadModel()` hook the loader only when `isProgressiveModelUrl(src)`; all other
  loads stay byte-identical. Clone-cache exclusion: add
  `&& !isProgressiveModelUrl(src)` to the `srcLoadCount(src) >= 2` branch.
- **`src/batch-models.js`**: in `getBatchProvider()`'s gltf-model branch, return
  `key: null` when `isProgressiveModelUrl(key)` — a null key already excludes from
  defer-load, grouping, and late repack. Log a distinct "progressive-streaming
  model" reason.
- **Fallback** — `src/aframe-components/asset-fallback-system.js`: today it gives
  up when the fresh doc's `optimizedSourceUrl ?? storageUrl` equals the failing
  URL. Generic fix: when the preferred URL equals the failing one, retry
  `storageUrl` if it differs, and remember the assetId for the session. Covers
  "Needle CDN unreachable" since the Firebase original is never deleted.
- **Verification**: `npm run lint`, `npm test`; measure-load.mjs on a mixed
  catalog+progressive scene, both batching modes (catalog batching stats
  unchanged); editor pass: place, duplicate ×3 (stays unbatched, all refine),
  undo/delete, save/reload.

## Phase 2 — Processing via the existing job queue

- **Client-side split at the 10MB rule** —
  `src/editor/lib/asset-upload/uploadAndPlaceAsset.js`: skip `optimizeGlb(file)`
  when `kind === 'glb' && file.size > 10 * MB` (decimal, matching quota
  convention); upload original only. Small files keep the current worker path.
- **New `public/functions/progressive-dispatch.js`**, closely mirroring
  `rad-dispatch.js` (exported from `index.js`):
  - Firestore v1 `onCreate` on `users/{userId}/assets/{assetId}`; guards:
    `type === 'mesh'`, `size > 10MB`, no `optimizedSourceUrl`, `storagePath`
    present, `visibility !== 'private'` (public-CDN privacy guard).
  - Writes a `generationJobs` doc **before** dispatch (crash-safe, reconcilable):
    `{ kind: 'glb-progressive', provider: 'cloudrun', status: 'queued',
tokenCost: 0, tokenCharged: false, refunded: false, assetId, storagePath,
inputBytes, createdAt, dispatchedAt }` — same normalized vocab as `splat-rad`
    so the reconciler's provider-agnostic queries just work.
- **Worker**: a tiny **`needle-uploader/` Cloud Run service** (Node-only container
  with pinned `needle-cloud`; far simpler than `rad-converter/`), enqueued via
  Cloud Tasks with OIDC exactly like `enqueueRadTask` (generalize/copy the helper;
  per-project URL map + env override, same as `RAD_SERVICE_URLS`). Contract
  mirrors `rad-converter/server.js`: download GLB from `storagePath` →
  `needle-cloud upload` (token from Secret Manager) → parse Progressive-World URL
  → patch asset doc `{ optimizedSourceUrl, optimizedSourceSize,
optimizationMetadata: { format: 'needle-progressive', needleAssetId,
profile: 'world' } }` → write terminal job status. Failures →
  `status: 'failed'` with error; unparseable CLI output is a failure, never a
  bad URL.
- **Reconciler** — `public/functions/scheduled/generation-job-reconcile.js`: the
  `case 'cloudrun'` re-enqueue seam exists; make re-enqueue kind-aware
  (`splat-rad` → `enqueueRadTask`, `glb-progressive` → the new enqueue helper).
- **GC** — `public/functions/scheduled/asset-gc.js` purge path: when
  `optimizationMetadata.format === 'needle-progressive'`, delete the Needle copy
  via `needleAssetId` if their CLI/API supports deletion (**open question**);
  otherwise write to an orphan ledger for later purge. Resolve before GA.
- **Rollout**: worker + queue infra → functions → client 10MB split (order-safe:
  until the trigger deploys, big uploads simply serve `storageUrl`).

## Phase 3 — UI polish (small)

- Extend `deriveOptimizationInfo` (`src/shared/assets/utils.js`) so
  `MeshDetailsModal` labels `needle-progressive` as "Streaming (progressive LOD)";
  show nothing until writeback (simplest).
- Upload toast for >10MB GLBs: "Uploaded — streaming version processing in
  background". Scenes saved before writeback keep the working `storageUrl`;
  re-placements and the fallback path heal forward (same behavior RAD relies on).
- Privacy: `visibility: 'private'` assets are skipped by the trigger; note in UI
  copy that public assets' processed copies live on Needle's public CDN. Per-asset
  opt-out rides the existing client-writable `visibility` toggle — no new field.
- Update `docs/agent-context/asset-uploads.md` + `docs/agent-context/generation.md`
  (new job kind) per CLAUDE.md's doc-maintenance rule.

## Verification (per phase)

- **Phase 0**: measure-load.mjs vs gate criteria; browser pass; recorded CLI
  timings/output.
- **Phase 1**: lint + `npm test`; mixed-scene measure-load.mjs in both batching
  modes; duplicate/undo/save-reload editor pass.
- **Phase 2**: emulator test of the trigger writing a correct `generationJobs`
  doc; end-to-end on dev: upload ~15MB GLB → job `queued → succeeded` → asset doc
  gains Needle `optimizedSourceUrl` → gallery re-drag streams progressively;
  kill-switch (block Needle CDN in DevTools → falls back to `storageUrl`);
  reconciler re-enqueue test (kill the worker mid-job). No rules changes ⇒ no
  `test:rules` additions beyond a regression run.

## Risks / open questions

1. **Needle Cloud has no deletion API** (verified, see State of work) — GC
   writes an orphan ledger; ask Needle support; manual purge until then.
2. **Public CDN privacy** — mitigated by skipping `private` assets + UI copy;
   existing `visibility` toggle is the opt-out.
3. **Shared-texture-extension invariant** ("never swap a Source post-GPU-upload")
   — Phase 0 gate.
4. **Semantic overload of `optimizedSourceUrl`** — it now may point off-bucket.
   Audited consumers (`getServedUrl`, fallback system, GC, `MeshDetailsModal`)
   are covered above; anything else assuming a bucket URL should surface in
   Phase 2 testing. Chosen deliberately over new fields to minimize schema/rules
   surface.
5. **three/super-three lockstep** gains a third participant; pin exact versions,
   re-check on A-Frame/three bumps. Avoid 4.x alpha.
6. **Cost/throughput** of the €50/mo plan unverified — instrument the worker with
   PostHog (`asset_progressive_processed`, sizes/duration); consider gating to
   PRO/MAX if volume is costly.
7. **CLI output fragility** — pin `needle-cloud` in the worker image; assert on
   the Phase-0-recorded output shape.
8. **Editor top-down/screenshot views** may sit at low LOD; the library has a
   force-highest-LOD hook if needed.

## Critical files

- `src/aframe-components/gltf-model.js` · `src/batch-models.js`
  (`getBatchProvider`) · `src/tested/progressive-models.js` (+
  `test/core/progressive-models.test.js`)
- `src/aframe-components/asset-fallback-system.js` · `src/shared/assets/utils.js`
  (`deriveOptimizationInfo` only)
- `src/editor/lib/asset-upload/uploadAndPlaceAsset.js` (10MB split)
- `public/functions/progressive-dispatch.js` (new, mirrors `rad-dispatch.js`) ·
  `needle-uploader/` (new, mirrors `rad-converter/` handler contract) ·
  `public/functions/scheduled/generation-job-reconcile.js` (kind-aware
  re-enqueue) · `public/functions/scheduled/asset-gc.js`
- Docs: `docs/agent-context/asset-uploads.md`, `docs/agent-context/generation.md`
