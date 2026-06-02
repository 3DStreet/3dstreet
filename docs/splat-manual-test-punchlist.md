# Splat / Generation-Queue — Manual Test Punch List

Manual QA for the splat generation feature (PR #1650) and the two follow-ups:
background-job monitoring escalation and completion-email notifications.

Run against **dev/staging** (`dev-3dstreet`) first — cloudrun RAD config is still
hardcoded to dev. Use a real signed-in account with `genToken` available, plus a
second throwaway account for the "no email on file" edge case if you have one.

Legend: ☐ todo · ✅ pass · ❌ fail (note what happened)

---

## 1. Splat generation — happy path (tab open)
- ☐ Generator → **Splat** tab. Upload a source image; the preview shows it.
- ☐ "Generate Splat (1 token)" → button shows "Uploading…", then "Generating…",
  and the loading panel flips to the "you can close this tab" copy + a running
  timer once queued.
- ☐ Token balance drops by 1 immediately (charged on submit).
- ☐ A **pending card** appears in the Assets gallery (driven by the job doc).
- ☐ On completion: result iframe renders the splat (orbit/zoom), pending card is
  replaced by the real asset, "Splat generated!" toast.
- ☐ Gallery asset is draggable into a scene from the editor Assets panel.

## 2. Browser-independent completion (tab closed mid-job)
- ☐ Start a generation, then **close the tab** while it's still "Generating…".
- ☐ Reopen the app a few minutes later → the splat is in the Assets gallery
  (saved server-side by the webhook, no client involvement).

## 3. Completion email — default ON, tab closed → email sent
- ☐ Confirm the **"Email me when my splat is ready"** checkbox is **checked by
  default**.
- ☐ Generate, then **close the tab** immediately after it reaches "Generating…".
- ☐ Wait for completion + grace (≤ ~13 min: 10-min reconciler + 3-min grace).
- ☐ Receive the **"Your 3DStreet splat is ready"** email (Postmark). Link opens
  the app.
- ☐ Job doc shows `notify.sentAt` set, `notify.pending: false`. **Exactly one**
  email (re-running the reconciler does not re-send).

> Faster than waiting for the schedule: as an admin, call
> `triggerReconcileGenerationJobs({ dryRun: false })` to force the sweep. Use
> `{ dryRun: true }` first to preview `notify.sent`/`suppressed`/`waiting`.

## 4. Completion email — tab open → suppressed
- ☐ Generate with the box checked but **keep the tab open** until you see the
  result.
- ☐ Job doc shows `notify.clientAckedAt` set, `notify.pending: false`.
- ☐ Trigger the reconciler → notify summary counts it under `suppressed`, **no
  email** arrives.

## 5. Completion email — opted out
- ☐ Generate with the checkbox **unchecked**, close the tab.
- ☐ Job doc has `notify: { email: false, pending: false }`; reconciler never
  queries it; **no email** regardless of tab state.

## 6. Failure path
- ☐ Force a failure (e.g. invalid/garbage source the model rejects, or cancel the
  Replicate prediction).
- ☐ Token is **refunded** (balance returns); job doc `status: 'failed'`.
- ☐ **No email** (success-only by design), even with the box checked + tab closed.
- ☐ If tab open: error toast shown.

## 7. Reconciler backstop (dropped webhook / wedged save)
- ☐ Simulate a dropped webhook: complete a prediction but block/ignore the
  webhook (or just rely on a naturally missed one), tab closed.
- ☐ After the next sweep, the job reaches `succeeded` (or `failed` + refund past
  the give-up window) — nothing stays stuck.
- ☐ A job manually left in `saving` past the TTL gets re-taken and finishes.

## 8. Monitoring escalation
- ☐ Force a give-up (a job with no `providerJobId` older than 30 min, or a
  provider-absent prediction) and run the sweep.
- ☐ Cloud Logging shows the **`ALERT: generation jobs need attention`** line at
  **ERROR** severity; it surfaces in Cloud Error Reporting.
- ☐ (If wiring alerts) confirm the Error Reporting / log-based-alert notification
  channel fires.

## 9. RAD optimization (cloudrun, automatic)
- ☐ After a splat asset is created (generated OR drag-uploaded), a
  `kind: 'splat-rad'`, `provider: 'cloudrun'`, `tokenCost: 0` job runs
  `queued → running → succeeded`.
- ☐ Asset doc gets `optimizedSourceUrl` / `optimizedSourcePath` /
  `optimizedSourceSize`; quota tally **excludes** `optimizedSourceSize`.
- ☐ Dragging the splat into a scene now streams the `.rad` (byte-range / HTTP
  206, paged), not the full `.ply`.
- ☐ A `.rad` uploaded directly is left as-is (no re-conversion).
- ☐ cloudrun reconciler: a wedged RAD job re-enqueues; a truly old one gives up.

## 10. Upload formats & size limits
- ☐ Drag-upload each splat format: `.ply`, `.spz`, `.splat`, `.rad` — each loads
  and renders.
- ☐ Per-plan size caps enforced client-side and in `getUploadQuota`
  (free/pro/max). Oversized upload is rejected with a clear message.
- ☐ Generated `.ply` over the client cap still saves server-side (server ceiling
  is higher).

## 11. Thumbnails & preview cache
- ☐ Opening the splat viewer lazily captures a thumbnail; `thumbnailUrl` backfills
  on the asset and shows in the gallery.
- ☐ Preview modal reuses the editor cache for the same splat URL (no second full
  download).

## 12. End-to-end persistence
- ☐ Drag a generated splat into a scene, **save** the scene, reload → splat loads
  from the saved `storageUrl`/`optimizedSourceUrl`.
- ☐ Open the saved scene in an **anonymous/incognito** session → the splat loads
  via the download token (no auth).

---

## Pre-prod deployment checklist (from the PR punch list)
- ☐ `firebase deploy --only firestore:rules,firestore:indexes,storage` (new
  `(notify.pending, status)` collection-group index must finish **building**
  before the reconciler's notify sweep can query).
- ☐ Deploy functions: `generateReplicateSplat`, `getGenerationJobStatus`,
  `replicateJobWebhook`, `onSplatAssetCreated`, `reconcileGenerationJobs`,
  `triggerReconcileGenerationJobs`. Confirm `POSTMARK_API_KEY` is bound to the
  reconciler.
- ☐ `gsutil cors set public/cors.json gs://<bucket>` (byte-range headers).
- ☐ Lift `rad-dispatch.js` `RAD_CONFIG` off hardcoded dev values; stand up the
  prod Cloud Run service + Cloud Tasks queue + invoker SA + IAM.
- ☐ Deploy hosting (generator bundle, `splat-viewer.html`).
