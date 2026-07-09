# Generation Job Queue (Async AI Jobs)

A provider-agnostic system for **long-running AI generations** (image → splat,
image, video, photogrammetry) that:

- survive a **closed browser** (completion happens server-side),
- complete via a **provider-appropriate completion model** — all idempotent and
  all backstopped by the same scheduled reconciler, so no single delivery failure
  loses a job,
- charge tokens on submit and **refund exactly once** on failure (or never charge,
  for silent backend jobs),
- **notify by email** when a job finishes while the tab is closed (opt-in,
  default on; suppressed if a live tab acked the result — see Phase 4 below).

**Four providers exist today**, and they prove the schema generalizes beyond a
single completion shape:

| Provider | Kind(s) | Completion model | Tokens |
| --- | --- | --- | --- |
| `replicate` | `splat` (image→splat, SHARP), `video` (image→video, Veo/Kling/LTX/…), `image` (nano-banana/seedream/kontext) | **convergent**: provider webhook + client poll + reconciler all funnel into one idempotent processor | charged on submit, refunded once on failure |
| `modal` | `splat` (video→splat, vid2scene tiers) | convergent, like replicate (status endpoint + staged-output existence check) | charged on submit, refunded once on failure |
| `fal` | `mesh` (image→3D GLB, Hunyuan3D/TRELLIS), `image` (flux-2 edit family) | **convergent** since #1832: `fal_webhook` + client poll + reconciler via one authoritative status adapter (`fetchFalPrediction`) | charged on submit, refunded once on failure |
| `cloudrun` | `splat-rad` (.ply→RAD/LOD) | **worker-writeback**: the Cloud Run worker writes its own terminal status; reconciler re-enqueues a stalled task (no external state to poll) | **`tokenCost: 0`** — silent backend optimization, never charges |

