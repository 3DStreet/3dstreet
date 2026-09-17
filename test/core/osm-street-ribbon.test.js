/* global describe, it */

/**
 * Flat ribbon geometry from OSM way centerlines (#1930): strip widths,
 * winding, round caps, class-ordered heights.
 */

import assert from 'assert';
import {
  buildWayRibbons,
  hexToRgb,
  CLASS_ORDER_STEP_M
} from '../../src/tested/osm-street-ribbon.js';
import {
  ribbonStyleForClass,
  roadWidthMeters
} from '../../src/tested/osm-street-style.js';

function way(cls, ...lines) {
  return { wayId: 'w', class: cls, polylines: lines };
}

function bounds(positions) {
  const b = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity
  };
  for (let i = 0; i < positions.length; i += 3) {
    b.minX = Math.min(b.minX, positions[i]);
    b.maxX = Math.max(b.maxX, positions[i]);
    b.minZ = Math.min(b.minZ, positions[i + 2]);
    b.maxZ = Math.max(b.maxZ, positions[i + 2]);
  }
  return b;
}

// Signed area of every triangle in the x/z plane; +y-facing when the
// winding is (l0, l1, r0) with right = +perpendicular... we only assert
// that every triangle has the SAME sign (consistent winding).
function windingSigns(positions, indices) {
  const signs = new Set();
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
    const ax = positions[a * 3];
    const az = positions[a * 3 + 2];
    const bx = positions[b * 3];
    const bz = positions[b * 3 + 2];
    const cx = positions[c * 3];
    const cz = positions[c * 3 + 2];
    const cross = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
    if (Math.abs(cross) > 1e-9) signs.add(Math.sign(cross));
  }
  return signs;
}

describe('hexToRgb', () => {
  it('parses #rrggbb into 0..1 floats', () => {
    assert.deepStrictEqual(hexToRgb('#ff0080'), [1, 0, 128 / 255]);
  });
});

describe('buildWayRibbons', () => {
  it('returns empty arrays for nothing to draw', () => {
    const out = buildWayRibbons([]);
    assert.strictEqual(out.positions.length, 0);
    assert.strictEqual(out.indices.length, 0);
    // Degenerate single-point polyline draws nothing either.
    const single = buildWayRibbons([way('minor', [{ x: 0, z: 0 }])]);
    assert.strictEqual(single.positions.length, 0);
  });

  it('sweeps a straight way to its class width with round caps', () => {
    const w = roadWidthMeters('minor');
    const out = buildWayRibbons([
      way('minor', [
        { x: 0, z: 0 },
        { x: 100, z: 0 }
      ])
    ]);
    const b = bounds(out.positions);
    // Width across z, caps extend half a width past each end along x.
    assert.ok(Math.abs(b.maxZ - b.minZ - w) < 1e-6);
    assert.ok(Math.abs(b.minX - -w / 2) < 1e-6);
    assert.ok(Math.abs(b.maxX - (100 + w / 2)) < 1e-6);
    assert.strictEqual(out.indices.length % 3, 0);
    assert.strictEqual(windingSigns(out.positions, out.indices).size, 1);
  });

  it('winds every triangle consistently through bends', () => {
    const out = buildWayRibbons([
      way('primary', [
        { x: 0, z: 0 },
        { x: 50, z: 0 },
        { x: 50, z: 50 },
        { x: 0, z: 80 }
      ])
    ]);
    assert.strictEqual(windingSigns(out.positions, out.indices).size, 1);
  });

  it('stacks classes at ordered heights above the base', () => {
    const line = [
      { x: 0, z: 0 },
      { x: 10, z: 0 }
    ];
    const major = buildWayRibbons([way('motorway', line)], { baseY: 0.3 });
    const minor = buildWayRibbons([way('path', line)], { baseY: 0.3 });
    const yOf = (out) => out.positions[1];
    assert.ok(yOf(major) > yOf(minor));
    assert.ok(
      Math.abs(
        yOf(major) -
          (0.3 + ribbonStyleForClass('motorway').order * CLASS_ORDER_STEP_M)
      ) < 1e-6 // Float32 output
    );
  });

  it('colors vertices by class', () => {
    const out = buildWayRibbons([
      way('service', [
        { x: 0, z: 0 },
        { x: 10, z: 0 }
      ])
    ]);
    const [r, g, b] = hexToRgb(ribbonStyleForClass('service').color);
    assert.strictEqual(out.colors.length, out.positions.length);
    assert.ok(Math.abs(out.colors[0] - r) < 1e-6);
    assert.ok(Math.abs(out.colors[1] - g) < 1e-6);
    assert.ok(Math.abs(out.colors[2] - b) < 1e-6);
  });

  it('merges multiple ways and polylines into one buffer', () => {
    const one = buildWayRibbons([
      way('minor', [
        { x: 0, z: 0 },
        { x: 10, z: 0 }
      ])
    ]);
    const two = buildWayRibbons([
      way('minor', [
        { x: 0, z: 0 },
        { x: 10, z: 0 }
      ]),
      way(
        'path',
        [
          { x: 0, z: 5 },
          { x: 10, z: 5 }
        ],
        [
          { x: 0, z: 9 },
          { x: 10, z: 9 }
        ]
      )
    ]);
    assert.strictEqual(two.positions.length, one.positions.length * 3);
    assert.ok(two.indices.every((i) => i < two.positions.length / 3));
  });
});
