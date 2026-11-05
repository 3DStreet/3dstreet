import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  FILL_MATERIALS,
  effectivePatternSize,
  fillAngleFromRing,
  fillUV,
  parsePatternKey,
  patternCoverageAtUV,
  patternKey,
  patternTileSize,
  rasterPatternTile,
  resolveFillMaterial,
  resolveFillPattern,
  writeFillUVs
} from '../../src/tested/shape-fill.js';

// The fill frame, worked from its stated convention rather than read back
// through fillUV: at Angle θ the across axis is (cos θ, -sin θ) and the along
// axis (-sin θ, -cos θ) in world (x, z), offsets subtracted after rotation.
const DEG = Math.PI / 180;
const acrossAxis = (deg) => [Math.cos(deg * DEG), -Math.sin(deg * DEG)];
const alongAxis = (deg) => [-Math.sin(deg * DEG), -Math.cos(deg * DEG)];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const scale = (a, k) => [a[0] * k, a[1] * k];
// Stripe family 1 is lines along (-1, 1)/√2 in (across, along), so its normal
// is (1, 1)/√2; family 2 (crosshatch) is the mirror.
const normal1 = (deg) =>
  scale(add(acrossAxis(deg), alongAxis(deg)), Math.SQRT1_2);
const normal2 = (deg) =>
  scale(add(alongAxis(deg), acrossAxis(deg), -1), Math.SQRT1_2);

const STEP = 1e-4; // 0.1 mm
const TOL = 1e-3; // 1 mm

function covered(pattern, p, o) {
  const [u, v] = fillUV(p[0], p[1], o.angle, o.along, o.across);
  return patternCoverageAtUV(pattern, u, v, o.spacing, o.width);
}

// Walk from `start` along unit `dir` over t in [t0, t1], returning each
// coverage transition as { t, rising } at the midpoint between samples.
function walk(pattern, o, start, dir, t0, t1) {
  const edges = [];
  let prev = covered(pattern, add(start, dir, t0), o);
  for (let t = t0 + STEP; t <= t1; t += STEP) {
    const now = covered(pattern, add(start, dir, t), o);
    if (now !== prev) edges.push({ t: t - STEP / 2, rising: now });
    prev = now;
  }
  return edges;
}

// Line widths (rising → falling) and pitches (rising → rising) along a walk.
function measure(edges) {
  const widths = [];
  const pitches = [];
  for (let i = 0; i < edges.length; i++) {
    if (!edges[i].rising) continue;
    const fall = edges.slice(i + 1).find((e) => !e.rising);
    if (fall) widths.push(fall.t - edges[i].t);
    const nextRise = edges.slice(i + 1).find((e) => e.rising);
    if (nextRise) pitches.push(nextRise.t - edges[i].t);
  }
  return { widths, pitches };
}

const SPACINGS = [1, 1.5, 0.4];
const WIDTHS = [0.15, 0.3];
const ANGLES = [0, 30, -60];
const OFFSETS = [
  { along: 0, across: 0 },
  { along: 0.37, across: -1.2 }
];

function combos() {
  const out = [];
  for (const spacing of SPACINGS) {
    for (const width of WIDTHS) {
      for (const angle of ANGLES) {
        for (const off of OFFSETS) out.push({ spacing, width, angle, ...off });
      }
    }
  }
  return out;
}

