"""composite_labels.py — overlay the 2D cross-section label bar + branding.

The label bar is NOT baked into the GLB (per the pipeline design); it's drawn
here with Pillow from the travelled-way segments, mirroring the cell layout of
src/aframe-components/street-label.js drawLabels() (proportional cell widths,
per-segment accent band, width value + wrapped name), plus the title and
"made with 3DStreet" branding from street-render-harness.js capture().

    python3 composite_labels.py --render r.png --street street.json --out out.png \
        [--units metric|imperial] [--title "..."] [--no-branding]
"""

import argparse
import json
import re
from PIL import Image, ImageDraw, ImageFont

# street-label.js SURFACE_SWATCHES
SURFACE_SWATCHES = {
    "asphalt": "#4e5459",
    "cracked-asphalt": "#4e5459",
    "concrete": "#c4c8cc",
    "sidewalk": "#c4c8cc",
    "grass": "#81b371",
    "planting-strip": "#81b371",
    "gravel": "#b1a58f",
    "sand": "#e3d5ac",
    "hatched": "#d8dade",
}


def accent_color_for(color, surface):
    if color:
        c = color.strip()
        hexm = re.match(r"^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$", c)
        is_white = re.match(r"^white$", c, re.I)
        if hexm and not is_white:
            h = hexm.group(1)
            if len(h) == 3:
                r, g, b = (int(ch * 2, 16) for ch in h)
            else:
                r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
            if (r + g + b) / 3 < 240:
                return c
        elif not is_white and not hexm:
            return c
    return SURFACE_SWATCHES.get(surface, "#d8dade")


def font(size):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def wrap_text(draw, text, fnt, max_w):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        if draw.textlength(trial, font=fnt) <= max_w or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def draw_label_bar(width, bar_h, segments, units):
    """Draw the cross-section bar; returns an RGBA image width x bar_h."""
    img = Image.new("RGBA", (width, bar_h), (255, 255, 255, 255))
    d = ImageDraw.Draw(img)

    travelled = [s for s in segments if (s.get("type") or "") != "boundary"]
    widths = [float(s.get("width") or 0) for s in travelled]
    total = sum(widths) or 1.0

    band_h = round(bar_h * 0.12)
    val_font = font(round(bar_h * 0.24))
    name_font = font(round(bar_h * 0.15))

    x = 0.0
    for seg, w in zip(travelled, widths):
        cell_w = (w / total) * width
        cx = x + cell_w / 2
        accent = accent_color_for(seg.get("color"), seg.get("surface"))
        # accent band along the top edge
        d.rectangle([x, 0, x + cell_w, band_h], fill=accent)
        # separator
        if x > 0:
            d.line([(x, band_h), (x, bar_h)], fill="#e3e5e9", width=max(1, round(bar_h * 0.015)))
        # width value
        if units == "imperial":
            val = f"{w * 3.28084:.1f}ft"
        else:
            val = f"{w:.1f}m"
        d.text((cx, bar_h * 0.42), val, font=val_font, fill="#22272e", anchor="mm")
        # segment name, wrapped
        name = seg.get("name") or seg.get("type") or ""
        if name:
            lines = wrap_text(d, name, name_font, cell_w * 0.9)
            lh = round(bar_h * 0.15 * 1.2)
            y0 = bar_h * 0.72 - (len(lines) - 1) * lh / 2
            for i, line in enumerate(lines):
                d.text((cx, y0 + i * lh), line, font=name_font, fill="#6a7076", anchor="mm")
        x += cell_w
    # top hairline separating bar from render
    d.line([(0, 0), (width, 0)], fill="#c9ccd1", width=2)
    return img


def draw_text_shadow(d, xy, text, fnt, fill, anchor):
    x, y = xy
    for dx, dy in ((-1, 1), (1, 1), (1, -1), (-1, -1), (0, 2)):
        d.text((x + dx, y + dy), text, font=fnt, fill=(0, 0, 0, 140), anchor=anchor)
    d.text(xy, text, font=fnt, fill=fill, anchor=anchor)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--render", required=True)
    ap.add_argument("--street", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--units", default="metric")
    ap.add_argument("--title", default=None)
    ap.add_argument("--no-branding", action="store_true")
    args = ap.parse_args()

    payload = json.load(open(args.street))
    street = payload.get("street", payload)
    options = payload.get("options", {})
    units = options.get("units", args.units)
    segments = street.get("segments", [])

    render = Image.open(args.render).convert("RGBA")
    W, H = render.size

    # Title (top-left) + branding (bottom-right), drawn on the render.
    d = ImageDraw.Draw(render)
    scale = W / 1200.0
    title = args.title if args.title is not None else options.get("title", street.get("name", ""))
    if title:
        draw_text_shadow(d, (round(24 * scale), round(20 * scale)), title,
                         font(round(30 * scale)), (255, 255, 255, 255), "la")
    if not args.no_branding and options.get("branding", True) is not False:
        draw_text_shadow(d, (W - round(20 * scale), H - round(16 * scale)),
                         "made with 3DStreet · 3dstreet.app",
                         font(round(17 * scale)), (255, 255, 255, 235), "rd")

    # Label bar appended below the render.
    bar_h = round(W * 0.085)
    bar = draw_label_bar(W, bar_h, segments, units)

    out = Image.new("RGBA", (W, H + bar_h), (255, 255, 255, 255))
    out.paste(render, (0, 0))
    out.paste(bar, (0, H))
    out.convert("RGB").save(args.out)
    print(f"[composite] wrote {args.out} ({out.size[0]}x{out.size[1]})")


if __name__ == "__main__":
    main()
