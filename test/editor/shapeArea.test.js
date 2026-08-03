import { describe, expect, it } from 'vitest';
import {
  polygonAreaXZ,
  polygonCentroidXZ
} from '../../src/aframe-components/polygonMath.js';
import { segmentsIntersectXZ } from '../../src/editor/lib/shapeMeasure.js';

// Helper: build x/z points (y is irrelevant to the plan-view math).
const p = (x, z) => ({ x, z });

describe('polygonAreaXZ', () => {
  it('computes a 10×10 square as 100', () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    expect(polygonAreaXZ(square)).toBeCloseTo(100, 6);
  });

  it('is winding-independent (CW == CCW)', () => {
    const ccw = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    const cw = [p(0, 0), p(0, 10), p(10, 10), p(10, 0)];
    expect(polygonAreaXZ(cw)).toBeCloseTo(polygonAreaXZ(ccw), 6);
    expect(polygonAreaXZ(cw)).toBeCloseTo(100, 6);
  });

  it('computes a right triangle as half the bounding box', () => {
    const tri = [p(0, 0), p(10, 0), p(10, 10)];
    expect(polygonAreaXZ(tri)).toBeCloseTo(50, 6);
  });

  it('computes a concave L-shape as its true area, not the convex hull', () => {
    // 10×10 square with a 5×5 bite out of the top-right corner → 75, not 100.
    const L = [p(0, 0), p(10, 0), p(10, 5), p(5, 5), p(5, 10), p(0, 10)];
    expect(polygonAreaXZ(L)).toBeCloseTo(75, 6);
  });

  it('returns 0 for a degenerate (collinear) ring, no NaN', () => {
    const line = [p(0, 0), p(5, 0), p(10, 0)];
    expect(polygonAreaXZ(line)).toBe(0);
  });

  it('returns 0 for < 3 vertices', () => {
    expect(polygonAreaXZ([])).toBe(0);
    expect(polygonAreaXZ([p(0, 0)])).toBe(0);
    expect(polygonAreaXZ([p(0, 0), p(1, 0)])).toBe(0);
  });
});

describe('polygonCentroidXZ', () => {
  it('places a square centroid at its centre', () => {
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    const c = polygonCentroidXZ(square);
    expect(c.x).toBeCloseTo(5, 6);
    expect(c.z).toBeCloseTo(5, 6);
  });

  it('falls back to the vertex mean for a collinear ring (no divide-by-zero)', () => {
    const line = [p(0, 0), p(6, 0), p(12, 0)];
    const c = polygonCentroidXZ(line);
    expect(c.x).toBeCloseTo(6, 6);
    expect(c.z).toBeCloseTo(0, 6);
    expect(Number.isNaN(c.x)).toBe(false);
  });

  it('clamps a near-degenerate sliver centroid to the vertex bounding box', () => {
    // A very thin sliver: signed area is tiny but above the mean-fallback
    // threshold, so the raw area-weighted centroid can shoot far outside. The
    // clamp must keep it within the x/z bounding box.
    const sliver = [p(0, 0), p(100, 1e-4), p(100, 2e-4), p(0, 1e-4)];
    const c = polygonCentroidXZ(sliver);
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.x).toBeLessThanOrEqual(100);
    expect(c.z).toBeGreaterThanOrEqual(0);
    expect(c.z).toBeLessThanOrEqual(2e-4);
  });
});

describe('segmentsIntersectXZ', () => {
  it('detects a proper crossing', () => {
    expect(segmentsIntersectXZ(p(0, 0), p(10, 10), p(0, 10), p(10, 0))).toBe(
      true
    );
  });

  it('does not count a shared endpoint as a crossing', () => {
    // Two edges meeting at (10,0) — adjacent ring edges must not read as crossing.
    expect(segmentsIntersectXZ(p(0, 0), p(10, 0), p(10, 0), p(10, 10))).toBe(
      false
    );
  });

  it('returns false for disjoint segments', () => {
    expect(segmentsIntersectXZ(p(0, 0), p(1, 0), p(5, 5), p(6, 6))).toBe(false);
  });

  it('flags the bow-tie closing edge from the spec §5 example', () => {
    // Triangle 0,0 / 4,0 / 0,4; a new vertex near (4,4) makes the closing edge
    // (4,4)->(0,0) cross the edge (4,0)->(0,4).
    expect(segmentsIntersectXZ(p(4, 4), p(0, 0), p(4, 0), p(0, 4))).toBe(true);
  });
});
