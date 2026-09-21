import { describe, it, expect, vi } from 'vitest';
import {
  assetPathFromUrl,
  createBoundsLookup,
  getEntityBounds,
  lookupModelBounds,
  normalizeBounds,
  onEntityBounds,
  registerEntityBounds
} from '@/model-bounds';
import table from '@/model-bounds.json';

describe('normalizeBounds', () => {
  it('accepts the packed array and the object form', () => {
    expect(normalizeBounds([-1, 0, -2, 1, 3, 2])).toEqual({
      min: [-1, 0, -2],
      max: [1, 3, 2]
    });
    expect(normalizeBounds({ min: [0, 0, 0], max: [1, 1, 1] })).toEqual({
      min: [0, 0, 0],
      max: [1, 1, 1]
    });
    expect(normalizeBounds({ min: ['0', '0', '0'], max: ['2', 1, 1] })).toEqual(
      {
        min: [0, 0, 0],
        max: [2, 1, 1]
      }
    );
  });

  it('rejects malformed, non-finite, inverted and point bounds', () => {
    expect(normalizeBounds(null)).toBeNull();
    expect(normalizeBounds([1, 2, 3])).toBeNull();
    expect(normalizeBounds({ min: [0, 0], max: [1, 1, 1] })).toBeNull();
    expect(normalizeBounds([0, 0, 0, 1, NaN, 1])).toBeNull();
    expect(normalizeBounds([0, 0, 0, -1, 1, 1])).toBeNull();
    expect(normalizeBounds([2, 2, 2, 2, 2, 2])).toBeNull();
    // A flat plane is still a box worth drawing.
    expect(normalizeBounds([0, 0, 0, 1, 0, 1])).not.toBeNull();
  });
});

describe('assetPathFromUrl', () => {
  it('strips scheme, host, query, hash, url() and leading ./', () => {
    expect(
      assetPathFromUrl('https://assets.3dstreet.app/sets/a/b.glb?v=2#x')
    ).toBe('sets/a/b.glb');
    expect(assetPathFromUrl('url(https://cdn.example/x/sets/a/b.glb)')).toBe(
      'x/sets/a/b.glb'
    );
    expect(assetPathFromUrl('./assets/sets/a/b.glb')).toBe(
      'assets/sets/a/b.glb'
    );
    expect(assetPathFromUrl('/sets/a/b.glb')).toBe('sets/a/b.glb');
    expect(assetPathFromUrl(undefined)).toBe('');
  });
});

describe('createBoundsLookup', () => {
  const lookup = createBoundsLookup({
    'sets/vehicles/bus.glb': [-1, 0, -6, 1, 3, 6],
    'sets/props/street-props.glb#palmtree': {
      min: [-2, 0, -2],
      max: [2, 8, 2]
    },
    'sets/broken.glb': [0, 0, 0, 0, 0, 0]
  });

  it('matches by exact path, part, and with a custom base prefix', () => {
    expect(lookup('https://assets.3dstreet.app/sets/vehicles/bus.glb')).toEqual(
      {
        min: [-1, 0, -6],
        max: [1, 3, 6]
      }
    );
    expect(
      lookup('https://mirror.example/v2/sets/vehicles/bus.glb?t=1')
    ).toEqual({ min: [-1, 0, -6], max: [1, 3, 6] });
    expect(
      lookup(
        'https://assets.3dstreet.app/sets/props/street-props.glb',
        'palmtree'
      )
    ).toEqual({ min: [-2, 0, -2], max: [2, 8, 2] });
  });

  it('returns null for unknown models, unknown parts and degenerate entries', () => {
    expect(
      lookup('https://assets.3dstreet.app/sets/vehicles/car.glb')
    ).toBeNull();
    expect(
      lookup('https://assets.3dstreet.app/sets/props/street-props.glb', 'tree')
    ).toBeNull();
    expect(lookup('https://assets.3dstreet.app/sets/broken.glb')).toBeNull();
    expect(lookup('')).toBeNull();
    expect(lookup('bus.glb')).toBeNull();
  });
});

describe('precomputed table', () => {
  it('covers a catalog vehicle and a street-props part', () => {
    const car = lookupModelBounds(
      'https://assets.3dstreet.app/sets/vehicles/gltf-exports/draco/waymo-self-driving-car.glb'
    );
    expect(car).not.toBeNull();
    // A car is longer (z) than it is tall (y) and stands on the ground.
    expect(car.max[2] - car.min[2]).toBeGreaterThan(car.max[1] - car.min[1]);
    expect(car.min[1]).toBeGreaterThan(-0.1);
    const palm = lookupModelBounds(
      'https://assets.3dstreet.app/sets/street-props/gltf-exports/draco/street-props.glb',
      'palmtree'
    );
    expect(palm).not.toBeNull();
    expect(Object.keys(table.bounds).length).toBeGreaterThan(100);
  });
});

describe('entity registry', () => {
  it('stores normalized bounds per entity and notifies listeners', () => {
    const el = document.createElement('div');
    const listener = vi.fn();
    const off = onEntityBounds(listener);
    expect(getEntityBounds(el)).toBeNull();
    expect(
      registerEntityBounds(el, { min: [0, 0, 0], max: [1, 2, 3] })
    ).toEqual({ min: [0, 0, 0], max: [1, 2, 3] });
    expect(getEntityBounds(el)).toEqual({ min: [0, 0, 0], max: [1, 2, 3] });
    expect(listener).toHaveBeenCalledWith(el, {
      min: [0, 0, 0],
      max: [1, 2, 3]
    });
    off();
    // Invalid bounds are ignored and do not overwrite.
    expect(registerEntityBounds(el, [1, 1, 1, 0, 0, 0])).toBeNull();
    expect(getEntityBounds(el)).toEqual({ min: [0, 0, 0], max: [1, 2, 3] });
    registerEntityBounds(el, [0, 0, 0, 5, 5, 5]);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
