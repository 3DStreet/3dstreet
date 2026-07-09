import { describe, it, expect, beforeAll } from 'vitest';
import * as THREE from 'three';

// Make THREE globally available the same way A-Frame does in the app.
beforeAll(() => {
  globalThis.THREE = THREE;
});

const { CursorAnchor, _internals } =
  await import('../../../../src/editor/lib/nav-experimental/cursorAnchor.js');

function makeDom() {
  const el = document.createElement('div');
  Object.defineProperty(el, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, width: 100, height: 100 })
  });
  return el;
}

function makeSceneEl(rootObj) {
  return { object3D: rootObj };
}

function makeCameraLookingDown(height) {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  cam.position.set(0, height, 0);
  cam.lookAt(0, 0, 0); // straight down
  cam.updateMatrixWorld();
  return cam;
}

describe('CursorAnchor.worldPointAt', () => {
  it('returns mesh hit when raycast intersects scene mesh', () => {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshBasicMaterial()
    );
    ground.rotation.x = -Math.PI / 2; // facing up
    ground.updateMatrixWorld(true);
    const root = new THREE.Group();
    root.add(ground);

    const cam = makeCameraLookingDown(50);
    const ca = new CursorAnchor({
      camera: cam,
      sceneEl: makeSceneEl(root),
      domElement: makeDom()
    });

    // Cursor at exact center of viewport.
    const p = ca.worldPointAt(50, 50);
    expect(p.source).toBe('mesh');
    expect(Math.abs(p.x)).toBeLessThan(0.05);
    expect(Math.abs(p.z)).toBeLessThan(0.05);
    expect(p.y).toBeCloseTo(0, 1);
  });

  it('falls back to ground plane when no mesh is hit', () => {
    const root = new THREE.Group(); // empty
    const cam = makeCameraLookingDown(100);
    const ca = new CursorAnchor({
      camera: cam,
      sceneEl: makeSceneEl(root),
      domElement: makeDom()
    });
    const p = ca.worldPointAt(50, 50);
    expect(p.source).toBe('ground');
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('falls back to forward-30m when ground plane is unreachable', () => {
    const root = new THREE.Group();
    // Camera at y=10 looking up at the sky (away from ground). The ray
    // points away from the y=0 plane, so the ground intersection is
    // behind the camera and rejected.
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
    cam.position.set(0, 10, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 1000, 0); // straight up
    cam.updateMatrixWorld();

    const ca = new CursorAnchor({
      camera: cam,
      sceneEl: makeSceneEl(root),
      domElement: makeDom()
    });
    const p = ca.worldPointAt(50, 50);
    expect(p.source).toBe('fallback');
    // 30m along +Y from (0,10,0) -> (0, 40, 0)
    expect(p.y).toBeCloseTo(40, 3);
  });

  it('skips excluded objects in the mesh hit list (transform gizmos)', () => {
    const root = new THREE.Group();

    // Foreground "gizmo" mesh — should be excluded by name.
    const gizmo = new THREE.Mesh(
      new THREE.BoxGeometry(1000, 1000, 1000),
      new THREE.MeshBasicMaterial()
    );
    gizmo.name = 'TransformControlsGizmo';
    gizmo.position.set(0, 25, 0);
    gizmo.updateMatrixWorld(true);
    root.add(gizmo);

    // Background ground at y=0, which the ray should hit *through* the gizmo.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshBasicMaterial()
    );
    ground.rotation.x = -Math.PI / 2;
    ground.updateMatrixWorld(true);
    root.add(ground);

    const cam = makeCameraLookingDown(50);
    const ca = new CursorAnchor({
      camera: cam,
      sceneEl: makeSceneEl(root),
      domElement: makeDom()
    });
    const p = ca.worldPointAt(50, 50);
    expect(p.source).toBe('mesh');
    expect(p.y).toBeCloseTo(0, 3); // hit the ground, not the gizmo at y=25
  });

  it('exclusion list checks ancestors as well as the hit object', () => {
    const parent = new THREE.Group();
    parent.name = 'TransformControls';
    const child = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    parent.add(child);
    expect(_internals._isExcludedObject(child)).toBe(true);
  });

  it('non-excluded objects pass the filter', () => {
    const obj = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    obj.name = 'street-segment-mesh';
    expect(_internals._isExcludedObject(obj)).toBe(false);
  });

  // TASK-014d: per-caller maxGroundDist reach ceiling.
  it('default reject (no opts) drops a >2000m ground hit to fallback', () => {
    const root = new THREE.Group(); // empty → ground-plane path
    const cam = makeCameraLookingDown(5000); // straight down, 5000 m up
    const ca = new CursorAnchor({
      camera: cam,
      sceneEl: makeSceneEl(root),
      domElement: makeDom()
    });
    // Straight-down ground hit is 5000 m away → exceeds MAX_GROUND_DIST
    // (2000) → Step 2 rejected → Step 3 forward fallback.
    const p = ca.worldPointAt(50, 50);
    expect(p.source).toBe('fallback');
  });

  it('raised maxGroundDist keeps a high-altitude ground hit (source ground)', () => {
    const root = new THREE.Group();
    const cam = makeCameraLookingDown(5000);
    const ca = new CursorAnchor({
      camera: cam,
      sceneEl: makeSceneEl(root),
      domElement: makeDom()
    });
    // Same 5000 m straight-down hit, but the wheel-zoom reach ceiling keeps
    // it as a real ground anchor.
    const p = ca.worldPointAt(50, 50, { maxGroundDist: 1e6 });
    expect(p.source).toBe('ground');
    expect(p.y).toBeCloseTo(0, 3);
  });
});

