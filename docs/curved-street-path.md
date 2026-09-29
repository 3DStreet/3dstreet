# Curved streets: the street-owned centerline

A managed street owns its centerline (#1930 pillar 1). `managed-street.points`
holds the control points inline, in the street's local space; the street bends
along the curve built through them, its `length` follows the arc length, and
it moves and rotates with its own transform like any entity. A straight street
is the 2-point degenerate case — its centerline is derived from `length` +
`street-align` and nothing is stored (`src/tested/street-nodes-utils.js`).

This supersedes the linked-path prototype (PR #1920), where a street followed
a separately referenced shape entity live. A drawn shape is now an **authoring
tool**: picking one copies its vertices into the street, once. From then on
the shape is just a drawing (edit or delete it freely) and the street's own
node handles reshape the curve.

Three ways to get a curved street:

1. **Copy from a drawn shape.** Draw a polyline with the shape tool along the
   corridor, select the street → street panel → **Shape** row → **curved** →
   pick the shape (or **Draw a new path** to sketch one first). The copy is
   one undo step; the shape's curve style is copied too (a linear shape comes
   in as smooth — a centerline nearly always wants a curve). The street's
   origin moves to the copied curve's XZ centroid (the OSM generate
   convention), so its rotation pivot and the intersection candidate search
   sit on the curve even when the shape was drawn far from the street.
2. **Generate from OpenStreetMap** (`docs/osm-street-lod.md`): each generated
   piece is a point-owning street along the way's centerline, no scaffolding
   shape.
3. **Set the points directly** (AI tools, scripts):
   `managed-street: points: "x y z, x y z, ..."` — see the codec in
   `src/tested/street-centerline.js`.

Choosing **straight** clears the points (undoable).

## Properties (on `managed-street`)

- **points** — `"x y z, x y z, …"`, street-local meters, ≥2 points for a
  curve. Empty = straight. Points whose curve comes to under 1 m of arc
  resolve to no curve: the street renders, reports its nodes and shows its
  handles as straight until the points change.
- **curveType** — `smooth` (centripetal Catmull-Rom through every point, the
  default), `arc` (straight legs joined by circular fillets — the
  road-engineering centerline style), `linear` (hard corners). Same vocabulary
  as `shape.curveType`.
- **filletRadius** — corner radius in meters for `arc`, clamped per-corner so
  adjacent fillets never overlap.
- **closed** — loop street (needs 3+ points): the ribbon runs the full
  circumference, no end caps, and the street has no end nodes.
- **path** — _deprecated input_. Setting `#shapeId` copies that shape's
  vertices and curve settings into `points` and clears itself. Kept so scenes
  saved by the linked-path prototype load curved (see Migration).

## Editing the curve

Selecting a curved street shows one node handle per control point in the
viewport (`src/editor/lib/gizmos/StreetNodeControls.js`, the same circles a
straight street shows at its two ends). Drag any circle: the re-sampled
centerline previews the result and `points` is rewritten once on release —
one undo step. The end circles are the street's end nodes (what intersections
connect to). When street-align's width alignment is not `center`, each
circle sits the centerline offset away from its control point along the
curve's right vector there (`controlPointRights`), the same lateral axis the
renderer and the end nodes use. Curve style and corner radius are in the street panel's Path
row. Adding or removing a control point is not on the handles yet: draw a
shape with the vertices you want and copy it in.

Dragging or rotating the street entity moves the whole curve with it (the
points are local). Manual `length` edits on a curved street extend/trim
along the curve (extrapolating straight past an open end) until the next
points change snaps length back to arc length. The end node follows: it
sits at `s = length`, where the content stops, not at the curve's arc
length.

## Architecture

The design principle is unchanged: **the street keeps its straight-space
layout, and one mapping bends it.** street-align still assigns each segment a
lateral x offset; generated components still compute (x across, z along)
placements; `street-segment.length` is still the street length. A single
arc-length mapping `s = z - zStart` (zStart from the length alignment via
`zStartForAlign`) converts any straight-space point to a curve frame —
position + tangent + horizontal right vector — so lateral offsets rotate with
the curve.

