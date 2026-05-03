# HY-World 2.0 Replicate (cog)

Cog deployment of [Tencent HY-World 2.0](https://github.com/Tencent-Hunyuan/HY-World-2.0) — specifically the **WorldMirror 2.0** reconstruction component, a unified feed-forward model that takes multi-view images or a video and predicts depth, surface normals, camera parameters, point clouds, and 3D Gaussian splats in a single pass.

Modeled after [`kfarr/sharp-ml-replicate`](https://github.com/kfarr/sharp-ml-replicate).

Model: https://huggingface.co/tencent/HY-World-2.0
Paper / repo: https://github.com/Tencent-Hunyuan/HY-World-2.0

## Files

- `cog.yaml` — Build config (CUDA 12.4, Python 3.10, torch 2.4.0, prebuilt FlashAttention-2 + gsplat wheels, model weights baked in).
- `predict.py` — Cog predictor (`Predictor`). Accepts a video or a zip of images, returns a zip of reconstructed assets.
- `scripts/make_sample_zip.py` — Helper to package a directory of images into a `samples/scene.zip` for local `cog predict` runs.
- `LICENSE` — MIT, covers the wrapper code only. The underlying model has its own Tencent Hunyuan license.

## Inputs

- `input_file` — A video (`.mp4`/`.mov`/...) **or** a `.zip` of multi-view images. A single image is also accepted.
- `target_size` — Longest-edge resolution; resized to a multiple of 14. Default `952`.
- `fps`, `video_max_frames` — Frame extraction controls for video input.
- `save_gaussians`, `save_points`, `save_depth`, `save_normal`, `save_camera` — Toggle output assets.
- `apply_sky_mask`, `apply_edge_mask` — Filter unreliable regions before reconstruction.
- `compress_gs_max_points`, `compress_pts_max_points` — Caps on output density.

## Output

A single `.zip` containing the run directory, e.g.:

```
hy_world_output.zip
├── gaussians.ply        # 3D Gaussian splatting (drop into 3DStreet / a splat viewer)
├── points.ply           # Dense point cloud
├── camera_params.json   # Predicted intrinsics + extrinsics per view
├── depth/               # depth_0000.png + depth_0000.npy per view
└── normal/              # normal_0000.png per view
```

`gaussians.ply` is the headline asset for 3DStreet workflows.

## Build & push

Get a CLI token from https://replicate.com/auth/token (different from the API token):

```bash
cog login --token-stdin
# paste token, Enter, Ctrl+D

cog push r8.im/<your-username>/hy-world
```

## Local test

Package up a folder of images, then run a prediction:

```bash
python scripts/make_sample_zip.py /path/to/multi-view-images samples/scene.zip
cog predict -i input_file=@samples/scene.zip -i target_size=952
```

Or with a video:

```bash
cog predict -i input_file=@samples/clip.mp4 -i fps=2 -i video_max_frames=24
```

## Calling from the Replicate API

Once pushed, the model is invokable like any other Replicate model:

```python
import replicate

output = replicate.run(
    "<your-username>/hy-world:<version>",
    input={
        "input_file": open("scene.zip", "rb"),
        "target_size": 952,
        "fps": 2,
    },
)
# `output` is a URL to the result zip — download and unzip it.
```

## Build notes

- **FlashAttention** is installed from a prebuilt wheel (`flash-attn 2.7.0.post2`, cu12, torch 2.4, py310). Building from source on Replicate routinely exceeds the build timeout. If the wheel link 404s, generate a matching one from https://github.com/Dao-AILab/flash-attention/releases or fall back to building in `cog.yaml`'s `run:` step.
- **gsplat** uses the upstream-blessed wheel (`v1.5.3+pt24cu124-cp310`).
- Model weights (~6 GB) are pre-downloaded during build via `huggingface_hub.snapshot_download` so the first prediction doesn't pay the download cost.
- `bf16` is enabled in `setup()` to keep activation memory in check on smaller GPUs (A40/L40 work; 24 GB cards may need to drop `target_size`).
- `uniception` and `pycolmap==3.10.0` are upstream-required and unusual — keep them pinned.

## Known limitations

- Only the **WorldMirror 2.0** (reconstruction) component is wired up. The full text/image → world generation pipeline (HY-Pano 2.0, WorldNav, WorldStereo 2.0) is not yet released by Tencent as of this writing — wire those up here when they ship.
- `--use_fsdp` multi-GPU mode is not exposed; Replicate predictions run on a single GPU.
- Multi-view input must contain at least 2 views for a useful reconstruction.

## Hardware

Recommend an **A100 40GB** or **L40S** for default settings. A40 / L40 work but may need `target_size <= 800` and a smaller `video_max_frames`. Set the GPU tier on Replicate via `cog push` after configuring your model's hardware in the Replicate dashboard.

## Attribution

- Model and pipeline code: [Tencent HY-World 2.0](https://github.com/Tencent-Hunyuan/HY-World-2.0) — Tencent Hunyuan license.
- Cog wrapper structure: inspired by [`kfarr/sharp-ml-replicate`](https://github.com/kfarr/sharp-ml-replicate).
- Wrapper code in this repo: MIT (see `LICENSE`).
