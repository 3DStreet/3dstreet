# Asset Upload Architecture

First-party drag-and-drop GLB / image upload, cloud persistence, and quota tracking. Implements Kieran's v2 design brief on top of the existing gallery infrastructure (`GALLERY_STORAGE_ARCHITECTURE.md`).

## Goals

- Drop a `.glb` / `.gltf` / `.jpg` / `.jpeg` / `.png` / `.webp` / `.avif` onto the viewport and have it appear immediately, then persist to cloud in the background.
- Optimize GLB files client-side via `gltf-transform` before upload (deduplication, instancing, simplification, WebP texture compression, Draco geometry compression).
- Enforce per-plan storage quotas (Free 100 MB / Pro 5 GB / Max 25 GB) and per-file caps (50 MB GLB / 10 MB image, decimal MB).
- Persist saved scenes to load correctly with cloud-hosted assets, including for anonymous viewers of shared scenes.
- Surface upload status (uploading / optimizing / uploaded / failed / local-only) in the layers panel and properties panel.

## Out of scope (deferred)

- `cloud-model` resolver Cloud Function (Variant 3 of the brief). Today scenes carry the tokenized Firebase download URL directly; resolver-based deletion enforcement and per-project access control land later.
- Server-side `screenshot-glb` Cloud Function. Thumbnails are generated client-side instead (see _Thumbnail capture_ below); a placeholder cube SVG shows until the JPEG lands.
- `shortName` / programmatic asset access for the StreetPlan integration.
- Server-side optimization pipeline (`functions-pipeline` codebase).

## Data model

Unchanged from the existing gallery system:

| Layer     | Path                                                           |
| --------- | -------------------------------------------------------------- |
| Firestore | `users/{userId}/assets/{assetId}`                              |
| Storage   | `users/{userId}/assets/{meshes\|images\|videos}/{assetId}.ext` |
| Quota doc | `users/{userId}/meta/usage` (managed by Cloud Function)        |

Asset doc fields used by uploads: `assetId`, `userId`, `type` (`mesh` / `image`), `category` (`upload`), `storagePath`, `storageUrl`, `name` (editable display name, default = basename of `originalFilename`), `filename`, `originalFilename`, `size`, `mimeType`, `deleted`, timestamps.

## Drop / upload flow

```
Drop file onto viewport (AddLayerPanel global drop handler)
        │
        ▼
isAcceptedAssetFile(file) ── no ──► toast "Unsupported file type" / per-file size error
        │ yes
        ▼
INSPECTOR.execute('entitycreate', { gltf-model: url(blob:…), data-temporary-file: 'true', … })
        │  (entity is in command history + layers panel; serializer SKIPS it because of data-temporary-file)
        ▼
setUpload(entity.id, { status: 'uploading', file, … })   ◄── Zustand
        │
        ▼
preflightQuota(file.size)   ◄── getUploadQuota Cloud Function (callable)
        │       │
        │       └─ over_limit ──► toast + status: 'local'
        │
        ▼ (GLB only)
status: 'optimizing' → optimizeGlb(file)
        │  dedup → instance → palette → flatten → join → weld
        │   → simplify(Meshopt, ratio 0.5, error 0.001)
        │   → resample → prune → sparse
        │   → textureCompress(webp, [2048, 2048])
        │   → draco({ method: 'edgebreaker' })
        │
        ▼
status: 'uploading' → galleryServiceV2.addAsset(blob, …, 'mesh' | 'image', 'upload', userId)
        │  (existing service uploads to Storage, writes Firestore doc, emits assetAdded)
        ▼
INSPECTOR.execute('multi', [
   ['entityupdate', { component: 'gltf-model' or 'src', value: cloudUrl }],
   ['entityupdate', { component: 'data-asset-id',         value: assetId }],
   ['entityupdate', { component: 'data-asset-owner-uid',  value: userId }],
   ['entityupdate', { component: 'data-temporary-file',   value: null   }],
], 'Upload asset to cloud')
        │  (single history entry; dirty-state machinery fires; serializer now picks up the entity)
        ▼
clearUpload(entity.id) → toast "Uploaded"
        │
        ▼ (GLB only, fire-and-forget)
captureAndUploadThumbnail(assetId, userId, cloudUrl)
        │  see "Thumbnail capture" below — galleryServiceV2.updateAsset emits
        │  'assetUpdated' so the gallery card swaps the cube placeholder
        │  for the JPEG once it lands.
```

