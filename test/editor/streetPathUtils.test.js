// Curve core for path-following (curved) streets: centerline construction,
// arc-length frames, the straight→curved mapping, and ribbon geometry.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  buildCenterlinePoints,
  filletPolyline,
  PathSampler,
  mapStraightPoint,
  buildRibbonGeometry
} from '@/tested/street-path-utils.js';

const v = (x, y, z) => new THREE.Vector3(x, y, z);

describe('buildCenterlinePoints', () => {
  it('linear keeps the vertices as-is', () => {
    const pts = buildCenterlinePoints([v(0, 0, 0), v(0, 0, 10), v(10, 0, 10)], {
      curveType: 'linear'
    });
    expect(pts).toHaveLength(3);
    expect(pts[2].x).toBeCloseTo(10);
  });

  it('smooth passes through the end vertices and densifies', () => {
    const pts = buildCenterlinePoints([v(0, 0, 0), v(0, 0, 20), v(20, 0, 20)], {
      curveType: 'smooth'
    });
    expect(pts.length).toBeGreaterThan(10);
    expect(pts[0].distanceTo(v(0, 0, 0))).toBeLessThan(1e-6);
    expect(pts[pts.length - 1].distanceTo(v(20, 0, 20))).toBeLessThan(1e-6);
  });

  it('drops duplicate consecutive vertices', () => {
    const pts = buildCenterlinePoints([v(0, 0, 0), v(0, 0, 0), v(0, 0, 10)], {
      curveType: 'linear'
    });
    expect(pts).toHaveLength(2);
  });
});

describe('filletPolyline', () => {
  it('replaces a 90° corner with an arc of the requested radius', () => {
    // L path: 10m up +z, then 10m along +x; radius 4 cuts the corner.
    const pts = filletPolyline(
      [v(0, 0, 0), v(0, 0, 10), v(10, 0, 10)],
      4,
      false,
      0.25
    );
    const sampler = new PathSampler(pts, false);
    // legs (10-4)*2 + quarter arc 2π*4/4 ≈ 18.283
    const expected = 12 + (Math.PI / 2) * 4;
    expect(sampler.totalLength).toBeGreaterThan(expected - 0.05);
    expect(sampler.totalLength).toBeLessThan(expected + 0.05);
    // endpoints unchanged
    expect(pts[0].distanceTo(v(0, 0, 0))).toBeLessThan(1e-6);
    expect(pts[pts.length - 1].distanceTo(v(10, 0, 10))).toBeLessThan(1e-6);
  });

  it('clamps the radius so adjacent fillets never overlap', () => {
    const pts = filletPolyline(
      [v(0, 0, 0), v(0, 0, 10), v(10, 0, 10)],
      100, // absurd radius: tangent length clamps to half the shorter leg (5)
      false,
      0.25
    );
    const sampler = new PathSampler(pts, false);
    expect(sampler.totalLength).toBeLessThan(20); // still cuts the corner
    expect(sampler.totalLength).toBeGreaterThan(10 * Math.SQRT2); // > chord
  });
});

describe('PathSampler frames', () => {
  it('is the identity mapping on a straight +z path', () => {
    const sampler = new PathSampler([v(0, 0, 0), v(0, 0, 10)], false);
    expect(sampler.totalLength).toBeCloseTo(10);
    const f = sampler.frameAtS(3);
    expect(f.position.z).toBeCloseTo(3);
    expect(f.yawDeg).toBeCloseTo(0);
    expect(f.right.x).toBeCloseTo(1); // +x lateral, as straight streets have
    const mapped = mapStraightPoint(sampler, 0, 2, 3);
    expect(mapped.x).toBeCloseTo(2);
    expect(mapped.y).toBeCloseTo(0);
    expect(mapped.z).toBeCloseTo(3);
    expect(mapped.yawDeg).toBeCloseTo(0);
  });

  it('turns lateral offsets with the tangent after a 90° corner', () => {
    const sampler = new PathSampler(
      [v(0, 0, 0), v(0, 0, 10), v(10, 0, 10)],
      false
    );
    // s=15 → 5m into the second leg heading +x; right of +x is -z
    const mapped = mapStraightPoint(sampler, 0, 1, 15);
    expect(mapped.x).toBeCloseTo(5);
    expect(mapped.z).toBeCloseTo(9);
    expect(mapped.yawDeg).toBeCloseTo(90);
  });

  it('extrapolates straight past an open path end', () => {
    const sampler = new PathSampler([v(0, 0, 0), v(0, 0, 10)], false);
    expect(sampler.frameAtS(12).position.z).toBeCloseTo(12);
    expect(sampler.frameAtS(-2).position.z).toBeCloseTo(-2);
  });

  it('wraps arc length on closed paths', () => {
    const sampler = new PathSampler(
      [v(0, 0, 0), v(10, 0, 0), v(10, 0, 10), v(0, 0, 10)],
      true
    );
    expect(sampler.totalLength).toBeCloseTo(40);
    const a = sampler.frameAtS(1);
    const b = sampler.frameAtS(41);
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-6);
  });

  it('honors zStart (street-align derived) in the mapping', () => {
    const sampler = new PathSampler([v(0, 0, 0), v(0, 0, 10)], false);
    // align 'middle' on a 10m street: straight z ∈ [-5, 5], zStart = -5
    const mapped = mapStraightPoint(sampler, -5, 0, -5);
    expect(mapped.z).toBeCloseTo(0); // street start sits on the path start
  });

  it('carries the path elevation into the mapping', () => {
    const sampler = new PathSampler([v(0, 0, 0), v(0, 2, 10)], false);
    const mapped = mapStraightPoint(sampler, 0, 0, sampler.totalLength / 2);
    expect(mapped.y).toBeCloseTo(1);
  });
});