describe('isSolidFloorHit (solid-floor filter, TASK-013 → TASK-024)', () => {
  const { isSolidFloorHit } = _internals;

  // Build a fake THREE.Intersection-like hit with a parent chain. `attrs`
  // = a map of attribute-name → value the owning entity answers via
  // hasAttribute / getAttribute / id (e.g. { 'street-segment': '' }), or
  // null = no owning entity. `depth` nests submesh parents above the
  // entity-root leaf so the `.el` resolution has to walk up. `ancestors`
  // = extra `.el`-bearing entities stacked ABOVE the entity root (for the
  // tiles-descendant case: the marked #google3d sits above offsetEl).
  function makeEl(attrs) {
    return {
      _attrs: attrs,
      id: attrs && attrs.id != null ? attrs.id : undefined,
      hasAttribute: (n) => attrs != null && Object.prototype.hasOwnProperty.call(attrs, n),
      getAttribute: (n) => (attrs != null ? attrs[n] : undefined)
    };
  }

  function makeHit({
    attrs,
    material,
    objVisible = true,
    depth = 0,
    ancestors = [],
    pointY = 0
  }) {
    const ownerEl = attrs ? makeEl(attrs) : null;
    // Build the UPWARD chain (via `.parent`): topmost ancestor first, then
    // the entity root (owning the first `.el` the predicate resolves to).
    let parentNode = null;
    for (const a of ancestors) {
      // ancestors are listed outermost-first; chain them so the LAST one
      // listed is the entity root's parent. We want #google3d to be an
      // ancestor of offsetEl, so build top-down.
      parentNode = { el: makeEl(a), parent: parentNode };
    }
    const entityRoot = { el: ownerEl, parent: parentNode };
    let leaf = entityRoot;
    for (let i = 0; i < depth; i++) {
      leaf = { el: null, parent: leaf }; // submesh without .el
    }
    leaf.material = material;
    leaf.visible = objVisible;
    return { object: leaf, point: { x: 0, y: pointY, z: 0 }, distance: 1 };
  }

  it('accepts a visible segment surface (depth 0 — the realistic case)', () => {
    const hit = makeHit({
      attrs: { 'street-segment': '' },
      material: { visible: true },
      depth: 0
    });
    expect(isSolidFloorHit(hit)).toBe(true);
  });

  it('accepts a building clone (mixin category buildings, stubbed catalog)', () => {
    globalThis.STREET = {
      catalog: [{ id: 'SM3D_Bld_Mixed_4fl', category: 'buildings' }]
    };
    const hit = makeHit({
      attrs: { mixin: 'SM3D_Bld_Mixed_4fl' },
      material: { visible: true },
      depth: 3 // deep gltf submesh resolves up to the clone entity
    });
    expect(isSolidFloorHit(hit)).toBe(true);
    delete globalThis.STREET;
  });

  it('rejects a building clone when acceptBuildings:false (travel height)', () => {
    globalThis.STREET = {
      catalog: [{ id: 'SM3D_Bld_Mixed_4fl', category: 'buildings' }]
    };
    const hit = makeHit({
      attrs: { mixin: 'SM3D_Bld_Mixed_4fl' },
      material: { visible: true },
      depth: 3
    });
    expect(isSolidFloorHit(hit, { acceptBuildings: false })).toBe(false);
    delete globalThis.STREET;
  });

  it('accepts a #google3d-descendant (tiles) — must climb past the first .el', () => {
    // The hit's first .el is the tiles offsetEl (no id / layer-name); the
    // marked #google3d entity is an ANCESTOR. The predicate must walk past
    // offsetEl to find it.
    const hit = makeHit({
      attrs: {}, // offsetEl: no id, no layer-name
      material: { visible: true },
      depth: 2,
      ancestors: [{ id: 'google3d', 'data-layer-name': 'Google 3D Tiles' }]
    });
    expect(isSolidFloorHit(hit)).toBe(true);
  });

  it('accepts a tiles-descendant matched by data-layer-name alone', () => {
    const hit = makeHit({
      attrs: {},
      material: { visible: true },
      depth: 1,
      ancestors: [{ 'data-layer-name': 'Google 3D Tiles' }]
    });
    expect(isSolidFloorHit(hit)).toBe(true);
  });

  it('rejects a scatter clone (mixin category plants)', () => {
    globalThis.STREET = {
      catalog: [{ id: 'tree3', category: 'plants' }]
    };
    const hit = makeHit({
      attrs: { mixin: 'tree3' },
      material: { visible: true },
      depth: 2
    });
    expect(isSolidFloorHit(hit)).toBe(false);
    delete globalThis.STREET;
  });

  it('rejects a fence (mixin not in catalog → not buildings)', () => {
    globalThis.STREET = { catalog: [] };
    const hit = makeHit({
      attrs: { mixin: 'fence' },
      material: { visible: true },
      depth: 1
    });
    expect(isSolidFloorHit(hit)).toBe(false);
    delete globalThis.STREET;
  });

  it('rejects a model/clone hit when STREET is undefined (headless/tests)', () => {
    // No STREET → no catalog lookup → mixin entity reads as scatter.
    const hit = makeHit({
      attrs: { mixin: 'SM3D_Bld_Mixed_4fl' },
      material: { visible: true },
      depth: 3
    });
    expect(isSolidFloorHit(hit)).toBe(false);
  });

  it('rejects an invisible (surface:none) segment — D3, depth 0', () => {
    const hit = makeHit({
      attrs: { 'street-segment': '' },
      material: { visible: false },
      depth: 0
    });
    expect(isSolidFloorHit(hit)).toBe(false);
  });

  it('rejects a material-array segment when all materials invisible', () => {
    const hit = makeHit({
      attrs: { 'street-segment': '' },
      material: [{ visible: false }, { visible: false }],
      depth: 0
    });
    expect(isSolidFloorHit(hit)).toBe(false);
  });

  it('accepts a material-array segment when at least one is visible', () => {
    const hit = makeHit({
      attrs: { 'street-segment': '' },
      material: [{ visible: false }, { visible: true }],
      depth: 0
    });
    expect(isSolidFloorHit(hit)).toBe(true);
  });

  it('rejects a segment whose object.visible === false (no material)', () => {
    const hit = makeHit({
      attrs: { 'street-segment': '' },
      material: undefined,
      objVisible: false,
      depth: 0
    });
    expect(isSolidFloorHit(hit)).toBe(false);
  });

  it('rejects a raw mesh with no .el ancestor (gizmo / helper — auto-reject)', () => {
    const hit = makeHit({
      attrs: null,
      material: { visible: true },
      depth: 0
    });
    expect(isSolidFloorHit(hit)).toBe(false);
  });

  it('rejects null / missing object', () => {
    expect(isSolidFloorHit(null)).toBe(false);
    expect(isSolidFloorHit({})).toBe(false);
  });
});