With image migrated (#1835) every user-initiated generation kind is on the
queue; Teleport/Varjo photogrammetry can drop in as an additional **kind** and
**provider** without re-architecting.

> **Naming note:** this document was previously `splat-generation.md`. Splat is
> now one consumer of the queue, not the headline.

---

## Current state — Splat v1 (image → splat), on the generic schema

**Flow:** Generator "Splat" tab → upload one image → `generateReplicateSplat`
Cloud Function writes a **pending `generationJobs` doc**, creates a Replicate
prediction (with a webhook), and **returns the internal `jobId` immediately** →
SHARP (`kfarr/sharp-ml`) runs on Replicate → on completion the webhook (or a
client poll) downloads the `.ply` and saves it **server-side** to the user's
gallery as an `ASSET_TYPES.SPLAT` / `SPLAT_OUTPUT` asset → draggable into a
scene from the editor's Assets panel (same as a mesh).

Phase 0 (the durable-contract groundwork below) is **implemented**: the queue
already uses the generalized collection, internal `jobId`, normalized status
vocabulary, and generic callable/webhook names, even though splat is the only
consumer today.

**Why async:** SHARP can sit in a cold-boot queue for minutes. Holding the
callable connection open that long gets it dropped, surfacing as a spurious
client error even when the job succeeds. So we create-and-return, and completion
is browser-independent.

**Cost:** 1 `genToken`, charged server-side on submit
(`REPLICATE_MODELS['sharp-ml'].tokenCost`) in an atomic transaction, refunded
once if Replicate later reports failure.

### Completion model (the part that generalizes)

Two convergent paths, both funneling into one **idempotent** processor
(`processTerminalPrediction`):

1. **Replicate webhook** (`replicateJobWebhook`) — fires on completion; makes
   the result land even if the tab is closed. One endpoint for all Replicate
   kinds.
2. **Client poll** (`getGenerationJobStatus`) — drives live UI while the tab is
   open and is a fallback if webhook delivery fails. Polls by `jobId`.

The processor claims the save via a transactional `status → 'saving'` flip so a
webhook/poll race can't double-save or double-charge. The claim is
**time-bounded** (`savingStartedAt` + `SAVING_CLAIM_TTL_MS`, 3 min): a save that
is killed mid-flight (e.g. the process is terminated) never runs its release, so
without a TTL the job would wedge in `saving` forever — a stale claim is
re-takeable. The webhook body is never trusted: both paths re-fetch the
prediction from Replicate authoritatively (keyed on the stored `providerJobId`),
and the endpoint is gated on `uid` + `jobId` + a per-job `webhookSecret`.

The persist itself (`saveSplatToGallery`) **streams** the `.ply` from Replicate's
(short-lived) CDN URL straight into the Storage write stream — it does not buffer
the file via `arrayBuffer()`/`Buffer`. Memory stays flat regardless of splat
size; the functions run at 512 MB as fixed cold-start headroom, not sized to the
file. (An earlier buffered version OOM'd at 256 MB on a ~70 MB splat, and because
the OOM killed the process mid-save the claim never released — which is what the
TTL above now recovers from.)

**Known gap (closed in Phase 1):** if the webhook never arrives *and* the tab is
closed, nothing finishes the job — token stays charged, splat never saved. There
is currently no scheduled reconciler backstop. (This bit us in practice: jobs
whose save OOM'd sat in `saving` with no retrigger; the TTL makes them
*recoverable*, but only the reconciler will actually *re-trigger* them.)

### As-built specifics (as implemented)

- **Collection:** `users/{uid}/generationJobs/{jobId}`. The doc id is an internal
  **uuid `jobId`**; the Replicate prediction id is the `providerJobId` field. The
  `pending` doc (`status: 'queued'`) is written **before** submit, so a crash
  mid-submit leaves a visible, reconcilable row.
- **Functions:** `generateReplicateSplat` (splat-specific submit, 120s timeout,
  create-and-return), `getGenerationJobStatus` (generic poll callable, by
  `jobId`, 512 MB), `replicateJobWebhook` (`onRequest`, one endpoint for all
  Replicate kinds, `webhook_events_filter: ['completed']`, 512 MB).
- **Status:** normalized enum `queued | running | saving | succeeded | failed |
  canceled` (`normalizeReplicateStatus` maps the raw Replicate strings); the raw
  value is kept in `providerStatus`. `saving` is an internal save-claim, not a
  provider status.
- **Job fields:** `kind: 'splat'`, `provider: 'replicate'`, `providerJobId`,
  `tokenCost` / `tokenCharged` / `refunded`, `webhookSecret`, `tempFilePath`,
  `originalFilename` / `assetName`.
- **Charge order:** write pending doc → create prediction (mark `failed` on
  error) → charge in a transaction (cancel prediction + mark `failed` on error)
  → promote to live status + record `providerJobId`.
- **Idempotency / refund:** `processTerminalPrediction` claims via `status →
  'saving'` (time-bounded by `savingStartedAt` + `SAVING_CLAIM_TTL_MS` so a
  crashed save self-heals); `refundSplatToken` refunds once, guarded by
  `refunded`.
- **Persist (streamed):** `saveSplatToGallery` pipes Replicate's CDN response
  into `file.createWriteStream()` (resumable/chunked) and reads `size` back via
  `getMetadata()` — no full-file buffering, so memory is independent of splat
  size.
- **Webhook URL:** `?jobId=&uid=&token=`; region from `process.env.FUNCTION_REGION`
  (no hardcoded `us-central1`).
- **Rules:** `firestore.rules` now has explicit
  `match /users/{uid}/generationJobs/{jobId} { allow read, write: if false; }`
  (Admin-SDK only; protects `webhookSecret`).
- **Client (`splat.js`):** submit → `tokenCountChanged` → `setTimeout` poll loop
  (3s, 15min ceiling) → on success refreshes the gallery via `assets:refresh`.
  The old client-side `saveToGallery` is gone; the server owns persistence.

### Key files (current)

| Concern | File |
| --- | --- |
| Generator tab UI + poll loop | `src/generator/splat.js` |
| Cloud Functions (submit / poll / webhook / idempotent processor) | `public/functions/replicate.js` |
| Job-doc lockdown | `public/firestore.rules` (`generationJobs`) |
| Model config | `public/functions/replicate-models.js` (`sharp-ml`) |
| Splat asset persistence (MIME/ext, octet-stream rewrap) | `src/shared/assets/services/assetsService.js` |
| Editor drop / gallery placement | `src/editor/lib/asset-upload/uploadAndPlaceAsset.js` |
| Splat rendering (Spark) | `src/aframe-components/splat.js` |
| Live splat viewer (iframe) | `public/splat-viewer.html` |
| Reconciler pattern to copy | `public/functions/scheduled/asset-usage-reconcile.js` |
| Email sender to reuse | `public/functions/scheduled/scheduledEmails.js` (Postmark) |

---

## Second provider — Cloud Run RAD conversion (`provider: 'cloudrun'`) ✅ DONE (dev)

The first **non-Replicate** provider, and the first **worker-writeback** one. It
turns a splat `.ply` into a Spark **RAD (LOD)** file — the splat analog of the
GLB optimized variant — landing it in `optimizedSource*` on the same asset doc.
Full design + ops: [`rad-cloud-run-pipeline.md`](./rad-cloud-run-pipeline.md).

**Flow (fully automatic, no UI):**

```
splat asset doc created  (uploaded OR generator-saved)
  └─ onSplatAssetCreated (Firestore onCreate trigger, rad-dispatch.js)
       ├─ writes a generationJobs doc {kind:'splat-rad', provider:'cloudrun', tokenCost:0}
       └─ enqueues a Cloud Task (OIDC) → POSTs the rad-converter Cloud Run service
            └─ worker: download .ply → build-lod --quality → upload {assetId}-lod.rad
               → patch optimizedSource* on the asset → write job terminal status
```

**How it differs from the Replicate model (and why it still fits the schema):**

- **No webhook, no client poll.** The conversion is a silent backend
  optimization with no user waiting on it, so there's no live UI to drive. The
  worker owns completion: it writes `status: 'running'` on start and
  `succeeded`/`failed` at the end, directly to the job doc via the Admin SDK.
- **No external prediction to fetch.** Replicate jobs are reconciled by
  re-fetching `predictions.get(providerJobId)`; a cloudrun job has **no
  `providerJobId`** — there's nothing external to poll. So the reconciler's
  `case 'cloudrun'` instead **re-enqueues the Cloud Task** for a job stuck
  non-terminal past `RACE_GUARD_MS` (the worker is idempotent — it just
  overwrites the same `-lod.rad` and re-patches the doc), and gives up
  (`failed`) past `GIVE_UP_MS`. `refundSplatToken` is a no-op at `tokenCost: 0`.
- **One trigger covers both splat origins.** Drag-uploaded and generator-saved
  splats both create the asset doc without an optimized variant, so the single
  `onCreate` guard (`type==='splat' && !optimizedSourceUrl`) catches both.
- **Reuses the asset schema unchanged.** RAD is to a splat what the Draco+WebP
  optimized GLB is to a mesh: `storageUrl`/`storagePath` stay the original `.ply`
  (`assetRole: 'original'`), the RAD lands in `optimizedSourceUrl` /
  `optimizedSourcePath` / `optimizedSourceSize` (`assetRole: 'optimized'`), and
  the renderer/placement already prefer `optimizedSourceUrl ?? storageUrl`.
  `optimizedSourceSize` is excluded from the quota tally (platform cost).

### As-built specifics (cloudrun)

- **Job fields:** `kind: 'splat-rad'`, `provider: 'cloudrun'`, `providerJobId:
  null` (none), `assetId`, `plyPath`, `tokenCost: 0`, `tokenCharged: false`,
  `refunded: false`. Worker adds `startedAt` + terminal `status`.
- **Trigger:** `onSplatAssetCreated` (1st-gen Firestore `onCreate` on
  `users/{uid}/assets/{assetId}`, mirrors `onAssetWritten`). Writes the queued
  job **before** enqueueing; on enqueue failure it leaves the job `queued` (+
  records `enqueueError`) so the reconciler re-enqueues.
- **Dispatch:** Cloud Tasks queue `rad-convert`; task carries an OIDC token for
  the `rad-task-invoker` SA (`audience` = service URL) so the private Cloud Run
  service accepts it. `enqueueRadTask` is shared by the trigger and the
  reconciler.
- **Worker:** `rad-converter/` Cloud Run service (multi-stage Docker: Rust stage
  compiles `build-lod` from Spark v2.1.0; Node stage runs the handler). Streams
  the `.ply` to `/tmp`, runs `build-lod --quality`, uploads with the
  `saveSplatToGallery` URL/token scheme byte-for-byte (anonymous viewers load via
  the download token).
- **Serving:** GCS byte-range CORS (`cors.json` exposes `Accept-Ranges` +
  `Content-Range`); the `splat` component streams `.rad` paged.
- **Config caveat:** `rad-dispatch.js` constants (service URL, queue, invoker SA)
  are **hardcoded to dev** pending prod rollout — see the RAD doc's Status.

### Key files (cloudrun)

| Concern | File |
| --- | --- |
| Trigger + Cloud Task enqueue helper | `public/functions/rad-dispatch.js` (`onSplatAssetCreated`, `enqueueRadTask`) |
| Reconciler `case 'cloudrun'` | `public/functions/scheduled/generation-job-reconcile.js` |
| Converter service (Dockerfile + handler) | `rad-converter/` |
| Bucket byte-range CORS | `public/cors.json` |
| Full design + deploy/IAM ops | `docs/rad-cloud-run-pipeline.md`, `rad-converter/README.md` |

---

## Second kind on Replicate — Video (image → video) ✅ DONE

**Why it moved here (issue #1780):** `generateReplicateVideo` used to be a
synchronous callable that blocked on `replicate.run(...)` for the whole render
(~2 min median) with zero streamed bytes. Safari drops idle data-less HTTPS
connections well before that — the client surfaced a spurious
`FirebaseError: internal` while the server kept running, charged tokens, and
produced a video nobody received. There is no timeout to tune (onCall can't
stream), so the fix is the same create-and-return pattern as splat.

**What's different from splat (the deltas, everything else is reused as-is):**

- **Model addressing:** video models are official Replicate models addressed by
  NAME (`replicate.predictions.create({ model: 'google/veo-3.1-fast', ... })`),
  no version hash — splat pins a resolved `version` because community models
  404 on the name form. `SUPPORTED_VIDEO_MODELS` in `replicate.js` is the
  allowlist.
- **Terminal persist:** `saveVideoToGallery` streams the `.mp4` from the
  (ephemeral) `replicate.delivery` URL into
  `users/{uid}/assets/videos/{assetId}.mp4` and writes the same
  `type: 'video'` / `category: 'ai-render'` asset doc the client-side save used
  to write, so pre- and post-migration gallery videos render identically. The
  gallery save previously ran in the browser (`video.js:saveToGallery`) and
  died with a closed tab — moving it into the terminal processor is the core
  browser-independence win.
- **Discord post** moved from the submit callable into the terminal processor's
  claimed success branch — fires on real completion, exactly once (the
  `saving` claim serializes webhook/poll/reconciler), with the durable Storage
  URL instead of the ephemeral provider URL.
- **No geometry gate** (that's a splat-specific SfM sanity check). The
  completion-email opt-in works exactly like splat's (checkbox on the tab →
  `notify: { email, pending }` on the job doc; the `generationReady` template
  already had video copy) — renders are usually ~2 min, but provider queue
  waits can stretch far past what anyone keeps a tab open for.
- **Job doc extras:** `generationParams` ({model_name, prompt, aspect_ratio,
  duration_seconds, scene_id}) — everything the terminal processor needs to
  build the gallery metadata + Discord post without a browser. Terminal result
  field is `videoUrl` (returned to the client as `video_url`, mirroring
  `splat_url`).

Tokens flipped from charge-after-success to charge-at-submit + refund-once on
failure (the old ordering is exactly what stranded charges on disconnect).
Client (`src/generator/video.js`) mirrors `splat.js`: submit → `jobId` →
`pollVideoStatus` loop; the gallery's pending-job card lights up from the
existing job-doc listener for free.

---

## Architecture: invariant framework vs per-adapter

Reading all three providers (Replicate, fal, Teleport) shows they share one
shape. The split:

**Invariant framework (write once, shared by every kind/provider):**

- A unified `users/{uid}/generationJobs/{jobId}` collection — job state machine,
  token accounting, webhook secret, notify flags, result pointer.
- A generic idempotent `processTerminalJob(job, normalizedStatus)` — the
  claim-via-transaction + charge/refund logic, with the persist step dispatched
  by `kind`.
- One generic webhook endpoint + one generic poll callable, dispatched by
  `provider`.
- One scheduled **reconciler** that sweeps stalled jobs and runs the same
  processor (fixes the dropped-webhook gap for all providers at once).
- One **notify** step on terminal (email via Postmark).

**Per-adapter (small, one per provider × kind):**

| Hook | Splat (Replicate) | Image (Replicate) | fal | Teleport |
| --- | --- | --- | --- | --- |
| `submit(input)` | `predictions.create` + webhook | same, image input shaping | `POST queue.fal.run` + `fal_webhook` | multipart S3 upload → submit capture |
| `fetchStatus(id)` → normalized | `predictions.get` | `predictions.get` | `GET status_url` | `GET capture` |
| `persistResult(output)` → asset | download `.ply` → splat asset | download image → image asset | download image → image asset | download splat → splat asset |
| `estimateCost(input)` | fixed | fixed (per model) | fixed | estimate + hold + reconcile |

The provider dispatch is a `switch (job.provider)` — now with **two real cases**
(`replicate` and `cloudrun`). cloudrun was the first non-Replicate provider to
exercise the seam, and proved it generalizes past the convergent-webhook shape to
a worker-writeback one (no `providerJobId`, no external fetch — the reconciler
re-enqueues instead of polling). It's promoted to a real **registry** when
fal/Teleport add a third/fourth.

### The unification that keeps fast flows fast

Images don't have to choose "synchronous like today" vs "async like splat." A
single backend supports both:

1. Always create the job + provider job **with a webhook** (cheap).
2. The callable **optionally waits up to ~50s** (`replicate.wait`). If terminal,
   process inline and return the result — today's fast image UX, unchanged.
3. If not terminal by the wait deadline, return `{ jobId, status: 'running' }`;
   the client polls, or just closes the tab.
4. The webhook finishes it regardless and (if `notify.email`) sends email.

---

## Durable contracts — get these right before any job doc is written

These are the surfaces where changing later costs a **data migration** or a
**deployed-endpoint / embedded-URL compat shim**. They are cheap now precisely
because nothing is committed or has written data yet.

1. **Internal `jobId` (uuid) is the doc id — not the provider's prediction id.**
   `providerJobId` is a *field*. This lets us write a `pending` doc *before*
   submit (a crash mid-submit becomes a visible, reconcilable row), keeps job
   identity uniform across providers (fal `request_id`, Teleport capture id),
   and lets the webhook URL carry a stable `jobId`. **Webhook URLs are frozen at
   submit time**, so the URL param scheme (`?jobId=&uid=&token=`) must be right
   before any prediction is created.

2. **Store a normalized status vocabulary, not the raw provider status.**
   Own enum: `queued | running | saving | succeeded | failed | canceled` (keep
   `providerStatus` as a raw passthrough for debugging). This keeps the
   reconciler's core query — "find non-terminal jobs" — provider-agnostic
   forever instead of needing a per-provider list of in-flight strings.

3. **The asset output path + download-token URL are a permanent contract.**
   When a user drags a generated asset into a scene, its `storageUrl` (with
   `?token=`) is written into the **saved scene JSON** and referenced
   indefinitely. The server persist (`saveSplatToGallery` and its image sibling)
   must match the client `assetsService.addAsset` path/URL scheme byte-for-byte.
   Mark it in code as a stable contract so a later "tidy-up" doesn't orphan
   references in already-saved scenes.

4. **Collection stays nested** (`users/{uid}/generationJobs/{jobId}`) to match
   the assets convention and security-rules model; the reconciler uses a
   collection-group sweep (same as `asset-usage-reconcile.js`). Job docs are
   **Admin-SDK only** — rules `allow read, write: if false`.

5. **Reserve field slots now** (additive later, but cheaper to name up front):
   `notify` (`{ email: bool, sentAt }`) and the terminal-notify guard; token
   fields named to accommodate Teleport's hold model later
   (`tokenCost` / `tokenHeld` / `refunded`).

---

## Phased plan

Principle: **land splat + reconciler, prove the generic shape, then fold images
in** — so the image migration happens against a settled framework rather than
co-evolving with it. Bake the durable-contract decisions in from Phase 0.

### Phase 0 — Cleanup + forward-compatible naming/schema ✅ DONE
No new features; got the durable surface right.
- ✅ Collection **`generationJobs`** with `kind: 'splat'` + `provider:
  'replicate'` fields.
- ✅ Doc id is internal **`jobId` (uuid)**; `providerJobId` (the Replicate
  prediction id) is a field; webhook URL carries `?jobId=&uid=&token=`; client
  polls by `jobId`. (Durable contract #1.) Pending doc written **before** submit.
- ✅ **Normalized status** enum stored; `providerStatus` kept raw
  (`normalizeReplicateStatus`). (Contract #2.)
- ✅ Callables renamed: `getGenerationJobStatus`, `replicateJobWebhook` (one
  endpoint for all Replicate kinds). `generateReplicateSplat` **stays** — it's
  the splat-specific submit; image will have its own.
- ✅ `firestore.rules`: explicit `match …/generationJobs/{jobId} { allow read,
  write: if false; }`.
- ✅ Webhook region derived from env (`FUNCTION_REGION`), not hardcoded.
- ✅ `src/generator/splat.js` + `public/functions/index.js` call sites updated.
- **Remaining:** Contract #3 — mark the `saveSplatToGallery` storage/URL scheme
  as a stable contract in a code comment (cross-check it matches
  `assetsService.addAsset` byte-for-byte). No dated `.txt` artifact exists to
  clean up.

### Phase 1 — Generic reconciler (the robustness gap) ✅ DONE
One scheduled function; closes "webhook dropped + tab closed → charged-but-lost"
**and** re-triggers jobs stuck in `saving` (the stale-claim TTL makes them
re-takeable, but something still has to call the processor). Also the recovery
path for jobs wedged in `saving` on staging.
- ✅ New `public/functions/scheduled/generation-job-reconcile.js`, modeled on
  `asset-usage-reconcile.js`: PubSub schedule (every 10 min) + admin-only
  callable trigger (`triggerReconcileGenerationJobs`, dryRun default).
- ✅ Collection-group sweep of `generationJobs` where `status` is non-terminal
  (`in ['queued','running','saving']`); jobs younger than `RACE_GUARD_MS`
  (3 min) are skipped so it never fights a live webhook/poll or an in-flight
  save. For each: `fetchProviderPrediction(job)` (a `switch (job.provider)`,
  Replicate-only today — the seam that becomes the registry) →
  `processTerminalPrediction(...)` (the same idempotent processor the
  webhook/poll use, so no double-save / double-charge).
- ✅ Give-up rule: non-terminal **and** > `GIVE_UP_MS` (30 min) **and** the
  provider also reports failed/absent (404) → mark `failed`, refund once via the
  shared `refundSplatToken`. A job the provider still reports as *running* is
  left alone (SHARP cold-boots are slow). Jobs that never recorded a
  `providerJobId` (crashed mid-submit) are given up the same way once old.
- ✅ `processTerminalPrediction` / `refundSplatToken` / `cleanupSplatTempFile` /
  `normalizeReplicateStatus` exported from `replicate.js` so the reconciler runs
  identical logic. Schedule + trigger exported from `index.js`.

### Phase 2 — Extract the shared framework (pure refactor, splat stays sole consumer) ← NEXT
No data churn (Phase 0 already named everything generically); verify splat
behaves identically end-to-end.
- New `public/functions/jobs/` module: `processTerminalJob`,
  `getGenerationJobStatus`, generic webhook handler, refund/cleanup helpers,
  status normalization, and a `persistors` map (`persistors.splat` =
  `saveSplatToGallery`).
- A no-op `notify` hook on terminal (home for Phase 4).
- `replicate.js` keeps only the splat *submit*; everything shared moves to
  `jobs/`.

### Phase 3 — Fold in images (Replicate + fal) ✅ DONE (#1835)
Images gained browser-independence + email — the last synchronous kind. Both
image providers became new `kind: 'image'` jobs on the existing machinery:
- `generateReplicateImage` (nano-banana/seedream/kontext, input shaping kept)
  and `generateFalImage` (flux-2 edit family) are now submit-and-return:
  pending job → charge-at-submit + refund-once → provider submit **with a
  webhook** → `{ jobId }`. Tokens flipped from charge-after-success to
  charge-at-submit, same as the video migration.
- `saveImageToGallery` in the shared terminal processor mirrors
  `saveVideoToGallery` (streamed, deterministic assetId, `type: 'image'` /
  `category: 'ai-render'`, MIME/extension from the downloaded bytes). The
  Discord post moved from the submit callables into the claimed success branch.
- **`galleryMetadata` job field**: client extras merged into the saved asset's
  `generationMetadata` — the editor passes sceneId/sceneTitle/cameraState/
  renderMode so the gallery's scene link + focus-camera button (#1605) keep
  working now that the save is server-side. Sanitized + size-capped at submit.
- Clients (`generator-tab-base.js` Image tab, editor `ScreenshotModal`) mirror
  `video.js`: submit → jobId → 3s poll loop; the editor modal keeps its UX but
  survives closure. Client-side `saveToGallery` retired.
- Completion email defaults **OFF** for images (renders usually finish in
  seconds); the generator tab has an unchecked opt-in, the editor sends none.
- The **inline-wait wrapper** (~50s) was skipped: with a 3s poll the fast-image
  UX regression is one poll tick, not worth a second code path.

### Phase 4 — Notifications ✅ DONE (splat, success-only)
Built entirely on the job doc — **no separate notification system**, exactly as
intended. The reminder request rides on the job; the reconciler delivers it.
- **Opt-in at submit.** The Splat tab has an "Email me when my splat is ready"
  checkbox, **default on** (`src/generator/splat.js`). It passes
  `notify: { email }` to `generateReplicateSplat`, which writes
  `notify: { email, pending }` onto the job doc (`pending` mirrors the opt-in and
  is the only field the sweep queries on).
- **The open tab acks itself.** A live poll (`getGenerationJobStatus`) that
  carries/sees the job as succeeded stamps `notify.clientAckedAt` and clears
  `pending` (`ackClientSeen`). If the tab is open, this lands within ~3s of
  completion → the email is suppressed. No heartbeat, no tab-state guessing.
- **The reconciler sends the email.** `sendReadyNotifications` (in
  `generation-job-reconcile.js`) sweeps `notify.pending == true && status ==
  'succeeded'`: if `clientAckedAt` → clear (tab was open, no email); else once
  past `NOTIFY_GRACE_MS` (3 min) with no ack → Postmark `generationReady` email
  (kind-aware copy — splat today, video/image reuse it for free; reuses
  `sendPostmarkEmail`/`getUserInfo` from `scheduledEmails.js`), set
  `notify.sentAt`, clear `pending`. Idempotent: `pending` clears the instant we
  act, so each job emails **at most once**. Needs a collection-group index on
  `(notify.pending, status)` (added to `firestore.indexes.json`).
- **Success-only** by design; failures refund silently (a closed-tab user just
  finds the token back). Thresholds ("only if cost > x / time > y") are moot for
  splat (fixed 1 token, always minutes) — revisit when fast image kinds fold in.
- Deferred: failure emails, in-app **Jobs panel** reading `generationJobs`, web
  push.

### Monitoring — reconciler self-escalation ✅ DONE
No new infra. When a sweep finishes with `gaveUp > 0`, `errored > 0`, or
`notify.errored > 0`, the reconciler logs at **ERROR** (`escalateIfNeeded`), so
Cloud Error Reporting groups it and a log-based / Error Reporting notification
channel can page on it. Cloud Functions already ship uncaught exceptions to Error
Reporting and all `console.*` to Cloud Logging; this just makes the *expected-but-bad*
outcomes (jobs the reconciler gave up on, emails that failed to send) loud enough
to alert on. A real admin Jobs dashboard remains deferred.

### Later — additional providers (justifies a real registry)
- ✅ **fal** adapter — DONE: `submit`/`fetchStatus` over its queue API
  (`request_id`, `status_url`, `fal_webhook`) for `mesh` (fal-3d.js) and
  `image` (fal-proxy.js) kinds; the old in-callable 2-min poll in
  `fal-proxy.js` is gone (pure submit-and-return, no inline wait).
- **Teleport/Varjo** photogrammetry (see reference below): heavier `submit`
  (direct-to-Storage source upload, presigned multipart) + cost
  estimate/hold/reconcile.

---

## Teleport / Varjo photogrammetry (fast-follow, not yet built)

The next consumer after splat-v1 ships: Teleport is the **fast-follow**, gated
only on API keys. It processes a **zip of images** or a **video** into a splat
via an asynchronous cloud pipeline (minutes-to-hours), and is the first kind
that exercises the queue's large-source-file and cost-hold paths. It needs the
full queue plus two things the Replicate kinds don't:

1. **Large source files.** A zip/video is too big to base64 through a callable
   (~10–32 MB limit). The client uploads directly to **Firebase Storage**
   (resumable, progress UI) under a `splat-source` area and passes the **storage
   path** to the backend — never the bytes.

2. **Cost estimation + approval / hold + reconcile.** Scan client-side *before*
   upload: zip → count images (read the central directory, e.g. JSZip); video →
   `<video>.duration` × fps. Estimate `$1.00 + $0.01 × max(images,
   video_seconds × 2)`, convert to tokens, show an approval modal, **hold** the
   estimate on submit, and reconcile to actual on completion (refund the
   overage). This is why the token fields are named for a hold model in
   Contract #5.

### Teleport API shape

- Auth: API key.
- Upload: AWS S3 multipart (create capture → request presigned part URLs →
  upload parts → notify complete). Capture exposes a `state` field.
- Pricing: `$1.00` base + `$0.01` per image or per ½-second of video.
- Output: a Gaussian Splat.
- Docs: <https://teleport.varjo.com/docs/>

---

## Notes / constraints (splat rendering)

- Splats render via the `splat` A-Frame component (Spark). The entity uses
  `splat="src: <url>"` (a **bare** `src:`, no `url()` wrapper, unlike
  `gltf-model`). `placeCloudAsset` / the upload swap branch on asset type.
- Splats upload as `application/octet-stream`. `storage.rules` allows up to
  **100 MB** (server ceiling, so large *generated* splats save), while user
  drag-and-drop uploads are capped at **50 MB** client-side (`SPLAT_MAX_BYTES`).
  Browsers rarely set `File.type` for `.ply`/`.splat`/`.spz`, so
  `assetsService.addAsset` re-wraps the blob with an explicit octet-stream type.
- File extension is taken from the source filename
  (`.ply`/`.splat`/`.spz`/`.rad`, default `.ply`) because the `splat` component
  selects its loader by extension.
- **CORS:** the `splat` component cannot load GitHub raw URLs; Firebase Storage
  download URLs are fine.
- **Server save is streamed**, so generation is *not* memory-bound by splat size
  (see Completion model). The remaining ceiling is the **100 MB octet-stream cap
  in `storage.rules`**, which a generated `.ply` must stay under.
- **Target output format — World Labs / sparkjsdev RAD with LOD.** SHARP emits
  uncompressed `.ply` today, which is the source of the size ceiling. The chosen
  long-term cloud-processing target is the **RAD** format (World Labs /
  [sparkjsdev](https://github.com/sparkjsdev)) **with level-of-detail**, so the
  viewer streams progressively and stays performant on large scenes. This is the
  practical replacement for **Google 3D Tiles** as the real-world-context layer:
  splats become the geometry source, RAD+LOD makes them cheap enough to ship to
  end users. **This is now built** (`provider: 'cloudrun'`, `kind: 'splat-rad'`
  — see the "Second provider" section above). Note the as-built shape differs
  from the original prediction: rather than a `persistResult` step *inside* the
  splat-generation job, it's a **separate job triggered on splat asset
  creation**, so it also covers drag-uploaded splats (not just generated ones)
  and reprocesses independently of how the `.ply` was produced. Interim `.spz` /
  `.ksplat` conversion (~5–10× smaller) remains a cheaper stopgap if RAD tooling
  isn't ready.
- **RAD is the splat "optimized variant" — reuse the GLB original/optimized
  schema as-is.** The RAD+LOD output is to a splat exactly what the Draco+WebP
  optimized GLB is to a mesh original, so it maps onto the existing asset fields
  with **no schema change**:
  - `storageUrl` / `storagePath` (+ `assetRole: 'original'`) — the raw `.ply`
    from SHARP, preserved as the source of truth.
  - `optimizedSourceUrl` / `optimizedSourcePath` / `optimizedSourceSize`
    (+ `assetRole: 'optimized'`) — the derived RAD+LOD variant.
  - The renderer/scene loader prefers `optimizedSourceUrl ?? storageUrl` (the
    same rule GLBs already use), so a splat with a RAD variant streams it and
    silently falls back to the `.ply` when there isn't one yet.
  - **Reprocessable by construction:** a future, better LOD pass just rewrites
    the `optimizedSource*` variant; the original `.ply` is never touched, so we
    can re-optimize the whole back catalogue as the tooling improves. And the
    quota math is already correct — `optimizedSourceSize` is intentionally
    excluded from the tally (it's a platform-derived cost, not user storage),
    matching how GLB optimization is billed.
  This means RAD can land as a pure server-side `persistResult` enhancement (or a
  later reprocessing sweep over existing splat assets) without any client,
  schema, or rules churn.

## Deploying

- **Rules:** `firestore.rules` (job-doc lockdown) and `storage.rules` (the
  octet-stream cap is 100 MB for generated `.ply`). Deploy with
  `firebase deploy --only firestore:rules,storage`.
- **Cloud Functions:** the `npm run deploy[:staging]` scripts are **hosting-only**
  — functions deploy separately:
  `cd public && firebase use <project> && firebase deploy --only functions:<name>`.
  New/changed functions: `generateReplicateSplat`, `getGenerationJobStatus`,
  `replicateJobWebhook`, `onSplatAssetCreated`, the reconciler schedule + trigger.
- **Cloud Run (RAD / cloudrun provider):** deploys separately from Firebase via
  `gcloud run deploy rad-converter --source rad-converter/`, plus a one-time
  Cloud Tasks queue + invoker SA + IAM. Full steps in
  [`rad-cloud-run-pipeline.md`](./rad-cloud-run-pipeline.md) and
  `rad-converter/README.md`. Bucket byte-range CORS:
  `gsutil cors set public/cors.json gs://<bucket>`.
- **Hosting:** generator bundle, `public/generator/index.html`,
  `public/splat-viewer.html` (covered by `npm run deploy[:staging]`).
- **Secrets:** none new for splat — reuses `REPLICATE_API_TOKEN` and
  `ALLOWED_PRO_TEAM_DOMAINS`. Email (Phase 4) reuses the existing Postmark
  secret. cloudrun adds **no secrets** (OIDC via the invoker SA).

## Third provider — fal (image → 3D mesh) ✅ DONE

Landed as the first **poll-provider** (no webhook wired in v1), the exact seam
the reconciler's `switch (job.provider)` anticipated — then upgraded to the
full convergent shape in #1832 (see the webhook note at the end of this
section). It also fixed a real bug: `generateFalMesh` used to be a synchronous
callable that polled fal inline for up to ~4.6 min, so longer jobs (TRELLIS 2,
or fal queue congestion) hit the 300s function timeout and 500'd with the
token uncharged-but-work-wasted feel. Same class of failure as the video
migration (#1780).

- **Kind/provider:** `kind: 'mesh'`, `provider: 'fal'`. Models Hunyuan3D v2 and
  TRELLIS 2 (`type: 'fal-3d'` in `replicate-models.js`), image-to-3D only.
- **Submit-and-return:** `generateFalMesh` stages the input image, writes the
  pending job, charges at submit (refund-once-on-failure, shared
  `refundSplatToken` path), submits to `queue.fal.run`, stores the fal
  `request_id` as `providerJobId` plus `statusUrl`/`responseUrl`, and returns
  `{ jobId }`. No inline poll.
- **Completion:** `fetchFalPrediction(job)` (in `fal-3d.js`) fetches
  `statusUrl` and shapes the result as a Replicate-style prediction (GLB URL as
  `output`, mapped to Replicate status words), returning `{ prediction }` or
  `{ absent }`. `getGenerationJobStatus` (client poll, live UX), the fal
  webhook, and the reconciler (closed-tab backstop) all call it, then run the
  shared `processTerminalPrediction`, whose `kind: 'mesh'` branch saves the GLB
  via `saveMeshToGallery` (streamed to `users/{uid}/assets/meshes/{assetId}.glb`,
  `type: 'mesh'` / `category: 'ai-render'`, asset id keyed on the fal
  `request_id` so retries converge). Result field is `meshUrl` (returned as
  `mesh_url`).
- **Client:** `model3d.js` mirrors `splat.js`/`video.js` — submit → `jobId` →
  self-rescheduling `pollMeshStatus`, "email me when my 3D model is ready"
  checkbox (default on), pending gallery card via the kind-agnostic
  `generationJobs` listener (`mesh` noun added to `PendingJobCard`).
- **Secrets:** `FAL_KEY` added to `getGenerationJobStatus` and the reconciler
  (either can carry a fal job to terminal).
- **Webhook (#1832, added post-v1):** submits now attach `fal_webhook` to the
  `queue.fal.run` URL (`falQueueSubmitUrl`), pointing at **`falJobWebhook`** —
  the shared `handleJobWebhook` in `replicate.js` with a `provider: 'fal'`
  branch that re-fetches via `fetchFalPrediction` (the body is never trusted)
  and runs the same idempotent processor + real-time completion email. Gated
  by a per-job `webhookSecret`, exactly like the Replicate/Modal webhooks.
  Closed-tab mesh/image jobs now finalize + email in real time instead of on
  the 10-min reconciler cadence; poll + reconciler stay as backstops.

## Completion-email suppression race (#1833) ✅ FIXED

The "no email while you're watching" contract: an open tab's poll acks a
succeeded job (`notify.clientAckedAt`) and the email is suppressed. For
webhook providers the webhook used to email the instant the save committed —
always beating the tab's next ~3s poll, so open-tab suppression effectively
never applied to webhook kinds (observed on dev: a watched video still
emailed). Fix: after finalizing, the webhook waits `WEBHOOK_NOTIFY_ACK_GRACE_MS`
(10s ≈ 3 poll cycles) **only when the job is opted-in and still pending**,
then calls the transactional `sendGenerationReadyEmail`, which suppresses if
an ack landed during the wait. A closed tab's email is delayed by those few
seconds; a webhook killed mid-wait loses nothing (`notify.pending` stays set,
the reconciler sweep delivers).