describe('buildRibbonGeometry', () => {
  it('extrudes a straight run into the expected box envelope', () => {
    const sampler = new PathSampler([v(0, 0, 0), v(0, 0, 10)], false);
    const geom = buildRibbonGeometry(sampler, {
      lateralCenter: 0,
      width: 2,
      height: 0.5,
      sStart: 0,
      sEnd: 10
    });
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    expect(bb.min.x).toBeCloseTo(-1);
    expect(bb.max.x).toBeCloseTo(1);
    expect(bb.min.y).toBeCloseTo(-0.5);
    expect(bb.max.y).toBeCloseTo(0);
    expect(bb.min.z).toBeCloseTo(0);
    expect(bb.max.z).toBeCloseTo(10);
    expect(geom.getAttribute('uv')).toBeTruthy();
    expect(geom.getAttribute('normal')).toBeTruthy();
    expect(geom.getIndex().count % 3).toBe(0);
  });

  it('offsets by lateralCenter and subtracts the origin', () => {
    const sampler = new PathSampler([v(0, 0, 0), v(0, 0, 10)], false);
    const geom = buildRibbonGeometry(sampler, {
      lateralCenter: 3,
      width: 2,
      height: 0,
      sStart: 0,
      sEnd: 10,
      origin: { x: 3, z: 0 }
    });
    geom.computeBoundingBox();
    // lateral band [2,4] minus origin.x 3 → [-1, 1] in entity-local space
    expect(geom.boundingBox.min.x).toBeCloseTo(-1);
    expect(geom.boundingBox.max.x).toBeCloseTo(1);
    // height 0 → top face only
    expect(geom.boundingBox.min.y).toBeCloseTo(0);
  });

  it('tilts the top face across the width for slope segments', () => {
    const sampler = new PathSampler([v(0, 0, 0), v(0, 0, 10)], false);
    const geom = buildRibbonGeometry(sampler, {
      lateralCenter: 0,
      width: 2,
      height: 1,
      sStart: 0,
      sEnd: 10,
      slopeLeftDelta: -0.3,
      slopeRightDelta: 0.3
    });
    const pos = geom.getAttribute('position');
    // top-face verts sit at x=-1 (left, tilted down) and x=+1 (right, up);
    // the bottom stays flat at -height
    let leftTopSeen = false;
    let rightTopSeen = false;
    let minY = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      minY = Math.min(minY, y);
      if (Math.abs(x + 1) < 1e-6 && Math.abs(y + 0.3) < 1e-6) {
        leftTopSeen = true;
      }
      if (Math.abs(x - 1) < 1e-6 && Math.abs(y - 0.3) < 1e-6) {
        rightTopSeen = true;
      }
    }
    expect(leftTopSeen).toBe(true);
    expect(rightTopSeen).toBe(true);
    expect(minY).toBeCloseTo(-1); // flat bottom, unaffected by slope
  });

  it('bends around a corner (vertices appear on both legs)', () => {
    const sampler = new PathSampler(
      [v(0, 0, 0), v(0, 0, 10), v(10, 0, 10)],
      false
    );
    const geom = buildRibbonGeometry(sampler, {
      lateralCenter: 0,
      width: 2,
      height: 0.2,
      sStart: 0,
      sEnd: sampler.totalLength
    });
    geom.computeBoundingBox();
    expect(geom.boundingBox.max.x).toBeGreaterThan(9);
    expect(geom.boundingBox.max.z).toBeGreaterThan(10.5); // corner miter widens
  });
});
