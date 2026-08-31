# Managed Intersection (prototype)

`managed-intersection` is the prototype successor to the legacy `intersection`
component, in the same way `managed-street` replaces `street` +
`streetmix-loader`. Instead of hand-tuning `dimensions` / per-quadrant curb
strings inside a `-90 -90 0` rotated frame, a managed intersection derives its
geometry from the **street nodes** that meet it and rebuilds live as those
streets are edited.

Issues it addresses: [#438](https://github.com/3DStreet/3dstreet/issues/438)
(auto-size to connecting streets), [#1029](https://github.com/3DStreet/3dstreet/issues/1029)
(instantiate at rotation `0 0 0`, Y-up), [#1224](https://github.com/3DStreet/3dstreet/issues/1224)
(intersection automation given managed streets).

## How it works

A managed street's endpoint "nodes" are derived state — `position` +
`rotation.y` + `managed-street.length` + `street-align` (the same math the
street endpoint gizmo uses, `src/editor/lib/gizmos/StreetNodeControls.js`).
The intersection scans the scene's managed streets; every endpoint node within
`snapRadius` of the intersection origin becomes an **arm**: node point,
outward direction, and lateral cross-section extents. Two extents per arm are
read from the street's segment list:

- **roadway** (curb-to-curb): the travelled way minus the contiguous band of
  sidewalk-ish segments at each outer edge,
- **full**: the whole travelled way.

From 2+ arms, `computeIntersectionGeometry`
(`src/tested/managed-intersection-utils.js`, pure 2D math, unit-tested in
`test/editor/managedIntersectionUtils.test.js`) produces:

- the **roadway surface polygon** — adjacent arms' roadway edge lines
  intersected; each corner rounded with a curb-return fillet arc
  (`curbRadius`); near-parallel pairs (two collinear streets) fall back to a
  seam, which makes a 2-street joint a valid intersection (e.g. a mid-block
  crosswalk treatment between two street nodes),
- **sidewalk corner wedges** — the curb-return area between the roadway
  fillet and the arms' full travelled-way edges (the automatic equivalent of
  the legacy component's four curb quadrants), extruded one curb step above
  the roadway,
- a **mouth** per arm — the line where that street's opening meets the
  intersection, placed past the fillet tangents; crosswalks and traffic
  control are laid out on it.

Special cases: fewer than 2 arms renders a placeholder asphalt pad
(`placeholderRadius`) so the entity is visible/selectable; 3-way T, skewed,
and 5+ arm intersections all come out of the same edge-intersection walk.

## Schema

| property              | default           | notes                                                        |
| --------------------- | ----------------- | ------------------------------------------------------------ |
| `streets`             | `''`              | csv of street element ids; empty = auto-connect by proximity |
| `snapRadius`          | `20`              | max node distance (m) from the intersection origin           |
| `curbRadius`          | `3`               | corner fillet radius (m)                                     |
| `crosswalk`           | `crosswalk-zebra` | `none` or one of the flat crosswalk mixins                   |
| `trafficControl`      | `none`            | `none` / `stop` / `signal`, applied per arm                  |
| `showSidewalkCorners` | `true`            | corner wedge visibility                                      |
| `snapStreets`         | `true`            | keep connected streets snapped flush to the mouth            |
| `placeholderRadius`   | `6`               | pad radius while <2 streets connect                          |

## Live updates & persistence

- There is no event that covers every street-editing route (gizmo drags,
  properties panel, undo, AI chat, scene load ordering), so the component
  runs a throttled **signature watch** on an interval (matrices + lengths +
  alignment + segment types/widths of candidate streets). An interval rather
  than `tick` because the editor keeps A-Frame ticks paused while the
  inspector is open. Drag a street endpoint node through an intersection's
  snap radius and the geometry follows.
- Only the component config persists. Meshes hang off
  `setObject3D('managed-intersection')` and treatment entities carry the
  `autocreated` class, so saves round-trip to just
  `managed-intersection: ...` + `geo-flatten` (attached in init like
  managed-street, so intersections flatten 3D-tiles terrain too).
- The entity carries `data-transform-no-scale` (its size IS the connected
  streets' geometry).

## Street snapping (`snapStreets`, default on)

The editing contract: **a street whose node is within `snapRadius` is
connected, and after every settle its node sits exactly at the mouth.** The
snap is bidirectional — an overlapping street is trimmed (otherwise its
sidewalks and everything cloned along them march through the junction) and a
street stopping short is extended to close the gap. The node is slid along
its own centerline (position + `managed-street.length` rewritten, far
endpoint and rotation kept fixed — the endpoint-gizmo origin-rebuild math),
and the re-layout cascade regenerates clones to the new extent.

Bidirectionality is what makes the intersection **converge** under ordinary
back-and-forth editing instead of ratcheting: nudge the intersection, rotate
a street, widen then narrow a cross street — every settle re-lands all nodes
on the fresh mouths. Even a snap taken against briefly-odd geometry
self-corrects on the next settle. To disconnect a street, drag its node past
`snapRadius`; while connected, street length is owned by the intersection.

Why the pass doesn't feed back on itself: the mouth is anchored in **space**,
not to the node — corner clearances are projections of fixed edge-line
intersections, the `minSetback` floor is measured from the intersection
origin's projection, and node-baseline fallback corners are excluded — so a
node sitting on the mouth recomputes `mouth.t ≈ 0` and the pass no-ops
(regression-tested in `managedIntersectionUtils.test.js`). Snaps are
epsilon-guarded (5cm) and never shorten a street below 4m.

Additional guards:

- **Snaps wait for the scene to settle.** Visual rebuilds run on every watch
  tick, but the snap pass only fires after the signature has been quiet for
  ~800ms — mid-drag geometry is transient (a street swept past a
  near-parallel angle momentarily computes huge mouths). This also means
  half-parsed streets on scene load are never snapped from incomplete
  segment lists.
- **Mouths are capped at `snapRadius - 2` from the origin** (the
  `maxSetback` option of `computeIntersectionGeometry`), so even a settled
  sliver-angle pair can never demand a snap that pushes a node out of its
  own detection radius.
- **Nearest-intersection ownership.** A node claimed by two intersections is
  snapped only by the nearer one (ties break by document order), so a street
  parked between two intersections never gets tug-of-warred.

Caveats:

- Snapping edits the street for real (no undo step — it's a component-level
  write). Deleting the intersection leaves streets at their last snapped
  extent; the immutable-street-data version of this (render-time insets on a
  persistent node graph) is the planned architecture pass —
  [#1930](https://github.com/3DStreet/3dstreet/issues/1930).
- `snapStreets: false` restores the fully non-destructive overlap behavior
  (with the poke-through artifacts that implies).

## Editor

"(Beta) Managed Intersection" card in the Add Layer panel's Streets tab
(`createManagedIntersection` in `createLayerFunctions.js`) creates the entity
at rotation `0 0 0`. Properties are edited through the generic component
panel; there is no bespoke sidebar yet (the legacy `IntersectionSidebar`
stays tied to the old component).

**CAD/PDF plan export**: the shared plan model
(`src/editor/lib/plan/planModel.js`) has a managed-intersection pass that
redraws the component's `lastGeometry` — roadway surface polygon on `C-ROAD`,
sidewalk corner wedges on `C-WALK`, crosswalk bands on `C-ROAD-MRKG` — so the
DXF, PDF, and Export-modal previews match the rendered meshes
(`test/editor/planModelManagedIntersection.test.js`). Signals/stop signs are
point objects, out of scope like street furniture.

## Known limitations (prototype scope)

- **Snaps mutate street data** (see above): no undo step, and no automatic
  restore when the intersection is deleted. Making street geometry immutable
  (render-time insets) needs persistent node identity (a node graph shared
  by streets and intersections), which is also the path to
  [#138](https://github.com/3DStreet/3dstreet/issues/138)-style OSM import
  with LOD hydration — the umbrella ticket is
  [#1930](https://github.com/3DStreet/3dstreet/issues/1930).
- Treatments are global (one crosswalk/traffic-control choice for all arms);
  per-arm overrides need stable arm identity (street ids) plus UI.
- Curved (path-following) streets are skipped — their nodes live on the path
  shape, not in the straight endpoint math. Their end frames are obtainable
  today (`PathSampler.frameAtS` at 0 / totalLength), and the geometry core is
  direction-agnostic, so wiring them in is a known increment — **deliberately
  deferred** until the straight-node system has had more testing, so curved
  connections can ride the same persistent-node-graph design instead of
  becoming a second special case.
- No traffic-circle interior ([#1322](https://github.com/3DStreet/3dstreet/issues/1322));
  the polygon walk could grow an island later.
- Signal/stop-sign placement is right-hand-traffic and heuristic; the raised
  crosswalk GLB variant isn't supported.