describe('classifyHitEntity (TASK-012 Phase-4 source classifier)', () => {
  const { classifyHitEntity } = _internals;

  function makeEl(attrs) {
    return {
      id: attrs && attrs.id != null ? attrs.id : undefined,
      hasAttribute: (n) =>
        attrs != null && Object.prototype.hasOwnProperty.call(attrs, n),
      getAttribute: (n) => (attrs != null ? attrs[n] : undefined)
    };
  }

  function makeHit({ attrs, depth = 0, ancestors = [] }) {
    const ownerEl = attrs ? makeEl(attrs) : null;
    let parentNode = null;
    for (const a of ancestors) {
      parentNode = { el: makeEl(a), parent: parentNode };
    }
    const entityRoot = { el: ownerEl, parent: parentNode };
    let leaf = entityRoot;
    for (let i = 0; i < depth; i++) {
      leaf = { el: null, parent: leaf };
    }
    return { object: leaf, point: { x: 0, y: 0, z: 0 } };
  }

  it('classifies a street-segment as segment', () => {
    expect(
      classifyHitEntity(makeHit({ attrs: { 'street-segment': '' } }))
    ).toBe('segment');
  });

  it('classifies a Google 3D Tiles descendant as tiles', () => {
    const hit = makeHit({
      attrs: {},
      depth: 2,
      ancestors: [{ id: 'google3d', 'data-layer-name': 'Google 3D Tiles' }]
    });
    expect(classifyHitEntity(hit)).toBe('tiles');
  });

  it('classifies a catalog building mixin as building', () => {
    globalThis.STREET = {
      catalog: [{ id: 'SM3D_Bld_Mixed_4fl', category: 'buildings' }]
    };
    const hit = makeHit({ attrs: { mixin: 'SM3D_Bld_Mixed_4fl' }, depth: 3 });
    expect(classifyHitEntity(hit)).toBe('building');
    delete globalThis.STREET;
  });

  it('classifies a non-building catalog mixin as scatter', () => {
    globalThis.STREET = { catalog: [{ id: 'tree3', category: 'plants' }] };
    const hit = makeHit({ attrs: { mixin: 'tree3' }, depth: 2 });
    expect(classifyHitEntity(hit)).toBe('scatter');
    delete globalThis.STREET;
  });

  it('classifies a mixin entity as scatter when STREET is undefined', () => {
    const hit = makeHit({ attrs: { mixin: 'SM3D_Bld_Mixed_4fl' }, depth: 1 });
    expect(classifyHitEntity(hit)).toBe('scatter');
  });

  it('classifies a plain entity (no segment/mixin/tiles) as scatter', () => {
    expect(classifyHitEntity(makeHit({ attrs: { 'some-component': '' } }))).toBe(
      'scatter'
    );
  });

  it('returns null for a hit with no owning entity (editor chrome)', () => {
    expect(classifyHitEntity(makeHit({ attrs: null }))).toBe(null);
  });

  it('returns null for null / missing object', () => {
    expect(classifyHitEntity(null)).toBe(null);
    expect(classifyHitEntity({})).toBe(null);
  });
});

