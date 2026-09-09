/* global describe, it */

/**
 * Overpass → extruded building geometry (#1962 step F).
 *
 * Covers the height heuristics carried over from osm4vr, ring winding
 * (roof normals up, walls outward), multipolygon holes, tile ownership by
 * bbox clipping (border buildings render as abutting fragments with no
 * wall on the clip line), and rejection of degenerate input.
 */

import assert from 'assert';
import {
  buildTileGeometry,
  tagsToHeight,
  tagsToMinHeight,
  heightToMeters,
  LEVEL_HEIGHT_M,
  BUILDING_TO_METER
} from '../../src/tested/osm-building-geometry.js';

const ORIGIN = { originLat: 37.7952, originLon: -122.3937 };

// A ~11 m square way footprint around the origin (closed ring, like
// Overpass `out geom` returns). dLat of 5e-5 ≈ 5.6 m.
function squareWay(tags = { building: 'yes' }, d = 5e-5, center = ORIGIN) {
  const { originLat: lat, originLon: lon } = center;
  return {
    type: 'way',
    id: 1,
    tags,
    geometry: [
      { lat: lat - d, lon: lon - d },
      { lat: lat - d, lon: lon + d },
      { lat: lat + d, lon: lon + d },
      { lat: lat + d, lon: lon - d },
      { lat: lat - d, lon: lon - d }
    ]
  };
}

function build(elements, tileBBox = null) {
  return buildTileGeometry(elements, { ...ORIGIN, tileBBox });
}

function triangleNormalY(positions, indices, tri) {
  const [a, b, c] = [
    indices[tri * 3],
    indices[tri * 3 + 1],
    indices[tri * 3 + 2]
  ];
  const p = (i) => [
    positions[i * 3],
    positions[i * 3 + 1],
    positions[i * 3 + 2]
  ];
  const [ax, ay, az] = p(a);
  const [bx, by, bz] = p(b);
  const [cx, cy, cz] = p(c);
  const u = [bx - ax, by - ay, bz - az];
  const v = [cx - ax, cy - ay, cz - az];
  return u[2] * v[0] - u[0] * v[2]; // y component of u × v
}

describe('osm-building-geometry heights', () => {
  it('parses meters and quoted feet', () => {
    assert.strictEqual(heightToMeters('12'), 12);
    assert.ok(Math.abs(heightToMeters("30'") - 9.144) < 1e-9);
  });

  it('follows the tag precedence: height > levels > roof:height > type', () => {
    assert.strictEqual(
      tagsToHeight({ height: '15', 'building:levels': '2' }, 100),
      15
    );
    assert.strictEqual(
      tagsToHeight({ 'building:levels': '4' }, 100),
      4 * LEVEL_HEIGHT_M
    );
    assert.strictEqual(tagsToHeight({ 'roof:height': '9' }, 100), 9);
    assert.strictEqual(
      tagsToHeight({ building: 'church' }, 100),
      BUILDING_TO_METER.church
    );
  });

  it('caps the tagless default by perimeter so sheds stay low', () => {
    assert.strictEqual(tagsToHeight({ building: 'yes' }, 100), 6);
    assert.strictEqual(tagsToHeight({ building: 'yes' }, 10), 2);
  });

  it('reads min_height and building:min_level', () => {
    assert.strictEqual(tagsToMinHeight({ min_height: '4' }), 4);
    assert.strictEqual(
      tagsToMinHeight({ 'building:min_level': '2' }),
      2 * LEVEL_HEIGHT_M
    );
    assert.strictEqual(tagsToMinHeight({}), 0);
  });
});

