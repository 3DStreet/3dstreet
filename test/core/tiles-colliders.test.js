/* global describe, it, before, after */

/**
 * tiles-colliders — the world-space geometry baking that feeds Google
 * 3D Tiles into Rapier trimesh colliders, plus the TilesColliderSet
 * bookkeeping (build queue, LOD retirement, triangle budget). The live
 * TilesRenderer + physics world path is covered by the browser verify
 * flow; here we pin the pure mesh extraction and, with stub physics,
 * the two "fell through the ground" regressions: the triangle budget
 * must be RETURNED when a tile's collider is freed, and an LOD swap
 * must keep the outgoing tile's collider until the replacement built.
 */

const assert = require('assert');

let collectWorldGeometry;
let TilesColliderSet;
let MAX_RETIRED_TILES;

describe('tiles-colliders collectWorldGeometry', () => {
  before(() => {
    // The module reads the global THREE (webpack externalizes bare
    // `three` imports to the A-Frame build); mirror that in Node.
    global.THREE = require('three');
    ({
      collectWorldGeometry,
      TilesColliderSet
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

describe('tiles-colliders TilesColliderSet bookkeeping', () => {
  before(() => {
    global.THREE = require('three');
    ({
      TilesColliderSet,
      MAX_RETIRED_TILES
    } = require('../../src/aframe-components/play/tiles-colliders.js'));
  });

  after(() => {
    delete global.THREE;
  });

  function stubPhysics() {
    let nextId = 1;
    return {
      active: true,
      world: {},
      added: [],
      removed: [],
      addStaticTrimesh(vertices, indices) {
        const body = { id: nextId++, triangles: indices.length / 3 };
        this.added.push(body);
        return body;
      },
      removeBody(body) {
        this.removed.push(body);
      }
    };
  }

  function stubTiles() {
    return {
      visibleTiles: null,
      addEventListener() {},
      removeEventListener() {}
    };
  }

  function makeTile() {
    const THREE = global.THREE;
    const root = new THREE.Object3D();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))); // 12 tris
    return { engineData: { scene: root } };
  }

  function makeSet(physics) {
    const set = new TilesColliderSet(physics, stubTiles());
    clearInterval(set.interval); // tests drain manually, deterministically
    return set;
  }

  it('REGRESSION: freeing a tile returns its triangles to the budget', () => {
    const physics = stubPhysics();
    const set = makeSet(physics);
    const tile = makeTile();
    set.enqueue(tile);
    set.drainQueue();
    assert.strictEqual(set.totalTriangles, 12);
    set.removeTile(tile);
    set.drainQueue(); // queue empty -> retired body freed
    assert.strictEqual(set.totalTriangles, 0);
    assert.strictEqual(physics.removed.length, 1);
    set.dispose();
  });

  it('REGRESSION: an LOD swap keeps the old collider until the replacement builds', () => {
    const physics = stubPhysics();
    const set = makeSet(physics);
    const parent = makeTile();
    set.enqueue(parent);
    set.drainQueue();
    // LOD swap: parent leaves the selection, child enters, same batch.
    const child = makeTile();
    set.onVisibilityChange({ tile: parent, visible: false });
    set.onVisibilityChange({ tile: child, visible: true });
    // Old body must still be alive while the child awaits its build.
    assert.strictEqual(physics.removed.length, 0);
    set.drainQueue(); // builds the child, THEN frees the retired parent
    assert.strictEqual(physics.added.length, 2);
    assert.strictEqual(physics.removed.length, 1);
    assert.strictEqual(set.totalTriangles, 12);
    set.dispose();
  });

  it('REGRESSION: retired bodies are capped while the queue never empties', () => {
    // Review finding (PR #1955): retired tiles were only freed once the
    // build queue was completely empty; a fast flight over dense tiles
    // keeps the queue fed, so stale bodies (and their triangle budget)
    // accumulated without bound.
    const physics = stubPhysics();
    const set = makeSet(physics);
    const live = [];
    for (let i = 0; i < MAX_RETIRED_TILES + 5; i++) {
      const t = makeTile();
      set.enqueue(t);
      live.push(t);
    }
    while (set.queue.size > 0) set.drainQueue();
    const builtTriangles = set.totalTriangles;
    // Keep the queue permanently non-empty with a tile that never
    // builds (drainQueue isn't called again), then retire everything.
    set.enqueue(makeTile());
    for (const t of live) set.onVisibilityChange({ tile: t, visible: false });
    assert.strictEqual(set.retired.size, MAX_RETIRED_TILES);
    assert.strictEqual(physics.removed.length, 5);
    // The oldest were the ones freed; the newest retirements survive.
    assert.ok(set.retired.has(live[live.length - 1]));
    assert.ok(!set.retired.has(live[0]));
    assert.ok(set.totalTriangles < builtTriangles);
    set.dispose();
  });

  it('restores a retired tile that becomes visible again without rebuilding', () => {
    const physics = stubPhysics();
    const set = makeSet(physics);
    const tile = makeTile();
    set.enqueue(tile);
    set.drainQueue();
    set.removeTile(tile); // frustum-culled...
    set.enqueue(tile); // ...and back before the next drain
    set.drainQueue();
    assert.strictEqual(physics.added.length, 1); // no rebuild
    assert.strictEqual(physics.removed.length, 0);
    assert.strictEqual(set.totalTriangles, 12);
    set.dispose();
  });

  it('dispose frees live and retired bodies alike', () => {
    const physics = stubPhysics();
    const set = makeSet(physics);
    const a = makeTile();
    const b = makeTile();
    set.enqueue(a);
    set.enqueue(b);
    set.drainQueue();
    set.removeTile(b); // b retired, a live
    set.dispose();
    assert.strictEqual(physics.removed.length, 2);
  });
});

describe('tiles-colliders build order + safety net (#2030)', () => {
  let isSafetyNetSurface;
  let TILES_SAFETY_NET_Y;
  let tileDistanceToPoint;

  before(() => {
    global.THREE = require('three');
    ({
      TilesColliderSet,
      isSafetyNetSurface,
      TILES_SAFETY_NET_Y,
      tileDistanceToPoint
    } = require('../../src/aframe-components/play/tiles-colliders.js'));
  });

  after(() => {
    delete global.THREE;
  });

  function stubPhysics() {
    return {
      active: true,
      world: {},
      added: [],
      addStaticTrimesh(vertices, indices) {
        const body = { triangles: indices.length / 3 };
        this.added.push(body);
        return body;
      },
      removeBody() {}
    };
  }

  /** A tile whose bounding volume is a sphere at `center` (radius 1). */
  function tileAt(x, y, z) {
    const THREE = global.THREE;
    const root = new THREE.Object3D();
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
    const sphere = new THREE.Sphere(new THREE.Vector3(x, y, z), 1);
    return {
      name: `tile(${x},${y},${z})`,
      engineData: {
        scene: root,
        boundingVolume: {
          distanceToPoint: (p) => Math.max(0, sphere.distanceToPoint(p))
        }
      }
    };
  }

  function stubTiles(group) {
    return {
      visibleTiles: null,
      group,
      addEventListener() {},
      removeEventListener() {}
    };
  }

  it('REGRESSION: builds the tiles nearest the spawn first', () => {
    // visibleTiles iterates in traversal order, so the tile under the
    // player used to build at an arbitrary point in the drain while
    // the helicopter was already falling through it.
    const physics = stubPhysics();
    const set = new TilesColliderSet(physics, stubTiles(null), {
      focus: { x: 0, y: 0, z: 0 }
    });
    clearInterval(set.interval);
    const far = tileAt(900, 0, 0);
    const farther = tileAt(0, 0, 1500);
    const near = tileAt(10, 0, 0);
    const mid = tileAt(300, 0, 0);
    const under = tileAt(0, -1, 0);
    for (const t of [far, farther, near, mid, under]) set.enqueue(t);
    set.drainQueue(); // one pass = 3 builds
    assert.deepStrictEqual(
      [...set.bodies.keys()].map((t) => t.name),
      [under.name, near.name, mid.name]
    );
    assert.strictEqual(set.queue.size, 2);
    set.drainQueue();
    assert.deepStrictEqual([...set.bodies.keys()].map((t) => t.name).slice(3), [
      far.name,
      farther.name
    ]);
    set.dispose();
  });

  it('measures distance in the tileset frame (group transform applied)', () => {
    const THREE = global.THREE;
    // Tileset group shifted +1000 on X: a tile at local x=1000 sits at
    // the world origin, where the focus is.
    const group = new THREE.Object3D();
    group.position.set(-1000, 0, 0);
    group.updateMatrixWorld(true);
    group.matrixWorldInverse = group.matrixWorld.clone().invert();
    const set = new TilesColliderSet(stubPhysics(), stubTiles(group), {
      focus: { x: 0, y: 0, z: 0 }
    });
    clearInterval(set.interval);
    const atWorldOrigin = tileAt(1000, 0, 0);
    const atLocalOrigin = tileAt(0, 0, 0);
    set.enqueue(atLocalOrigin);
    set.enqueue(atWorldOrigin);
    assert.deepStrictEqual(
      set._queuedByDistance().map((t) => t.name),
      [atWorldOrigin.name, atLocalOrigin.name]
    );
    set.dispose();
  });

  it('keeps insertion order without a focus or without bounding volumes', () => {
    const set = new TilesColliderSet(stubPhysics(), stubTiles(null));
    clearInterval(set.interval);
    const a = tileAt(500, 0, 0);
    const b = tileAt(1, 0, 0);
    set.enqueue(a);
    set.enqueue(b);
    assert.deepStrictEqual(set._queuedByDistance(), [a, b]);
    set.setFocus({ x: 0, y: 0, z: 0 });
    assert.deepStrictEqual(set._queuedByDistance(), [b, a]);
    // Tiles with no bounding volume sort last, in insertion order.
    const bare1 = { name: 'bare1', engineData: { scene: null } };
    const bare2 = { name: 'bare2', engineData: { scene: null } };
    set.enqueue(bare1);
    set.enqueue(bare2);
    assert.deepStrictEqual(
      set._queuedByDistance().map((t) => t.name),
      [b.name, a.name, 'bare1', 'bare2']
    );
    assert.strictEqual(
      tileDistanceToPoint(bare1, new global.THREE.Vector3()),
      Infinity
    );
    set.dispose();
  });

  it('isSafetyNetSurface tells the deep pad from real ground', () => {
    assert.strictEqual(isSafetyNetSurface(TILES_SAFETY_NET_Y), true);
    assert.strictEqual(isSafetyNetSurface(TILES_SAFETY_NET_Y + 0.05), true);
    assert.strictEqual(isSafetyNetSurface(0), false);
    assert.strictEqual(isSafetyNetSurface(-0.05), false); // flat pad
    assert.strictEqual(isSafetyNetSurface(-120), false); // deep terrain
    assert.strictEqual(isSafetyNetSurface(null), false);
    assert.strictEqual(isSafetyNetSurface(undefined), false);
    assert.strictEqual(isSafetyNetSurface(-Infinity), false);
  });
});
