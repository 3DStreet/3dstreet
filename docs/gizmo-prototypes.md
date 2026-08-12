# Gizmo Prototype Lab

Experimental, switchable gizmo behaviors for the editor viewport, exploring
the ideas in #1674, #1446, #1096, #1218, and #1806 side by side instead of
betting on one "perfect" gizmo up front.

## Switching prototypes

**View → Gizmo Prototypes (Lab)** in the editor menu. The choice is a
persisted local preference (`store.gizmoPrototype`, localStorage-backed) and
takes effect immediately on the current selection — no reload. Default is
`legacy`, which is the stock behavior, byte-for-byte.

| Prototype                             | What changes                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Legacy (current gizmo)**            | Standard three.js TransformControls, unchanged.                                                                                                                                                                                                                                                                                                         |
| **Simplified Move + Rotate** (#1674)  | One combined gizmo for every entity: drag the purple disc/arrows to move along the ground plane (Y preserved), drag the blue ring to rotate around Y. Thick tube geometry instead of 1px lines. Hold **Shift** to snap (0.5 m grid / 15°).                                                                                                              |
| **Simplified + Ground Clamp** (#1446) | Same gizmo, but horizontal drags raycast down and re-seat the object on whatever surface is under the drag point (streets, shapes, 3D tiles), using the object's bounding-box bottom so it sits _on_ — not _in_ — the ground.                                                                                                                           |
| **Street Endpoint Nodes** (#1096)     | Selecting a **managed street** shows a draggable circle at each end of the street. Dragging a circle keeps the other end fixed and rewrites the street's position, Y rotation, and `managed-street.length` so the two circles always define the street's ends. One undo step per drag (MultiCommand). Other entities fall back to the Simplified gizmo. |
| **Segment Width Handles** (#1218)     | Selecting a **street segment** shows a bar along each long edge; dragging a bar changes `street-segment.width` live, with the normal managed-street re-layout cascade running during the drag. Shift snaps to 0.5 m. Other entities fall back to the Simplified gizmo.                                                                                  |

In **every non-legacy prototype**, selecting a street-segment suppresses the
move/rotate gizmo entirely (#1806) — `street-align` owns segment transforms,
so an editable gizmo there silently loses its edits. The selection highlight
still shows; width/type editing stays in the sidebar (plus the width handles
prototype above).

Managed streets only: none of the street-specific gizmos attach to legacy
`street` + `streetmix-loader` scenes.

## Architecture

```
src/editor/lib/gizmos/
├── constants.js              # prototype registry (ids, labels) — menu + routing share it
├── GizmoPointerControls.js   # shared base: pointer plumbing, raycasting, event dispatch
├── SimpleTransformControls.js# move-on-ground + Y-rotate (+ optional ground clamp)
├── StreetNodeControls.js     # managed-street endpoint circles
└── SegmentWidthControls.js   # street-segment edge bars
```

- All controls follow the `MeasureLineControls` pattern: a `THREE.Object3D`
  added to `inspector.sceneHelpers`, running its own raycaster against its
  picker meshes, dispatching TransformControls-compatible events
  (`mouseDown` / `objectChange` / `mouseUp`) that `viewport.js` wires to
  camera-control locking and undoable `entityupdate` commands.
- `attachControlsForSelection()` in `viewport.js` is the single routing
  table: selection changes, transform-mode changes, and prototype switches
  all funnel through it.
- The simplified gizmo reuses the pre-drag snapshot + coalescing
  `entityupdate` path the stock gizmo uses, so undo behaves identically.
  The street gizmos mutate attributes live during the drag (so the street's
  re-layout cascade runs) and commit one undo step on mouse-up via
  `commitDrag` → `entityupdate`/`multi`.
- Scale mode (`l` key) always attaches the stock TransformControls — the
  advanced escape hatch under every prototype.
- New gizmo objects are named with the `gizmoPrototype` prefix, which is on
  the nav-experimental cursor-anchor exclusion list.

## Known prototype limitations (by design, for now)

- #1674's "advanced translate/rotate as a toolbar submenu" is approximated
  by the lab switcher itself (+ scale mode escape hatch); no ActionBar
  submenu yet.
- Segment width drag with `street-align` width `center` grows the segment
  symmetrically, so the dragged edge moves at ~half cursor speed; anchoring
  the opposite edge would need a coordinated street-position change.
- Endpoint node drags throttle `managed-street.length` writes to 10 Hz
  during the drag (the length cascade re-lays-out every segment); the final
  value always lands on mouse-up.
- #1806's sidebar half (read-only position/rotation rows for segments) is
  not part of this branch.
