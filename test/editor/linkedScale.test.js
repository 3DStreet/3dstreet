import { describe, expect, it } from 'vitest';
import {
  isUniformScale,
  linkedScaleUpdate
} from '../../src/editor/lib/linkedScale.js';

describe('isUniformScale', () => {
  it('is true when all axes match', () => {
    expect(isUniformScale({ x: 2, y: 2, z: 2 })).toBe(true);
  });

  it('tolerates float noise', () => {
    expect(isUniformScale({ x: 1, y: 1 + 1e-9, z: 1 - 1e-9 })).toBe(true);
  });

  it('is false for a non-uniform scale', () => {
    expect(isUniformScale({ x: 1, y: 2, z: 1 })).toBe(false);
  });

  it('is false for non-finite axes', () => {
    expect(isUniformScale({ x: 1, y: NaN, z: 1 })).toBe(false);
    expect(isUniformScale(undefined)).toBe(false);
  });
});

describe('linkedScaleUpdate', () => {
  it('writes the edited value to every axis', () => {
    expect(linkedScaleUpdate(0.5)).toEqual({ x: 0.5, y: 0.5, z: 0.5 });
  });

  it('passes through 0 and negatives as a uniform mirror', () => {
    expect(linkedScaleUpdate(0)).toEqual({ x: 0, y: 0, z: 0 });
    expect(linkedScaleUpdate(-0.01)).toEqual({ x: -0.01, y: -0.01, z: -0.01 });
  });
});
