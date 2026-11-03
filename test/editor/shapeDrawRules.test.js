import { describe, expect, it } from 'vitest';
import {
  closePlan,
  commitOutcome,
  previewRefused
} from '../../src/editor/lib/shapeDrawRules.js';

const MIN = 0.05;
const p = (x, z) => ({ x, y: 0, z });

describe('previewRefused', () => {
  it('shows a too-close point as refused only with snap on, and a crossing always (fails if too-close turns red with snap off)', () => {
    const tooClose = { crosses: false, tooClose: true };
    const crosses = { crosses: true, tooClose: false };
    expect(previewRefused(false, tooClose)).toBe(false);
    expect(previewRefused(true, tooClose)).toBe(true);
    expect(previewRefused(false, crosses)).toBe(true);
    expect(previewRefused(true, crosses)).toBe(true);
    expect(previewRefused(true, { crosses: false, tooClose: false })).toBe(
      false
    );
  });
});

describe('closePlan', () => {
  it('with snap off, refuses a crossing or empty ring and returns the ring unchanged otherwise', () => {
    // The closing side (20,5)→(0,0) crosses the side (10,0)→(10,10).
    const crossing = [p(0, 0), p(10, 0), p(10, 10), p(20, 5)];
    expect(closePlan(crossing, 0, MIN).refused).toBe(true);
    const collinear = [p(0, 0), p(5, 0), p(10, 0)];
    expect(closePlan(collinear, 0, MIN).refused).toBe(true);
    const square = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    const plan = closePlan(square, 0, MIN);
    expect(plan.refused).toBe(false);
    expect(plan.adjusted).toBe(false);
    expect(plan.ring).toBe(square);
  });

  it('with snap on, moves only the last vertex of a rough rectangle', () => {
    const rough = [p(0, 0), p(10, 0), p(10, 10), p(-3, 10)];
    const plan = closePlan(rough, 90, MIN);
    expect(plan.refused).toBe(false);
    expect(plan.adjusted).toBe(true);
    expect(plan.ring.slice(0, 3)).toEqual(rough.slice(0, 3));
    expect(plan.ring[3]).not.toEqual(rough[3]);
    expect(plan.ring[3].x).toBeCloseTo(0, 9);
    expect(plan.ring[3].z).toBeCloseTo(10, 9);
    // Refused: the ring is handed back as it was, unadjusted.
    const triangle = [p(0, 0), p(10, 0), p(10, 10)];
    expect(closePlan(triangle, 90, MIN)).toEqual({
      ring: triangle,
      refused: true,
      adjusted: false
    });
  });
});

describe('commitOutcome', () => {
  it('commits closed only for an unrefused plan, and open with the placed vertices otherwise (fails if a refused close commits closed)', () => {
    const vertices = [p(0, 0), p(10, 0), p(10, 10)];
    expect(commitOutcome({ vertices, plan: null })).toEqual({
      closed: false,
      vertices
    });
    const refused = { ring: vertices, refused: true, adjusted: false };
    expect(commitOutcome({ vertices, plan: refused })).toEqual({
      closed: false,
      vertices
    });
    const ring = [p(0, 0), p(10, 0), p(10, 10), p(0, 10)];
    const adjusted = { ring, refused: false, adjusted: true };
    const out = commitOutcome({ vertices, plan: adjusted });
    expect(out.closed).toBe(true);
    expect(out.vertices).toBe(ring);
  });
});
