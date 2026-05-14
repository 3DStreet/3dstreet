/* global describe, it */

const assert = require('assert');
const {
  groundCandidates,
  clusterByXZ,
  classifySide,
  splitIntoComponents,
  wheelLikeAspect,
  buildSubmeshIndices,
  removeTriangles,
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

  describe('#splitIntoComponents()', function () {
    // Helper: build a quad from 4 corners (two triangles).
    function quad(verts) {
      const positions = [];
      for (const v of verts) positions.push(v[0], v[1], v[2]);
      const indices = [0, 1, 2, 0, 2, 3];
      return { positions, indices };
    }

    it('returns one component for a single connected mesh', function () {
      const q = quad([
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1]
      ]);
      const comps = splitIntoComponents(q.positions, q.indices);
      assert.strictEqual(comps.length, 1);
      assert.strictEqual(comps[0].vertexIndices.length, 4);
    });

    it('splits a primitive containing two disjoint quads', function () {
      // Quad A at origin, quad B 10m away — no shared verts, no shared tris.
      const positions = [
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        1,
        0,
        0,
        1, // A: 0..3
        10,
        0,
        0,
        11,
        0,
        0,
        11,
        0,
        1,
        10,
        0,
        1 // B: 4..7
      ];
      const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
      const comps = splitIntoComponents(positions, indices);
      assert.strictEqual(comps.length, 2);
      const sorted = comps.slice().sort((a, b) => a.aabb.min.x - b.aabb.min.x);
      assert.strictEqual(sorted[0].aabb.min.x, 0);
      assert.strictEqual(sorted[1].aabb.min.x, 10);
    });

    it('merges seam-duplicated vertices via position snapping', function () {
      // Same quad but with vertex 4 = duplicate of vertex 0 (different
      // index, identical position — common UV/normal seam case). Two
      // disjoint index triangles that would split without snapping.
      const positions = [
        0,
        0,
        0,
        1,
        0,
        0,
        1,
        0,
        1, // tri 1
        0,
        0,
        0,
        1,
        0,
        1,
        0,
        0,
        1 // tri 2 — index 3 duplicates index 0
      ];
      const indices = [0, 1, 2, 3, 4, 5];
      const comps = splitIntoComponents(positions, indices);
      assert.strictEqual(comps.length, 1);
    });

    it('separates a chassis-merged glb into chassis + 4 wheel components', function () {
      // Synthetic mini-bus: one big roof quad far above ground, plus four
      // ground-level wheel quads at the corners. All in one positions
      // array, indexed but with no shared topology between them.
      const positions = [];
      const indices = [];
      const addQuad = (corners) => {
        const base = positions.length / 3;
        for (const c of corners) positions.push(c[0], c[1], c[2]);
        indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
      };
      // Chassis (roof).
      addQuad([
        [-1, 2, -2],
        [1, 2, -2],
        [1, 2, 2],
        [-1, 2, 2]
      ]);
      // 4 wheels at corners on the ground.
      for (const [cx, cz] of [
        [-0.8, -1.5],
        [0.8, -1.5],
        [-0.8, 1.5],
        [0.8, 1.5]
      ]) {
        addQuad([
          [cx - 0.15, 0, cz - 0.15],
          [cx + 0.15, 0, cz - 0.15],
          [cx + 0.15, 0, cz + 0.15],
          [cx - 0.15, 0, cz + 0.15]
        ]);
      }
      const comps = splitIntoComponents(positions, indices);
      assert.strictEqual(comps.length, 5);
      // Exactly one component has its AABB up at the roof (y≥2);
      // the other four sit on the ground.
      const roof = comps.filter((c) => c.aabb.min.y >= 1.5);
      const wheels = comps.filter((c) => c.aabb.max.y < 1);
      assert.strictEqual(roof.length, 1);
      assert.strictEqual(wheels.length, 4);
    });

    it('handles non-indexed primitives (triangle soup)', function () {
      // Two disjoint triangles in soup form.
      const positions = [
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1, // tri 1
        10,
        0,
        0,
        11,
        0,
        0,
        10,
        0,
        1 // tri 2
      ];
      const comps = splitIntoComponents(positions, null);
      assert.strictEqual(comps.length, 2);
    });

    it('returns an empty list for empty input', function () {
      assert.deepStrictEqual(splitIntoComponents([], null), []);
    });
  });

  describe('#wheelLikeAspect()', function () {
    it('accepts a roughly circular wheel (axle = X)', function () {
      // 0.2m wide on axle (X), 0.6m × 0.6m side-profile.
      const box = aabb(-0.1, 0, -0.3, 0.1, 0.6, 0.3);
      assert.strictEqual(wheelLikeAspect(box), true);
    });
    it('rejects a flat mud-flap (very thin in Z)', function () {
      // 0.3m × 0.4m × 0.04m — yz aspect ~10 from the mini-bus.
      const box = aabb(-0.15, 0, -0.02, 0.15, 0.4, 0.02);
      assert.strictEqual(wheelLikeAspect(box), false);
    });
    it('rejects an elongated running-board lip (very long in X)', function () {
      // X dominates so axle = smallest of (Y, Z); whichever it picks,
      // the other pair has X vs the remaining axis with ratio ~6.
      const box = aabb(-1.5, 0, -0.05, 1.5, 0.05, 0.05);
      assert.strictEqual(wheelLikeAspect(box), false);
    });
    it('passes when maxRatio is Infinity (off switch)', function () {
      const box = aabb(-0.15, 0, -0.02, 0.15, 0.4, 0.02);
      assert.strictEqual(wheelLikeAspect(box, Infinity), true);
    });
    it('respects a tighter custom ratio', function () {
      // 0.6m vs 0.4m → ratio 1.5. Passes at 2.0, fails at 1.2.
      const box = aabb(-0.1, 0, -0.3, 0.1, 0.4, 0.3);
      assert.strictEqual(wheelLikeAspect(box, 2.0), true);
      assert.strictEqual(wheelLikeAspect(box, 1.2), false);
    });
  });

  describe('#buildSubmeshIndices()', function () {
    it('keeps only triangles whose three vertices are all in the kept set', function () {
      // Quad A (verts 0..3) and quad B (verts 4..7); kept = quad A only.
      const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
      const { newIndices, oldToNew } = buildSubmeshIndices(
        indices,
        [0, 1, 2, 3],
        8
      );
      assert.deepStrictEqual(newIndices, [0, 1, 2, 0, 2, 3]);
      assert.strictEqual(oldToNew.size, 4);
      assert.strictEqual(oldToNew.get(0), 0);
      assert.strictEqual(oldToNew.get(3), 3);
    });

    it('reindexes against the order of vertexIndices, not the old indices', function () {
      // Same quad-A triangles but request a different vertex ordering.
      const indices = [0, 1, 2, 0, 2, 3];
      const { newIndices } = buildSubmeshIndices(indices, [3, 0, 2, 1], 4);
      // 3→0, 0→1, 1→3, 2→2 — so the triangles re-encode as below.
      assert.deepStrictEqual(newIndices, [1, 3, 2, 1, 2, 0]);
    });

    it('drops triangles that straddle the kept/excluded boundary', function () {
      // Triangle (0,1,4) crosses the cut and must be dropped entirely.
      const indices = [0, 1, 2, 0, 1, 4];
      const { newIndices } = buildSubmeshIndices(indices, [0, 1, 2], 5);
      assert.deepStrictEqual(newIndices, [0, 1, 2]);
    });

    it('handles non-indexed (triangle soup) input via the vertexCount bound', function () {
      // 6 vertices = 2 triangles in soup mode; keep the second one only.
      const { newIndices } = buildSubmeshIndices(null, [3, 4, 5], 6);
      assert.deepStrictEqual(newIndices, [0, 1, 2]);
    });

    it('returns an empty index list when no triangle qualifies', function () {
      const indices = [0, 1, 2];
      const { newIndices } = buildSubmeshIndices(indices, [3, 4, 5], 6);
      assert.deepStrictEqual(newIndices, []);
    });
  });

  describe('#removeTriangles()', function () {
    it('drops every triangle that touches a removed vertex', function () {
      // Two quads. Remove vertex 4 → both triangles of quad B vanish.
      const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
      const kept = removeTriangles(indices, new Set([4]), 8);
      assert.deepStrictEqual(kept, [0, 1, 2, 0, 2, 3]);
    });

    it('preserves triangles whose vertices are all outside the removed set', function () {
      const indices = [0, 1, 2, 3, 4, 5];
      const kept = removeTriangles(indices, new Set([99]), 6);
      assert.deepStrictEqual(kept, [0, 1, 2, 3, 4, 5]);
    });

    it('drops a triangle even when only one vertex is removed', function () {
      const indices = [0, 1, 2];
      const kept = removeTriangles(indices, new Set([2]), 3);
      assert.deepStrictEqual(kept, []);
    });

    it('handles triangle soup via vertexCount', function () {
      // 9 vertices = 3 triangles in soup mode. Remove vertex 4 (middle
      // triangle) — only first and last triangles survive.
      const kept = removeTriangles(null, new Set([4]), 9);
      assert.deepStrictEqual(kept, [0, 1, 2, 6, 7, 8]);
    });

    it('returns an empty list when every vertex is removed', function () {
      const indices = [0, 1, 2];
      const kept = removeTriangles(indices, new Set([0, 1, 2]), 3);
      assert.deepStrictEqual(kept, []);
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
