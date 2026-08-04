import { describe, expect, it } from 'vitest';
import { ringSelfIntersects } from '../../src/aframe-components/polygonMath.js';

// Helper: build x/z points (y is irrelevant to the plan-view math).
const p = (x, z) => ({ x, z });

describe('ringSelfIntersects', () => {
  it('is false for a simple square', () => {
    expect(ringSelfIntersects([p(0, 0), p(10, 0), p(10, 10), p(0, 10)])).toBe(
      false
    );
  });

  it('is true for a bow-tie (the crossing pair includes the wrap edge)', () => {
    // Edges (10,0)->(0,10) and the wrap (10,10)->(0,0) cross at (5,5).
    expect(ringSelfIntersects([p(0, 0), p(10, 0), p(0, 10), p(10, 10)])).toBe(
      true
    );
  });

  it('is false for a concave L', () => {
    const L = [p(0, 0), p(10, 0), p(10, 5), p(5, 5), p(5, 10), p(0, 10)];
    expect(ringSelfIntersects(L)).toBe(false);
  });

  it('is true for a star traced in ring order', () => {
    // Five points evenly spaced on a circle, visited 0,2,4,1,3 — a pentagram.
    const circle = [];
    for (let k = 0; k < 5; k++) {
      const a = (2 * Math.PI * k) / 5;
      circle.push(p(Math.cos(a), Math.sin(a)));
    }
    const star = [circle[0], circle[2], circle[4], circle[1], circle[3]];
    expect(ringSelfIntersects(star)).toBe(true);
    // The same five points in their natural order are a convex pentagon.
    expect(ringSelfIntersects(circle)).toBe(false);
  });

  it('is true for a collinear self-overlap', () => {
    // Edge 0 (0,0)->(10,0) and edge 2 (8,0)->(2,0) lie on the same line and
    // overlap: degenerate, but the ring still has no well-defined interior.
    expect(ringSelfIntersects([p(0, 0), p(10, 0), p(8, 0), p(2, 0)])).toBe(
      true
    );
  });

  it('is false for a triangle — every edge pair is adjacent', () => {
    expect(ringSelfIntersects([p(0, 0), p(10, 0), p(5, 10)])).toBe(false);
  });

  it('is false below 4 vertices', () => {
    expect(ringSelfIntersects([])).toBe(false);
    expect(ringSelfIntersects([p(0, 0)])).toBe(false);
    expect(ringSelfIntersects([p(0, 0), p(1, 0)])).toBe(false);
  });
});
