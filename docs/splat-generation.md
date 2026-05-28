# Splat Generation (Generator → Scene)

This document describes the **Splat** feature in the AI Generator: turning
photos into 3D Gaussian Splats that can be placed into a 3DStreet scene.

## v1 — SHARP single image → splat (shipped)

**Flow:** Generator "Splat" tab → upload one image → `generateReplicateSplat`
Cloud Function → SHARP (`kfarr/sharp-ml`) on Replicate → `.ply` → saved to the
user's gallery as an `ASSET_TYPES.SPLAT` / `SPLAT_OUTPUT` asset → draggable into
a scene from the editor's Assets panel (same as a mesh).

**Why synchronous:** SHARP completes in ~4 minutes on a Replicate T4, which fits
inside the callable timeout. So v1 reuses the existing "await the callable"
pattern (identical to image generation) — no job queue required.

**Cost:** 1 `genToken`. The authoritative charge is server-side
(`REPLICATE_MODELS['sharp-ml'].tokenCost`), deducted in an atomic Firestore
transaction only after a successful generation, mirroring image/video.

### Key files

| Concern | File |
| --- | --- |
| Generator tab UI + flow | `src/generator/splat.js` |
| Tab registration | `src/generator/index.js`, `public/generator/index.html`, `src/generator/main.js` |
| Cloud Function | `public/functions/replicate.js` (`generateReplicateSplat`) |
| Model config | `public/functions/replicate-models.js` (`sharp-ml`) |
| Splat asset persistence (MIME/ext, octet-stream rewrap) | `src/shared/assets/services/assetsService.js` |
| Splat support in upload kinds | `src/shared/asset-upload/uploadAsset.js` |
| Editor drop / gallery placement | `src/editor/lib/asset-upload/uploadAndPlaceAsset.js` |
| Gallery card rendering (placeholder, draggable) | `src/shared/assets/components/AssetsItem.jsx` |
| Splat rendering (existing) | `src/aframe-components/splat.js` (Spark) |
| Live splat viewer (iframe) | `public/splat-viewer.html` |

### Live preview

`public/splat-viewer.html` is a standalone, self-contained Spark viewer
(mirrors `public/model-viewer.html` for GLB): it takes `?src=<splatUrl>`,
loads three.js + Spark from a pinned CDN via an import map, renders the splat
with `OrbitControls`, and auto-frames the camera to the splat's bounding box.
It's hosted in its own document so its THREE copy doesn't collide with the
editor's `window.THREE` (set by A-Frame).

It's embedded as an `<iframe>` in two places:
- the Generator's Splat tab result panel (live preview of the just-generated
  splat), and
- the gallery details modal (`MeshDetailsModal`, which now serves both meshes
  and splats and picks the viewer page + type label by asset type).

### Deploying v1

- **Rules:** `firestore.rules` unchanged (`type: 'splat'` already allowed).
  `storage.rules` **does** change — the `application/octet-stream` cap is
  raised from 50 MB → 100 MB so generated `.ply` splats (which can be ~66 MB
  uncompressed) can be saved. Deploy with
  `firebase deploy --only storage` (or include it in a combined deploy).
- **Cloud Functions:** required — the new `generateReplicateSplat` callable.
  Note the `npm run deploy` / `deploy:staging` scripts are **hosting-only**, so
  the function must be deployed separately:
  `cd public && firebase use <project> && firebase deploy --only functions:generateReplicateSplat`.
- **Hosting:** required — generator bundle, `public/generator/index.html`,
  `public/splat-viewer.html` (covered by `npm run deploy[:staging]`).
- **Secrets:** none new — reuses `REPLICATE_API_TOKEN` and
  `ALLOWED_PRO_TEAM_DOMAINS`, already set for image generation.

### Notes / constraints
- Splats render via the existing `splat` A-Frame component (Spark). The entity
  uses `splat="src: <url>"` (a **bare** `src:`, no `url()` wrapper — unlike
  `gltf-model`). `placeCloudAsset` / the upload swap branch on asset type to
  emit the right component.
