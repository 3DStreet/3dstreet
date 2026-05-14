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
- Server-side `screenshot-glb` thumbnail generation. Mesh items render a placeholder cube SVG until thumbnails arrive.
- `shortName` / programmatic asset access for the StreetPlan integration.
- Server-side optimization pipeline (`functions-pipeline` codebase).

## Data model

Unchanged from the existing gallery system:

| Layer     | Path                                                           |
| --------- | -------------------------------------------------------------- |
| Firestore | `users/{userId}/assets/{assetId}`                              |
| Storage   | `users/{userId}/assets/{meshes\|images\|videos}/{assetId}.ext` |
| Quota doc | `users/{userId}/meta/usage` (managed by Cloud Function)        |

Asset doc fields used by uploads: `assetId`, `userId`, `type` (`mesh` / `image`), `category` (`upload`), `storagePath`, `storageUrl`, `filename`, `originalFilename`, `size`, `mimeType`, `deleted`, timestamps.

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

- **Properties panel** — `<AssetUploadStatus>` (`src/editor/components/elements/AssetUploadStatus.jsx`) renders a colored pill: status text, progress percent, asset source (`your cloud` / `not owned by you`), assetId snippet, original filename. Retry button shown only on `status === 'failed'`.
- **Layers panel** — `<AssetUploadDot>` (next to each entity name) shows a small colored dot keyed to status.

Both consume `useAssetUploadStatus(entity)`, which:

1. Subscribes to Zustand `uploads[entity.id]` for in-flight state.
2. Reads `data-asset-id` + `data-asset-owner-uid` via a `MutationObserver` (only those two persistent attrs are watched).
3. Triggers `ensureAsset(assetId, ownerUid)` to fetch the Firestore doc into the Zustand `assets` cache.
4. Returns a merged shape; Firestore data wins for `sizeBytes` / `originalFilename` once cached.

Status colors live in a single shared `STATUS_LABELS` constant exported from the hook file.

### Imports

- File menu → **Import…** (above Export) — multi-file picker.
- Assets panel → **Upload** button (same picker).
- Drag-drop onto viewport — global handler in `AddLayerPanel.component.jsx`.

All three call `uploadAndPlaceAsset(file, position?)` directly (static imports; only `optimizeGlb` is dynamically imported).

## Delete behavior

`useGallery.removeItem` calls `galleryServiceV2.deleteAsset(id, userId, false)` — soft delete. The Firestore doc is marked `deleted: true`; the Storage object stays.

- `onAssetWritten` decrements `bytesUsed` immediately (the trigger treats `deleted: true` the same as a removed doc when summing).
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

- `src/editor/lib/asset-upload/optimizeGlb.js`
- `src/editor/lib/asset-upload/uploadAndPlaceAsset.js`
- `src/editor/state/assetUploadStore.js`
- `src/editor/components/elements/useAssetUploadStatus.js`
- `src/editor/components/elements/AssetUploadStatus.jsx`
- `src/editor/components/elements/AssetUploadDot.jsx`
- `public/functions/asset-quota.js`

### Modified

- `src/editor/components/elements/AddLayerPanel/AddLayerPanel.component.jsx` — global drop handler routes to `uploadAndPlaceAsset`.
- `src/editor/components/elements/AddLayerPanel/createLayerFunctions.js` — removed legacy `createModelFromFile`.
- `src/editor/components/elements/ComponentsContainer.jsx` — removed legacy "Temporary Model" warning panel (replaced by the status pill / dot).
- `src/editor/components/elements/Sidebar.jsx` — renders `<AssetUploadStatus />`.
- `src/editor/components/scenegraph/Entity.jsx` — renders `<AssetUploadDot />` next to layer names.
- `src/editor/components/scenegraph/GalleryPanel.jsx` + `.module.scss` — Assets panel rename + filters + upload + storage meter.
- `src/editor/components/scenegraph/SceneGraph.jsx` — tab label "Gallery" → "Assets".
- `src/editor/components/scenegraph/AppMenu.jsx` — File > Import… entry.
- `src/json-utils_1.1.js` — serializer special-cases for `data-asset-id`, `data-asset-owner-uid`, and the `data-temporary-file` skip.
- `src/shared/gallery/components/GalleryItem.jsx` + `Gallery.module.scss` — mesh placeholder, "Model" type label.
- `src/shared/gallery/hooks/useGallery.js` — soft delete on `removeItem`.
- `public/firestore.rules` — usage doc read rule.
- `public/storage.rules` — per-content-type size caps.
- `public/functions/index.js` — exports `onAssetWritten` and `getUploadQuota`.
- `webpack.config.js` — `fs` / `path` fallbacks; copy Draco WASM blobs to `/dist/`.

# Remaining to do

- [ ] create model thumbnail client side
- [ ] drag and drop from assets panel
