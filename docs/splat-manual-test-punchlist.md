# Splat / Generation-Queue — Manual Test Punch List

Manual QA for the splat generation feature (PR #1650) and the two follow-ups:
background-job monitoring escalation and completion-email notifications.

Run against **dev/staging** (`dev-3dstreet`) first — cloudrun RAD config is still
hardcoded to dev. Use a real signed-in account with `genToken` available, plus a
second throwaway account for the "no email on file" edge case if you have one.

Legend: ☐ todo · ✅ pass · ❌ fail (note what happened)

---

## 0. This branch's in-flight changes — deploy + smoke test

> 🎵 Elton John, ["Rocket Man"](https://open.spotify.com/search/Elton%20John%20Rocket%20Man): liftoff to dev, `firebase deploy` is your countdown.

> Scope: the System Health monitoring surface (heartbeats + `#admin/health` page)
> and the RAD perf instrumentation. Once these land, fold the smoke tests below
> into the relevant sections (8b, 9) and delete this section.

### Deploy to dev (`dev-3dstreet`)
- ☐ **Functions + Firestore rule** (the 5 scheduled jobs' heartbeats,
  `onSplatAssetCreated` `inputBytes`, reconciler `terminatedBy`, and the
  admin-only `jobHealth` read rule):
  ```bash
  firebase use dev-3dstreet
  firebase deploy --only "firestore:rules,functions:reconcileGenerationJobs,functions:sendScheduledEmails,functions:purgeSoftDeletedAssets,functions:reconcileAssetUsage,functions:cleanupOrphanedStorage,functions:onSplatAssetCreated"
  ```
- ☐ **rad-converter Cloud Run** (new `server.js` phase timing + `SERVICE_REGION`):
  ```bash
  cd rad-converter && ./deploy.sh dev-3dstreet us-central1
  ```
- ☐ **System Health page** — no hosting deploy needed; run the editor locally
  (it points at the dev Firebase config) and open the hash route:
  ```bash
  npm start            # → http://localhost:3333
  ```
  Then visit `http://localhost:3333/#admin/health` signed in as an **admin**
  account. (Full deployed bundle instead: `npm run deploy:staging`.)

### Smoke test
- ☐ **Health page renders**: `#admin/health` lists all 5 jobs; non-admin/logged
  out shows "Admins only".
- ☐ **First heartbeat**: the 10-min reconciler writes its row within ~10 min, or
  force it now (the admin `triggerReconcileGenerationJobs` callable does **not**
  write a heartbeat by design — use the scheduler):
  ```bash
  gcloud scheduler jobs list --project dev-3dstreet --location us-central1
  gcloud scheduler jobs run firebase-schedule-reconcileGenerationJobs-us-central1 \
    --project dev-3dstreet --location us-central1
  ```
  After it runs, the reconciler row goes green; the other 4 stay gray ("No
  heartbeat reported yet") until their (daily/weekly/monthly) cron fires.
- ☐ **RAD perf instrumentation**: drag-upload or generate a splat, then inspect:
  - The `generationJobs` doc has `inputBytes` set at **queue** time, and on
    completion `durationMs` + `phaseMs:{download,convert,upload}` + `runtime`
    (with `region`/`revision`/`cpuCount`; `patches` is null until the Dockerfile
    `PATCHES_APPLIED` env is wired).
  - The **asset** doc's `optimizationMetadata` mirrors the same perf subset (so it
    survives the job-doc TTL).
- ☐ **`terminatedBy`**: a reconciler-killed job (give-up / stall ceiling) has
  `terminatedBy: 'reconciler'`; a worker-reported failure does **not**.

---

## 1. Splat generation — happy path (tab open)

> 🎵 ELO, ["Mr. Blue Sky"](https://open.spotify.com/search/ELO%20Mr%20Blue%20Sky): everything works, the splat renders, life is good.

- ☐ Generator → **Splat** tab. Upload a source image; the preview shows it.
- ☐ "Generate Splat (1 token)" → button shows "Uploading…", then "Generating…",
  and the loading panel flips to the "you can close this tab" copy + a running
  timer once queued.
- ☐ Token balance drops by 1 immediately (charged on submit).
- ☐ A **pending card** appears in the Assets gallery (driven by the job doc).
- ☐ On completion: result iframe renders the splat (orbit/zoom), pending card is
  replaced by the real asset, "Splat generated!" toast.
- ☐ The result panel shows an **"Open in 3DStreet"** button (deep-links to
  `…/#asset:{uid}/{assetId}`, same shape as the email CTA) plus a single
  Download button (no duplicate). Falls back to the raw `.ply` only if
  assetId/uid is missing.
- ☐ Gallery asset is draggable into a scene from the editor Assets panel.

## 2. Browser-independent completion (tab closed mid-job)

> 🎵 Semisonic, ["Closing Time"](https://open.spotify.com/search/Semisonic%20Closing%20Time): close the tab, the webhook finishes without you.

- ☐ Start a generation, then **close the tab** while it's still "Generating…".
- ☐ Reopen the app a few minutes later → the splat is in the Assets gallery
  (saved server-side by the webhook, no client involvement).

## 3. Completion email — default ON, tab closed → email sent

> 🎵 The Box Tops, ["The Letter"](https://open.spotify.com/search/Box%20Tops%20The%20Letter): "my baby just wrote me a letter" (Postmark delivered).

- ☐ Confirm the **"Email me when my splat is ready"** checkbox is **checked by
  default**.
- ☐ Generate, then **close the tab** immediately after it reaches "Generating…".
- ☐ Wait for completion + grace (≤ ~13 min: 10-min reconciler + 3-min grace).
- ☐ Receive the completion email (Postmark). Subject is **dynamic + kind-aware**:
  with an asset name it reads `Your 3DStreet splat "<name>" is ready`; otherwise
  it falls back to `Your 3DStreet splat is ready (<time> UTC)`. Body uses the
  splat noun and includes the generated-at line.
- ☐ Job doc shows `notify.sentAt` set, `notify.pending: false`. **Exactly one**
  email (re-running the reconciler does not re-send).
- ☐ **Deep link**: the email CTA points at `…/#asset:{ownerUid}/{assetId}`.
  Clicking it opens the editor with `AssetDetailModal`, which self-fetches the
  doc and routes a splat to the 3D viewer (`MeshDetailsModal`) showing the live
  splat. Owner actions (rename/delete) appear once auth resolves.
- ☐ **Place in scene**: the modal shows a "Place in scene" button; clicking it
  drops the splat into the current scene at the ground-pick point and closes the
  modal (same as the Assets panel). The placed splat uses the RAD optimized
  variant if present.
- ☐ Open the same `#asset:uid/id` link **logged out / incognito** → the splat
  still renders (assets are public-read), in read-only mode.
- ☐ Closing the modal strips the `#asset:…` hash (reload doesn't reopen it).
- ☐ A bogus `#asset:uid/nonexistent` shows "Asset not available", no crash.

> Faster than waiting for the schedule: as an admin, call
> `triggerReconcileGenerationJobs({ dryRun: false })` to force the sweep. Use
> `{ dryRun: true }` first to preview `notify.sent`/`suppressed`/`waiting`.

## 4. Completion email — tab open → suppressed

> 🎵 The Police, ["Every Breath You Take"](https://open.spotify.com/search/The%20Police%20Every%20Breath%20You%20Take): client ack = "I'll be watching you," so no email.

- ☐ Generate with the box checked but **keep the tab open** until you see the
  result.
- ☐ Job doc shows `notify.clientAckedAt` set, `notify.pending: false`.
- ☐ Trigger the reconciler → notify summary counts it under `suppressed`, **no
  email** arrives.

## 5. Completion email — opted out

> 🎵 Simon & Garfunkel, ["The Sound of Silence"](https://open.spotify.com/search/Simon%20Garfunkel%20The%20Sound%20of%20Silence): box unchecked, blissful inbox quiet.

- ☐ Generate with the checkbox **unchecked**, close the tab.
- ☐ Job doc has `notify: { email: false, pending: false }`; reconciler never
  queries it; **no email** regardless of tab state.

## 6. Failure path

> 🎵 Chumbawamba, ["Tubthumping"](https://open.spotify.com/search/Chumbawamba%20Tubthumping): I get knocked down (refunded), but I get up again.

- ☐ Force a failure (e.g. invalid/garbage source the model rejects, or cancel the
  Replicate prediction).
- ☐ Token is **refunded** (balance returns); job doc `status: 'failed'`.
- ☐ **No email** (success-only by design), even with the box checked + tab closed.
- ☐ If tab open: error toast shown.

## 7. Reconciler backstop (dropped webhook / wedged save)

> 🎵 Fontella Bass, ["Rescue Me"](https://open.spotify.com/search/Fontella%20Bass%20Rescue%20Me): nothing stays stuck, the sweep saves wedged jobs.

- ☐ Simulate a dropped webhook: complete a prediction but block/ignore the
  webhook (or just rely on a naturally missed one), tab closed.
- ☐ After the next sweep, the job reaches `succeeded` (or `failed` + refund past
  the give-up window) — nothing stays stuck.
- ☐ A job manually left in `saving` past the TTL gets re-taken and finishes.

## 8. Monitoring escalation

> 🎵 Rockwell, ["Somebody's Watching Me"](https://open.spotify.com/search/Rockwell%20Somebody%27s%20Watching%20Me): the `ALERT:` line fires at ERROR severity.

- ☐ Force a give-up (a job with no `providerJobId` older than 30 min, or a
  provider-absent prediction) and run the sweep.
- ☐ Cloud Logging shows the **`ALERT: generation jobs need attention`** line at
  **ERROR** severity; it surfaces in Cloud Error Reporting.
- ☐ (If wiring alerts) confirm the Error Reporting / log-based-alert notification
  channel fires.

## 8b. System Health page (background-job heartbeats)

> 🎵 Bee Gees, ["Stayin' Alive"](https://open.spotify.com/search/Bee%20Gees%20Stayin%20Alive): literal heartbeats, green/yellow/red, the CPR-rhythm classic.

- ☐ As an **admin**, open `…/#admin/health` → the "System Health" modal lists all
  five scheduled jobs (gen reconciler, scheduled emails, asset GC, usage
  reconcile, orphan cleanup) with a green/yellow/red dot, last-run time, and
  duration. Overall banner reflects the worst job.
- ☐ As a **non-admin** (or logged out), the same hash shows "Admins only" and no
  job data loads (Firestore `jobHealth` read is admin-gated too).
- ☐ After the 10-min reconciler runs, its row goes **green** with a fresh
  "Xm ago"; expanding shows the run summary JSON + recent-runs history.
- ☐ A run that completes with `gaveUp`/`errored` > 0 shows **yellow** ("Completed
  with issues: …"); a job that **threw** shows **red** with the error stack.
- ☐ **Staleness**: a job whose `lastRunAt` is older than 2× its interval shows
  **red "stale"** even if its last recorded run was green (proves the page
  catches a schedule that stopped firing). A never-reported job shows gray
  "No heartbeat reported yet".

## 9. RAD optimization (cloudrun, automatic)

> 🎵 Queen & David Bowie, ["Under Pressure"](https://open.spotify.com/search/Queen%20Bowie%20Under%20Pressure): compression to `.rad`, right on the nose.

- ☐ After a splat asset is created (generated OR drag-uploaded), a
  `kind: 'splat-rad'`, `provider: 'cloudrun'`, `tokenCost: 0` job runs
  `queued → running → succeeded`.
- ☐ While it runs, the gallery card shows a subtle **"Optimizing…"** badge
  (lower-center) and the detail modal surfaces the same RAD/LOD status; both
  clear once `optimizedSourceUrl` lands.
- ☐ Asset doc gets `optimizedSourceUrl` / `optimizedSourcePath` /
  `optimizedSourceSize`; quota tally **excludes** `optimizedSourceSize`.
- ☐ Perf instrumentation lands: the job doc carries `inputBytes` (from queue
  time) + `durationMs` / `phaseMs:{download,convert,upload}` / `runtime` on the
  terminal status, and the asset doc's `optimizationMetadata` mirrors that perf
  subset (survives the job-doc TTL). A reconciler-killed RAD job is stamped
  `terminatedBy: 'reconciler'`.
- ☐ Dragging the splat into a scene now streams the `.rad` (byte-range / HTTP
  206, paged), not the full `.ply`.
- ☐ A `.rad` uploaded directly is left as-is (no re-conversion).
- ☐ cloudrun reconciler: a wedged RAD job re-enqueues; a truly old one gives up.

## 10. Upload formats & size limits

> 🎵 Lou Bega, ["Mambo No. 5"](https://open.spotify.com/search/Lou%20Bega%20Mambo%20No%205): a little bit of .ply, a little bit of .spz, a little bit of .splat.

- ☐ Drag-upload each splat format: `.ply`, `.spz`, `.splat`, `.rad` — each loads
  and renders.
- ☐ Per-plan size caps enforced client-side and in `getUploadQuota`
  (free/pro/max). Oversized upload is rejected with a clear message.
- ☐ Generated `.ply` over the client cap still saves server-side (server ceiling
  is higher).

## 11. Thumbnails & preview cache

> 🎵 Paul Simon, ["Kodachrome"](https://open.spotify.com/search/Paul%20Simon%20Kodachrome): "give us those nice bright colors" (please not a black thumb).

- ☐ Opening the splat viewer lazily captures a thumbnail; `thumbnailUrl` backfills
  on the asset and shows in the gallery.
- ☐ Thumbnail is captured from the **live canvas** — a RAD/`.rad` splat produces a
  real image, **not a black thumb**.
- ☐ The detail modal's **"Regenerate thumbnail"** button recaptures and
  overwrites `thumbnailUrl` (gallery card updates).
- ☐ Preview modal reuses the editor cache for the same splat URL (no second full
  download).

## 12. End-to-end persistence

> 🎵 Simple Minds, ["Don't You (Forget About Me)"](https://open.spotify.com/search/Simple%20Minds%20Don%27t%20You%20Forget%20About%20Me): save, reload, the splat persists.

- ☐ Drag a generated splat into a scene, **save** the scene, reload → splat loads
  from the saved `storageUrl`/`optimizedSourceUrl`.
- ☐ Open the saved scene in an **anonymous/incognito** session → the splat loads
  via the download token (no auth).

---

## Pre-prod deployment checklist (from the PR punch list)

> 🎵 Europe, ["The Final Countdown"](https://open.spotify.com/search/Europe%20The%20Final%20Countdown): obviously.

- ☐ `firebase deploy --only firestore:rules,firestore:indexes,storage` (new
  `(notify.pending, status)` collection-group index must finish **building**
  before the reconciler's notify sweep can query). Rules deploy also ships the
  new admin-only `jobHealth/{jobName}` read rule that the System Health page
  needs.
- ☐ Deploy functions: `generateReplicateSplat`, `getGenerationJobStatus`,
  `replicateJobWebhook`, `onSplatAssetCreated`, `reconcileGenerationJobs`,
  `triggerReconcileGenerationJobs`. Confirm `POSTMARK_API_KEY` is bound to the
  reconciler.
- ☐ `gsutil cors set public/cors.json gs://<bucket>` (byte-range headers).
- ☐ Lift `rad-dispatch.js` `RAD_CONFIG` off hardcoded dev values; stand up the
  prod Cloud Run service + Cloud Tasks queue + invoker SA + IAM.
- ☐ Deploy hosting (generator bundle, `splat-viewer.html`).
