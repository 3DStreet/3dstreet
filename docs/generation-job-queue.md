# Generation Job Queue (Async AI Jobs)

A provider-agnostic system for **long-running AI generations** (image → splat,
image, video, photogrammetry) that:

- survive a **closed browser** (completion happens server-side),
- complete via **three convergent, idempotent paths** — provider webhook, client
  poll, and a scheduled reconciler — so no single delivery failure loses a job,
- charge tokens on submit and **refund exactly once** on failure,
- (planned) **notify by email** when a job finishes while the tab is closed.

The first consumer is the **Splat** feature (image → 3D Gaussian Splat via the
SHARP model on Replicate). The design generalizes so Replicate image/video,
fal, and Teleport/Varjo photogrammetry can drop in as additional **kinds** and
**providers** without re-architecting.

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

With only Replicate today, the provider dispatch is a `switch (job.provider)`;
it's promoted to a real **registry** when fal/Teleport arrive.

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

### Phase 3 — Fold in nano banana (Replicate image)
Images gain browser-independence + email. Same provider → a new `kind`, not a
provider integration.
- `persistors.image` (server-side persist) — mirrors `saveSplatToGallery`:
  download from Replicate → re-upload to Storage → write `type: 'image'` asset
  doc. Capture the rich generation metadata (model, prompt, seed, steps,
  guidance, dimensions) into the **job doc at submit** so the server writes it
  without the browser; read dimensions server-side from the buffer if needed.
- Lift the existing nano-banana/seedream/kontext input shaping from
  `generateReplicateImage` into the image submit adapter.
- Add the **inline-wait wrapper** (~50s) so the fast image UX doesn't regress.
- `src/generator/generator-tab-base.js`: handle the `{ jobId, running }` branch
  by polling (copy `splat.js`'s loop) and add an "email me when done" opt-in that
  sets `notify.email`. Retire the client-side `saveToGallery(imageUrl)` for the
  async route.

### Phase 4 — Notifications
- Wire the `notify` hook to Postmark (reuse `scheduledEmails.js`): on terminal,
  if `notify.email` is set **and** no client has acked the result (guarded by a
  `notifiedAt`/`clientSeenAt` field), email a link to the gallery/asset. Add an
  "AI generation ready" template.
- Deferred options: in-app **Jobs panel** reading `generationJobs`; web push.

### Later — additional providers (justifies a real registry)
- **fal** adapter: `submit`/`fetchStatus` over its queue API (`request_id`,
  `status_url`, `fal_webhook`). The current in-callable 2-min poll in
  `fal-proxy.js` becomes the optional short inline wait.
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
  end users. A server-side `.ply → RAD` conversion step slots into the job
  queue's `persistResult` adapter (it's just a different output encoding for the
  same `kind: 'splat'`). Interim `.spz` / `.ksplat` conversion (~5–10× smaller)
  remains a cheaper stopgap if RAD tooling isn't ready.
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
  `replicateJobWebhook`, the reconciler schedule + trigger.
- **Hosting:** generator bundle, `public/generator/index.html`,
  `public/splat-viewer.html` (covered by `npm run deploy[:staging]`).
- **Secrets:** none new for splat — reuses `REPLICATE_API_TOKEN` and
  `ALLOWED_PRO_TEAM_DOMAINS`. Email (Phase 4) reuses the existing Postmark
  secret.
