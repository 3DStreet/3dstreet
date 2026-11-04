import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TRANSFORM_MODE,
  MOVE_GIZMO_MODES,
  nextMoveGizmo
} from '@/editor/lib/transformModes.js';

describe('move gizmo modes', () => {
  it('defaults to the first mode in menu order', () => {
    expect(DEFAULT_TRANSFORM_MODE).toBe(MOVE_GIZMO_MODES[0]);
    expect(DEFAULT_TRANSFORM_MODE).toBe('easy');
  });

  it('starts the cycle at the first mode from anything that is not a move gizmo', () => {
    expect(nextMoveGizmo('off')).toBe('easy');
    expect(nextMoveGizmo('scale')).toBe('easy');
    expect(nextMoveGizmo(undefined)).toBe('easy');
  });

  it('steps through the move gizmos in menu order and wraps', () => {
    expect(nextMoveGizmo('easy')).toBe('translate');
    expect(nextMoveGizmo('translate')).toBe('rotate');
    expect(nextMoveGizmo('rotate')).toBe('easy');
  });
});
