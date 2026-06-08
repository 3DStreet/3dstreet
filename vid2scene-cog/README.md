# vid2scene Cog — video → Gaussian splat for 3DStreet

Packages the **standalone** [vid2scene](https://github.com/samuelm2/vid2scene)
reconstruction pipeline as a [Replicate Cog](https://github.com/replicate/cog),
so 3DStreet can offer a **"Video → Splat (vid2scene)"** model alongside the
existing **"Image → Splat (SHARP)"** option — exactly the way the image
generator offers multiple models.

This wraps **only** `vid2scene_core/` (frame extraction → GLOMAP SfM → gsplat
training → `.ply`). It uses **none** of the vid2scene SaaS (Django web,
Postgres, Redis/django-rq, Azurite blob, Stripe billing) — 3DStreet already
provides the queue, storage, auth, and tokens.

**Contract:** `video` in → one `.ply` splat out. 3DStreet's `generateReplicateSplat`
streams that `.ply` into the user's gallery; the downstream RAD/LOD Cloud Run
pipeline (`onSplatAssetCreated`) optimizes it. See
`docs/vid2scene-video-to-splat.md`.

## ⚠️ This cannot be built in a CPU sandbox

The image needs **CUDA 12.4 + an NVIDIA GPU** and compiles COLMAP/glomap/gsplat/
spz from source (~30 GB, long build). Build and push it from a CUDA machine
(your workstation, a GPU cloud VM, or `cog`'s remote build). The files here are
authored to be correct but are **untested** — validate on a real build.

## Files

| File | Purpose |
| --- | --- |
| `cog.yaml` | Build recipe — mirrors the upstream `Worker_Dockerfile` (deps + compile steps). |
| `predict.py` | `Predictor` wrapping `vid2scene_core/vid2scene.py::process_video_to_scene`. |

## Build & push

```bash
# On a CUDA + NVIDIA-GPU machine with cog installed:
cd vid2scene-cog
# Pin the upstream commit for reproducibility (recommended):
#   edit cog.yaml → VID2SCENE_REF, or pass --build-arg if you template it.

cog build                     # local build (slow: compiles COLMAP/gsplat)
cog predict -i video=@orbit.mp4   # smoke test on the GPU box

# Publish to Replicate (create the model first at replicate.com):
cog login
cog push r8.im/<owner>/vid2scene
```

Then point 3DStreet at it: set `REPLICATE_MODELS.vid2scene.modelName` in
`public/functions/replicate-models.js` to `<owner>/vid2scene` (it currently
reads `3dstreet/vid2scene` as a placeholder). The backend resolves the latest
version at runtime, so re-pushes don't need a code change.

## Two build strategies

1. **This `cog.yaml`** (chosen here): reproduce the upstream build steps in
   `build.run`. Simplest to reason about; the `|| echo 'ADJUST: …'` lines flag
   the spots where the exact upstream submodule paths must be confirmed against
   the current `Worker_Dockerfile` (they move occasionally).
2. **Wrap the upstream `Worker_Dockerfile`**: build that image, then add a thin
   Cog HTTP layer. More faithful to upstream's exact environment, but heavier to
   maintain. Switch to this if (1) proves brittle across upstream changes.

## Inputs (predict.py)

| Input | Default | Notes |
| --- | --- | --- |
| `video` | — | A short, steady orbit of a static subject. |
| `reconstruction_method` | `glomap` | `glomap` needs no weights (keeps licensing clean). |
| `target_framecount` | 600 | Frames sampled from the video. |
| `training_num_steps` | 30000 | Lower = faster, lower quality. |
| `training_max_num_gaussians` | 1_000_000 | **Also caps `.ply` size** — keep generated splats under 3DStreet's 100 MB `storage.rules` ceiling. |
| `remove_background` | false | |
| `equirectangular` | false | 360 video. |

VGGT / SAM3 paths are intentionally **omitted** — they're gated HuggingFace
models (one is `*-Commercial`) and upstream notes they're lower quality than
GLOMAP. Add them later only if needed (would require `HF_TOKEN` as a Cog secret).