describe('fill layout maths (period, width, phase)', () => {
  it('draws stripes at the panel width and spacing, an edge through the origin', () => {
    for (const o of combos()) {
      const s = o.spacing;
      // Across at least three tile boundaries, through negative u and v.
      const edges = walk('stripes', o, [0, 0], normal1(o.angle), -3 * s, 3 * s);
      const { widths, pitches } = measure(edges);
      expect(widths.length).toBeGreaterThanOrEqual(4);
      expect(pitches.length).toBeGreaterThanOrEqual(4);
      for (const w of widths) expect(Math.abs(w - o.width)).toBeLessThan(TOL);
      for (const p of pitches) expect(Math.abs(p - s)).toBeLessThan(TOL);
      if (o.along === 0 && o.across === 0) {
        const nearest = Math.min(...edges.map((e) => Math.abs(e.t)));
        expect(nearest).toBeLessThan(TOL);
      }
    }
  });

  it('places the first stripe edge past an offset at a hand-worked world position', () => {
    // Offset along 0.37, across -1.2, spacing 1. Along the stripe normal the
    // coverage is (t - (across + along)/√2) mod 1 < w, so rising edges sit at
    // t = -0.83/√2 + k: the first positive one at 1 - 0.586899 = 0.413101.
    // As a world point, t × normal:
    //   Angle 0:  normal (0.707107, -0.707107)  → (0.292103, -0.292103)
    //   Angle 30: normal (0.258819, -0.965926)  → (0.106919, -0.399025)
    const cases = [
      { angle: 0, literal: [0.292103, -0.292103] },
      { angle: 30, literal: [0.106919, -0.399025] }
    ];
    for (const c of cases) {
      const o = {
        spacing: 1,
        width: 0.15,
        angle: c.angle,
        along: 0.37,
        across: -1.2
      };
      const dir = normal1(c.angle);
      const first = walk('stripes', o, [0, 0], dir, 0, 1.5).find(
        (e) => e.rising
      );
      const at = scale(dir, first.t);
      expect(Math.abs(at[0] - c.literal[0])).toBeLessThan(TOL);
      expect(Math.abs(at[1] - c.literal[1])).toBeLessThan(TOL);
    }
  });

  it('draws both crosshatch families at the panel width and spacing', () => {
    for (const o of combos()) {
      const s = o.spacing;
      const c1 = (o.across + o.along) * Math.SQRT1_2;
      const c2 = (o.along - o.across) * Math.SQRT1_2;
      // Walk each family along its own normal, on a line that sits in the
      // middle of the OTHER family's gap, so only one family is crossed.
      const fam = [
        { dir: normal1(o.angle), side: normal2(o.angle), sideAt: c2, c: c1 },
        { dir: normal2(o.angle), side: normal1(o.angle), sideAt: c1, c: c2 }
      ];
      for (const f of fam) {
        const q = f.sideAt + (s + o.width) / 2;
        const start = scale(f.side, q);
        const edges = walk('crosshatch', o, start, f.dir, -3 * s, 3 * s);
        const { widths, pitches } = measure(edges);
        expect(widths.length).toBeGreaterThanOrEqual(4);
        for (const w of widths) expect(Math.abs(w - o.width)).toBeLessThan(TOL);
        for (const p of pitches) expect(Math.abs(p - s)).toBeLessThan(TOL);
        // A rising edge at t = c (mod s).
        const phase = edges
          .filter((e) => e.rising)
          .map((e) => Math.abs(((((e.t - f.c) % s) + s + s / 2) % s) - s / 2));
        expect(Math.min(...phase)).toBeLessThan(TOL);
      }
    }
  });

  it('draws dots at the panel diameter and pitch, a centre at a hand-worked point', () => {
    for (const o of combos()) {
      const s = o.spacing;
      // A row of dot centres: along = s/2 after offset, so in world terms the
      // walk line is (s/2 + along) × alongAxis, walked along acrossAxis.
      const start = scale(alongAxis(o.angle), s / 2 + o.along);
      const edges = walk('dots', o, start, acrossAxis(o.angle), -3 * s, 3 * s);
      const { widths, pitches } = measure(edges);
      expect(widths.length).toBeGreaterThanOrEqual(4);
      for (const w of widths) expect(Math.abs(w - o.width)).toBeLessThan(TOL);
      for (const p of pitches) expect(Math.abs(p - s)).toBeLessThan(TOL);
    }
    // Spacing 1, width 0.15, offset along 0.37, across -1.2: a centre at
    // across = along = 0.5, i.e. at -0.7 × acrossAxis + 0.87 × alongAxis.
    //   Angle 0:  (-0.7, -0.87)
    //   Angle 30: (-0.7·0.866025 - 0.87·0.5, 0.7·0.5 - 0.87·0.866025)
    //           = (-1.041218, -0.403442)
    const cases = [
      { angle: 0, centre: [-0.7, -0.87] },
      { angle: 30, centre: [-1.041218, -0.403442] }
    ];
    for (const c of cases) {
      const o = {
        spacing: 1,
        width: 0.15,
        angle: c.angle,
        along: 0.37,
        across: -1.2
      };
      expect(covered('dots', c.centre, o)).toBe(true);
      for (const axis of [acrossAxis(c.angle), alongAxis(c.angle)]) {
        for (const k of [-1, 1]) {
          expect(covered('dots', add(c.centre, axis, k * 0.074), o)).toBe(true);
          expect(covered('dots', add(c.centre, axis, k * 0.076), o)).toBe(
            false
          );
        }
      }
    }
  });

  it('draws checkerboard squares of the spacing, an edge through the origin and at the offset', () => {
    for (const o of combos()) {
      const s = o.spacing;
      // Walk across, a quarter-square in from an along edge.
      const start = scale(alongAxis(o.angle), o.along + s / 4);
      const edges = walk(
        'checkerboard',
        o,
        start,
        acrossAxis(o.angle),
        -3 * s,
        3 * s
      );
      const { widths, pitches } = measure(edges);
      // Squares alternate over a 2s period, so ±3s holds at least two whole.
      expect(widths.length).toBeGreaterThanOrEqual(2);
      expect(pitches.length).toBeGreaterThanOrEqual(1);
      for (const w of widths) expect(Math.abs(w - s)).toBeLessThan(TOL);
      for (const p of pitches) expect(Math.abs(p - 2 * s)).toBeLessThan(TOL);
      // An edge at across = 0, i.e. at t = offset across (mod s) along this
      // walk.
      const phase = edges.map((e) =>
        Math.abs(((((e.t - o.across) % s) + s + s / 2) % s) - s / 2)
      );
      expect(Math.min(...phase)).toBeLessThan(TOL);
    }
    // Literal: at Angle 0 with offset across -1.2, a square edge at x = -1.2.
    const o = { spacing: 1, width: 0.15, angle: 0, along: 0.37, across: -1.2 };
    const z = -(0.37 + 0.25);
    expect(covered('checkerboard', [-1.2 + 0.002, z], o)).not.toBe(
      covered('checkerboard', [-1.2 - 0.002, z], o)
    );
  });
});

