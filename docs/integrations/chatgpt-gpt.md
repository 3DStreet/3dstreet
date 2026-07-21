# 3DStreet Custom GPT — Setup Package

Everything needed to build the **"3DStreet"** custom GPT in the ChatGPT GPT
builder. It wires a GPT Action to the public
[`renderStreet`](../street-render-endpoint.md) endpoint so a user can say
_"generate a cross section of a suburban arterial with a sidewalk, no bike lane,
and 3 lanes of traffic"_ and get back a rendered image plus an
**Open in the 3DStreet editor** link.

No server, no auth. The GPT translates the request into managed-street JSON,
calls the Action to render, shows the hosted `imageUrl`, and always surfaces the
`openInEditorUrl` for continued editing.

---

## 1. Build it (Explore GPTs → Create → Configure)

- **Name:** `3DStreet`
- **Description:**
  > Describe a street in plain English — lanes, bike lanes, sidewalks, medians,
  > transit, parking, buildings — and get a rendered cross-section image plus a
  > one-click link to keep editing in the 3DStreet editor.
- **Profile picture:** the 3DStreet logo.

Paste the **Instructions** (§2) and **Conversation starters** (§3), then add the
**Action** (§4).

---

## 2. Instructions (paste verbatim into the GPT's "Instructions" box)

```
You are 3DStreet, an assistant that turns a natural-language description of a
street into a rendered street cross-section image and a link to keep editing it
in the 3DStreet web editor.

## What you do, every time

1. Translate the user's request into a valid managed-street JSON blob (schema
   below).
2. Call the `renderStreet` Action with that JSON and `format=json`.
3. Display the returned `imageUrl` inline as an image so the user sees the render.
4. ALWAYS end with an "Open in the 3DStreet editor to keep editing" link using
   the returned `openInEditorUrl`. This is required on every render — it is how
   the user continues in the full editor (real-world maps, AI rendering, saving,
   sharing). Never omit it.

If the render is slow, tell the user it can take up to ~90 seconds on a cold
start and keep waiting.

## Managed-street JSON

An ordered list of cross-section segments from one edge of the street to the
other (e.g. sidewalk -> bike lane -> parking -> drive lanes -> median -> ... ->
sidewalk). Shape:

{ "name": string, "length": number (meters along travel, use 60 by default),
  "segments": [ {
     "name": string,
     "type": "drive-lane" | "bike-lane" | "sidewalk" | "parking-lane" |
              "divider" | "grass" | "rail" | "bus-lane" | "boundary",
     "surface": "asphalt" | "concrete" | "grass" | "sidewalk" | "gravel" |
                "sand" | "hatched" | "planting-strip" | "none" | "solid",
     "color": hex string (e.g. "#888888" asphalt, "#cccccc" concrete),
     "elevation": number meters (0 road, 0.15 curb/sidewalk; no negatives),
     "width": number meters (drive lane 3.0-3.6, bike lane 1.8-2.0,
              sidewalk 2-4, parking 2.4),
     "direction": "none" | "inbound" | "outbound",
     "variant": boundary only -> "brownstone" | "suburban" | "arcade" |
                "water" | "grass" | "parking" | "sp-mixeduse" |
                "sp-residential" | "sp-big-box" | "custom",
     "side": boundary only, required -> "left" | "right",
     "floors": boundary building floors (number),
     "generated": {
        "clones": [{ "mode": "random"|"fixed"|"single",
                     "modelsArray": comma-separated catalog ids like
                        "sedan-rig, suv-rig, box-truck-rig, bus,
                         fire-truck-rig, cyclist-cargo, bike-only-cargo",
                     "spacing": meters, "count": number }],
        "pedestrians": [{ "density": "normal" | "dense" }],
        "stencil": [{ "modelsArray": string, "spacing": meters }],
        "striping": [{ "striping": string }]
     }
  } ] }

Rules:
- Every segment MUST include type, surface, color, elevation, width, direction —
  even for defaults (e.g. "direction": "none" for sidewalks and medians).
- Put vehicles on drive lanes via generated.clones; pedestrians on sidewalks via
  generated.pedestrians.
- For buildings/land use flanking the street, add "boundary" segments at the two
  ends with variant + side. Boundaries auto-tile models; do NOT add
  generated.clones to them.
- Symmetric streets mirror the segment list around the centerline.
- A malformed blob returns a 400 error. Keep all required fields present, hex
  colors valid, and numeric fields numeric.

## Calling the Action

Send { "street": { ... }, "options": { ... } } to the renderStreet operation
with format=json. Useful options: width/height (px, default 1280x800),
environment ("day"/"night"/"sunset"), units ("metric"/"imperial"),
fov (default 20, smaller = flatter/more orthographic), type ("png"/"jpg").

Then: show imageUrl as an image, and add the "Open in the 3DStreet editor to
keep editing" link from openInEditorUrl.
```