describe('buildTileGeometry', () => {
  it('extrudes a square way: roof at height, walls from ground', () => {
    const { positions, indices, buildingCount } = build([
      squareWay({ building: 'yes', height: '10' })
    ]);
    assert.strictEqual(buildingCount, 1);
    // 4 roof verts + 4 walls × 4 verts
    assert.strictEqual(positions.length / 3, 4 + 16);
    // roof: 2 triangles; walls: 4 × 2
    assert.strictEqual(indices.length / 3, 2 + 8);
    const ys = [];
    for (let i = 1; i < positions.length; i += 3) ys.push(positions[i]);
    assert.strictEqual(Math.max(...ys), 10);
    assert.strictEqual(Math.min(...ys), 0);
  });

  it('faces roofs up and walls outward', () => {
    const { positions, indices } = build([
      squareWay({ building: 'yes', height: '10' })
    ]);
    // roof triangles are the first two
    assert.ok(triangleNormalY(positions, indices, 0) > 0, 'roof faces up');
    assert.ok(triangleNormalY(positions, indices, 1) > 0, 'roof faces up');
    // wall normals: horizontal, pointing away from the footprint center.
    for (let tri = 2; tri < indices.length / 3; tri++) {
      const [a, b, c] = [
        indices[tri * 3],
        indices[tri * 3 + 1],
        indices[tri * 3 + 2]
      ];
      const p = (i) => [
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2]
      ];
      const [ax, ay, az] = p(a);
      const [bx, by, bz] = p(b);
      const [cx, cy, cz] = p(c);
      const u = [bx - ax, by - ay, bz - az];
      const v = [cx - ax, cy - ay, cz - az];
      const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0]
      ];
      // wall centroid (the footprint is centered at the local origin)
      const centroid = [(ax + bx + cx) / 3, 0, (az + bz + cz) / 3];
      const dot = n[0] * centroid[0] + n[2] * centroid[2];
      assert.ok(dot > 0, `wall triangle ${tri} faces outward`);
    }
  });

  it('honors min_height (walls start above ground)', () => {
    const { positions } = build([
      squareWay({ building: 'yes', height: '10', min_height: '4' })
    ]);
    const ys = [];
    for (let i = 1; i < positions.length; i += 3) ys.push(positions[i]);
    assert.strictEqual(Math.min(...ys), 4);
    assert.strictEqual(Math.max(...ys), 10);
  });

  it('triangulates multipolygon relations with holes', () => {
    const d = 5e-5;
    const h = 2e-5;
    const { originLat: lat, originLon: lon } = ORIGIN;
    const ring = (r) => [
      { lat: lat - r, lon: lon - r },
      { lat: lat - r, lon: lon + r },
      { lat: lat + r, lon: lon + r },
      { lat: lat + r, lon: lon - r },
      { lat: lat - r, lon: lon - r }
    ];
    const relation = {
      type: 'relation',
      id: 2,
      tags: { building: 'yes', height: '10', type: 'multipolygon' },
      members: [
        { type: 'way', role: 'outer', geometry: ring(d) },
        { type: 'way', role: 'inner', geometry: ring(h) }
      ]
    };
    const solid = build([squareWay({ building: 'yes', height: '10' })]);
    const withHole = build([relation]);
    assert.strictEqual(withHole.buildingCount, 1);
    // A hole adds courtyard walls and more roof triangles than the solid.
    assert.ok(withHole.indices.length > solid.indices.length);
    // every roof triangle still faces up
    assert.ok(triangleNormalY(withHole.positions, withHole.indices, 0) > 0);
  });

  it('skips open ways, non-buildings, and building:part', () => {
    const open = squareWay({ building: 'yes' });
    open.geometry = open.geometry.slice(0, 4); // un-close the ring
    const { buildingCount } = build([
      open,
      { type: 'way', tags: { highway: 'residential' }, geometry: [] },
      squareWay({ 'building:part': 'yes' })
    ]);
    assert.strictEqual(buildingCount, 0);
  });

  it('drops buildings wholly outside the tile bbox', () => {
    const d = 5e-5;
    const inside = squareWay({ building: 'yes', height: '10' });
    const outside = squareWay({ building: 'yes', height: '10' }, d, {
      originLat: ORIGIN.originLat + 0.01,
      originLon: ORIGIN.originLon
    });
    const tileBBox = {
      south: ORIGIN.originLat - 0.001,
      north: ORIGIN.originLat + 0.001,
      west: ORIGIN.originLon - 0.001,
      east: ORIGIN.originLon + 0.001
    };
    const { buildingCount } = build([inside, outside], tileBBox);
    assert.strictEqual(buildingCount, 1);
  });

  it('leaves a building fully inside the bbox untouched', () => {
    const tileBBox = {
      south: ORIGIN.originLat - 0.001,
      north: ORIGIN.originLat + 0.001,
      west: ORIGIN.originLon - 0.001,
      east: ORIGIN.originLon + 0.001
    };
    const whole = build([squareWay({ building: 'yes', height: '10' })]);
    const gated = build(
      [squareWay({ building: 'yes', height: '10' })],
      tileBBox
    );
    assert.deepStrictEqual([...gated.positions], [...whole.positions]);
    assert.deepStrictEqual([...gated.indices], [...whole.indices]);
  });

  it('clips border buildings to abutting fragments with no clip wall', () => {
    // Two tiles sharing the boundary meridian at the origin longitude; the
    // square building straddles it. East meters map to position z.
    const building = squareWay({ building: 'yes', height: '10' });
    const west = {
      south: ORIGIN.originLat - 0.001,
      north: ORIGIN.originLat + 0.001,
      west: ORIGIN.originLon - 0.001,
      east: ORIGIN.originLon
    };
    const east = {
      ...west,
      west: ORIGIN.originLon,
      east: ORIGIN.originLon + 0.001
    };
    const a = build([building], west);
    const b = build([building], east);
    assert.strictEqual(a.buildingCount, 1);
    assert.strictEqual(b.buildingCount, 1);

    const zs = (r) => {
      const out = [];
      for (let i = 2; i < r.positions.length; i += 3) out.push(r.positions[i]);
      return out;
    };
    // Each fragment stays on its own side and they abut exactly at z = 0.
    assert.ok(Math.max(...zs(a)) <= 0);
    assert.ok(Math.min(...zs(b)) >= 0);
    assert.strictEqual(Math.max(...zs(a)), 0);
    assert.strictEqual(Math.min(...zs(b)), 0);

    // No wall on the clip line: no triangle lies entirely in the z = 0
    // plane. (Roof + 3 walls per fragment: 2 + 3 × 2 triangles.)
    for (const r of [a, b]) {
      assert.strictEqual(r.indices.length / 3, 8);
      for (let t = 0; t < r.indices.length; t += 3) {
        const onBoundary = [0, 1, 2].every(
          (k) => r.positions[r.indices[t + k] * 3 + 2] === 0
        );
        assert.ok(!onBoundary, 'no wall emitted on the clip line');
      }
    }
  });

  it('gives clipped fragments the full footprint default height', () => {
    // Tagless building (default height = min(6, perimeter / 5)) straddling
    // the boundary: both fragments must use the WHOLE perimeter, so their
    // roofs meet at the same height.
    const building = squareWay({ building: 'yes' }); // ~11 m square
    const west = {
      south: ORIGIN.originLat - 0.001,
      north: ORIGIN.originLat + 0.001,
      west: ORIGIN.originLon - 0.001,
      east: ORIGIN.originLon
    };
    const east = {
      ...west,
      west: ORIGIN.originLon,
      east: ORIGIN.originLon + 0.001
    };
    const whole = build([building]);
    const roofY = (r) => {
      let max = -Infinity;
      for (let i = 1; i < r.positions.length; i += 3) {
        max = Math.max(max, r.positions[i]);
      }
      return max;
    };
    const expected = roofY(whole);
    assert.strictEqual(roofY(build([building], west)), expected);
    assert.strictEqual(roofY(build([building], east)), expected);
  });
});