| Piece             | Where                                                                                                                              | Role                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Points codec      | `src/tested/street-centerline.js`                                                                                                  | `formatCenterlinePoints` / `parseCenterlinePoints` (the `points` string), parent→local helpers, centroid                                                                                                                                                                                                                                                                                    |
| Node math         | `src/tested/street-nodes-utils.js`                                                                                                 | Straight-street end nodes from `length` + `street-align` (`getStreetNodes`, `endpointLocalZ`, `zStartForAlign`), `getLongitudinalSpan` (segment-local span every generator fills; the render-time inset hook of #1930 pillar 2)                                                                                                                                                             |
| Node reader       | `src/aframe-components/street-nodes.js`                                                                                            | `getStreetEndNodesLocal/World(streetEl)`: end nodes of ANY managed street — straight from the utils, curved from the curve's end frames — with `along` (into the street body) and `right` vectors. The one reader intersections and the graph use                                                                                                                                           |
| Curve math        | `src/tested/street-path-utils.js`                                                                                                  | Pure three.js, unit-tested: `buildCenterlinePoints` (smooth/arc/linear, open+closed), `PathSampler` (arc-length frames, miter frames, curvature-adaptive ring stations, extrapolation past open ends), `mapStraightPoint`, `buildRibbonGeometry`                                                                                                                                            |
| Street wiring     | `managed-street.js`                                                                                                                | `points`/`curveType`/`filletRadius`/`closed` (serialized); `rebuildCurveFromPoints` builds the street-local curve (`this.streetCurve = { sampler, zStart, closed, rev }`), drives `length`, emits `street-curve-changed` after layout settles; `adoptPath` is the legacy `path` copy-in                                                                                                     |
| Rendering helpers | `src/aframe-components/street-path.js`                                                                                             | The registered `street-ribbon` A-Frame geometry, `getCurvedPlacement` / `getRibbonGeometryAttr`, and `shapeToStreetPoints(shapeEl, streetEl)` (the shape → points copy). `street-path` stays registered as an inert marker for old shapes that carried it                                                                                                                                   |
| Surfaces          | `street-segment.js`, `street-generated-striping.js`, `street-generated-rail.js`, `street-ground.js`                                | Swap their box/plane for `street-ribbon` geometry when a curve is active (same material/texture pipeline — ribbon UVs match box conventions so repeat math is untouched)                                                                                                                                                                                                                    |
| Placements        | `street-generated-clones.js` (incl. fit-mode boundary buildings), `street-generated-stencil.js`, `street-generated-pedestrians.js` | Remap each computed straight placement through `getCurvedPlacement` and add the tangent yaw. RNG call order is unchanged, so a seed lays out identically straight or curved                                                                                                                                                                                                                 |
| Graph             | `src/aframe-components/street-graph.js` + `src/tested/street-graph-utils.js`                                                       | Derived scene system: each managed intersection is a node absorbing the street ends it owns within its snap radius (nearest intersection wins, one end per street — the arm rule); remaining ends cluster into shared nodes by proximity. Node `along` points into the street body. Rebuilt on demand (short cache), never serialized. Phase 5's intersection input (`nodeForIntersection`) |

### Event flow

```
points / curveType / filletRadius / closed edit ─► managed-street.update()
                                   │
                     managed-street.rebuildCurveFromPoints()
                     (local points → centerline → sampler;
                      sets length; bumps rev)
                                   │ setTimeout(0) — after street-align's
                                   ▼ synchronous realign listeners
                        street-curve-changed  ◄── also re-emitted on
                                   │              segments-/alignment-changed
                                   ▼              while a curve is active
      street-segment.regenerateForCurve(): re-mesh + force-update every
      street-generated-* component; street-ground reshapes the slab;
      StreetNodeControls re-reads the points
```

### street-ribbon geometry

A curve can't ride through a serializable geometry schema, so the registered
`street-ribbon` geometry resolves it via `document.getElementById(streetId)`
→ `managed-street.streetCurve` at build time, with a `rev` counter (bumped
per rebuild) and `skipCache: true` forcing regeneration. Ring stations are
curvature-adaptive (dense in corners, decimated on straights, capped gaps),
interior rings use miter tangents with a bounded miter scale so edges stay
parallel through corners, and strips share ring vertices for smooth normals
along the curve with hard edges between faces.

Saved scenes never carry a segment's `street-ribbon` geometry (the serializer
skips segment geometry/material); on load the street rebuilds its curve from
`points` in init and the `street-curve-changed` cascade meshes everything.

