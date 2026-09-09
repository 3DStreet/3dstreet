# Street Gizmos

Direct-manipulation handles for managed streets in the editor viewport,
always on — there is no user toggle. They are **additive**: every entity keeps the standard
TransformControls gizmo (move/rotate/scale per the active action tool);
the street handles appear alongside it. The one exception is a managed
street's **segments** (#1806): `street-align` owns segment transforms —
any street re-layout rewrites segment positions, silently resetting manual
edits — so a selected segment gets **only** its width bars, no stock
move/rotate gizmo (the selection highlight box still shows, and the
action-bar translate/rotate buttons dim, same as `data-no-transform`
entities). Segment editing goes through the width bars, the segment
sidebar (width/type/elevation) and the reorder buttons.

| Gizmo                             | What it adds                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Street Endpoint Nodes** (#1096) | Selecting a **managed street** shows a draggable circle at each end of the street. Dragging a circle keeps the other end fixed; an outline previews the new footprint during the drag, and on release the street's position, Y rotation, and `managed-street.length` are rewritten so the two circles always define the street's ends. One undo step per drag (MultiCommand). |
| **Segment Width Handles** (#1218) | Selecting a **street segment** shows a bar along each long edge at the near end (the end focus frames from, next to the width label; on a curved street the bars follow the curve); dragging a bar changes `street-segment.width` live, with the normal managed-street re-layout cascade running during the drag. Shift snaps to 0.5 m.                                       |

Managed streets only: neither gizmo attaches to legacy
`street` + `streetmix-loader` scenes.

New managed streets default to `street-align: length: middle` (schema
default since #1863), so a new street centers on its creation point and
endpoint drags grow it symmetrically around where the user placed it. The
serializer always writes `street-align` explicitly on managed streets;
scenes saved before the flip omit the `street-align` length value (the
alignment keyword, not the street's metre length) and are stamped `start` at load
(`src/tested/migrate-street-align.js`), so they stay put and self-heal on
their next save.

## Architecture

```
src/editor/lib/gizmos/
├── GizmoPointerControls.js   # shared base: pointer plumbing, raycasting, event dispatch
├── StreetNodeControls.js     # managed-street endpoint circles
└── SegmentWidthControls.js   # street-segment edge bars
```

- Both controls follow the `MeasureLineControls` pattern: a `THREE.Object3D`
  added to `inspector.sceneHelpers`, running its own raycaster against its
  picker meshes, dispatching TransformControls-compatible events
  (`mouseDown` / `objectChange` / `mouseUp`) that `viewport.js` wires to
  camera-control locking and undoable `entityupdate` commands.
- `attachControlsForSelection()` in `viewport.js` is the single routing
  table: the stock gizmo attaches to every transformable entity, a managed
  street additionally gets endpoint nodes, and a managed street's segment
  gets width bars INSTEAD of the stock gizmo (#1806, see above;
  `isManagedStreetSegment()` in `editor/lib/entity.js` is the shared
  predicate).
- Segment width bars mutate `street-segment.width` live during the drag (so
  the street's re-layout cascade runs). Endpoint nodes do not touch the
  entity until mouse-up (#1942): the dragged circle follows the cursor and a
  yellow footprint outline previews the resulting street, then position,
  rotation and length are applied once on release. Both commit one undo step
  on mouse-up via `commitDrag` → `entityupdate`/`multi`.
- Gizmo objects are named with the `gizmoPrototype` prefix, which is on
  the nav-experimental cursor-anchor exclusion list.

## Known limitations (by design, for now)

- Segment width drag with `street-align` width `center` grows the segment
  symmetrically, so the dragged edge moves at ~half cursor speed; anchoring
  the opposite edge would need a coordinated street-position change.
- Endpoint node drags show only an outline preview until release, so
  clones, striping and terrain flattening do not follow the cursor live.
- The simplified move/rotate and ground-clamp prototypes (#1674/#1446) from
  the original lab were not ported. (#1806's segment-gizmo suppression has
  since landed — see above.)
