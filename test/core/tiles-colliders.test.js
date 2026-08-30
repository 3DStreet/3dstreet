/* global describe, it, before, after */

/**
 * tiles-colliders — the world-space geometry baking that feeds Google
 * 3D Tiles into Rapier trimesh colliders. The manager class itself
 * needs a live TilesRenderer + physics world (covered by the browser
 * verify flow); these tests pin the pure mesh-extraction path:
 * world-transform baking, multi-mesh concatenation with index
 * rebasing, non-indexed geometry, normalized (quantized) attributes
 * like TileCompressionPlugin produces, and the vertex budget guard.
 */

const assert = require('assert');

let collectWorldGeometry;

describe('tiles-colliders collectWorldGeometry', () => {
  before(() => {
    // The module reads the global THREE (webpack externalizes bare
    // `three` imports to the A-Frame build); mirror that in Node.
    global.THREE = require('three');
    ({
      collectWorldGeometry
    } = require('../../src/aframe-components/play/tiles-colliders.js'));
  });

  after(() => {
    delete global.THREE;
  });

  it('bakes mesh vertices into world space', () => {
    const THREE = global.THREE;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
    mesh.position.set(10, 5, -3);
    const root = new THREE.Object3D();
    root.add(mesh);
    const out = collectWorldGeometry(root);
    assert.strictEqual(out.vertexCount, 24);
    assert.strictEqual(out.indices.length / 3, 12);
    // Every corner is ±1 in local space -> world coords offset by pos.
    for (let i = 0; i < out.vertices.length; i += 3) {
      assert.ok(Math.abs(Math.abs(out.vertices[i] - 10) - 1) < 1e-6);
      assert.ok(Math.abs(Math.abs(out.vertices[i + 1] - 5) - 1) < 1e-6);
      assert.ok(Math.abs(Math.abs(out.vertices[i + 2] + 3) - 1) < 1e-6);
    }
  });

  it('concatenates multiple meshes and rebases indices', () => {
    const THREE = global.THREE;
    const root = new THREE.Object3D();
    const a = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    const b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    b.position.set(100, 0, 0);
    root.add(a);
    root.add(b);
    const out = collectWorldGeometry(root);
    assert.strictEqual(out.vertexCount, 48);
    // Second mesh's indices must reference the second vertex block.
    const maxIndex = Math.max(...out.indices);
    assert.ok(maxIndex >= 24 && maxIndex < 48);
  });

  it('handles non-indexed geometry', () => {
    const THREE = global.THREE;
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        3
      )
    );
    const root = new THREE.Object3D();
    root.add(new THREE.Mesh(geom));
    const out = collectWorldGeometry(root);
    assert.strictEqual(out.vertexCount, 3);
    assert.deepStrictEqual([...out.indices], [0, 1, 2]);
  });

  it('de-quantizes normalized integer attributes (TileCompressionPlugin)', () => {
    const THREE = global.THREE;
    const geom = new THREE.BufferGeometry();
    // int16-normalized position: 32767 -> 1.0, ~16384 -> ~0.5.
    const attr = new THREE.BufferAttribute(
      new Int16Array([0, 0, 0, 32767, 0, 0, 0, 16384, 0]),
      3,
      true
    );
    geom.setAttribute('position', attr);
    geom.setIndex([0, 1, 2]);
    const root = new THREE.Object3D();
    root.add(new THREE.Mesh(geom));
    const out = collectWorldGeometry(root);
    assert.ok(Math.abs(out.vertices[3] - 1) < 1e-3);
    assert.ok(Math.abs(out.vertices[7] - 0.5) < 1e-3);
  });

  it('returns null for empty scenes and flags over-budget tiles', () => {
    const THREE = global.THREE;
    assert.strictEqual(collectWorldGeometry(new THREE.Object3D()), null);
    const big = new THREE.Object3D();
    big.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    const out = collectWorldGeometry(big, 10); // budget below 24 verts
    assert.strictEqual(out.overBudget, true);
  });
});
