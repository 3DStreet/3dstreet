---
name: street-cross-section
description: >-
  Render a street cross-section image from a natural-language description using
  the 3DStreet render endpoint. Use when the user asks to visualize, render,
  draw, or "make a cross section / street section" of a road, street, avenue,
  or arterial — e.g. lanes of traffic, bike lanes, sidewalks, medians, parking,
  transit, or buildings. Produces a hosted image URL plus an "open in editor"
  deep link for further editing in 3DStreet.
---

# Street Cross-Section Renderer

Turn a user's plain-English street request into a **managed-street JSON** blob,
render it to an image via the public 3DStreet render endpoint, then show the
user the image and an "open in editor" link.

There is no server to run and no auth. You make one `curl` call; the edit link
is built from the JSON you already composed (no round-trip).

## Flow

1. **Compose** a managed-street JSON blob from the request, following the
   Segment schema below. Order segments left-to-right across the street
   (e.g. sidewalk → bike lane → parking → drive lanes → median → … → sidewalk).
2. **Render**: POST the blob to the endpoint with `?format=json` and read
   `imageUrl` + `openInEditorUrl` from the response.
3. **Show** the `imageUrl` to the user (render it inline / as an image link).
4. **ALWAYS** surface `openInEditorUrl` as an
   **"Open in the 3DStreet editor to keep editing"** link — it recreates the
   exact street in the full editor (Google 3D Tiles maps, AI rendering, save,
   share). This is the whole point of the tool.

## Render call

```bash
curl -sS -X POST 'https://3dstreet.app/render-street?format=json' \
  -H 'Content-Type: application/json' \
  -d @street.json
```

Where `street.json` is `{ "street": { … }, "options": { … } }` (a bare
`{ name, length, segments }` object as the whole body also works).

The JSON response looks like:

```json
{
  "imageUrl": "https://3dstreet.app/render/img/v1/8f2a9c4d1e0b7a3f5c6d.png",
  "openInEditorUrl": "https://3dstreet.app/#managed-street-json:%7B...%7D",
  "meta": { "name": "Suburban Arterial", "width": 15.9, "length": 60, "segments": 5, "timedOut": false }
}
```

Use `imageUrl` to display the render. Surface `openInEditorUrl` as the
keep-editing link. Do **not** request the raw bytes or the base64 `image` field.

> **Latency:** a cold render launches a headless browser and can take 30–90s;
> warm renders are quick. Identical requests return the same cached `imageUrl`.

### Building the edit link yourself (optional)

`openInEditorUrl` is just the app URL with the street JSON URI-encoded after a
`#managed-street-json:` hash. If you ever need it without a render, build it
directly:

```
https://3dstreet.app/#managed-street-json:<encodeURIComponent(JSON.stringify(street))>
```

A GET render link works the same way with base64url:
`https://3dstreet.app/render-street?format=json&data=<base64url(JSON)>`.

## Managed-street JSON

```
{ name, length,                       // length = meters along travel (default 27; 60 is a good default)
  segments: [ {
    name, type, width, direction,     // one cross-section slice each
    surface, color, elevation,
    variant, side, floors,            // variant/side/floors: boundary segments only
    generated: {                      // optional procedural content
      clones:      [{ mode, modelsArray, spacing, count }],
      pedestrians: [{ density }],
      stencil:     [{ modelsArray, spacing }],
      striping:    [{ striping }]
    }
  } ] } }
```

### Segment schema (required fields: `type`, `surface`, `color`, `elevation`, `width`, `direction`)

- **`type`** — `"drive-lane"`, `"bike-lane"`, `"sidewalk"`, `"parking-lane"`,
  `"divider"`, `"grass"`, `"rail"`, `"bus-lane"`, `"boundary"`. Use `"boundary"`
  with `variant` + `side` for flanking land use (buildings, waterfront, fences):
  it renders outside the travelled way and auto-tiles models edge-to-edge — no
  `generated` needed.
- **`surface`** — `"asphalt"`, `"concrete"`, `"grass"`, `"sidewalk"`,
  `"gravel"`, `"sand"`, `"hatched"`, `"planting-strip"`, `"none"`, `"solid"`.
- **`color`** — hex, e.g. `"#888888"` for asphalt, `"#cccccc"` for concrete.
- **`elevation`** — meters: `0` road level, `0.15` curb/sidewalk. No negatives.
- **`width`** — meters. Typical drive lane 3.0–3.6, bike lane ~1.8–2.0,
  sidewalk 2–4, parking ~2.4.
