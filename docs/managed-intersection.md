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

## Editor

"(Beta) Managed Intersection" card in the Add Layer panel's Streets tab
(`createManagedIntersection` in `createLayerFunctions.js`) creates the entity
at rotation `0 0 0`. Properties are edited through the generic component
panel; there is no bespoke sidebar yet (the legacy `IntersectionSidebar`
stays tied to the old component).

## Known limitations (prototype scope)

- **No street trimming.** Streets are never modified: an untrimmed street
  runs underneath the intersection (the surface slab sits just above the
  street's lane markings to mask it). Auto-trimming a street's node to the
  mouth would feed back into the arm math on the next refresh — doing that
  properly needs persistent node identity (a node graph shared by streets and
  intersections), which is also the path to [#138](https://github.com/3DStreet/3dstreet/issues/138)-style
  OSM import. Until then, drag the street's endpoint node to the mouth for a
  clean seam.
- Treatments are global (one crosswalk/traffic-control choice for all arms);
  per-arm overrides need stable arm identity (street ids) plus UI.
- Curved (path-following) streets are skipped — their ends aren't straight
  nodes yet.
- No traffic-circle interior ([#1322](https://github.com/3DStreet/3dstreet/issues/1322));
  the polygon walk could grow an island later.
- Signal/stop-sign placement is right-hand-traffic and heuristic; the raised
  crosswalk GLB variant isn't supported.
