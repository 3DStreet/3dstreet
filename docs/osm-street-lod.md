# OSM streets: 2.5D rendering, click-to-upgrade, and the #1930 LOD roadmap

Entry point for the OSM street work shipped on the demo path (Sep 2026) and
the phased plan that grows it into issue
[#1930](https://github.com/3DStreet/3dstreet/issues/1930)'s full
architecture (street node graph, owned centerlines, non-destructive
connections, LOD hydration). The long-term design target: a GTA-style
illusion of a persistent city in play mode — streets near the player
high-fidelity and animated, streets in the distance cheap.

## What ships today (osm3d mode)

One component, `osm-streets`, owns both the visual and the data half.

**Visual: flat ribbons on the 2.5D ground.** Each streamed tile's
`transportation` ways are swept into one merged, vertex-colored mesh
(`src/tested/osm-street-ribbon.js`, pure + unit-tested): a mitered strip
per polyline at the class width from `roadWidthMeters`, round caps at
every polyline end (so meeting/crossing ways read as joined), floated
`RIBBON_BASE_Y` above the raster ground with a small class-ordered height
step so the higher class wins where two ribbons overlap. Unlit
`MeshBasicMaterial`, one draw call per tile, frustum-culled by bounding
sphere. Per-class tint + stacking order live in
`src/tested/osm-street-style.js` (`ribbonStyleForClass`).

Why not the library's `MVTOverlay` (the first cut, reverted before merge):
a canvas-rasterized tile texture went soft as soon as the camera got
anywhere near street level and capped out at the z14 vector tiles, so it
never looked like something a street sits on. Ribbons are crisp at any
zoom, carry true widths in meters, and are the same straight→curved
ribbon idea the curved-street work uses, so the mid-LOD ribbon and the
upgraded managed street share a centerline. Known limits of the cheap
junction treatment: ribbons only exist within the streaming radius
(no world-scale far layer), and same-class ribbons meeting at very sharp
angles show the miter clamp. A proper planar junction union is a later
phase.

**Data: `osm-streets` component + click-to-upgrade.**
`src/aframe-components/osm-streets.js` follows the camera like
`osm-buildings` (throttled tick, look-at-ground focus point,
`tilesWithinRadius` nearest-first, 1.5× keep hysteresis) and caches
decoded `transportation` way records — `decodeTransportation` in
`src/tested/vector-tile-buildings.js`, IndexedDB-cached via
`src/osm/overpass-cache.js` under a `streets/v1/` key prefix — with
polylines converted to scene-local meters (`x` north, `z` east, flat
`EQUATOR_M` projection matching the ground/buildings).

Click-to-upgrade: an empty-space viewport click probes
`wayAtPoint(groundPoint)` (`probeOsmWayAtCursor` in
`src/editor/lib/raycaster.js` — the probe rides the container mouseup
because A-Frame's cursor never emits `click` without an intersected
entity); a nearby way fills `store.osmWayCandidate` and the
`OsmUpgradeChip` offers **Generate Street** while `highlightWayAt`
draws the exact stretch it will create in a bright ribbon above the class
tint. (UI copy says "generate", never "upgrade" — in this app "upgrade"
means the paid plan; the code keeps the roadmap's LOD term.) The upgrade
(`upgradeWayAt`) converts the clicked stretch — the centerline clipped by
arc length to ±`UPGRADE_WINDOW_M` of the click; a single OSM way can run
for kilometers — into real managed streets via the editor command stack
(one undoable step per generate): the stretch **splits at junctions**
where other ways cross or terminate on it (`junctionsAlongStretch` /
`splitStretchAtJunctions` in `src/tested/osm-street-import.js`, ends
inset by half the crossing width plus curb-return room), each piece
becomes ONE **path-following street** whose editable path shape carries
the piece's Douglas–Peucker-simplified control points
(`stretchForWindow`; the same curved-street mechanism as hand-drawn
paths, `docs/curved-street-path.md`, `curveType: smooth`), degenerating
to a plain straight street when a piece simplifies to a single chord,
and a **`managed-intersection` is minted per junction** where ≥2
generated street ends meet (proximity-deduped, so generating the
crossing way later reuses it — its snap radius picks the new street
ends up automatically; pathed streets connect as geometry-only arms,
see `docs/managed-intersection.md`). Cross-section rules from
class + subclass + oneway (`streetJsonForWay`: one-way streets put every
lane in the way direction, residential gets parking and unclassified
doesn't, living streets go narrow, cycleways become bike lanes, lane
count per direction scales with class),
`sourceType: json-blob`, `playable: true` so `street-traffic` animates
them in play mode. `upgradeNearFocus(radius, cap)` is the console
convenience for demos. Upgraded streets are ordinary scene entities:
they serialize, edit, and persist — the explicit click IS the
"temporary → mine" promotion story for now, and refining the generated
geometry IS editing the path shape's vertices.

Data notes: OpenMapTiles `transportation` has `class`/`subclass`/
`brunnel`/`oneway` but **no lane counts or widths** — the cross-section
rules above are rules, not that street's data.

**Overpass hydration on generate (phase 6, first slice).** While the chip
is up, `osm-streets.hydrateWayAt(worldPoint)` runs one small-bbox Overpass
query (`way["highway"]` with `out tags geom`, `src/osm/overpass-fetch.js`,
one attempt per endpoint, IndexedDB-cached per bbox, memoized per way id)
and `pickOverpassWay` matches the way by geometry — the tiles don't carry
OSM ids — preferring drivable ways so a footway hugging the road never
shadows it. `crossSectionFromTags` (`src/tested/osm-way-tags.js`, pure +
tested) builds the segments: `lanes` / `lanes:forward` / `lanes:backward`
exact when tagged, `oneway` (motorways and roundabouts default one-way),
`sidewalk`, `parking:lane:*` / `parking:*`, `cycleway:*` on the tagged
side, `name`; every missing field falls back to the class rules, and
`facts` records `osm` vs `default` per field so the chip can say
"Market St · 4 lanes · sidewalks both sides" or "lanes not mapped (2
assumed)". Generate waits up to 1.5 s for an in-flight answer, else uses
the rules. Side convention: segments[0] is the way's forward-RIGHT side
(managed-street lays segments out -x → +x and +z is forward). Tunnels and ferries are
filtered. Real lane data arrives with the Overpass-backed hydrator
(phase 6 below; `src/osm/overpass-fetch.js` is kept for exactly that).

## Roadmap to full #1930 (nothing above is throwaway)

- **Phase 0 — shared node/span foundations.** New
  `src/tested/street-nodes-utils.js`: `getStreetNodes()` unifying the
  endpoint math triplicated today (`StreetNodeControls.js`,
  `managed-street.computeZStart`, PR #1927's `collectArms` — whose
  `lengthAlign` default is `'start'` vs the gizmo's `'middle'`, a real
  bug) and `getLongitudinalSpan(length, {insetStart, insetEnd})`;
  refactor every hardcoded ±L/2 in `street-generated-*`,
  `street-segment.js`, `street-ground.js` to consume it with zero insets.
  Zero behavior change, fully unit-tested.
- **Phase 1 — play-mode street LOD for ALL scenes** (independent of OSM;
  the cheapest ongoing win for the design target, retroactively covers
  hand-authored scenes). `src/tested/street-lod-utils.js` +
  `src/aframe-components/play/street-lod.js`. Tiers: LOD2 0–75 m full +
  traffic + colliders; LOD1 75–200 m no traffic (restore static clones
  via the refcounted `play/clone-visibility.js` — the only legal path);
  LOD0.5 200–400 m generated children hidden via
  `setAttribute('visible')` (batching rule — never raw
  `object3D.visible`). Hysteresis ×1.3 at band edges, ≤3 transitions per
  pass, collider retirement per `play/tiles-colliders.js`'s
  retire-don't-delete pattern. Requires per-street record grouping in
  `street-traffic.js` (`despawnForStreet`). Removes any upgrade-count
  cap.
- **Phase 2 — pipeline hardening.** Move transportation decode into the
  existing worker protocol (`src/osm/building-tiles.worker.js` pattern —
  the decode modules are already THREE-free by design); suppress/mask a
  way's ground tint after upgrade; `brunnel: bridge` treatment.
- **Phase 3 — pillar 1: street-owned centerlines + shared end nodes.**
  `managed-street.points` inline ordered list (straight = 2-point
  degenerate case) + node ids; `streetCurve` built from `points` (the
  existing `streetId`+`rev` indirection keeps every ribbon consumer
  working); the `path` shape demotes to an authoring tool that copies
  sampled points in; load migration in `json-utils_1.1.js`; a derived
  `street-graph` scene system rebuilt from entity data (honoring the
  managed-street JSON round-trip contract). One way = one curved street
  is already the demo-path behavior (via the path shape, see above);
  this phase internalizes the points and makes OSM node ids graph node
  ids shared across ways.
- **Phase 4 — pillar 2: render-time insets.** Derived, non-serialized
  `insets {start, end}` + `setInset` API consumed via
  `getLongitudinalSpan`; curves get `sStart`/`sEnd` in
  `buildRibbonGeometry` (precedent: `street-ground.js`'s 0.1/L−0.1).
- **Phase 5 — pillar 3: migrate PR #1927 intersections to node
  occupants.** Keep `src/tested/managed-intersection-utils.js` verbatim
  (`mouth.t` IS the inset); `managed-intersection` reads incident
  streets from the graph (killing its 400 ms signature polling) and
  writes per-end insets instead of `applyStreetSnaps`; drop the
  curved-street exclusion. Key test: deleting an intersection restores
  insets to 0 — streets pop back intact. Then upgraded-street junctions
  get real intersections automatically.
- **Phase 6 — full hydration + pinning.** The on-generate slice above
  ships; remaining: osm2lanes-grade tag coverage (#826: `width`,
  `turn:lanes`, `busway`, `shoulder`), hydrating ribbons ahead of the
  click so the highlight shows real widths, provenance
  `{source: 'osm', wayId}` serialized per street (today:
  `data-osm-way-id` / `data-osm-source` / `data-osm-name` attributes); any
  user edit sets `pinned: true` and the hydrator/LOD never touch pinned
  streets. Do NOT attach `geo-flatten`
  per hydrated street at area scale (each shape update re-flattens all
  google3d tiles).
- **Phase 7 — in-play predictive streaming + google3d mixing.** Auto
  hydrate/dehydrate rings around the player on the bounded-queue
  pattern; a geoFrame-backed `project(lon, lat)` callback for
  `osm-street-geometry` mixes OSM streets with Google 3D Tiles instead
  of forking the geometry code.

## Related

- #1930 (umbrella), #138 (OSM import), #826 (osm2streets), #1927
  (managed-intersection prototype), `docs/managed-intersection.md`,
  `docs/curved-street-path.md`, `docs/geospatial-2d-25d-upgrade-plan.md`
  §5 (shared OSM fetch service; no architectural dependency between the
  LOD0 layer and the node-graph pillars).
