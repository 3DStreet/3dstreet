// Geometry core for the managed-intersection prototype: arm-edge corners,
// curb-return fillets, the roadway surface polygon, sidewalk corner wedges,
// and per-arm mouths (crosswalk lines).
import { describe, it, expect } from 'vitest';
import {
  lineIntersect2D,
  filletCorner,
  computeIntersectionGeometry
} from '@/tested/managed-intersection-utils.js';

// Arm helper: symmetric cross-section — roadway ±roadHalf, full travelled way
// ±fullHalf — with the node at `point` pointing along unit `dir`.
const arm = (point, dir, roadHalf, fullHalf = roadHalf, id) => ({
  id,
  point,
  dir,
  road: { min: -roadHalf, max: roadHalf },
  full: { min: -fullHalf, max: fullHalf }
});

const E = { x: 1, z: 0 };
const W = { x: -1, z: 0 };
const N = { x: 0, z: 1 };
const S = { x: 0, z: -1 };
const O = { x: 0, z: 0 };

const closeTo = (p, x, z, tol = 1e-6) => {
  expect(p.x).toBeCloseTo(x, Math.max(0, -Math.log10(tol)) - 1);
  expect(p.z).toBeCloseTo(z, Math.max(0, -Math.log10(tol)) - 1);
};

// Shoelace area — sign encodes winding, magnitude the covered area.
const polygonArea = (pts) => {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
};

describe('lineIntersect2D', () => {
  it('intersects perpendicular lines', () => {
    const hit = lineIntersect2D({ x: 0, z: -5 }, N, { x: -5, z: 0 }, E);
    closeTo(hit.point, 0, 0);
    expect(hit.t1).toBeCloseTo(5);
    expect(hit.t2).toBeCloseTo(5);
  });

  it('returns null for parallel lines', () => {
    expect(lineIntersect2D({ x: 0, z: 0 }, N, { x: 1, z: 0 }, N)).toBeNull();
    expect(lineIntersect2D({ x: 0, z: 0 }, N, { x: 1, z: 0 }, S)).toBeNull();
  });
});

describe('filletCorner', () => {
  it('rounds a 90° corner with tangent length = radius', () => {
    // Corner at (5,5); edges run outward along +x and +z.
    const f = filletCorner({ x: 5, z: 5 }, E, N, 2);
    expect(f.tangentLength).toBeCloseTo(2);
    closeTo(f.tangentA, 7, 5);
    closeTo(f.tangentB, 5, 7);
    closeTo(f.center, 7, 7);
    // Arc endpoints are the tangent points.
    closeTo(f.points[0], 7, 5, 1e-6);
    closeTo(f.points[f.points.length - 1], 5, 7, 1e-6);
    // Every arc point sits on the circle.
    f.points.forEach((p) => {
      expect(Math.hypot(p.x - 7, p.z - 7)).toBeCloseTo(2);
    });
  });

  it('declines nearly-straight corners', () => {
    const almostOpposite = { x: -0.999, z: 0.001 };
    expect(filletCorner(O, E, almostOpposite, 2)).toBeNull();
  });
});

