# vid2scene — Video → Splat (second splat generator model)

Adds a **video-to-splat** option to the Generator's Splat tab, alongside the
existing image-to-splat (SHARP) model — picked from a dropdown, the same way the
image generator offers multiple models. Video reconstruction is the open-source
[vid2scene](https://github.com/samuelm2/vid2scene) pipeline (by samuelm2),
packaged as a Replicate Cog.

Parent design: [`generation-job-queue.md`](./generation-job-queue.md) (this is a
new **model** for the existing `kind: 'splat'`, `provider: 'replicate'` job — not
a new provider). RAD/LOD optimization of the result is the existing
[`rad-cloud-run-pipeline.md`](./rad-cloud-run-pipeline.md), reused unchanged.

---

## Why this is small

vid2scene's output is a **`.ply` Gaussian splat** — the same artifact
`kfarr/sharp-ml` already produces. So everything downstream of "produce the
`.ply`" already exists and is reused verbatim:

- `saveSplatToGallery` streams the `.ply` into Storage as a `type: 'splat'` asset,
- `onSplatAssetCreated` → the Cloud Run **RAD/LOD** pipeline optimizes it,
- the editor renders/places it via `optimizedSourceUrl ?? storageUrl`,
- the async webhook/poll/reconciler/refund/notify machinery is identical.

The integration is therefore "**add another model that emits a `.ply`**", plus
one genuinely new piece: a **video** source is too large to base64 through the
callable, so it's uploaded straight to Storage and the path is passed to the
backend (the large-source pattern the queue doc anticipated for Teleport).

## What we took from upstream (and what we left behind)

vid2scene is a self-hostable SaaS (Apache-2.0). It splits cleanly:

| Upstream | Decision |
| --- | --- |
| `vid2scene_core/` — the standalone CLI pipeline (`vid2scene.py::process_video_to_scene`): frame extraction → GLOMAP SfM → gsplat training → `.ply` (+ SOG/LOD) | ✅ **Keep** — wrapped as a Cog |
| `Worker_Dockerfile` build recipe (CUDA 12.4; compile glomap/gsplat/spz/autolod) | ✅ **Keep** — mirrored in `cog.yaml` |
| `vid2scene_server/` (Django web + REST + Svelte viewer), Postgres, Redis/`django-rq`, Azurite blob, Stripe billing (`BILLING_ENABLED`), auth/superuser | ❌ **Drop** — 3DStreet already provides all of this |
| Optional VGGT / SAM3 paths (gated HuggingFace models, one `*-Commercial`; upstream calls them lower-quality than GLOMAP) | ❌ **Skip for v1** — GLOMAP needs no weights, keeps licensing clean |

The upstream entrypoint is a pure CLI with no Django/Redis deps:

```bash
python vid2scene_core/vid2scene.py --video_path in.mp4 \
  --reconstruction_method glomap --target_framecount 600 \
  --training_num_steps 30000 <output_dir>
# → <output_dir>/ply/splat.ply
```

`process_video_to_scene(...)` returns the path to that `.ply`.

## Hosting decision — Replicate Cog (v1)

vid2scene needs a **GPU + CUDA** and runs for minutes (SfM + 30k-step training).
We package it as a **Replicate Cog** (exactly how `sharp-ml` was packaged), which
lets it reuse 3DStreet's entire `provider: 'replicate'` flow with near-zero
backend change. Replicate owns the GPU, the ~30 GB image, and scaling.

The cost-optimized alternative — **Cloud Run GPU**, reusing the already-built
`provider: 'cloudrun'` worker-writeback adapter (the RAD converter pattern) — is
the planned v2 once volume justifies the egress savings. Both seams already exist
in the codebase, so the later move is cheap.

---

## As-built (this change)

### Cog — `vid2scene-cog/`
- `cog.yaml` mirrors the upstream `Worker_Dockerfile` build (deps + compile
  glomap/ply-to-sog/3dgs-autolod/spz + gsplat); clones the upstream repo at a
  pinned ref.
- `predict.py` wraps `process_video_to_scene`: `video` in → one `.ply` out.
- **Must be built/pushed from a CUDA + GPU machine** (it cannot build in a CPU
  sandbox). Then create the Replicate model and `cog push`. See
  [`../vid2scene-cog/README.md`](../vid2scene-cog/README.md).

### Backend — `public/functions/`
- **`replicate-models.js`**: new `vid2scene` model entry (`type: 'splat'`,
  `inputKind: 'video'`, `modelName: '3dstreet/vid2scene'` — **placeholder, update
  to the real Replicate slug after `cog push`**, `tokenCost: 5` — **placeholder,
  tune to measured cost**). Also gave `sharp-ml` explicit `inputKind: 'image'`,
  `assetSlug`/`assetLabel`, and `attribution` so naming + credit are model-aware.
- **`replicate.js` / `generateReplicateSplat`**: generalized to accept either
  `input_image` (existing base64 → staged) **or** `input_video` (a Storage path
  the client already uploaded). For video it `makePublic()`s the path (mirroring
  the image-staging path), passes it to Replicate as `input.video`, records it as
  `tempFilePath`, and cleans it up on completion/failure via the existing
  `cleanupSplatTempFile`. Asset filename/label and the saved asset's
  `generationMetadata` now come from the model config / job `attribution` (SHARP
  fallback for old jobs). `kind` stays `'splat'`, so the webhook, poll,
  reconciler, persist, and RAD trigger are all unchanged.

### Frontend — `src/generator/splat.js`
- A **Model** dropdown ("Image → Splat (SHARP)" / "Video → Splat (vid2scene)"),
  toggling an image-upload block vs a video-upload block. The model-aware blurb,
  license/attribution notice, and token-cost button label update on change.
- **Video mode** uploads the file to `users/{uid}/assets/splat-sources/{uuid}.<ext>`
  via `uploadBytesResumable` (resumable, with a `%` progress label) — allowed by
  the existing `users/{uid}/assets/**` Storage rule (`video/*`, ≤ 5 GB) — then
  calls `generateReplicateSplat({ input_video: <path>, model_id: 'vid2scene' })`.
  Client guard: `VIDEO_MAX_BYTES` (200 MB).
- The submit/poll/result/timer/notify logic is unchanged from the image flow.

### Data flow
```
[video] --client upload--> Storage users/{uid}/assets/splat-sources/{uuid}.mp4
        --generateReplicateSplat({input_video, model_id:'vid2scene'})-->
  job doc {kind:'splat', provider:'replicate', model:'3dstreet/vid2scene'}
  makePublic(path) → Replicate predictions.create(input:{video:url}, webhook)
        --webhook/poll--> processTerminalPrediction → saveSplatToGallery(.ply)
        --onSplatAssetCreated--> Cloud Run RAD/LOD → optimizedSource* on asset
  cleanupSplatTempFile(path)   # deletes the uploaded source video
```

---

## Remaining work (before public launch)

- [ ] **Build + push the Cog** from a GPU box; create the Replicate model.
      Validate the `ADJUST:` build lines in `cog.yaml` against the current
      upstream submodule layout, and confirm where `process_video_to_scene`
      writes the `.ply`.
- [ ] **Set `modelName`** in `replicate-models.js` to the real `<owner>/vid2scene`
      slug, and **tune `tokenCost`** against measured Replicate GPU cost.
- [ ] **Output size:** `storage.rules` caps a generated `.ply` at **100 MB**. Cap
      `training_max_num_gaussians`/`target_framecount` (or emit `.spz`/SOG, which
      vid2scene supports) so large scenes stay under it.
- [ ] **Temp source GC:** `cleanupSplatTempFile` deletes the uploaded video on
      terminal. Confirm the reconciler's give-up path also cleans it (it calls
      `cleanupSplatTempFile(job.tempFilePath)` — verify for video jobs), so an
      abandoned upload can't linger.
- [ ] **Deploy:** `cd public && firebase deploy --only functions:generateReplicateSplat`
      + the generator hosting bundle. No new secrets (reuses `REPLICATE_API_TOKEN`).
- [ ] **Quality guidance:** surface capture tips (slow orbit, static subject,
      good light) — partially in the model blurb already.

## v2 — Cloud Run GPU (cost-optimized)

Re-skin the same Cog container as a Cloud Run **GPU** service and dispatch via
the existing `provider: 'cloudrun'` worker-writeback adapter (mirror
`rad-converter/` + `onSplatAssetCreated` + the reconciler's `case 'cloudrun'`).
GCP-native, scale-to-zero, no cross-cloud egress. Watch the Cloud Run request
timeout (60 min cap) vs training time, L4-only GPU, and GPU quota.
