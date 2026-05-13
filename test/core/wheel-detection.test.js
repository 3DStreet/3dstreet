/* global describe, it */

const assert = require('assert');
const {
  groundCandidates,
  clusterByXZ,
  classifySide,
  DEFAULT_GROUND_EPSILON,
  DEFAULT_CLUSTER_RADIUS
} = require('../../src/tested/wheel-detection');

// AABB factory: [minX, minY, minZ, maxX, maxY, maxZ].
function aabb(minX, minY, minZ, maxX, maxY, maxZ) {
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ }
  };
}

function prim(box) {
  const cx = (box.min.x + box.max.x) / 2;
  const cy = (box.min.y + box.max.y) / 2;
  const cz = (box.min.z + box.max.z) / 2;
  return { aabb: box, centroid: { x: cx, y: cy, z: cz } };
}

describe('wheel-detection', function () {
  describe('#groundCandidates()', function () {
    it('returns primitives whose minY sits within epsilon of vehicleMinY', function () {
      const onFloor = prim(aabb(-1, 0, -1, -0.8, 0.4, -0.8));
      const slightlyAbove = prim(aabb(-1, 0.04, -1, -0.8, 0.4, -0.8));
      const wayAbove = prim(aabb(-1, 0.5, -1, -0.8, 0.9, -0.8));
      const candidates = groundCandidates(
        [onFloor, slightlyAbove, wayAbove],
        0,
        DEFAULT_GROUND_EPSILON
      );
      assert.strictEqual(candidates.length, 2);
      assert.ok(candidates.includes(onFloor));
      assert.ok(candidates.includes(slightlyAbove));
    });
    it('respects a custom epsilon', function () {
      const justAbove = prim(aabb(-1, 0.08, -1, -0.8, 0.4, -0.8));
      // With default 5cm epsilon, the 8cm-above primitive is rejected.
      assert.strictEqual(groundCandidates([justAbove], 0).length, 0);
      // With a 10cm epsilon it's accepted.
      assert.strictEqual(groundCandidates([justAbove], 0, 0.1).length, 1);
    });
    it('skips primitives without an aabb', function () {
      const result = groundCandidates([{ centroid: { x: 0, y: 0, z: 0 } }], 0);
      assert.deepStrictEqual(result, []);
    });
  });

  describe('#clusterByXZ()', function () {
    it('clusters a 4-wheel layout into four clusters', function () {
      // Typical sedan footprint: 0.8m track, 2.4m wheelbase.
      const items = [
        prim(aabb(-0.5, 0, -1.3, -0.3, 0.6, -1.1)), // front-left
        prim(aabb(0.3, 0, -1.3, 0.5, 0.6, -1.1)), // front-right
        prim(aabb(-0.5, 0, 1.1, -0.3, 0.6, 1.3)), // back-left
        prim(aabb(0.3, 0, 1.1, 0.5, 0.6, 1.3)) // back-right
      ];
      const clusters = clusterByXZ(items, DEFAULT_CLUSTER_RADIUS);
      assert.strictEqual(clusters.length, 4);
      assert.ok(clusters.every((c) => c.length === 1));
    });

    it('merges co-located rim + tire primitives into one cluster', function () {
      // Rim and tire at the same wheel: centroids overlap exactly.
      const tire = prim(aabb(-0.5, 0, -1.3, -0.3, 0.6, -1.1));
      const rim = prim(aabb(-0.45, 0.15, -1.25, -0.35, 0.45, -1.15));
      const otherWheel = prim(aabb(0.3, 0, 1.1, 0.5, 0.6, 1.3));
      const clusters = clusterByXZ(
        [tire, rim, otherWheel],
        DEFAULT_CLUSTER_RADIUS
      );
      assert.strictEqual(clusters.length, 2);
      const big = clusters.find((c) => c.length === 2);
      assert.ok(big, 'expected one cluster of size 2');
      assert.ok(big.includes(tire) && big.includes(rim));
    });

    it('keeps two wheels separate when their centroids are > clusterRadius apart', function () {
      // 0.8m apart in X is well outside the 0.3m default cluster radius.
      const a = prim(aabb(-0.5, 0, -1.3, -0.3, 0.6, -1.1));
      const b = prim(aabb(0.3, 0, -1.3, 0.5, 0.6, -1.1));
      const clusters = clusterByXZ([a, b]);
      assert.strictEqual(clusters.length, 2);
    });

    it('handles an empty input', function () {
      assert.deepStrictEqual(clusterByXZ([]), []);
    });

    it('clusters a 6-wheel truck layout into six clusters (with truck _2 rear axles)', function () {
      const items = [
        prim(aabb(-0.5, 0, -2.6, -0.3, 0.7, -2.4)), // FL
        prim(aabb(0.3, 0, -2.6, 0.5, 0.7, -2.4)), // FR
        prim(aabb(-0.5, 0, 1.6, -0.3, 0.7, 1.8)), // BL
        prim(aabb(0.3, 0, 1.6, 0.5, 0.7, 1.8)), // BR
        prim(aabb(-0.5, 0, 2.4, -0.3, 0.7, 2.6)), // BL_2
        prim(aabb(0.3, 0, 2.4, 0.5, 0.7, 2.6)) // BR_2
      ];
      const clusters = clusterByXZ(items);
      assert.strictEqual(clusters.length, 6);
    });
  });

  describe('#classifySide()', function () {
    it('maps -x to L, +x to R (A-Frame right-hand convention)', function () {
      assert.strictEqual(classifySide({ x: -0.4, z: 0 }).x, 'L');
      assert.strictEqual(classifySide({ x: 0.4, z: 0 }).x, 'R');
    });
    it('maps -z to F, +z to B (A-Frame forward = -Z)', function () {
      assert.strictEqual(classifySide({ x: 0, z: -1.2 }).z, 'F');
      assert.strictEqual(classifySide({ x: 0, z: 1.2 }).z, 'B');
    });
    it('classifies a typical front-left wheel pivot correctly', function () {
      assert.deepStrictEqual(classifySide({ x: -0.4, z: -1.2 }), {
        x: 'L',
        z: 'F'
      });
    });
  });
});
