# Street Gizmos

Direct-manipulation handles for managed streets in the editor viewport,
always on — there is no user toggle. They are **additive**: every entity keeps the standard
TransformControls gizmo (move/rotate/scale per the active action tool);
the street handles appear alongside it.

| Gizmo                             | What it adds                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Street Endpoint Nodes** (#1096) | Selecting a **managed street** shows a draggable circle at each end of the street. Dragging a circle keeps the other end fixed and rewrites the street's position, Y rotation, and `managed-street.length` so the two circles always define the street's ends. One undo step per drag (MultiCommand). |
| **Segment Width Handles** (#1218) | Selecting a **street segment** shows a bar along each long edge; dragging a bar changes `street-segment.width` live, with the normal managed-street re-layout cascade running during the drag. Shift snaps to 0.5 m.                                                                                  |

Managed streets only: neither gizmo attaches to legacy
`street` + `streetmix-loader` scenes.

New managed streets are created with `street-align: length: middle` (set
explicitly at each creation site, not as a schema default — saved scenes
that relied on the `start` default must stay put on load), so a new street
centers on its creation point and endpoint drags grow it symmetrically
around where the user placed it.

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
  table: the stock gizmo attaches to every transformable entity exactly as
  before, then a managed street additionally gets endpoint nodes and a
  street segment additionally gets width bars.
- The street gizmos mutate attributes live during the drag (so the street's
  re-layout cascade runs) and commit one undo step on mouse-up via
  `commitDrag` → `entityupdate`/`multi`.
- Gizmo objects are named with the `gizmoPrototype` prefix, which is on
  the nav-experimental cursor-anchor exclusion list.

## Known limitations (by design, for now)

- Segment width drag with `street-align` width `center` grows the segment
  symmetrically, so the dragged edge moves at ~half cursor speed; anchoring
  the opposite edge would need a coordinated street-position change.
- Endpoint node drags throttle `managed-street.length` writes to 10 Hz
  during the drag (the length cascade re-lays-out every segment); the final
  value always lands on mouse-up.
- The simplified move/rotate and ground-clamp prototypes (#1674/#1446) from
  the original lab, and #1806's segment-gizmo suppression, were not ported —
  segments keep the stock gizmo here even though `street-align` owns segment
  transforms.