describe('fill Angle sign', () => {
  it('turns the same way as a positive rotation.y', () => {
    for (const deg of [0, 30, -60, 135]) {
      const obj = new THREE.Object3D();
      obj.rotation.y = deg * DEG;
      obj.updateMatrixWorld();
      const side = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion);
      const angle = fillAngleFromRing([
        { x: 0, z: 0 },
        { x: side.x, z: side.z }
      ]);
      expect(Math.abs(angle - deg)).toBeLessThanOrEqual(0.01);
      // And "along" increases toward the side's far end.
      const along =
        fillUV(side.x, side.z, angle, 0, 0)[1] - fillUV(0, 0, angle, 0, 0)[1];
      expect(along).toBeGreaterThan(0);
    }
  });
});

describe('fill texture orientation', () => {
  it('lays a texture on a shape at Angle 0 the way a segment box lays it', () => {
    // A segment's surface is the top face of a box: find it in a real
    // BoxGeometry (normal +y) and read how its UVs run.
    const box = new THREE.BoxGeometry(2, 1, 2);
    const pos = box.attributes.position;
    const uv = box.attributes.uv;
    const nrm = box.attributes.normal;
    const top = [];
    for (let i = 0; i < pos.count; i++) {
      if (nrm.getY(i) > 0.99) {
        top.push({
          x: pos.getX(i),
          z: pos.getZ(i),
          u: uv.getX(i),
          v: uv.getY(i)
        });
      }
    }
    expect(top).toHaveLength(4);
    const minX = top.filter((p) => p.x < 0);
    const maxX = top.filter((p) => p.x > 0);
    const minZ = top.filter((p) => p.z < 0);
    const maxZ = top.filter((p) => p.z > 0);
    const mean = (ps, k) => ps.reduce((a, p) => a + p[k], 0) / ps.length;
    const boxDuDx = mean(maxX, 'u') - mean(minX, 'u');
    const boxDvDz = mean(maxZ, 'v') - mean(minZ, 'v');
    expect(boxDuDx).toBeGreaterThan(0);
    expect(boxDvDz).toBeLessThan(0);

    const duDx = fillUV(1, 0, 0, 0, 0)[0] - fillUV(0, 0, 0, 0, 0)[0];
    const dvDz = fillUV(0, 1, 0, 0, 0)[1] - fillUV(0, 0, 0, 0, 0)[1];
    expect(Math.sign(duDx)).toBe(Math.sign(boxDuDx));
    expect(Math.sign(dvDz)).toBe(Math.sign(boxDvDz));
  });
});

