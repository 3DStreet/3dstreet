"""
Cog predictor for Tencent HY-World 2.0 (WorldMirror 2.0 reconstruction).

Takes a video file or a zip of multi-view images and returns a zip of
reconstructed 3D assets: gaussian splats (.ply), point cloud (.ply),
depth maps, normal maps, and camera parameters.

Upstream: https://github.com/Tencent-Hunyuan/HY-World-2.0
"""

import os
import shutil
import sys
import tempfile
import time
import zipfile
from pathlib import Path

# Make the cloned upstream repo importable.
sys.path.insert(0, "/opt/hy-world")

import torch
from cog import BasePredictor, Input, Path as CogPath


VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp", ".heic"}


def _is_video(path: Path) -> bool:
    return path.suffix.lower() in VIDEO_EXTENSIONS


def _extract_zip_of_images(zip_path: Path, dest_dir: Path) -> Path:
    """Unzip into dest_dir and return the directory containing the images.

    If the zip contains a single top-level folder, returns that folder.
    Filters out hidden/system files (e.g. __MACOSX, .DS_Store).
    """
    dest_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        for member in zf.infolist():
            name = member.filename
            if name.startswith("__MACOSX/") or name.endswith("/.DS_Store"):
                continue
            zf.extract(member, dest_dir)

    entries = [p for p in dest_dir.iterdir() if not p.name.startswith(".")]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return dest_dir


def _zip_directory(src_dir: Path, zip_path: Path) -> None:
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _, files in os.walk(src_dir):
            for fname in files:
                fpath = Path(root) / fname
                zf.write(fpath, fpath.relative_to(src_dir))


class Predictor(BasePredictor):
    """Cog predictor wrapping WorldMirrorPipeline for image/video → 3D."""

    def setup(self) -> None:
        from hyworld2.worldrecon.pipeline import WorldMirrorPipeline

        if not torch.cuda.is_available():
            raise RuntimeError("CUDA GPU required for HY-World 2.0 inference.")

        print(f"CUDA device: {torch.cuda.get_device_name(0)}")
        start = time.time()

        # bf16 substantially reduces memory; weights are pre-cached in the
        # image so this just loads from local HF cache.
        self.pipeline = WorldMirrorPipeline.from_pretrained(
            "tencent/HY-World-2.0",
            subfolder="HY-WorldMirror-2.0",
            enable_bf16=True,
        )
        print(f"Pipeline ready in {time.time() - start:.1f}s")

    def predict(
        self,
        input_file: CogPath = Input(
            description=(
                "A video file (mp4/mov/etc.) or a .zip archive of multi-view "
                "images. With a video, frames are extracted at the given fps."
            ),
        ),
        target_size: int = Input(
            description=(
                "Maximum resolution (longest edge). Images are resized and "
                "center-cropped to the nearest multiple of 14."
            ),
            default=952,
            ge=224,
            le=1568,
        ),
        fps: int = Input(
            description="Frames-per-second to extract from a video input.",
            default=1,
            ge=1,
            le=30,
        ),
        video_max_frames: int = Input(
            description="Maximum number of frames to use from a video input.",
            default=32,
            ge=2,
            le=128,
        ),
        save_gaussians: bool = Input(
            description="Save 3D Gaussian splats (gaussians.ply).",
            default=True,
        ),
        save_points: bool = Input(
            description="Save dense point cloud (points.ply).",
            default=True,
        ),
        save_depth: bool = Input(
            description="Save per-view depth maps (PNG previews + .npy).",
            default=True,
        ),
        save_normal: bool = Input(
            description="Save per-view surface-normal maps.",
            default=True,
        ),
        save_camera: bool = Input(
            description="Save predicted camera parameters (camera_params.json).",
            default=True,
        ),
        apply_sky_mask: bool = Input(
            description="Mask out the sky region before reconstruction.",
            default=True,
        ),
        apply_edge_mask: bool = Input(
            description="Mask out unreliable depth/normal discontinuities.",
            default=True,
        ),
        compress_gs_max_points: int = Input(
            description="Max number of gaussians to retain in the output PLY.",
            default=5_000_000,
            ge=100_000,
            le=20_000_000,
        ),
        compress_pts_max_points: int = Input(
            description="Max number of points to retain in points.ply.",
            default=2_000_000,
            ge=100_000,
            le=10_000_000,
        ),
    ) -> CogPath:
        """Run reconstruction and return a zip of all generated assets."""
        in_path = Path(str(input_file))

        # Stage the input. The upstream pipeline takes either a directory of
        # images or a video file path, so we hand it whichever applies.
        work_dir = Path(tempfile.mkdtemp(prefix="hyw_in_"))
        try:
            if in_path.suffix.lower() == ".zip":
                pipeline_input = str(_extract_zip_of_images(in_path, work_dir))
            elif _is_video(in_path):
                # Cog hands us a temp file with no extension preserved on disk,
                # but `in_path` keeps the original suffix — pass it directly.
                pipeline_input = str(in_path)
            elif in_path.suffix.lower() in IMAGE_EXTENSIONS:
                # Single-image edge case: place it in a directory.
                staged = work_dir / in_path.name
                shutil.copy2(in_path, staged)
                pipeline_input = str(work_dir)
            else:
                raise ValueError(
                    f"Unsupported input '{in_path.name}'. Provide a video, "
                    "a single image, or a .zip of images."
                )

            out_root = Path(tempfile.mkdtemp(prefix="hyw_out_"))
            run_dir = out_root / "run"
            run_dir.mkdir(parents=True, exist_ok=True)

            t0 = time.time()
            self.pipeline(
                input_path=pipeline_input,
                output_path=str(out_root),
                strict_output_path=str(run_dir),
                target_size=target_size,
                fps=fps,
                video_max_frames=video_max_frames,
                save_depth=save_depth,
                save_normal=save_normal,
                save_gs=save_gaussians,
                save_camera=save_camera,
                save_points=save_points,
                apply_sky_mask=apply_sky_mask,
                apply_edge_mask=apply_edge_mask,
                compress_gs_max_points=compress_gs_max_points,
                compress_pts_max_points=compress_pts_max_points,
            )
            print(f"Reconstruction took {time.time() - t0:.1f}s")

            # If the pipeline ignored strict_output_path and wrote into a
            # timestamped subdir under out_root, fall back to zipping that.
            zip_src = run_dir if any(run_dir.iterdir()) else out_root
            zip_path = Path(tempfile.mkdtemp(prefix="hyw_zip_")) / "hy_world_output.zip"
            _zip_directory(zip_src, zip_path)
            return CogPath(zip_path)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)