- Splats upload as `application/octet-stream`. Two different limits apply on
  purpose: `storage.rules` allows up to **100 MB** (the server ceiling, so
  large *generated* splats save), while **user drag-and-drop uploads** are
  capped at **50 MB** client-side (`SPLAT_MAX_BYTES`). The generator save path
  (`assetsService.addAsset`) isn't subject to the client cap, so generated
  `.ply` files up to 100 MB are allowed. Browsers rarely set a `File.type` for
  `.ply`/`.splat`/`.spz`, so `assetsService.addAsset` re-wraps the blob with an
  explicit octet-stream content type before upload.
- **Future:** SHARP emits uncompressed `.ply`. Converting to a compressed
  format (`.spz`/`.ksplat`) — client- or server-side — would cut size by ~5–10×
  and is the cleaner long-term fix for the size ceiling; tracked for a
  follow-up rather than v1.
- The stored file extension is taken from the source filename
  (`.ply`/`.splat`/`.spz`/`.rad`), defaulting to `.ply`, because the `splat`
  component selects its loader by extension.
- **CORS:** the `splat` component cannot load GitHub raw URLs. Firebase Storage
  download URLs (our generated/uploaded splats) are fine.
- No client-side thumbnail for splats — gallery cards show a point-cloud icon
  placeholder (like meshes).

## v2 — Teleport / Varjo photogrammetry (designed, not built)

Teleport processes a **zip of images** or a **video** into a splat via an
asynchronous cloud pipeline (minutes-to-hours), so it needs real job tracking
rather than a blocking call. Build is deferred until we have Teleport API
keys + billing. The design below is provider-agnostic so vid2scene / splatica
can drop in later as additional providers.

### Three problems to solve

1. **Large source files.** A zip/video is too big to base64 through a callable
   (~10–32 MB limit). The client uploads directly to **Firebase Storage**
   (resumable upload, progress UI) under a `splat-source` area and passes the
   **storage path** to the backend — never the bytes.

2. **Cost estimation + approval.** Scan client-side *before* upload:
   - zip → count images (read the zip central directory, e.g. JSZip)
   - video → duration via `<video>.duration` (and fps)

   Estimate `$1.00 + $0.01 × max(images, video_seconds × 2)`, convert to tokens
   (`/ 0.10 × 2` per current token economics → a 1-min video ≈ **44 tokens**),
   and show an approval modal / inline estimate. On submit, **hold** the
   estimated tokens and reconcile to the actual count on completion (refund the
   overage).

3. **Server-tracked async jobs.** A Firestore `splatJobs/{jobId}` state machine:
   `pending → uploading → submitted → processing → succeeded | failed`, storing
   provider, provider capture/job id, owner uid, estimated/actual cost, and the
   resulting asset id. Lifecycle:
   - `createSplatJob` (callable): validate + hold tokens, create the job doc,
     start the Teleport multipart upload (create capture → presigned S3 part
     URLs → upload parts → mark complete → submit for processing).
   - Status via **Teleport webhooks** into an `onRequest` handler, with a
     **scheduled reconciler** (PubSub, like `reconcileAssetUsage`) as a polling
     fallback for providers without reliable webhooks.
   - On success: download the splat → store as a `splat-output` asset →
     finalize the token charge → notify the UI (a "Jobs" list in the generator
     so users can close the tab and return).

### Teleport API shape (reference)

- Auth: API key.
- Upload: AWS S3 multipart (create capture → request presigned part URLs →
  upload parts → notify complete). Capture exposes a `state` field.
- Pricing (per current understanding): `$1.00` base + `$0.01` per image or per
  ½-second of video.
- Output: a Gaussian Splat.

Docs: <https://teleport.varjo.com/docs/> (API spec, upload-captures,
manage-captures, authentication).
