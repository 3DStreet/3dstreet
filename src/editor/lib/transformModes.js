// The move gizmos, in the order the toolbar menu lists them and `m` cycles
// through them. The first is the editor's default transform mode.
export const MOVE_GIZMO_MODES = ['easy', 'translate', 'rotate'];

export const DEFAULT_TRANSFORM_MODE = MOVE_GIZMO_MODES[0];

/**
 * The move gizmo after `current` in menu order, wrapping at the end. Any mode
 * that is not a move gizmo (the hand or shape tool, scale, or none) leads to
 * the first.
 */
export function nextMoveGizmo(current) {
  const index = MOVE_GIZMO_MODES.indexOf(current);
  if (index === -1) return MOVE_GIZMO_MODES[0];
  return MOVE_GIZMO_MODES[(index + 1) % MOVE_GIZMO_MODES.length];
}
