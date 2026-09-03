import { describe, expect, it } from 'vitest';
import { bearingFromEastNorth } from '../../src/editor/lib/geo/geoFrame.js';

describe('bearingFromEastNorth', () => {
  it('maps the cardinal directions to compass bearings', () => {
    expect(bearingFromEastNorth(0, 1)).toBe(0); // north
    expect(bearingFromEastNorth(1, 0)).toBe(90); // east
    expect(bearingFromEastNorth(0, -1)).toBe(180); // south
    expect(bearingFromEastNorth(-1, 0)).toBe(270); // west
  });

  it('never returns a negative bearing', () => {
    expect(bearingFromEastNorth(-1, 1)).toBeCloseTo(315);
  });
});
