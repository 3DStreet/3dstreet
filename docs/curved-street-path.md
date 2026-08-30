# Curved streets: follow a path (prototype)

Part of the shapes work (PR #1920, see `docs/shapes.md`) — and an inversion
of the earlier street-fill model. Street fill started from a polyline and stamped street clones along
it; this feature starts from a **street** and assigns a **path** to it.
**Street fill is removed** (`lib/streetFill.js` and the shape sidebar
dropdown are gone) — path following supersedes it, and its `linear` curve
style reproduces the hard-cornered look as one continuous street. Scenes
saved with fills keep working: fill wrappers and their cloned streets were
always plain entities (only the inert `data-street-fill*` markers remain
on them).

1. Build a managed street (import, template, or measure-and-convert).
2. Draw a polyline with the shape tool along the corridor.
3. Select the street → properties panel → **Follow Path** → pick the shape.

The street's centerline bends along the path — one continuous street, no
per-segment clones, no elbow joints. `managed-street.length` tracks the
path's arc length. Vertex edits on the shape, dragging the shape, dragging
the street, and curve-setting changes all re-lay the street live
(throttled). Clearing **Follow Path** (or undo) straightens it back out.

## The path owns the curve

Curve controls live on the PATH, not the street — as props of the `shape`
component itself (a curve is a property of the drawing, street or no
street; the schema-less `street-path` role component, auto-attached on
first assignment, reads them from there via `getCurveOptions()`):

- **shape.curveType** — `linear` (hard corners, the default: shapes draw
  straight; assigning one to a street bumps it to smooth once, at the
  assignment gesture in ManagedStreetSidebar, never on scene load),
  `smooth` (centripetal Catmull-Rom through every vertex), `arc` (straight
  legs joined by circular fillets, the road-engineering centerline style).
- **shape.filletRadius** — corner radius in meters for `arc`, clamped
  per-corner so adjacent fillets never overlap.

(The props briefly lived on `street-path` during prototyping; there is no
load-time migration — pre-move scenes were never released and load straight.)

One path can be followed by several streets, and closed shapes make loop
streets (the ribbon runs the full circumference, no end caps).

**The shape draws its own curve too.** A curve-styled shape renders its
outline (and a closed shape's fill and area) through the sampled curve —
the same `buildCenterlinePoints` call the street runs — so a selected path
and its street visibly trace the identical centerline; the vertices stay
the straight-line editable control points (measurement chips keep
measuring the control polygon). This also works standalone: the shape
sidebar's **Curve Style** select is available on any ≥3-vertex shape, no
street required.

## Architecture

The design principle: **the street keeps its straight-space layout, and one
mapping bends it.** street-align still assigns each segment a lateral x
offset; generated components still compute (x across, z along) placements;
`street-segment.length` is still the street length. A single arc-length
mapping `s = z - zStart` (zStart derived from the street-align length
alignment) converts any straight-space point to a curve frame — position +
tangent + horizontal right vector — so lateral offsets rotate with the
curve.

| Piece                     | Where                                                                                                                              | Role                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Curve math                | `src/tested/street-path-utils.js`                                                                                                  | Pure three.js, unit-tested: `buildCenterlinePoints` (smooth/arc/linear, open+closed), `PathSampler` (arc-length frames, miter frames, curvature-adaptive ring stations, extrapolation past open ends), `mapStraightPoint`, `buildRibbonGeometry`                                                                                                          |
| Path component + geometry | `src/aframe-components/street-path.js`                                                                                             | `street-path` role component (schema-less; reads the shape's curve props via `getCurveOptions`, emits throttled `street-path-changed` on vertex/transform/setting changes; a system watches transforms since editor entities are paused), the registered `street-ribbon` A-Frame geometry, and the `getCurvedPlacement` / `getRibbonGeometryAttr` helpers |
| Street wiring             | `managed-street.js`                                                                                                                | `path` property (selector, serialized), resolves the path (with retries for load ordering), builds the street-local curve (`this.streetCurve = { sampler, zStart, closed, rev }`), drives `length`, emits `street-curve-changed` after layout settles                                                                                                     |
| Surfaces                  | `street-segment.js`, `street-generated-striping.js`, `street-generated-rail.js`, `street-ground.js`                                | Swap their box/plane for `street-ribbon` geometry when a curve is active (same material/texture pipeline — ribbon UVs match box conventions so repeat math is untouched)                                                                                                                                                                                  |
| Placements                | `street-generated-clones.js` (incl. fit-mode boundary buildings), `street-generated-stencil.js`, `street-generated-pedestrians.js` | Remap each computed straight placement through `getCurvedPlacement` and add the tangent yaw. RNG call order is unchanged, so a seed lays out identically straight or curved                                                                                                                                                                               |

### Event flow

```
shape vertex edit ────► shape-geometry-changed ──► street-path-changed (throttled)
curve settings edit ──► shape re-derive ──────┘                 │
shape/street dragged ─► street-path system (matrixWorld watch) ─┤
                                   │
                     managed-street.rebuildPathCurve()
                     (world verts → street-local → centerline → sampler;
                      sets length; bumps rev)
                                   │ setTimeout(0) — after street-align's
                                   ▼ synchronous realign listeners
                        street-curve-changed  ◄── also re-emitted on
                                   │              segments-/alignment-changed
                                   ▼              while a curve is active
      street-segment.regenerateForCurve(): re-mesh + force-update every
      street-generated-* component; street-ground reshapes the slab
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

Saved scenes serialize segments' `street-ribbon` geometry attribute
harmlessly: on load it builds empty (no curve yet), then the street resolves
its path and the `street-curve-changed` cascade re-meshes everything.

## Curve-aware editor & play behaviors

- **Hover/selection highlight** conforms to the curved lane: when the
  hovered/selected entity carries `street-ribbon` geometry (or is a
  path-following street, whose segments do), the editor's box helper swaps
  its AABB for translucent overlays of the actual ribbon meshes
  (`OrientedBoxHelper.updateConformingHighlight` in `viewport.js`).
  Raycast hit areas were always mesh-accurate. Straight entities keep the
  box unchanged.
- **Slope segments** tilt on curves exactly as straight: the ribbon's top
  face tilts across its width (`slopeLeftDelta`/`slopeRightDelta`, the
  below-box equivalents). Path vertex elevation is also followed.
- **Play traffic** follows the curve: the generators stamp each bent
  clone's straight-space pose (`data-straight-*`), street-traffic advances
  that pose in straight lane space (same pure function of sim-time) and
  re-bends it through the live curve every tick — position and tangent yaw.
  Determinism and the mirrored-cast contract are unchanged.
- **street-label** places the cross-section ruler at the curve's end frame,
  yawed to the exit tangent.
- **Endpoint/width gizmos** are suppressed on pathed streets (no straight
  endpoints to drag — edit the path shape instead). Suppression applies on
  next selection.
- **Plan DXF/PDF/SVG export** (`editor/lib/plan/planModel.js`) emits curves:
  a curved street's segments export as their ribbon-edge outlines (same
  sampler + miter math as the 3D surface, via `computeRibbonOutline`), curbs
  become polylines along the shared edge, loop streets export as annulus
  rings, and curve-styled drawn shapes export their sampled centerline
  instead of the control polygon.

## Known limitations (prototype)

- **Boundary segments (buildings)** bend like other clones but are
  otherwise untested/unsupported on curves for now.
- **Drive mode** is unaffected in principle (raycast wheels ride the real
  curved meshes) but untested on curves.
- **geo-flatten** uses the mesh bounding footprint, so terrain flattening
  covers the curve's bounding area rather than the exact ribbon.
- Manual `length` edits on a pathed street extend/trim along the path
  (extrapolating straight past an open end) until the next path change
  snaps length back to arc length; un-assigning a path keeps the last
  arc length rather than restoring the pre-assignment length.
- Sharp hairpins tighter than a segment's half-width self-intersect
  (offset curves have no untangling pass) — use `arc` with a radius at
  least half the street width for clean results.
- **DXF exports tessellated polylines, not true arc entities.** Arc-mode
  fillets could emit LWPOLYLINE bulge factors / ARC entities so CAD users
  get real radii (the fillet math already computes center/radius/sweep) —
  deliberately deferred: correctness there is a CAD-interop question, best
  driven by iterative testing against a real AutoCAD session with
  SME-provided acceptance criteria rather than guessed at here.
