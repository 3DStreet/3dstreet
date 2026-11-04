import { describe, expect, it } from 'vitest';
import {
  barHeightForElevation,
  getBarProfile
} from '../../src/editor/lib/segmentPanel.js';

// #2140: the cross-section strip showed any raise, and any slope, at one
// fixed height, so a sloped segment looked level with the tallest curbs.
describe('cross-section strip bar profile', () => {
  it('keeps road level flat and a standard curb at the old raised height', () => {
    expect(barHeightForElevation(0)).toBe(32);
    expect(barHeightForElevation(undefined)).toBe(32);
    expect(barHeightForElevation(0.15)).toBe(40);
  });

  it('grows with elevation, a small raise still reading as raised, capped', () => {
    expect(barHeightForElevation(0.01)).toBeGreaterThan(35);
    expect(barHeightForElevation(0.3)).toBeGreaterThan(
      barHeightForElevation(0.15)
    );
    expect(barHeightForElevation(10)).toBe(48);
  });

  it('gives a flat segment equal edges', () => {
    expect(getBarProfile({ elevation: 0.15 })).toEqual({ start: 40, end: 40 });
    expect(getBarProfile({})).toEqual({ start: 32, end: 32 });
  });

  it('slants a sloped segment between its edge elevations', () => {
    const p = getBarProfile({
      slope: true,
      slopeStart: 0,
      slopeEnd: 0.15,
      elevation: 0.3
    });
    expect(p).toEqual({ start: 32, end: 40 });
    const q = getBarProfile({ slope: true, slopeStart: 0.3, slopeEnd: 0.15 });
    expect(q.start).toBeGreaterThan(q.end);
  });
});
