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
});

describe('isGroundSegmentHit (AGL ground filter, TASK-013)', () => {
  const { isGroundSegmentHit } = _internals;

  // Build a fake THREE.Intersection-like hit with a parent chain. `attrs`
  // = the attribute names the owning entity answers true for via
  // hasAttribute (e.g. ['street-segment']); null = no owning entity.
  // `depth` nests `depth` submesh parents above the entity-root leaf so
  // the `.el` resolution has to walk up (a model's gltf submesh).
  function makeHit({
    attrs,
    material,
    objVisible = true,
    depth = 0,
    pointY = 0
  }) {
    const ownerEl = attrs
      ? { hasAttribute: (n) => attrs.includes(n) }
      : null;
    const node = { el: ownerEl, parent: null }; // entity root
    let leaf = node;
    for (let i = 0; i < depth; i++) {
      leaf = { el: null, parent: leaf }; // submesh without .el
    }
    leaf.material = material;
    leaf.visible = objVisible;
    return { object: leaf, point: { x: 0, y: pointY, z: 0 }, distance: 1 };
  }

  it('accepts a visible segment surface (depth 0 — the realistic case)', () => {
    const hit = makeHit({
      attrs: ['street-segment'],
      material: { visible: true },
      depth: 0
    });
    expect(isGroundSegmentHit(hit)).toBe(true);
  });

  it('rejects a model/clone hit via deep .el walk (the WE-4 roof case)', () => {
    // A deep gltf submesh resolves up to the clone entity, which carries
    // a `mixin` but NOT `street-segment` → rejected; the probe continues
    // to the road below.
    const hit = makeHit({
      attrs: ['mixin'],
      material: { visible: true },
      depth: 3
    });
    expect(isGroundSegmentHit(hit)).toBe(false);
  });

  it('rejects an invisible (surface:none) segment — D3, depth 0', () => {
    const hit = makeHit({
      attrs: ['street-segment'],
      material: { visible: false },
      depth: 0
    });
    expect(isGroundSegmentHit(hit)).toBe(false);
  });

  it('rejects a material-array segment when all materials invisible', () => {
    const hit = makeHit({
      attrs: ['street-segment'],
      material: [{ visible: false }, { visible: false }],
      depth: 0
    });
    expect(isGroundSegmentHit(hit)).toBe(false);
  });

  it('accepts a material-array segment when at least one is visible', () => {
    const hit = makeHit({
      attrs: ['street-segment'],
      material: [{ visible: false }, { visible: true }],
      depth: 0
    });
    expect(isGroundSegmentHit(hit)).toBe(true);
  });

  it('rejects a segment whose object.visible === false (no material)', () => {
    const hit = makeHit({
      attrs: ['street-segment'],
      material: undefined,
      objVisible: false,
      depth: 0
    });
    expect(isGroundSegmentHit(hit)).toBe(false);
  });

  it('rejects a raw mesh with no .el ancestor (gizmo / helper — allowlist auto-reject)', () => {
    const hit = makeHit({
      attrs: null,
      material: { visible: true },
      depth: 0
    });
    expect(isGroundSegmentHit(hit)).toBe(false);
  });

  it('rejects null / missing object', () => {
    expect(isGroundSegmentHit(null)).toBe(false);
    expect(isGroundSegmentHit({})).toBe(false);
  });
});