describe('stripe direction in the world', () => {
  // At Angle 30 the along axis points at R_y(30°)(0, 0, -1); stripes run 45°
  // further round, R_y(75°)(0, 0, -1) = (-0.965926, -0.258819). Crosshatch's
  // second family runs at R_y(-15°)(0, 0, -1) = (0.258819, -0.965926).
  const o = { spacing: 1, width: 0.3, angle: 30, along: 0, across: 0 };
  const STRIPE_DIR = [-0.965926, -0.258819];
  const SECOND_DIR = [0.258819, -0.965926];

  function constantAlong(pattern, start, dir) {
    const first = covered(pattern, start, o);
    for (let t = -20; t <= 20; t += 0.01) {
      if (covered(pattern, add(start, dir, t), o) !== first) return null;
    }
    return first;
  }

  it('runs stripes at +45° from the Angle', () => {
    // A stripe centre and a gap centre, a quarter of the way into each.
    const inStripe = scale(normal1(30), o.width / 2);
    const inGap = scale(normal1(30), (o.spacing + o.width) / 2);
    expect(constantAlong('stripes', inStripe, STRIPE_DIR)).toBe(true);
    expect(constantAlong('stripes', inGap, STRIPE_DIR)).toBe(false);
    // Across the stripes it varies.
    expect(constantAlong('stripes', inStripe, SECOND_DIR)).toBe(null);
  });

  it('runs crosshatch along both diagonals', () => {
    const inFirst = scale(normal1(30), o.width / 2);
    const inSecond = scale(normal2(30), o.width / 2);
    expect(constantAlong('crosshatch', inFirst, STRIPE_DIR)).toBe(true);
    expect(constantAlong('crosshatch', inSecond, SECOND_DIR)).toBe(true);
    expect(
      constantAlong(
        'crosshatch',
        scale(normal1(30), (o.spacing + o.width) / 2),
        STRIPE_DIR
      )
    ).toBe(null);
  });
});

describe('the drawn pattern tile', () => {
  it('agrees with the layout maths texel by texel, with white gaps', () => {
    const ratio = 0.15;
    const size = patternTileSize('stripes', ratio);
    const data = rasterPatternTile('stripes', ratio, size);
    expect(data).toHaveLength(size * size * 4);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) {
        throw new Error(`texel ${i / 4} is not white`);
      }
    }
    // Spacing 1, width 0.15 → period √2. A deterministic scatter of world
    // points over ±3 periods, at Angle 30 with an offset.
    const spacing = 1;
    const width = ratio * spacing;
    const period = Math.SQRT2 * spacing;
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const frac = (x) => x - Math.floor(x);
    let checked = 0;
    let coveredCount = 0;
    const tiles = new Set();
    let negatives = 0;
    while (checked < 240) {
      const x = (rand() * 6 - 3) * period;
      const z = (rand() * 6 - 3) * period;
      const [u, v] = fillUV(x, z, 30, 0.37, -1.2);
      const tu = frac(u / period);
      const tv = frac(v / period);
      // At least 2 texels from a line edge (edges run diagonally in the tile,
      // where tu + tv crosses 0 or the ratio, mod 1).
      const d = frac(tu + tv);
      const margin = Math.min(d, Math.abs(d - ratio), 1 - d);
      if (margin < 3 / size) continue;
      const i = Math.floor(tu * size);
      const j = Math.floor(tv * size);
      const alpha = data[(j * size + i) * 4 + 3];
      const expected = patternCoverageAtUV('stripes', u, v, spacing, width);
      expect(alpha > 127).toBe(expected);
      if (expected) coveredCount++;
      if (u < 0 || v < 0) negatives++;
      tiles.add(`${Math.floor(u / period)},${Math.floor(v / period)}`);
      checked++;
    }
    expect(coveredCount).toBeGreaterThan(10);
    expect(checked - coveredCount).toBeGreaterThan(10);
    expect(negatives).toBeGreaterThan(10);
    expect(tiles.size).toBeGreaterThanOrEqual(3);
  });
});