Failure of the catch path leaves `status: 'failed'` plus the stashed `file` in the Zustand slot; the props-panel **Retry** button calls `uploadAndPlaceAsset(file, null, entity)` to re-run the same flow on the existing entity.

## Persistence model

Two persistent identity attributes are written via `EntityUpdateCommand` and serialized by `src/json-utils_1.1.js`:

- `data-asset-id` — Firestore doc id under the owner's subcollection.
- `data-asset-owner-uid` — needed because per-user owner-only Firestore rules require the path `users/{ownerUid}/assets/{assetId}` to read the doc.

The cloud URL itself lives in `gltf-model` (or `src` for images) — Firebase Storage download tokens bypass Storage rules, so anonymous viewers of a shared scene load the GLB without auth.

All other metadata (`size`, `originalFilename`, `mimeType`, etc.) is read from Firestore on demand by the `useAssetUploadStatus` hook and cached in the Zustand store (`assets[${assetId}:${ownerUid}]`).

### Transient state

In-flight upload state never touches DOM attributes, so it can't accidentally be saved. It lives in the Zustand `uploads[entity.id]` slot:

```js
{
  status: 'uploading' | 'optimizing' | 'uploaded' | 'failed' | 'local',
  progress: 0..100,
  sizeBytes,
  originalFilename,
  file        // retained while status is 'failed' so Retry can re-invoke uploadAndPlaceAsset
}
```

### Skipping placeholders on save

`getElementData` in `src/json-utils_1.1.js` returns early when an entity has `data-temporary-file` (or the existing `autocreated` class). The temp marker is set at placeholder creation and removed by the success `MultiCommand`. This also fixes a long-standing bug in the legacy `createModelFromFile` flow, where temporary-file entities were saved with dead `blob:` URLs.

The serializer also special-cases `data-asset-id` and `data-asset-owner-uid` so they round-trip through the saved JSON. `createEntityFromObj` re-applies them on load.

## Cloud Functions

### `onAssetWritten` (Firestore trigger)

- Path: `users/{userId}/assets/{assetId}` on create/update/delete.
- Maintains `users/{userId}/meta/usage.bytesUsed` as the running sum of `size` on non-deleted asset docs.
- Soft delete (`deleted: true`) and hard delete both decrement the counter — the trigger reads `before.deleted` vs `after.deleted` and computes the delta.

### `getUploadQuota` (callable HTTPS)

- Input: `{ proposedBytes }`.
- Resolves the user's plan from Firebase Auth custom claims (`PRO`, `TEAM`, `MAX`, default `FREE`).
- Returns `{ bytesUsed, planLimit, planName, allowed }` — used both as the pre-flight check before upload and as the source of truth for the storage meter in the Assets panel.

Both live in `public/functions/asset-quota.js` and are wired through `public/functions/index.js`.

### Plan limits (decimal MB / GB)

| Plan       | Limit  |
| ---------- | ------ |
| FREE       | 100 MB |
| PRO        | 5 GB   |
| TEAM / MAX | 25 GB  |

### Deploying

From inside `public/` (where `firebase.json` lives):

```bash
# Cloud Functions
firebase deploy --only functions:onAssetWritten,functions:getUploadQuota

# Security rules (per-content-type Storage caps + usage doc read rule)
firebase deploy --only firestore:rules,storage
```

Or in one shot:

```bash
firebase deploy --only \
  functions:onAssetWritten,functions:getUploadQuota,firestore:rules,storage
```

Deploy rules before functions if there's a window where the panel might call the new `users/{uid}/meta/usage` listener — otherwise the snapshot subscription errors with `permission-denied` until the new rule lands. Verify the trigger fires with `firebase functions:log --only onAssetWritten` after dropping a GLB.

## Security rules

### Firestore (`public/firestore.rules`)

- Existing `users/{userId}/assets/{assetId}` rule unchanged: owner-only read/write. The tokenized download URL is what makes anonymous-viewer access work; we don't loosen Firestore rules in v1.
- New: `users/{userId}/meta/usage` is owner-readable, write-only via Cloud Functions.

### Storage (`public/storage.rules`)

Per-content-type size caps replace the old single 50 MB ceiling:

| Content type                                         | Cap   |
| ---------------------------------------------------- | ----- |
| `image/*`                                            | 10 MB |
| `model/*` and `application/octet-stream` (GLB / PLY) | 50 MB |
| `video/*`                                            | 50 MB |

## Optimization pipeline (`src/editor/lib/asset-upload/optimizeGlb.js`)

Lazy-loaded — the heavy `gltf-transform`, `draco3dgltf`, and `meshoptimizer` modules are pulled in via dynamic `import()` only when the user actually drops a GLB.

