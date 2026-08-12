/**
 * Gizmo prototype lab (#1674, #1446, #1096, #1218, #1806).
 *
 * Experimental, switchable gizmo behaviors for the viewport. The active
 * prototype is a persisted editor preference (store.gizmoPrototype) picked
 * from View → Gizmo Prototypes (Lab). Each prototype changes which controls
 * attach to a selected entity — see attachControlsForSelection() in
 * viewport.js for the routing table.
 */

export const GIZMO_PROTOTYPES = [
  {
    id: 'legacy',
    label: 'Legacy (current gizmo)',
    description: 'Standard three.js TransformControls, unchanged.'
  },
  {
    id: 'simple',
    label: 'Simplified Move + Rotate',
    description:
      'Combined gizmo: drag the disc to move along the ground plane, drag the ring to rotate around Y. Hold Shift to snap. (#1674)'
  },
  {
    id: 'ground-clamp',
    label: 'Simplified + Ground Clamp',
    description:
      'Same as Simplified, but while dragging the object is clamped to sit on whatever surface is below it — streets, 3D tiles, shapes. (#1446)'
  },
  {
    id: 'street-nodes',
    label: 'Street Endpoint Nodes',
    description:
      'Managed streets get a draggable circle at each end; dragging an endpoint updates street position, rotation and length. Other entities use the Simplified gizmo. (#1096)'
  },
  {
    id: 'segment-width',
    label: 'Segment Width Handles',
    description:
      'Street segments get edge handles: drag an edge to widen or narrow the segment in place. Other entities use the Simplified gizmo. (#1218)'
  }
];

export const DEFAULT_GIZMO_PROTOTYPE = 'legacy';

export const GIZMO_PROTOTYPE_IDS = GIZMO_PROTOTYPES.map((p) => p.id);

export function isValidGizmoPrototype(id) {
  return GIZMO_PROTOTYPE_IDS.includes(id);
}
