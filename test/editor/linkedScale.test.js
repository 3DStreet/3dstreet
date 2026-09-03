import { describe, expect, it } from 'vitest';
import { linkedScaleUpdate } from '../../src/editor/lib/linkedScale.js';

describe('linkedScaleUpdate', () => {
  it('scales the other axes by the same ratio', () => {
    expect(linkedScaleUpdate({ x: 1, y: 2, z: 1 }, 'x', 1.5)).toEqual({
      x: 1.5,
      y: 3,
      z: 1.5
    });
  });

  it('keeps a uniform scale uniform', () => {
    expect(linkedScaleUpdate({ x: 1, y: 1, z: 1 }, 'z', 0.5)).toEqual({
      x: 0.5,
      y: 0.5,
      z: 0.5
    });
  });

  it('falls back to uniform when the edited axis was 0', () => {
    expect(linkedScaleUpdate({ x: 0, y: 2, z: 3 }, 'x', 2)).toEqual({
      x: 2,
      y: 2,
      z: 2
    });
  });

  it('rounds derived axes to 5 decimals', () => {
    expect(linkedScaleUpdate({ x: 3, y: 1, z: 1 }, 'x', 1).y).toBe(0.33333);
  });
});