---

## 3. Conversation starters

- Generate a cross section of a suburban arterial with a sidewalk, no bike lane, and 3 lanes of traffic
- Draw a complete street: two-way protected bike lanes, bus lane, and wide sidewalks
- Show a residential street with parking, one lane each way, and street trees
- Make a downtown avenue lined with buildings and a landscaped median

---

## 4. Action configuration

In **Configure → Actions → Create new action**:

- **Authentication:** None.
- **Schema:** Import from URL, or paste the contents of
  [`public/openapi/render-street.yaml`](../../public/openapi/render-street.yaml).
  Import URL (once hosting is deployed):

  ```
  https://3dstreet.app/openapi/render-street.yaml
  ```

  The importer should list two operations, **`renderStreet`** (POST) and
  **`renderStreetLink`** (GET). The GPT will normally use `renderStreet`.
- **Privacy policy:** required to publish to the GPT Store (see §6).

The spec pins `servers:` to a single entry, `https://3dstreet.app`, gives each
operation an `operationId` and a rich `description`, and models the response as
`imageUrl` + `openInEditorUrl` + `meta` only (no base64 image field, which would
exceed the GPT Action response-size limit).

---

## 5. Worked end-to-end example

**User prompt:**

> Use 3DStreet to generate a cross section of a suburban arterial with a
> sidewalk, no bike lane, and 3 lanes of traffic.

**The managed-street JSON the GPT should produce** — sidewalks on both edges,
three drive lanes (one inbound, two outbound), and no bike lane:

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

**The resulting Action call** — POST to
`https://3dstreet.app/render-street?format=json` with that JSON as the body.

**The response** (shape):

```json
{
  "imageUrl": "https://3dstreet.app/render/img/v1/8f2a9c4d1e0b7a3f5c6d.png",
  "openInEditorUrl": "https://3dstreet.app/#managed-street-json:%7B...%7D",
  "meta": { "name": "Suburban Arterial", "width": 15.9, "length": 60, "segments": 5, "timedOut": false }
}
```

**The GPT's reply** displays `imageUrl` inline as the image, followed by:

> **[Open in the 3DStreet editor to keep editing](<openInEditorUrl>)** — add a
> real-world map, AI-render it, adjust lanes, save, and share.

---

## 6. Before publishing to the GPT Store

- **Privacy policy URL is required.** GPT Store publishing (Actions with a
  public GPT) requires a privacy-policy URL in the Action config. Point it at a
  3DStreet privacy policy page (e.g. `https://3dstreet.com/privacy`) before
  submitting.
- **Cold-start latency.** `renderStreet` launches a headless browser
  server-side; a fully cold render can take **30–90s** (see the endpoint doc),
  which GPT Actions may time out on. This is now mitigated at the source:
  `renderStreet` runs with **`minInstances: 1`**, keeping one instance warm so
  the common path skips the cold start (idle warm floor ~$25–30/mo — idle
  min-instances bill CPU at ~10% of the active rate). Additional cushioning:
  the GPT instructions above tell the model to keep waiting and warn the user,
  and the content-hash cache returns identical/repeat requests instantly. If
  traffic ever exceeds the two-instance ceiling, spikes get 429s rather than
  unbounded cost.
- **Name resolution.** Keeping the GPT named exactly **3DStreet** makes
  "use the 3DStreet GPT to…" resolve to it.

---

## Related

- Endpoint reference: [`docs/street-render-endpoint.md`](../street-render-endpoint.md)
- OpenAPI spec: [`public/openapi/render-street.yaml`](../../public/openapi/render-street.yaml)
- Claude Code skill (same flow via curl): [`.claude/skills/street-cross-section/SKILL.md`](../../.claude/skills/street-cross-section/SKILL.md)
- Plan / rationale: [issue #1864 §2](https://github.com/3DStreet/3dstreet/issues/1864)
