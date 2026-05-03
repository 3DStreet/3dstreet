#!/usr/bin/env python3
"""Pack a directory of images into a zip for `cog predict -i input_file=@...`.

Usage:
    python scripts/make_sample_zip.py /path/to/images samples/scene.zip
"""

import argparse
import sys
import zipfile
from pathlib import Path

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp", ".heic"}


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("src", type=Path, help="Directory of images")
    p.add_argument("dest", type=Path, help="Output .zip path")
    args = p.parse_args()

    if not args.src.is_dir():
        print(f"error: {args.src} is not a directory", file=sys.stderr)
        return 1

    images = sorted(
        f for f in args.src.iterdir()
        if f.is_file() and f.suffix.lower() in IMAGE_EXTS
    )
    if not images:
        print(f"error: no images found in {args.src}", file=sys.stderr)
        return 1

    args.dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(args.dest, "w", zipfile.ZIP_DEFLATED) as zf:
        for img in images:
            zf.write(img, img.name)

    print(f"wrote {len(images)} images to {args.dest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