```js
await document.transform(
  dedup(),
  instance(),
  palette(),
  flatten(),
  join(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.001 }),
  resample(),
  prune(),
  sparse(),
  textureCompress({ targetFormat: 'webp', resize: [2048, 2048] }),
  draco({ method: 'edgebreaker' })
);
```

### Webpack notes

`draco3dgltf` is a Node-targeted package; its loader files `require('fs')` and `require('path')` on the Node code path only. Two webpack config tweaks support browser bundling:

- `resolve.fallback: { fs: false, path: false }` — silences the static-analysis errors; the Node branch is unreachable in browser execution.
- `CopyWebpackPlugin` copies `draco_decoder_gltf.wasm` and `draco_encoder.wasm` from `node_modules/draco3dgltf/` into the `/dist/` output, which is where the Emscripten loader fetches them at runtime.

`textureCompress` uses gltf-transform's canvas-based fallback encoder (no `sharp` in browser). Quality / effort options are ignored; `targetFormat` and `resize` are honored.

## Thumbnail capture (`src/editor/lib/asset-upload/captureThumbnail.js`)

Same idea as `@shopify/screenshot-glb` but in the browser:

1. After an upload succeeds, `uploadAndPlaceAsset` fire-and-forgets `captureAndUploadThumbnail(assetId, ownerUid, cloudUrl)`.
2. `captureGlbThumbnail` injects a hidden iframe pointing at **`/model-viewer-screenshot.html`** with `?src=<glbUrl>&w=512&h=512`.
3. The iframe loads `model-viewer@4.2.0` from CDN, sets `loading="eager"`, waits for `poster-dismissed` + 3× `requestAnimationFrame` (Shopify's stabilisation pattern) and calls `modelViewer.toBlob({ mimeType: 'image/png', idealAspect: true })`.
4. The PNG (alpha preserved) is composited onto a fresh 2D canvas pre-filled with `#ffffff`, then exported as JPEG (`qualityArgument: 0.85`). Shopify gets the white background "for free" via puppeteer's DOM compositor; in the browser we substitute with this 2D canvas pass.
5. The blob is `postMessage`'d back to the parent.
6. Parent uploads it to `users/{ownerUid}/assets/meshes/{assetId}-thumb.jpg` via `galleryServiceV2.uploadToStorage`, then `galleryServiceV2.updateAsset(assetId, ownerUid, { thumbnailPath, thumbnailUrl })`.
7. The resulting `assetUpdated` event propagates to `useGallery` (gallery card swaps cube → JPEG) and the editor's Zustand cache.

The iframe is rendered on-screen at `position: fixed; right: 0; bottom: 0` with `opacity: 0` + `pointer-events: none` + `z-index: -1`. Off-screen positioning (`left: -9999px`) was tried first and didn't work — Chrome pauses the render loop on iframes positioned outside the parent viewport, so `poster-dismissed` never fires.

The capture is best-effort: failures are logged but never surfaced to the user — the upload itself already succeeded, missing thumbnail just keeps the cube placeholder.

## UI

### Assets panel (renamed from Gallery)

`src/editor/components/scenegraph/GalleryPanel.jsx`:

- Tab label: **Assets** (was Gallery).
- Filter tabs: All / Meshes / Images / Video.
- Upload button (file picker, accepts `FILE_PICKER_ACCEPT`).
- Storage usage row + bar — initial values from `getUploadQuota` callable, live `bytesUsed` updates from a Firestore listener on `users/{uid}/meta/usage`.
- Refresh button.
- Empty state: "Drag GLB or image files into the viewport, or click Upload."

`GalleryItem.jsx` renders a centered cube SVG (`MeshPlaceholder`) for `type === 'mesh'` items without a `thumbnailUrl`, instead of the GLB rendering as a broken `<img>`.

### Per-entity status

- **Properties panel** — `<AssetUploadStatus>` (`src/editor/components/elements/AssetUploadStatus.jsx`) renders a colored pill: status text, progress percent, asset source (`your cloud` / `not owned by you`), assetId snippet, original filename. Retry button shown only on `status === 'failed'`. A **Details** button on uploaded entities opens `MeshDetailsModal`.
- **Layers panel** — `<AssetUploadDot>` (next to each entity name) shows a small colored dot keyed to status.

Both consume `useAssetUploadStatus(entity)`, which:

1. Subscribes to Zustand `uploads[entity.id]` for in-flight state.
2. Reads `data-asset-id` + `data-asset-owner-uid` via a `MutationObserver` (only those two persistent attrs are watched).
3. Triggers `ensureAsset(assetId, ownerUid)` to fetch the Firestore doc into the Zustand `assets` cache.
4. Returns a merged shape; Firestore data wins for `sizeBytes` / `originalFilename` / `name` / `type` once cached.

Status colors live in a single shared `STATUS_LABELS` constant exported from the hook file.

### Mesh details modal

`MeshDetailsModal.jsx` (in `src/shared/gallery/components/`) opens from either a mesh card click in the Assets panel or the **Details** button on `AssetUploadStatus`. Features:

- 3D preview via `<model-viewer>` hosted in a sandboxed iframe (`public/model-viewer.html`) so its bundled THREE doesn't collide with A-Frame's `window.THREE`. The iframe loads `model-viewer@4.2.0` from CDN.
- Editable display name (saved via `galleryServiceV2.updateAsset` → emits `assetUpdated` → editor cache + gallery list refresh via event listeners).
- Read-only metadata: file, size, MIME, uploaded-at, asset ID, owner.
- Icon-only **Download** and **Delete** actions with radix tooltips. Delete is owner-only and does a soft delete (`assetDeleted` event fires with `{size}` so the storage meter shrinks optimistically).

### Drag mesh / image cards into the viewport

Mirror of the AddLayer card flow:

- `GalleryItem` cards become `draggable` only when the host opts in via `placeable` (the editor's `GalleryPanel` passes it; the generator's standalone gallery does not).
- `dragStart` writes a custom MIME `application/x-3dstreet-asset` with `{ assetId, ownerUid, storageUrl, name, type }` and suppresses the default ghost via the same empty-gif trick used by AddLayer.
- `AddLayerPanel`'s global `dragover` fades the drop plane in for either `Files` or `application/x-3dstreet-asset`.
- `AddLayerPanel`'s global `drop` reads the MIME, parses the payload, picks the ground point, and calls `placeCloudAsset(asset, position)` (also exported from `uploadAndPlaceAsset.js`) — a plain `entitycreate` with the cloud URL + `data-asset-id` + `data-asset-owner-uid` + `data-layer-name = asset.name`. No upload, no `data-temporary-file` marker.

### Imports

- File menu → **Import…** (above Export) — multi-file picker.
- Assets panel → **Upload** button (same picker).
- Drag-drop file onto viewport — global handler in `AddLayerPanel.component.jsx`.

All three call `uploadAndPlaceAsset(file, position?)` directly (static imports; only `optimizeGlb` is dynamically imported).

## Delete behavior

`useGallery.removeItem` calls `galleryServiceV2.deleteAsset(id, userId, false)` — soft delete. The Firestore doc is marked `deleted: true`; the Storage object stays.

- The `assetDeleted` event payload includes `size` (read from the doc before the delete) so the storage meter in `GalleryPanel` can subtract optimistically — no lag waiting on the Cloud Function trigger + Firestore listener round-trip.
- `useGallery` listens for `assetDeleted` and `assetUpdated` and updates the list (drop / patch) without a refetch. The editor's `assetUploadStore` listens too and keeps the SceneGraph row, props pill, and layer dot in sync via `patchAsset` / `dropAsset`.
- `onAssetWritten` decrements `bytesUsed` server-side (the trigger treats `deleted: true` the same as a removed doc when summing).
- Scenes still referencing the tokenized download URL keep working — Firebase Storage tokens don't auto-invalidate when the Firestore doc flips. Effective deletion across saved scenes lands when the resolver Cloud Function ships.

## Known limitations

| Limitation                                             | Mitigation / future                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foreign-asset metadata not readable (Firestore rule)   | Hook degrades silently; pill shows "not owned by you" without size/filename. Resolver Cloud Function lifts this constraint when shipped.                      |
| Soft-deleted assets keep serving via the tokenized URL | Quota frees immediately, but scenes embedding the URL still load the file until the resolver is in place. Acceptable for v1; revisit when the resolver lands. |
| Undo of `entitycreate` while upload is in-flight       | Entity removed from scene; upload proceeds in background and creates an orphan asset doc in the gallery. No data loss but visible artifact.                   |
| No real-time progress chip outside the selected entity | Drop several files at once and only the selected entity shows progress. Acceptable for v1; add a global progress badge if it becomes painful.                 |

## Key files

### New

- `src/editor/lib/asset-upload/optimizeGlb.js` — gltf-transform pipeline.
- `src/editor/lib/asset-upload/uploadAndPlaceAsset.js` — drop-flow orchestrator + `placeCloudAsset` (drag-from-card).
- `src/editor/lib/asset-upload/captureThumbnail.js` — client-side thumbnail capture (iframe + post-upload write).
- `public/model-viewer-screenshot.html` — standalone iframe page for the thumbnail capture (model-viewer + PNG → composite onto white → JPEG).
- `src/editor/state/assetUploadStore.js` — Zustand: in-flight uploads + asset metadata cache + `galleryServiceV2` event listeners that patch / drop cache entries.
- `src/editor/components/elements/useAssetUploadStatus.js` — hook merging in-flight slot + persistent attrs + Firestore cache; exports `STATUS_LABELS`.
- `src/editor/components/elements/AssetUploadStatus.jsx` — props-panel status pill + Retry + Details button.
- `src/editor/components/elements/AssetUploadDot.jsx` — layers-panel status dot.
- `src/editor/components/scenegraph/EntityLabel.jsx` — replaces `printEntity`; renders icon + name (asset-aware) for SceneGraph row, ViewportHUD, and props panel header.
- `src/shared/gallery/components/MeshDetailsModal.jsx` + `.module.scss` — mesh details modal (model-viewer iframe, editable name, Download / Delete).
- `src/shared/gallery/utils.js` — `formatBytes`, `formatDate` (reused by panel, modal, status pill).
- `public/model-viewer.html` — sandboxed iframe page; loads `model-viewer@4.2.0` from CDN.
- `public/functions/asset-quota.js` — `onAssetWritten` + `getUploadQuota`.

### Modified

- `src/editor/components/elements/AddLayerPanel/AddLayerPanel.component.jsx` — global drop handler routes to `uploadAndPlaceAsset` (file drop) and `placeCloudAsset` (gallery-card drop via `application/x-3dstreet-asset` MIME).
- `src/editor/components/elements/AddLayerPanel/createLayerFunctions.js` — removed legacy `createModelFromFile`.
- `src/editor/components/elements/ComponentsContainer.jsx` — removed legacy "Temporary Model" warning panel (replaced by the status pill / dot).
- `src/editor/components/elements/Sidebar.jsx` — props panel header uses `<EntityLabel />`; renders `<AssetUploadStatus />`.
- `src/editor/components/scenegraph/Entity.jsx` — uses `<EntityLabel />` + `<AssetUploadDot />`.
- `src/editor/components/viewport/ViewportHUD.js` — uses `<EntityLabel />`.
- `src/editor/components/scenegraph/GalleryPanel.jsx` + `.module.scss` — Assets panel rename + filters + upload + storage meter (optimistic shrink on `assetDeleted`) + `placeable` enabled.
- `src/editor/components/scenegraph/SceneGraph.jsx` — tab label "Gallery" → "Assets".
- `src/editor/components/scenegraph/AppMenu.jsx` — File > Import… entry.
- `src/editor/lib/entity.js` — `printEntity` removed; `getEntityDisplayName` formats kebab/snake mixin fallback, prefers mixin over class.
- `src/json-utils_1.1.js` — serializer special-cases for `data-asset-id`, `data-asset-owner-uid`, and the `data-temporary-file` skip.
- `src/shared/gallery/components/GalleryItem.jsx` + `Gallery.module.scss` — asset name as card label, mesh placeholder cube, "Model" type label, drag-from-card (`placeable` prop).
- `src/shared/gallery/components/GalleryContent.jsx` / `GalleryGrid.jsx` — forward `placeable`; route mesh-item clicks to `MeshDetailsModal`.
- `src/shared/gallery/components/GalleryModal.jsx` — uses `@shared/icons` `TrashIcon`.
- `src/shared/gallery/hooks/useGallery.js` — soft delete on `removeItem`; listens for `assetUpdated` / `assetDeleted` to keep the list in sync without refetch; exposes `name` on display items.
- `src/shared/gallery/services/galleryServiceV2.js` — `addAsset` writes `name`; `updateAsset` / `deleteAsset` events enriched with `userId` + `updates` / `size`.
- `src/shared/icons/icons.jsx` — `TrashIcon` + `DownloadIcon` use `stroke="currentColor"` / `fill="currentColor"` so callers control color via CSS.
- `public/firestore.rules` — usage doc read rule.
- `public/storage.rules` — per-content-type size caps.
- `public/functions/index.js` — exports `onAssetWritten` and `getUploadQuota`.
- `webpack.config.js` — `fs` / `path` fallbacks; copy Draco WASM blobs to `/dist/`.
