# Progressive GLB streaming for large user uploads (issue #1990)

Implementation plan for [issue #1990](https://github.com/3DStreet/3dstreet/issues/1990):
integrate needle-tools' `gltf-progressive` so user-uploaded GLBs over 10MB stream
progressively (tiny low-LOD first, refined by screen-space density), reusing the
existing generationJobs/RAD cloud-job architecture. Delete this file once the work
lands (or fold what's durable into `docs/agent-context/`).

## State of work

- **Done (pushed on this branch):** Phase 0 spike scaffolding —
  `@needle-tools/gltf-progressive@3.6.1` (exact pin) plus a flag-gated hook in
  `src/aframe-components/gltf-model.js`. Enable with `?progressive` in the URL or
  `localStorage.progressiveModels = 'true'`. The library is dynamically imported
  (module evaluation has side effects: a decoder-reachability fetch, eager
  DRACO/KTX2 loader construction, a `Needle` global) and webpack code-splits it
  into a lazy chunk, so the main bundle is unchanged with the flag off.
  `useNeedleProgressive` only fills decoders the loader is missing, so A-Frame's
  DRACO/KTX2/meshopt setup wins. Lint + core/modern test suites pass.
- **Not done:** everything from "Phase 0 — Validation spike" step 1 onward. The
  spike needs a Needle Cloud account (external credential) and a real browser.

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

- **New `src/lib/progressive-models.js`**: `isProgressiveModelUrl(src)` (hostname
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

1. **Needle Cloud deletion API unknown** — third-party copies of user data need a
   GC path; orphan ledger + support inquiry; resolve before GA.
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

- `src/aframe-components/gltf-model.js` (spike hook already in; Phase 1 reworks
  it) · `src/batch-models.js` (`getBatchProvider`) · `src/lib/progressive-models.js`
  (new)
- `src/aframe-components/asset-fallback-system.js` · `src/shared/assets/utils.js`
  (`deriveOptimizationInfo` only)
- `src/editor/lib/asset-upload/uploadAndPlaceAsset.js` (10MB split)
- `public/functions/progressive-dispatch.js` (new, mirrors `rad-dispatch.js`) ·
  `needle-uploader/` (new, mirrors `rad-converter/` handler contract) ·
  `public/functions/scheduled/generation-job-reconcile.js` (kind-aware
  re-enqueue) · `public/functions/scheduled/asset-gc.js`
- Docs: `docs/agent-context/asset-uploads.md`, `docs/agent-context/generation.md`
