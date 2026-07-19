# Cloud asset processing pipeline (thumbnails + optimized variants)

Design + rollout plan for #1643, a fast-follow to #1639 (user asset upload).
Post-upload, every gallery asset should end up with (a) a small, cheap
**thumbnail** for grid cards, and (b) where it pays off, an **optimized
display variant** served in place of the original.

## Rollout ordering

Phases are ordered so that each one reuses the machinery of the previous one.
The key observation: every asset type's thumbnail problem reduces to *"produce
a source image, then run it through the shared image-optimize pass"* — so the
image pass ships first and everything else feeds it.

| Phase | Asset type | Poster / thumbnail | Optimized variant | Status |
| ----- | ---------- | ------------------ | ----------------- | ------ |
| 1 | **Image** | sharp → 512px WebP thumb (replaces client canvas JPEG) | sharp → ≤2048px high-compression WebP, served via `optimizedSourceUrl` | this PR |
| 2 | **Video** | server-side poster frame (ffmpeg) → phase-1 image pass | poster *is* the optimized image; video transcode explicitly out of scope | next |
| 3 | **Mesh (GLB)** | client model-viewer capture already exists → normalize through phase-1 pass; server-side headless render only as backfill | heavy KTX2/Meshopt GLB optimize = separate Cloud Run track (rad-converter pattern), decoupled from this ordering | later |
| 4 | **Splat** | client Spark capture at upload (same trick as GLB) → phase-1 pass; server render TBD | already shipped: RAD/LOD via `onSplatAssetCreated` → Cloud Run | later |

Why this order:

1. **Images first** — smallest job (sharp in a Cloud Function, seconds per
   asset), and it's where the pipeline *scaffolding* lands: the
   `processingState` field contract, the lease/claim transaction, and the
   reaper. Every later phase is "new poster producer + existing pipeline".
   Server-side is required, not a nicety: job-queue results (Veo/Kling videos,
   SHARP splats) are saved to the gallery **server-side with no client
   attached**, so a client-only approach can never cover them.
2. **Video posters second** — videos currently have *no* thumbnail at all
   (gallery cards embed the `<video>` element), so this is the biggest visible
   win. Server-side ffmpeg first, because the primary video creation path is
   the server-side job processor (closed-tab saves — the whole point of the
   job queue). Client-side mediabunny remains an optional instant-feedback
   fast path later; it can never be the only path.
3. **Mesh posters third** — lowest urgency because a decent client capture
   already exists (`captureThumbnail.js`); enrolling meshes is then just
   adding `'mesh'` to the pipeline's handled types and re-running the phase-1
   image pass over the captured thumb. Server-side mesh rendering (headless
   model-viewer / puppeteer in Cloud Run) is the most infra-heavy poster
   producer, so it waits until it's just backfill for missed client captures.
   The *other* mesh item from #1643 — server-side high-compression GLB
   optimization (KTX2, Draco/Meshopt at higher settings, swap
   `optimizedSourcePath`) — is a separate Cloud Run track mirroring
   rad-converter, and doesn't block or gate the poster phases.
4. **Splats last** — the optimized variant already exists (RAD pipeline);
   only the poster is missing, and rendering a splat needs either a client
   Spark capture (cheap, do first) or a GPU-ish server render (TBD once
   format choices stabilize).

## Architecture

Event-driven + reaper, not pure polling:

```
asset doc written (client upload OR server-side gallery save)
  └─ processAssetOnWrite (Firestore trigger, asset-processing.js)
       ├─ eligible + unclaimed? → transactional lease claim
       ├─ process inline (phase 1: sharp — fast enough for a Function)
       └─ write variants + processingState:'done' (or retry/failed)

asset-processing reaper (scheduled, every 10 min)
  ├─ expired leases (crashed/timed-out worker) → re-claim + re-process
  ├─ pending retries whose backoff elapsed     → re-claim + re-process
  └─ recent creations the trigger missed        → enroll + process
```

- **Locking**: Firestore transaction on `leaseExpiresAt`. `leaseExpiresAt`
  doubles as a *not-before* time on `pending` retries, so one composite index
  `(processingState, leaseExpiresAt)` serves the whole reaper query.
- **Cloud Tasks / Cloud Run**: deliberately NOT used in phase 1 — sharp on an
  image is seconds of work, inline in the trigger is simpler and has fewer
  moving parts. Heavier work (GLB optimize, possibly ffmpeg) reuses the
  proven Cloud Tasks → Cloud Run dispatch from `rad-dispatch.js` when its
  phase lands.
- **Idempotent by construction**: variant filenames are keyed on `assetId`
  (`{assetId}-thumb.webp`, `{assetId}-optimized.webp`), so a duplicate run
  overwrites the same objects and re-patches the same doc.

## Asset doc field contract

| Field | Meaning |
| ----- | ------- |
| `processingState` | `pending` \| `running` \| `done` \| `failed` (terminal) |
| `processingAttempts` | attempt counter; `failed` once `MAX_ATTEMPTS` reached |
| `leaseExpiresAt` | lease deadline while `running`; earliest-retry time while `pending`; cleared on terminal states |
| `processingVersion` | pipeline version that produced the variants — bump `PROCESSING_VERSION` to make touched assets reprocess |
| `processedAt` | server timestamp of last successful run |
| `processingError` | last error message (retry/failed paths) |
| `processingSkipped` | reason variants were intentionally not produced (e.g. `source_too_large`) — still `done` |
| `thumbnailPath` / `thumbnailUrl` | generated thumbnail (all types eventually) |
| `optimizedSourcePath` / `optimizedSourceUrl` / `optimizedSourceSize` | optimized display variant — same contract GLB client optimization already uses; `getServedUrl()` prefers it automatically |

Legacy assets (created before the pipeline) are enrolled lazily: any doc
touch (rename, re-save) fires the trigger and processes them. A bulk backfill
can later be a `dryRun=false` mode on the admin manual trigger.

## Quota accounting

Unchanged rule, inherited automatically: `onAssetWritten` sums only `size`
(the original upload). All generated variants are platform-derived artifacts —
stored with `customMetadata.assetRole = 'thumbnail' | 'optimized'`, sizes kept
in fields other than `size` — so they never count toward user quota.

## Serving behavior change (phase 1)

`getServedUrl()` (`optimizedSourceUrl ?? storageUrl`) previously only ever
found `optimizedSourceUrl` on GLBs. Images now get one too (≤2048px WebP), so
placed image entities and scene loads serve the optimized variant
automatically. Downloads intentionally keep using `storageUrl` (the original)
— see `downloadItem` in `useAssets.js`.

## Open questions carried forward

- Video posters: exact ffmpeg runtime (Function w/ ffmpeg-static vs Cloud
  Run) — decide when phase 2 starts, based on memory profile of real uploads.
- Mesh: rendered server-side preview (offscreen render) — only as backfill;
  measure how often client capture actually fails before building it.
- Splat poster: client Spark capture first; server render TBD.
