# Curved streets: follow a path (prototype)

Phase D.3 of the shapes/street-fill work
([handoff](./qa/shapes-qa-handoff.md)) — and an inversion of the street-fill
model. Street fill starts from a polyline and stamps street clones along it;
this feature starts from a **street** and assigns a **path** to it:

1. Build a managed street (import, template, or measure-and-convert).
2. Draw a polyline with the shape tool along the corridor.
3. Select the street → properties panel → **Follow Path** → pick the shape.

The street's centerline bends along the path — one continuous street, no
per-segment clones, no elbow joints. `managed-street.length` tracks the
path's arc length. Vertex edits on the shape, dragging the shape, dragging
the street, and curve-setting changes all re-lay the street live
(throttled). Clearing **Follow Path** (or undo) straightens it back out.

## The path owns the curve

Curve controls live on the PATH, not the street (`street-path` component,
auto-attached to the shape on first assignment; its controls appear in the
shape's properties panel once a street follows it):

- **curveType** — `smooth` (centripetal Catmull-Rom through every vertex),
  `arc` (straight legs joined by circular fillets, the road-engineering
  centerline style), `linear` (hard corners).
- **filletRadius** — corner radius in meters for `arc`, clamped per-corner
  so adjacent fillets never overlap.

One path can be followed by several streets, and closed shapes make loop
streets (the ribbon runs the full circumference, no end caps).

## Architecture

The design principle: **the street keeps its straight-space layout, and one
mapping bends it.** street-align still assigns each segment a lateral x
offset; generated components still compute (x across, z along) placements;
`street-segment.length` is still the street length. A single arc-length
mapping `s = z - zStart` (zStart derived from the street-align length
alignment) converts any straight-space point to a curve frame — position +
tangent + horizontal right vector — so lateral offsets rotate with the
curve.

| Piece | Where | Role |
| --- | --- | --- |
| Curve math | `src/tested/street-path-utils.js` | Pure three.js, unit-tested: `buildCenterlinePoints` (smooth/arc/linear, open+closed), `PathSampler` (arc-length frames, miter frames, curvature-adaptive ring stations, extrapolation past open ends), `mapStraightPoint`, `buildRibbonGeometry` |
| Path component + geometry | `src/aframe-components/street-path.js` | `street-path` component (curve controls, emits throttled `street-path-changed` on vertex/transform/setting changes; a system watches transforms since editor entities are paused), the registered `street-ribbon` A-Frame geometry, and the `getCurvedPlacement` / `getRibbonGeometryAttr` helpers |
| Street wiring | `managed-street.js` | `path` property (selector, serialized), resolves the path (with retries for load ordering), builds the street-local curve (`this.streetCurve = { sampler, zStart, closed, rev }`), drives `length`, emits `street-curve-changed` after layout settles |
| Surfaces | `street-segment.js`, `street-generated-striping.js`, `street-generated-rail.js`, `street-ground.js` | Swap their box/plane for `street-ribbon` geometry when a curve is active (same material/texture pipeline — ribbon UVs match box conventions so repeat math is untouched) |
| Placements | `street-generated-clones.js` (incl. fit-mode boundary buildings), `street-generated-stencil.js`, `street-generated-pedestrians.js` | Remap each computed straight placement through `getCurvedPlacement` and add the tangent yaw. RNG call order is unchanged, so a seed lays out identically straight or curved |

### Event flow

```
shape vertex edit ──► shape-geometry-changed ──► street-path-changed (throttled)
shape/street dragged ─► street-path system (matrixWorld watch) ─┘
curve settings edit ──► street-path update ─────┘
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

## Known limitations (prototype)

- **Slope segments** flatten on curves (elevation works; the per-segment
  cross-slope tilt doesn't). Path vertex elevation IS followed.
- **Play/traffic, drive mode** animate in straight space — a curved street's
  `playable` traffic won't follow the curve yet.
- **Endpoint/width gizmos** are suppressed on pathed streets (no straight
  endpoints to drag — edit the path shape instead). Suppression applies on
  next selection.
- **street-label** still renders in straight space (toggle it off on
  heavily curved streets).
- **geo-flatten** uses the mesh bounding footprint, so terrain flattening
  covers the curve's bounding area rather than the exact ribbon.
- Manual `length` edits on a pathed street extend/trim along the path
  (extrapolating straight past an open end) until the next path change
  snaps length back to arc length; un-assigning a path keeps the last
  arc length rather than restoring the pre-assignment length.
- Sharp hairpins tighter than a segment's half-width self-intersect
  (offset curves have no untangling pass) — use `arc` with a radius at
  least half the street width for clean results.
