import { describe, expect, it } from 'vitest';
import {
  ANGLE_EPS_DEG,
  closingAdjustment,
  headingDeg,
  isMultipleOf,
  snapHeading,
  snapPlacement,
  turnDeg
} from '../../src/editor/lib/shapeSnap.js';

const MIN = 0.05;
const p = (x, z) => ({ x, y: 0, z });
// The point `len` along `deg` from `from` — fixtures are built from exact
// headings, so their corners are exact up to rounding.
const polar = (from, len, deg) => {
  const rad = (deg * Math.PI) / 180;
  return p(from.x + len * Math.cos(rad), from.z + len * Math.sin(rad));
};

function expectPoint(actual, x, z, digits = 6) {
  expect(actual.x).toBeCloseTo(x, digits);
  expect(actual.z).toBeCloseTo(z, digits);
}

// The turns of a closed ring at every vertex, re-derived from its points.
function ringTurns(ring) {
  const n = ring.length;
  return ring.map((v, i) => {
    const prev = ring[(i - 1 + n) % n];
    const next = ring[(i + 1) % n];
    return turnDeg(headingDeg(prev, v), headingDeg(v, next));
  });
}

// The two closing turns — at the last vertex and at the first.
function closingTurns(vertices, point) {
  const ring = vertices.slice(0, -1).concat([point]);
  const turns = ringTurns(ring);
  return [turns[ring.length - 1], turns[0]];
}

const adjust = (vertices, step) =>
  closingAdjustment({ vertices, step, minSpacing: MIN });

describe('snapHeading', () => {
  it('snaps to the nearest multiple with hysteresis on wrapped distances, never reversing a side (fails without hysteresis, with a reverse on a later side, or with raw heading differences)', () => {
    const s = (o) =>
      snapHeading({ base: 0, step: 90, excludeReverse: true, ...o });
    expect(s({ rawHeading: 44 })).toBe(0);
    expect(s({ rawHeading: 46 })).toBe(90);
    expect(s({ rawHeading: 44, currentHeading: 90 })).toBe(90);
    expect(s({ rawHeading: 30, currentHeading: 90 })).toBe(0);
    expect([90, 270]).toContain(s({ rawHeading: 180 }));
    expect(
      snapHeading({ base: 0, step: 90, excludeReverse: false, rawHeading: 178 })
    ).toBe(180);
    // Across the 0°/360° seam: 314 is 46 from 0 and 44 from 270, inside the
    // band (44 + 9), so the shown 0 is kept; 300 is not.
    expect(s({ rawHeading: 314, currentHeading: 0 })).toBe(0);
    expect(s({ rawHeading: 300, currentHeading: 0 })).toBe(270);
  });

  it('quantises relative to the base, not to the world axes', () => {
    expect(
      snapHeading({
        base: 20,
        step: 90,
        excludeReverse: false,
        rawHeading: 105
      })
    ).toBe(110);
  });
});

describe('snapPlacement', () => {
  it('places the perpendicular foot on the ray, clamped at the last vertex (fails without the clamp)', () => {
    const last = { x: 0, y: 0, z: 0 };
    const behind = snapPlacement({
      last,
      raw: { x: -1, y: 0, z: 0.01 },
      heading: 0
    });
    expect(Math.hypot(behind.x, behind.y, behind.z)).toBeLessThan(1e-9);
    const ahead = snapPlacement({
      last,
      raw: { x: 0.04, y: 0, z: 0.3 },
      heading: 0
    });
    expectPoint(ahead, 0.04, 0);
    expect(ahead.y).toBe(0);
  });
});