## Migration (scenes saved with `path: #shape`)

`migrateStreetPathToPoints` (`src/tested/migrate-street-path.js`, run from
`createEntities` in `json-utils_1.1.js` alongside the other load
migrations) copies a sibling shape's vertices into the street's `points` in
the saved JSON before any entity exists — for the common layout of street
and shape as upright, unscaled siblings, which is every generated and
hand-assigned path. The shape's own curve settings are copied verbatim (a
deliberately linear path stays linear). Anything the JSON pass can't handle
(nested elsewhere, rotated shape, tilted street) keeps its `path`, which
`managed-street.adoptPath` resolves at runtime with full transforms and then
clears — same outcome one frame later. Either way the shape stays in the
scene as a plain drawing; delete it if you don't want it. The next save
writes `points` and never migrates again.

## Curve-aware editor & play behaviors

- **Hover/selection highlight** conforms to the curved lane: when the
  hovered/selected entity carries `street-ribbon` geometry (or is a curved
  street, whose segments do), the editor's box helper swaps its AABB for
  translucent overlays of the actual ribbon meshes
  (`OrientedBoxHelper.updateConformingHighlight` in `viewport.js`).
  Raycast hit areas were always mesh-accurate. Straight entities keep the
  box unchanged.
- **Slope segments** tilt on curves exactly as straight: the ribbon's top
  face tilts across its width (`slopeLeftDelta`/`slopeRightDelta`, the
  below-box equivalents). Point elevation (y) is followed.
- **Play traffic** follows the curve: the generators stamp each bent
  clone's straight-space pose (`data-straight-*`), street-traffic advances
  that pose in straight lane space (same pure function of sim-time) and
  re-bends it through the live curve every tick — position and tangent yaw.
  Determinism and the mirrored-cast contract are unchanged.
- **street-label** places the cross-section ruler at the curve's end frame,
  yawed to the exit tangent.
- **Managed intersections** connect a curved street's end nodes as
  geometry-only arms (`docs/managed-intersection.md`); the snap pass leaves
  its extent alone until render-time insets (#1930 pillar 2).
- **Segment width gizmo** bars follow the curve; the node handles edit the
  control points (above).
- **Plan DXF/PDF/SVG export** (`editor/lib/plan/planModel.js`) emits curves:
  a curved street's segments export as their ribbon-edge outlines (same
  sampler + miter math as the 3D surface, via `computeRibbonOutline`), curbs
  become polylines along the shared edge, loop streets export as annulus
  rings, and curve-styled drawn shapes export their sampled centerline
  instead of the control polygon.

## Known limitations

- **No insert/delete of control points on the handles** yet — copy a
  reshaped drawing in instead.
- **Boundary segments (buildings)** bend like other clones but are
  otherwise untested/unsupported on curves for now.
- **Drive mode** is unaffected in principle (raycast wheels ride the real
  curved meshes) but untested on curves.
- **geo-flatten** uses the mesh bounding footprint, so terrain flattening
  covers the curve's bounding area rather than the exact ribbon.
- Sharp hairpins tighter than a segment's half-width self-intersect
  (offset curves have no untangling pass) — use `arc` with a radius at
  least half the street width for clean results.
- **Convert to Shapes** refuses curved streets (#1720).
- **DXF exports tessellated polylines, not true arc entities.** Arc-mode
  fillets could emit LWPOLYLINE bulge factors / ARC entities so CAD users
  get real radii (the fillet math already computes center/radius/sweep) —
  deliberately deferred: correctness there is a CAD-interop question, best
  driven by iterative testing against a real AutoCAD session with
  SME-provided acceptance criteria rather than guessed at here.