describe('fillAngleFromRing', () => {
  it('reads the first side of at least 1 mm', () => {
    expect(
      fillAngleFromRing([
        { x: 0, z: 0 },
        { x: 0, z: -5 }
      ])
    ).toBe(0);
    expect(
      fillAngleFromRing([
        { x: 0, z: 0 },
        { x: 0, z: 5 }
      ])
    ).toBe(180);
    expect(
      fillAngleFromRing([
        { x: 0, z: 0 },
        { x: -5, z: 0 }
      ])
    ).toBe(90);
    // A first side under 1 mm is skipped.
    expect(
      fillAngleFromRing([
        { x: 0, z: 0 },
        { x: 0.0005, z: 0 },
        { x: -4.9995, z: 0 }
      ])
    ).toBe(90);
    // All degenerate → 0.
    expect(
      fillAngleFromRing([
        { x: 1, z: 1 },
        { x: 1, z: 1.0002 },
        { x: 1.0003, z: 1.0002 }
      ])
    ).toBe(0);
    expect(fillAngleFromRing([])).toBe(0);
  });
});

describe('resolvers, guards and tile size', () => {
  it('maps an unknown stored value to the default without rewriting it', () => {
    for (const v of ['asphalt', 'water', '', undefined, 'toString']) {
      expect(resolveFillMaterial(v)).toBe('solid');
    }
    expect(resolveFillMaterial('grass')).toBe('grass');
    for (const v of ['zigzag', '', undefined]) {
      expect(resolveFillPattern(v)).toBe('none');
    }
    expect(resolveFillPattern('dots')).toBe('dots');
    const data = { fillMaterial: 'asphalt' };
    resolveFillMaterial(data.fillMaterial);
    expect(data.fillMaterial).toBe('asphalt');
  });

  it('guards spacing and width at draw time', () => {
    for (const s of [0, -1, NaN, '']) {
      for (const w of [0, -1, NaN, 5]) {
        const out = effectivePatternSize(s, w);
        expect(Number.isFinite(out.spacing)).toBe(true);
        expect(Number.isFinite(out.width)).toBe(true);
        expect(out.spacing).toBeGreaterThanOrEqual(0.05);
        expect(out.width).toBeGreaterThanOrEqual(0.01);
        expect(out.width).toBeLessThanOrEqual(out.spacing);
      }
    }
    expect(effectivePatternSize(1.5, 0.3)).toEqual({
      spacing: 1.5,
      width: 0.3
    });
    expect(effectivePatternSize(NaN, NaN)).toEqual({
      spacing: 1,
      width: 0.15
    });
  });

  it('picks the tile size from the narrowest feature', () => {
    expect(patternTileSize('stripes', 0.15)).toBe(256);
    expect(patternTileSize('stripes', 0.005)).toBe(1024);
    expect(patternTileSize('stripes', 1 / 1024)).toBe(2048);
    expect(patternTileSize('stripes', 1)).toBe(256);
    expect(patternTileSize('checkerboard', 0.005)).toBe(256);
  });

  it('round-trips a pattern key', () => {
    expect(parsePatternKey(patternKey('stripes', 1.5, 0.3))).toEqual({
      pattern: 'stripes',
      spacing: 1.5,
      width: 0.3
    });
    expect(patternKey('checkerboard', 2, 0.15)).toBe(
      patternKey('checkerboard', 2, 0.7)
    );
  });

  it('names every texture by its shared asset id', () => {
    expect(FILL_MATERIALS.solid.textureId).toBe(null);
    expect(FILL_MATERIALS.grass.textureId).toBe('grass-texture');
  });
});

describe('writeFillUVs', () => {
  it('writes the same UVs as fillUV, in place', () => {
    const positions = new Float32Array([0, 0, 0, 3, 0, -2, -1.5, 0, 4]);
    const uvs = new Float32Array(6);
    writeFillUVs(positions, uvs, 30, 0.37, -1.2);
    for (let i = 0; i < 3; i++) {
      const [u, v] = fillUV(
        positions[i * 3],
        positions[i * 3 + 2],
        30,
        0.37,
        -1.2
      );
      expect(uvs[i * 2]).toBeCloseTo(u, 5);
      expect(uvs[i * 2 + 1]).toBeCloseTo(v, 5);
    }
  });
});