- **`direction`** — `"none"`, `"inbound"`, `"outbound"`.
- **`variant`** (boundary only) — `"brownstone"`, `"suburban"`, `"arcade"`,
  `"water"`, `"grass"`, `"parking"`, `"sp-mixeduse"`, `"sp-residential"`,
  `"sp-big-box"`, `"custom"`.
- **`side`** (boundary only, required) — `"left"` or `"right"`.
- **`generated.clones`** — repeated models. `mode` ∈ `random|fixed|single`;
  `modelsArray` = comma-separated catalog ids
  (`sedan-rig`, `suv-rig`, `box-truck-rig`, `bus`, `fire-truck-rig`,
  `cyclist-cargo`, `bike-only-cargo`); `spacing` meters; `count` for random.
- **`generated.pedestrians`** — `density` ∈ `normal|dense` (on sidewalks).

### Render options (all optional; put in `options`)

`width`/`height` (px, 320–2560, default 1280×800), `fov` (deg, default 20;
smaller = more orthographic), `azimuth` (default 20), `elevation` (default 30),
`environment` (`day`/`night`/`sunset`…), `labels`, `vehicles`, `ground`,
`boundaries` (bools, default true), `units` (`metric`/`imperial`),
`title` (`""` to hide), `branding`, `type` (`png`/`jpg`), `quality` (0–1 jpg).

## Worked example

**User:** "Generate a cross section of a suburban arterial with a sidewalk, no
bike lane, and 3 lanes of traffic."

**Compose** (`street.json`) — sidewalks on both edges, three drive lanes
(one inbound, two outbound), no bike lane:

```json
{
  "street": {
    "name": "Suburban Arterial",
    "length": 60,
    "segments": [
      { "name": "Sidewalk", "type": "sidewalk", "surface": "sidewalk", "color": "#cccccc", "elevation": 0.15, "width": 3, "direction": "none",
        "generated": { "pedestrians": [{ "density": "normal" }] } },
      { "name": "Inbound Drive Lane", "type": "drive-lane", "surface": "asphalt", "color": "#888888", "elevation": 0, "width": 3.3, "direction": "inbound",
        "generated": { "clones": [{ "mode": "random", "modelsArray": "sedan-rig, suv-rig, box-truck-rig", "spacing": 20, "count": 2 }] } },
      { "name": "Outbound Drive Lane 1", "type": "drive-lane", "surface": "asphalt", "color": "#888888", "elevation": 0, "width": 3.3, "direction": "outbound",
        "generated": { "clones": [{ "mode": "random", "modelsArray": "sedan-rig, suv-rig", "spacing": 20, "count": 2 }] } },
      { "name": "Outbound Drive Lane 2", "type": "drive-lane", "surface": "asphalt", "color": "#888888", "elevation": 0, "width": 3.3, "direction": "outbound",
        "generated": { "clones": [{ "mode": "random", "modelsArray": "sedan-rig, suv-rig", "spacing": 25, "count": 2 }] } },
      { "name": "Sidewalk", "type": "sidewalk", "surface": "sidewalk", "color": "#cccccc", "elevation": 0.15, "width": 3, "direction": "none",
        "generated": { "pedestrians": [{ "density": "normal" }] } }
    ]
  },
  "options": { "width": 1280, "height": 800, "environment": "day", "units": "imperial" }
}
```

**Render:**

```bash
curl -sS -X POST 'https://3dstreet.app/render-street?format=json' \
  -H 'Content-Type: application/json' -d @street.json
```

**Reply to the user:** show `imageUrl` inline, then:

> **[Open in the 3DStreet editor to keep editing](<openInEditorUrl>)** — add a
> real-world map, AI-render it, tweak lanes, save, and share.

## Tips

- Every segment MUST include all six required fields, even if a value is a
  sensible default (e.g. `"direction": "none"` for sidewalks/medians).
- Symmetric streets: mirror the segment list around the centerline.
- Add a `divider` segment (surface `"solid"` or `"hatched"`) for a median /
  center turn lane.
- For buildings lining the street, add `boundary` segments at the two ends
  with `variant` (e.g. `"suburban"`) and `side` (`"left"`/`"right"`) — no
  `generated` needed.
- A malformed blob returns HTTP 400; keep every required field present and
  numeric fields numeric.
