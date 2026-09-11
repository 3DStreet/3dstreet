# User Asset Upload

[Back to the codebase guide](../../CLAUDE.md). Source paths start at the
repository root; bare filenames name modules within this subsystem.

Drag-and-drop GLB/image upload with client-side optimization, cloud persistence, quota enforcement, and per-entity status UI.

**Persistence — two identity attributes written to saved JSON:**

- `data-asset-id` — Firestore doc id under the owner's subcollection
- `data-asset-owner-uid` — needed to reconstruct the owner-only Firestore path (`users/{ownerUid}/assets/{assetId}`) without auth context (e.g. for anonymous viewers)

The cloud URL lives in `gltf-model` / `src`. Firebase Storage download tokens allow anonymous viewers to load the file without Firestore access.

**`data-temporary-file` sentinel:** placeholder entities carrying a transient `blob:` URL are marked with this attribute; the scene serializer (`src/json-utils_1.1.js`) skips them. Removed by `src/editor/lib/asset-upload/uploadAndPlaceAsset.js` on success.

**All other metadata** (`size`, `originalFilename`, etc.) lives in Firestore and is fetched on demand — never saved in the scene JSON.

**Cloud Functions:**

- `onAssetWritten` — Firestore trigger, maintains `users/{uid}/meta/usage.bytesUsed` via transaction. Only `size` (original) counts toward quota; `optimizedSourceSize` is excluded (platform cost).
- `getUploadQuota` — callable, reads plan via `getAuth().getUser(uid)` (Admin SDK, always fresh custom claims). Returns `{ bytesUsed, planLimit, planName, allowed }`.

**Plan limits (decimal):** total storage FREE 100 MB · PRO 5 GB · MAX 25 GB (reserved; no users today). Per-file caps are plan-scaled and type-agnostic (`MAX_FILE_BYTES_BY_PLAN` in `public/functions/asset-quota.js`, surfaced as `getUploadQuota().perFileLimit`): FREE 100 MB · PRO 1 GB · MAX 5 GB. Soft-enforced client-side + preflight; `public/storage.rules` holds a flat 5 GB hard ceiling.

**Security rules:**

- `size`, `storagePath`, `optimizedSourcePath`, `userId` immutable after create — prevents quota spoofing
- Client hard-delete (`deleteDoc`) disallowed; UI soft-deletes (`deleted: true`); GC Cloud Function purges via Admin SDK
- `users/{uid}/meta/usage` owner-readable, write-only via Cloud Functions