describe('buildTileGeometry shading attributes', () => {
  it('emits flat normals: roof +y, walls horizontal and outward', () => {
    const { positions, normals, indices } = build([squareWay()]);
    assert.strictEqual(normals.length, positions.length);
    // Roof vertices come first (4 of them), all facing up.
    for (let v = 0; v < 4; v++) {
      assert.ok(Math.abs(normals[v * 3 + 1] - 1) < 1e-6, 'roof normal +y');
    }
    // Every wall vertex: no vertical component, unit length, pointing away
    // from the footprint center (dot with position > 0).
    for (let v = 4; v < positions.length / 3; v++) {
      const nx = normals[v * 3];
      const ny = normals[v * 3 + 1];
      const nz = normals[v * 3 + 2];
      assert.ok(Math.abs(ny) < 1e-6, 'wall normal horizontal');
      assert.ok(Math.abs(Math.hypot(nx, ny, nz) - 1) < 1e-6, 'unit length');
      const dot = nx * positions[v * 3] + nz * positions[v * 3 + 2];
      assert.ok(dot > 0, 'wall normal points outward');
    }
    assert.ok(indices.length > 0);
  });

  it('emits roof and wall vertex colors from the options', () => {
    const { colors } = buildTileGeometry([squareWay()], {
      ...ORIGIN,
      tileBBox: null,
      roofColor: [1, 0, 0],
      wallColor: [0, 0, 1]
    });
    assert.deepStrictEqual([...colors.slice(0, 3)], [1, 0, 0]);
    assert.deepStrictEqual([...colors.slice(12, 15)], [0, 0, 1]);
    assert.strictEqual(colors.length % 3, 0);
  });
});
