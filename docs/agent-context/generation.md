# Generator

[Back to the codebase guide](../../CLAUDE.md). Source paths start at the
repository root; bare filenames name modules within this subsystem.

**Structure:** Vanilla JS app (modify/create/video/gallery tabs) + React islands (auth, navigation, purchase modal)

**Island Architecture:** React components mounted via `mount-*.js` files into specific DOM elements

**Workflow:** User prompt → token check → Firebase Cloud Function (fal.ai or Replicate) submits an async job → jobId → client polls; result saved to gallery server-side

**Token system:** TokenSync syncs Firestore → Zustand, PurchaseModal for Stripe checkout. One-time gen-token packs (#1374, paid plans only, flat $0.10/token): `BuyTokensModal` (shared) → `createStripeSession` (mode `payment`, server-gated to Pro/Max) → `stripeWebhook` grants via idempotent transaction + `tokenLog` `type: 'purchase'` row; pack definitions mirrored in `public/functions/token-packs.js` + `src/shared/components/UpgradeModal/pricing.js` (drift-guarded by `test/shared/pricing-sync.test.js`); purchased tokens survive the monthly top-up-to-floor refill (regression test: `test/core/token-packs.test.js`). Entry points: generator via `UpgradeModal.onAlreadyPro`; editor via `useStore.startBuyTokens()` (ScreenshotModal 4x pre-flight + `resource-exhausted` submit rejection, `EditorBuyTokensModal` adapter)

**Async job queue:** All user-initiated AI generations use `users/{uid}/generationJobs/{jobId}` (provider-agnostic, survives a closed browser). Providers today: `replicate` (image→splat via SHARP, image→video via Veo/Kling/LTX, image→image via nano-banana/seedream/kontext — converge on one idempotent processor via webhook + poll + reconciler; results saved to the gallery server-side), `fal` (image→3D mesh via Hunyuan3D/TRELLIS and image→image via flux-2 edit — same convergent shape via `fal_webhook` → `falJobWebhook` + the shared `fetchFalPrediction` adapter), and `cloudrun` (`.ply`→RAD/LOD conversion via the `rad-converter` Cloud Run service; worker-writeback, `tokenCost: 0`, triggered by `onSplatAssetCreated`). A scheduled reconciler backstops all of them. Outcome emails (success and failure — "didn't finish, tokens refunded") send from the webhook in real time (after a ~10s open-tab ack grace so a watching tab suppresses them); the opt-in checkbox appears only while a job is rendering, defaults checked for every kind, and writes through post-submit via `setGenerationJobNotify`. Design: [docs/generation-job-queue.md](../generation-job-queue.md); RAD pipeline: [docs/rad-cloud-run-pipeline.md](../rad-cloud-run-pipeline.md).