describe('CursorAnchor.ndcFor (optional out-param idiom)', () => {
  function makeCa() {
    return new CursorAnchor({
      camera: makeCameraLookingDown(50),
      sceneEl: makeSceneEl(new THREE.Group()),
      domElement: makeDom()
    });
  }

  it('returns a fresh Vector2 each call when no target is passed', () => {
    const ca = makeCa();
    const a = ca.ndcFor(25, 75);
    const b = ca.ndcFor(25, 75);
    expect(a).toBeInstanceOf(THREE.Vector2);
    expect(b).toBeInstanceOf(THREE.Vector2);
    expect(a).not.toBe(b);
    // Same pixel → same NDC value.
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.y).toBeCloseTo(b.y, 12);
  });

  it('fills and returns the caller-supplied target when passed', () => {
    const ca = makeCa();
    const fresh = ca.ndcFor(25, 75);
    const t = new THREE.Vector2();
    const r = ca.ndcFor(25, 75, t);
    expect(r).toBe(t);
    expect(t.x).toBeCloseTo(fresh.x, 12);
    expect(t.y).toBeCloseTo(fresh.y, 12);
  });
});

describe('worldHitNormal — two live results stay independent', () => {
  const { worldHitNormal } = _internals;

  function makeMeshHit(rot, normal, pos) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial()
    );
    if (pos) mesh.position.set(pos[0], pos[1], pos[2]);
    if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
    mesh.updateWorldMatrix(true, false);
    return { object: mesh, face: { normal: normal.clone() }, distance: 1 };
  }

  it('two normals held at once are distinct objects and distinct values', () => {
    // Distinct object transforms + distinct face normals → distinct results,
    // exactly the wasdFlight floorNow/floorDest two-live-normals hazard.
    const hitA = makeMeshHit(null, new THREE.Vector3(0, 1, 0), [10, 0, 0]);
    const hitB = makeMeshHit([0, 0, Math.PI / 4], new THREE.Vector3(1, 0, 0), [
      -10, 0, 0
    ]);

    const nA = worldHitNormal(hitA);
    const nB = worldHitNormal(hitB);

    // Different objects — the pooled Matrix3 must NOT leak into the returns.
    expect(nA).not.toBe(nB);
    // Different values.
    expect(nA.distanceTo(nB)).toBeGreaterThan(0.1);

    // nA must be untouched by computing nB (both held live).
    const ax = nA.x;
    const ay = nA.y;
    const az = nA.z;
    worldHitNormal(hitB); // a third call must not perturb the earlier result
    expect(nA.x).toBe(ax);
    expect(nA.y).toBe(ay);
    expect(nA.z).toBe(az);
  });
});