describe('closingAdjustment', () => {
  it('slides the last vertex along its own side to square a rough rectangle (fails if the first vertex moves, or the point leaves the side)', () => {
    const v0 = p(0, 0);
    const v1 = polar(v0, 10, 20);
    const v2 = polar(v1, 6, 110);
    const v3 = polar(v2, 13, 200); // rough: the regular close is 10 along
    const vertices = [v0, v1, v2, v3];
    const { point } = adjust(vertices, 90);
    expect(point).toBeDefined();
    const d = { x: v3.x - v2.x, z: v3.z - v2.z };
    expect((point.x - v2.x) * d.x + (point.z - v2.z) * d.z).toBeGreaterThan(0);
    // On the line of the last side.
    expect(
      Math.abs((point.x - v2.x) * d.z - (point.z - v2.z) * d.x)
    ).toBeLessThan(1e-6);
    for (const turn of ringTurns([v0, v1, v2, point])) {
      expect(Math.abs(Math.abs(turn) - 90)).toBeLessThan(1e-6);
    }
  });

  it('refuses a close that only a backwards slide would square (fails if the slide parameter is tested unsigned)', () => {
    // The last side runs +x after a turn at v2. The one candidate the 0°/180°
    // rules leave (closing heading 270°) needs t = −10: the last side would
    // run backwards, changing the corner behind it, to (0, 10).
    const result = adjust([p(0, 0), p(10, 0), p(10, 10), p(13, 10)], 90);
    expect(result).toEqual({ refused: true });
  });

  it('refuses a triangle at 90° and closes one at 45° with snapped turns', () => {
    expect(adjust([p(0, 0), p(10, 0), p(10, 10)], 90)).toEqual({
      refused: true
    });
    const v1 = p(10, 0);
    const vertices = [p(0, 0), v1, polar(v1, 10, 135)];
    const { point } = adjust(vertices, 45);
    expect(point).toBeDefined();
    for (const turn of closingTurns(vertices, point)) {
      expect(isMultipleOf(turn, 45)).toBe(true);
    }
  });

  it('never makes the first vertex a straight-through point (fails without the 0° exclusion)', () => {
    // A unit hexagon whose last side is 1.7 long. Closing heading 300° moves
    // the last vertex 0.7 (t = 1); heading 0° moves it only 0.3 (t = 2) but
    // runs the closing side straight on into the first side — a pentagon.
    const v4 = p(0, 1.732051);
    const vertices = [
      p(0, 0),
      p(1, 0),
      p(1.5, 0.866025),
      p(1, 1.732051),
      v4,
      polar(v4, 1.7, 240)
    ];
    const { point } = adjust(vertices, 60);
    expectPoint(point, -0.5, 0.866025, 5);
  });

  it('refuses when the first and last sides are incompatible under the step, and leaves its input alone (fails on input mutation, or without the precondition)', () => {
    const vertices = [p(0, 0), p(10, 0), p(10, 10)];
    const copy = JSON.parse(JSON.stringify(vertices));
    expect(adjust(vertices, 60)).toEqual({ refused: true });
    expect(adjust(vertices, 45).point).toBeDefined();
    expect(vertices).toEqual(copy);
  });

  it('closes a pentagon at 36° and picks the least-moving close (fails on the largest move, a wrong order, or free placement)', () => {
    const v0 = p(0, 0);
    const v1 = p(10, 0);
    const v2 = polar(v1, 10, 72);
    const v3 = polar(v2, 10, 144);
    // (a) Nearly regular: every corner reads 108.
    const near = [v0, v1, v2, v3, polar(v3, 10.5, 216)];
    const a = adjust(near, 36).point;
    expectPoint(a, -3.09017, 9.51057, 5);
    for (const turn of ringTurns([v0, v1, v2, v3, a])) {
      expect(180 - Math.abs(turn)).toBeCloseTo(108, 6);
    }
    // (b) Overshot: the regular close is 15 away; closing heading 324° at
    // t = 16.18 moves it 8.82.
    const v4 = polar(v3, 25, 216);
    const far = [v0, v1, v2, v3, v4];
    const b = adjust(far, 36).point;
    expectPoint(b, -8.09017, 5.87785, 5);
    const d = { x: v4.x - v3.x, z: v4.z - v3.z };
    expect((b.x - v3.x) * d.x + (b.z - v3.z) * d.z).toBeGreaterThan(0);
    // Brute force over every closing heading: no valid candidate moves less.
    const moved = Math.hypot(b.x - v4.x, b.z - v4.z);
    const len = Math.hypot(d.x, d.z);
    for (let k = -4; k <= 5; k++) {
      const phi = 0 - k * 36;
      const c = {
        x: Math.cos((phi * Math.PI) / 180),
        z: Math.sin((phi * Math.PI) / 180)
      };
      const ux = d.x / len;
      const uz = d.z / len;
      const det = ux * c.z - uz * c.x;
      if (Math.abs(det) < 1e-9) continue;
      const wx = v0.x - v3.x;
      const wz = v0.z - v3.z;
      const t = (wx * c.z - wz * c.x) / det;
      const s = (ux * wz - uz * wx) / det;
      if (t < MIN || s < MIN) continue;
      const q = p(v3.x + t * ux, v3.z + t * uz);
      const turns = closingTurns(far, q);
      if (turns.some((turn) => isMultipleOf(turn, 180))) continue;
      const result = adjust([v0, v1, v2, v3, q], 36).point;
      // Only candidates that themselves close validly compete.
      if (!result || Math.hypot(result.x - q.x, result.z - q.z) > 1e-6) {
        continue;
      }
      expect(Math.hypot(q.x - v4.x, q.z - v4.z)).toBeGreaterThanOrEqual(
        moved - 1e-9
      );
    }
  });

  it('passes over a least-moving close whose closing side crosses the shape (fails if the first candidate is returned unvalidated)', () => {
    // Last side (−1,3)→(7,3); at 45° the closes on z = 3 are (3,3), moving
    // the vertex 4 with a closing side to the origin at 225°, and (0,3),
    // moving it 7 at 270°. (−3,3) would need t = −2, and every closing side
    // running up from the line would need s < 0. The first crosses the side
    // (2,0)→(2,8) at (2,2); the second crosses nothing.
    const vertices = [p(0, 0), p(2, 0), p(2, 8), p(-1, 8), p(-1, 3), p(7, 3)];
    const { point } = adjust(vertices, 45);
    expectPoint(point, 0, 3);
  });

  it('never closes back along the first side, in a fixture and across a seeded sweep (fails without the 180° exclusion)', () => {
    // (a) Closing heading 135°, t = 17.07, s = 19.14. Without the exclusion
    // the 180° candidate (t = 3.54) sorts first and, in double arithmetic,
    // lands a few ulps off the x-axis, where the edge tests do not see the
    // closing side running back over v0→v1.
    const v2 = polar(p(10, 0), 5, 45);
    const v3 = polar(v2, 7, 270);
    const { point } = adjust([p(0, 0), p(10, 0), v2, v3], 45);
    expectPoint(point, 13.535534, -13.535534);

    // (b) Whether (a)'s wrong result slips through depends on the sign of a
    // rounding residue, so a deterministic sweep covers many such cases.
    function mulberry32(seed) {
      let a = seed;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const rand = mulberry32(1);
    const pick = (list) => list[Math.floor(rand() * list.length)];
    let points = 0;
    const offending = [];
    for (let i = 0; i < 200; i++) {
      const step = pick([30, 45, 60, 90]);
      const n = pick([3, 4, 5, 6]);
      let heading = Math.floor(rand() * (360 / step)) * step;
      const turns = [];
      for (let m = 1 - 180 / step; m <= 180 / step - 1; m++) {
        turns.push(m * step);
      }
      const vertices = [p(0, 0)];
      for (let side = 0; side < n - 1; side++) {
        const length = 2 + rand() * 13;
        vertices.push(polar(vertices[vertices.length - 1], length, heading));
        if (side < n - 2) heading += pick(turns);
      }
      const result = adjust(vertices, step);
      if (!result.point) continue;
      points++;
      for (const turn of closingTurns(vertices, result.point)) {
        const bad =
          !isMultipleOf(turn, step) ||
          Math.abs(turn) < ANGLE_EPS_DEG ||
          Math.abs(Math.abs(turn) - 180) < ANGLE_EPS_DEG;
        if (bad) offending.push({ i, turn });
      }
    }
    expect(points).toBeGreaterThanOrEqual(50);
    expect(offending).toEqual([]);
  });

  it('keeps the slid vertex the minimum spacing from both neighbours (fails if either parameter is only tested non-negative)', () => {
    // (a) The only closes put the vertex 0.04 and 0.028 from the first vertex.
    const v2 = p(10, 10.04);
    expect(adjust([p(0, 0), p(10, 0), v2, polar(v2, 12, 225)], 45)).toEqual({
      refused: true
    });
    // (b) The only close puts it 0.03 from the vertex behind it, at (10, 10).
    expect(adjust([p(0, 0), p(10, 0), p(10, 9.97), p(10, 12.97)], 45)).toEqual({
      refused: true
    });
  });

  it('refuses up front when the sides were not drawn at the step, and snaps the closing turns when they were', () => {
    const v1 = polar(p(0, 0), 10, 30);
    const v2 = polar(v1, 10, 90);
    const vertices = [p(0, 0), v1, v2];
    expect(adjust(vertices, 90)).toEqual({ refused: true });
    // A last side at 120° after a first side at 0°: a close at (0, 17.32)
    // crosses nothing, but its closing turns (−30° and −60°) are not
    // multiples of 90°, so the close is refused before any slide is tried.
    expect(adjust([p(0, 0), p(10, 0), polar(p(10, 0), 10, 120)], 90)).toEqual({
      refused: true
    });
    const result = adjust(vertices, 30);
    if (result.point) {
      for (const turn of closingTurns(vertices, result.point)) {
        expect(isMultipleOf(turn, 30)).toBe(true);
      }
    } else {
      expect(result).toEqual({ refused: true });
    }
  });
});
