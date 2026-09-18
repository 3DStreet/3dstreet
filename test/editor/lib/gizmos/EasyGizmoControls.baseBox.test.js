/* global THREE */ // A-Frame's global, mirrored into the test env by test/setup.js.
// Where the gizmo thinks an object's BASE is. Everything near eye level hangs
// off it — the square, the arc, the drag plane, both probes and both landing
// targets — so a wrong base is not a cosmetic error, it puts the whole handle
// somewhere the object is not.
//
// The case that motivated this: a rigged model's `geometry.boundingBox`
// describes its authored REST POSE, while a SkinnedMesh's own `boundingBox`
// describes the POSED result. The catalog's StreetPlan trees have rest-pose
// bounds running −19.9 m to +37.4 m around a 6.7 m tree, so reading the
// geometry box put the handle twenty metres underground on roughly a third of
// the catalog — while the tree itself drew correctly and the editor's selection
// outline sized correctly, because THREE.Box3 prefers the object-level box.
import { describe, it, expect } from 'vitest';
import { EasyGizmoControls } from '@/editor/lib/gizmos/EasyGizmoControls.js';

function makeControls() {
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 5000);
  const dom = document.createElement('div');
  dom.getBoundingClientRect = () => ({
    width: 1600,
    height: 900,
    left: 0,
    top: 0
  });
  Object.defineProperty(dom, 'clientHeight', { value: 900 });
  return new EasyGizmoControls(camera, dom, {
    object3D: new THREE.Scene(),
    addEventListener() {},
    removeEventListener() {}
  });
}

/** A plain mesh: only its geometry knows how big it is. */
function plainMesh(minY, maxY) {
  const g = new THREE.BufferGeometry();
  g.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1, minY, -1),
    new THREE.Vector3(1, maxY, 1)
  );
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial());
  return m;
}

/**
 * A rigged mesh, in the shape three.js gives one: a huge rest-pose box on the
 * geometry, and a truthful posed box on the object. Built by hand rather than
 * with a real skeleton so the test states the contract rather than depending on
 * three's skinning maths.
 */
function riggedMesh({ restMinY, restMaxY, posedMinY, posedMaxY }) {
  const m = plainMesh(restMinY, restMaxY);
  m.boundingBox = new THREE.Box3(
    new THREE.Vector3(-1, posedMinY, -1),
    new THREE.Vector3(1, posedMaxY, 1)
  );
  return m;
}

function baseOf(root) {
  const c = makeControls();
  c.object = root;
  root.updateWorldMatrix(true, true);
  c.deriveLocalBox();
  return c.localBox
    ? c.localBox.clone().applyMatrix4(root.matrixWorld).min.y
    : null;
}

describe('the base the gizmo draws from', () => {
  it('uses a plain mesh geometry box when that is all there is', () => {
    const root = new THREE.Object3D();
    root.add(plainMesh(0, 3));
    expect(baseOf(root)).toBeCloseTo(0, 6);
  });

  it('prefers a rigged mesh POSED box over its rest-pose geometry box', () => {
    // The StreetPlan tree, in miniature: rest pose runs 20 m below the origin,
    // the posed result sits on the ground.
    const root = new THREE.Object3D();
    root.add(
      riggedMesh({
        restMinY: -19.9,
        restMaxY: 37.4,
        posedMinY: -0.17,
        posedMaxY: 6.69
      })
    );
    expect(baseOf(root)).toBeCloseTo(-0.17, 6);
  });

  it('is not dragged down by one rigged mesh among several plain ones', () => {
    // The real tree: trunk and canopy as ordinary meshes, plus two rigged ones
    // whose rest pose is enormous. Reading the geometry box gives −19.9.
    const root = new THREE.Object3D();
    root.add(plainMesh(-0.17, 6.69)); // the tree
    root.add(plainMesh(-0.03, 0.04)); // a ground quad
    for (let i = 0; i < 2; i++) {
      root.add(
        riggedMesh({
          restMinY: -19.9,
          restMaxY: 37.4,
          posedMinY: 0.5,
          posedMaxY: 5.0
        })
      );
    }
    expect(baseOf(root)).toBeCloseTo(-0.17, 6);
  });

  it('computes a rigged mesh box on demand when it has not been computed yet', () => {
    // three leaves `boundingBox` null until asked; the property still EXISTS,
    // which is what selects this branch. Reading it without computing would
    // throw, and falling back to the geometry would silently restore the bug.
    const root = new THREE.Object3D();
    const m = plainMesh(-19.9, 37.4);
    m.boundingBox = null;
    let computed = false;
    m.computeBoundingBox = function () {
      computed = true;
      this.boundingBox = new THREE.Box3(
        new THREE.Vector3(-1, -0.17, -1),
        new THREE.Vector3(1, 6.69, 1)
      );
    };
    root.add(m);
    expect(baseOf(root)).toBeCloseTo(-0.17, 6);
    expect(computed).toBe(true);
  });

  it('takes the cached AABB for a batched entity without traversing', () => {
    // batch-models strips the mesh tree and stashes a local box; without this
    // branch every duplicated building in a demo scene loses its base.
    const root = new THREE.Object3D();
    root.add(plainMesh(-50, 50)); // would win if the traversal ran
    root._batchLocalBbox = new THREE.Box3(
      new THREE.Vector3(-1, 1.25, -1),
      new THREE.Vector3(1, 4, 1)
    );
    expect(baseOf(root)).toBeCloseTo(1.25, 6);
  });

  it('reports no box at all rather than a wrong one when nothing qualifies', () => {
    // A did-not-run must stay distinguishable: layout falls back to the
    // object's origin, which is bounded, rather than to a fabricated base.
    const root = new THREE.Object3D();
    root.add(new THREE.Object3D());
    const c = makeControls();
    c.object = root;
    c.deriveLocalBox();
    expect(c.localBox).toBeNull();
  });

  it('measures the base in the OBJECT frame, so rotation does not inflate it', () => {
    // The reason this is not just Box3.setFromObject: that returns a world box,
    // and re-expressing it in object space takes the AABB of an AABB. A tall
    // thin object yawed 45° would gain base height it does not have.
    const root = new THREE.Object3D();
    root.add(plainMesh(0, 4));
    root.rotation.y = Math.PI / 4;
    expect(baseOf(root)).toBeCloseTo(0, 6);
  });

  it('measures the base in the OBJECT frame under a non-yaw rotation', () => {
    // The case above cannot fail, and this one is why it is kept company. A YAW
    // leaves y-extents exactly invariant, and the fixture reads `.min.y` only —
    // so the AABB-of-an-AABB inflation it is meant to catch is confined to x
    // and z, and a world-box build passes it. Under a ROLL the same fixture
    // separates them by 2.3 m: the correct object-local box transformed once
    // gives −√2/2, while re-applying the matrix to an already-world AABB gives
    // −3.0.
    const root = new THREE.Object3D();
    root.add(plainMesh(0, 4));
    root.rotation.z = Math.PI / 4;
    expect(baseOf(root)).toBeCloseTo(-0.7071067811865476, 6);
  });
});