describe('computeIntersectionGeometry', () => {
  it('returns null with fewer than two arms', () => {
    expect(computeIntersectionGeometry([], {})).toBeNull();
    expect(computeIntersectionGeometry([arm(O, N, 5)], {})).toBeNull();
  });

  it('builds a symmetric 4-way crossing', () => {
    const g = computeIntersectionGeometry(
      [arm(O, N, 5, 8), arm(O, S, 5, 8), arm(O, E, 5, 8), arm(O, W, 5, 8)],
      { curbRadius: 2, mouthMargin: 0.5 }
    );
    expect(g).not.toBeNull();
    expect(g.corners).toHaveLength(4);
    expect(g.mouths).toHaveLength(4);

    // Roadway corners: edge lines at ±5 meet at (±5, ±5).
    const apexes = g.corners.map((c) => c.apex);
    const expectApex = (x, z) =>
      expect(
        apexes.some((a) => Math.abs(a.x - x) < 1e-6 && Math.abs(a.z - z) < 1e-6)
      ).toBe(true);
    expectApex(5, 5);
    expectApex(-5, 5);
    expectApex(5, -5);
    expectApex(-5, -5);

    // All corners are rounded, tangent length = curbRadius at 90°.
    g.corners.forEach((c) => {
      expect(c.arc).not.toBeNull();
      expect(c.arc.tangentLength).toBeCloseTo(2);
    });

    // Mouth setback clears corner (5) + tangent (2) + margin (0.5).
    g.mouths.forEach((m) => {
      expect(m.t).toBeCloseTo(7.5);
      expect(m.width).toBeCloseTo(10);
    });
    // North arm's mouth center sits on the +z centerline.
    closeTo(g.mouths[0].center, 0, 7.5);

    // Surface polygon is simple and covers at least the 10x10 core plus the
    // four mouth stubs; winding is consistent (nonzero area).
    const area = Math.abs(polygonArea(g.surface));
    expect(area).toBeGreaterThan(10 * 10);
    expect(area).toBeLessThan(20 * 20);

    // Sidewalk wedges exist at all four corners and have positive area.
    g.corners.forEach((c) => {
      expect(c.wedge).not.toBeNull();
      expect(Math.abs(polygonArea(c.wedge))).toBeGreaterThan(1);
    });
  });

  it('omits wedges when arms carry no sidewalk band', () => {
    const g = computeIntersectionGeometry(
      [arm(O, N, 5), arm(O, S, 5), arm(O, E, 5), arm(O, W, 5)],
      { curbRadius: 2 }
    );
    g.corners.forEach((c) => expect(c.wedge).toBeNull());
  });

  it('handles a 3-way T intersection', () => {
    const g = computeIntersectionGeometry(
      [arm(O, E, 5, 8), arm(O, W, 5, 8), arm(O, N, 4, 6)],
      { curbRadius: 2, mouthMargin: 0.5 }
    );
    expect(g.corners).toHaveLength(3);
    // The E/W pair is straight-through on the south side: fallback seam
    // corner at the shared edge, no fillet there.
    const fallbackCorners = g.corners.filter((c) => !c.arc);
    expect(fallbackCorners).toHaveLength(1);
    closeTo(fallbackCorners[0].apex, 0, -5);
    // The two N corners are real intersections at (±4, 5).
    const rounded = g.corners.filter((c) => c.arc);
    expect(rounded).toHaveLength(2);
    const xs = rounded.map((c) => c.apex.x).sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(-4);
    expect(xs[1]).toBeCloseTo(4);
    rounded.forEach((c) => expect(c.apex.z).toBeCloseTo(5));
  });

  it('joins two collinear arms with a seam (crosswalk-only joint)', () => {
    const g = computeIntersectionGeometry(
      [arm({ x: 0, z: 1 }, N, 5, 8), arm({ x: 0, z: -1 }, S, 5, 8)],
      { minSetback: 2 }
    );
    expect(g).not.toBeNull();
    // Both corners fall back to seam midpoints at x = ±5.
    expect(g.corners.every((c) => !c.arc)).toBe(true);
    const seamXs = g.corners.map((c) => c.apex.x).sort((a, b) => a - b);
    expect(seamXs[0]).toBeCloseTo(-5);
    expect(seamXs[1]).toBeCloseTo(5);
    // Surface is the seam band between the two mouths.
    expect(Math.abs(polygonArea(g.surface))).toBeGreaterThan(10 * 4 - 1e-6);
    // Mouths face opposite directions with full roadway width.
    expect(g.mouths[0].width).toBeCloseTo(10);
    expect(g.mouths[1].width).toBeCloseTo(10);
    expect(g.mouths[0].dir.z).toBeCloseTo(1);
    expect(g.mouths[1].dir.z).toBeCloseTo(-1);
  });

  it('respects asymmetric cross-sections and off-center nodes', () => {
    // East arm's roadway is shifted: sidewalk only on its max side.
    const east = {
      id: 'east',
      point: { x: 2, z: 0 },
      dir: E,
      road: { min: -5, max: 3 },
      full: { min: -5, max: 6 }
    };
    const g = computeIntersectionGeometry(
      [east, arm(O, N, 4, 6, 'north'), arm(O, S, 4, 6, 'south')],
      { curbRadius: 1, mouthMargin: 0.5 }
    );
    expect(g).not.toBeNull();
    expect(g.mouths[0].width).toBeCloseTo(8);
    // Mouth center is offset from the arm centerline by (min+max)/2 = -1.
    // normal(E) = {x:0, z:1}, so the offset shows up in z.
    expect(g.mouths[0].center.z).toBeCloseTo(-1);
    // Ids ride along for the component to key treatments on.
    expect(g.mouths[0].id).toBe('east');
  });

  // Trim contract: the component moves a street's node onto the mouth, and
  // the next rebuild sees the node there. The mouth must be a fixed point in
  // space for a node sliding along its own centerline, or trimming would
  // drift the intersection outward on every rebuild.
  it('keeps mouth points fixed when a node slides along its centerline', () => {
    const opts = { curbRadius: 2, mouthMargin: 0.5 };
    const before = computeIntersectionGeometry(
      [arm(O, N, 5, 8), arm(O, S, 5, 8), arm(O, E, 5, 8), arm(O, W, 5, 8)],
      opts
    );
    // Slide the north node out to its own mouth (t along dir from the node).
    const northMouth = before.mouths[0];
    const after = computeIntersectionGeometry(
      [
        arm({ x: 0, z: northMouth.t }, N, 5, 8),
        arm(O, S, 5, 8),
        arm(O, E, 5, 8),
        arm(O, W, 5, 8)
      ],
      opts
    );
    // Same mouth point in space; node now sits on it (t ≈ 0), so a second
    // trim would be a no-op.
    closeTo(after.mouths[0].center, northMouth.center.x, northMouth.center.z);
    expect(after.mouths[0].t).toBeCloseTo(0);
    // The other arms' mouths are untouched.
    for (let i = 1; i < 4; i++) {
      closeTo(
        after.mouths[i].center,
        before.mouths[i].center.x,
        before.mouths[i].center.z
      );
    }
  });

  it('keeps seam mouths fixed for collinear pairs too', () => {
    const opts = { minSetback: 2 };
    const before = computeIntersectionGeometry(
      [arm({ x: 0, z: 1 }, N, 5, 8), arm({ x: 0, z: -1 }, S, 5, 8)],
      opts
    );
    const after = computeIntersectionGeometry(
      [
        arm({ x: 0, z: 1 + before.mouths[0].t }, N, 5, 8),
        arm({ x: 0, z: -1 - before.mouths[1].t }, S, 5, 8)
      ],
      opts
    );
    closeTo(
      after.mouths[0].center,
      before.mouths[0].center.x,
      before.mouths[0].center.z
    );
    closeTo(
      after.mouths[1].center,
      before.mouths[1].center.x,
      before.mouths[1].center.z
    );
    expect(after.mouths[0].t).toBeCloseTo(0);
    expect(after.mouths[1].t).toBeCloseTo(0);
  });

  it('caps mouth setback for sliver-angle arm pairs (trim safety)', () => {
    // ~12° between the first two arms: their corner lands ~47m down the
    // edges (still under maxCornerDistance), which without the cap would put
    // the mouths — and any street trim chasing them — ~50m out.
    const sliverDir = { x: Math.sin(0.21), z: Math.cos(0.21) };
    const g = computeIntersectionGeometry(
      [arm(O, N, 5, 8), arm(O, sliverDir, 5, 8), arm(O, S, 5, 8)],
      { curbRadius: 2, maxSetback: 15 }
    );
    expect(g).not.toBeNull();
    g.mouths.forEach((m) => {
      // Symmetric arms with nodes at the origin: mouth center distance from
      // the origin equals the setback.
      expect(Math.hypot(m.center.x, m.center.z)).toBeLessThanOrEqual(15.01);
    });
  });

  it('keeps arms in caller order in mouths[]', () => {
    const g = computeIntersectionGeometry(
      [arm(O, W, 5), arm(O, E, 5), arm(O, N, 5)],
      {}
    );
    expect(g.mouths[0].dir).toEqual(W);
    expect(g.mouths[1].dir).toEqual(E);
    expect(g.mouths[2].dir).toEqual(N);
  });
});
