/* global THREE */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EasyGizmoControls } from '@/editor/lib/gizmos/EasyGizmoControls.js';
import catalog from '@/catalog.json';
import { evaluatePath } from '@/editor/lib/gizmos/easyGizmoGround.js';
import { _internals as cursorInternals } from '@/editor/lib/nav-experimental/cursorAnchor.js';
import {
  dodgeExtents,
  elevationAngleDegrees,
  flatArcLift
} from '@/editor/lib/gizmos/easyGizmoMath.js';
import {
  ARC_FLAT_CLEAR_FRAC,
  EDGE_OPACITY_RATIO,
  HEAD_LEN_FRAC,
  IDLE_PROBE_INTERVAL_MS,
  HORIZON_CAP_METRES,
  LANDING_BAR_HEIGHT_FRAC,
  LANDING_OUTLINE_FRAC,
  MOVE_PLATE_ROUND_FRAC,
  OPACITY_ACTION,
  OPACITY_REST,
  RENDER_ORDER_EDGE,
  RENDER_ORDER_LANDING_FAR,
  RENDER_ORDER_LANDING_NEAR
} from '@/editor/lib/gizmos/easyGizmoConstants.js';

const fixtures = [];
afterEach(() => {
  fixtures.splice(0).forEach((f) => f.controls.dispose());
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function fixture({ base = 0, cameraY = 10 } = {}) {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  canvas.getBoundingClientRect = () => ({
    width: 1200,
    height: 800,
    left: 0,
    top: 0
  });
  Object.defineProperty(canvas, 'clientHeight', { value: 800 });
  const inspector = { opened: true, container: canvas };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector });
  const sceneEl = document.createElement('div');
  document.body.append(sceneEl);
  sceneEl.object3D = new THREE.Scene();
  sceneEl.time = 0;
  const camera = new THREE.PerspectiveCamera(50, 1.5, 0.1, 1000);
  camera.position.set(0, cameraY, 10);
  camera.lookAt(0, base, 0);
  camera.updateMatrixWorld(true);
  const el = document.createElement('div');
  sceneEl.append(el);
  const object = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.2, 1, 0.2),
    new THREE.MeshBasicMaterial()
  );
  mesh.position.y = 0.5;
  object.add(mesh);
  object.position.y = base;
  object.el = el;
  el.object3D = object;
  const nativeGet = el.getAttribute.bind(el);
  const nativeSet = el.setAttribute.bind(el);
  el.getAttribute = (name) =>
    name === 'position'
      ? { x: object.position.x, y: object.position.y, z: object.position.z }
      : name === 'rotation'
        ? {
            x: THREE.MathUtils.radToDeg(object.rotation.x),
            y: THREE.MathUtils.radToDeg(object.rotation.y),
            z: THREE.MathUtils.radToDeg(object.rotation.z)
          }
        : nativeGet(name);
  el.setAttribute = (name, value) => {
    if (name === 'position') object.position.set(value.x, value.y, value.z);
    else if (name === 'rotation') {
      object.rotation.set(
        THREE.MathUtils.degToRad(value.x),
        THREE.MathUtils.degToRad(value.y),
        THREE.MathUtils.degToRad(value.z)
      );
    } else nativeSet(name, value);
    object.updateMatrixWorld(true);
  };
  sceneEl.object3D.add(object);
  const controls = new EasyGizmoControls(camera, canvas, sceneEl);
  const helpers = new THREE.Scene();
  helpers.add(controls);
  const commits = [];
  controls.addEventListener('commitDrag', (event) => commits.push(event));
  const f = {
    canvas,
    inspector,
    sceneEl,
    camera,
    el,
    object,
    mesh,
    helpers,
    controls,
    commits
  };
  f.surface = (y, { x = 0, width = 20, kind = 'segment', slope = 0 } = {}) => {
    const groundEl = document.createElement('div');
    if (kind === 'segment') groundEl.setAttribute('street-segment', '');
    if (kind === 'tiles') groundEl.id = 'google3d';
    if (kind === 'building') {
      vi.stubGlobal('STREET', {
        catalog: [{ id: 'building-1', category: 'buildings' }]
      });
      groundEl.setAttribute('mixin', 'building-1');
    }
    if (kind === 'import') {
      groundEl.setAttribute('gltf-model', 'url(mesh)');
      groundEl.setAttribute('data-asset-id', 'mesh');
    }
    if (kind === 'image') {
      groundEl.setAttribute('data-asset-id', 'image');
      groundEl.setAttribute('geometry', 'primitive: plane');
    }
    if (kind === 'polygon') groundEl.setAttribute('shape', '');
    if (kind === 'satellite') {
      groundEl.setAttribute('data-ignore-raycaster', '');
      groundEl.setAttribute('data-layer-name', 'Mapbox satellite');
    }
    sceneEl.append(groundEl);
    const geometry = new THREE.PlaneGeometry(width, 20);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      positions.setY(i, slope * positions.getX(i));
    }
    geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    ground.position.set(x, y, 0);
    ground.el = groundEl;
    sceneEl.object3D.add(ground);
    ground.updateMatrixWorld(true);
    sceneEl.dispatchEvent(new Event('child-attached'));
    return { el: groundEl, mesh: ground };
  };
  f.frame = (advance = true) => {
    if (advance) sceneEl.time += 16;
    sceneEl.object3D.updateMatrixWorld(true);
    controls.updateMatrixWorld(true);
  };
  f.attach = () => {
    controls.attach(el);
    f.frame();
  };
  f.pointer = (type, world, pointerType = 'mouse', pointerId = 1) => {
    const point = world.clone().project(camera);
    const event = new MouseEvent(type, {
      clientX: (point.x + 1) * 600,
      clientY: (1 - point.y) * 400,
      button: 0,
      bubbles: true,
      cancelable: true
    });
    Object.defineProperties(event, {
      pointerType: { value: pointerType },
      pointerId: { value: pointerId },
      isPrimary: { value: pointerId === 1 }
    });
    canvas.dispatchEvent(event);
    return event;
  };
  f.start = (pointerType = 'mouse') => {
    f.pointer('pointerdown', controls.moveGroup.position, pointerType);
    expect(controls.isDragging).toBe(true);
    expect(controls.axis).toBe('move');
  };
  fixtures.push(f);
  return f;
}

describe('persistent vertical control', () => {
  it('is present without a modifier and hides in a top-down view', () => {
    const f = fixture();
    f.surface(0);
    f.attach();

    expect(f.controls.verticalGroup.visible).toBe(true);
    expect(f.controls.getPickers()).toContain(f.controls.verticalGroup);
    expect(f.controls.verticalGroup.position.y).toBeGreaterThan(
      f.controls.moveGroup.position.y + f.controls.squareSide
    );
    expect(f.controls.verticalShaftEdge.geometry.instanceCount).toBe(2);
    expect(f.controls.verticalHeadsEdge.geometry.instanceCount).toBe(8);

    f.camera.position.set(0, 10, 0.1);
    f.camera.lookAt(0, 0, 0);
    f.camera.updateMatrixWorld(true);
    f.frame();

    expect(f.controls.verticalGroup.visible).toBe(false);
    expect(f.controls.getPickers()).not.toContain(f.controls.verticalGroup);
  });

  it('drags world Y only and commits one ordinary move without another ray', () => {
    const f = fixture();
    f.surface(0);
    f.attach();
    const start = f.controls.verticalGroup.position.clone();
    const probe = vi.spyOn(f.controls.probe, 'probeColumn');

    f.pointer('pointerdown', start);
    expect(f.controls.isDragging).toBe(true);
    expect(f.controls.axis).toBe('vertical');
    probe.mockClear();

    for (const metres of [5, -5, 1]) {
      f.pointer(
        'pointermove',
        start.clone().add(new THREE.Vector3(0, metres, 0))
      );
      expect(f.object.position.y).toBeCloseTo(metres, 3);
      expect(f.object.position.x).toBe(0);
      expect(f.object.position.z).toBe(0);
      expect(f.object.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
      expect(probe).not.toHaveBeenCalled();
    }

    f.pointer('pointerup', start.clone().add(new THREE.Vector3(0, 1, 0)));
    expect(f.commits).toHaveLength(1);
    expect(f.commits[0].name).toBe('move');
  });

  it.each(['pointercancel', 'blur', 'escape'])(
    'restores a vertical drag on %s',
    (reason) => {
      const f = fixture({ base: 2 });
      f.surface(0);
      f.attach();
      const start = f.controls.verticalGroup.position.clone();
      f.pointer('pointerdown', start);
      expect(f.controls.axis).toBe('vertical');
      f.pointer('pointermove', start.clone().add(new THREE.Vector3(0, 3, 0)));
      expect(f.object.position.y).toBeCloseTo(5, 3);
      f.controls.endGesture(reason);
      expect(f.object.position.y).toBeCloseTo(2, 3);
      expect(f.commits).toHaveLength(0);
      expect(f.controls.isDragging).toBe(false);
    }
  );

  it('moves in world Y under a rotated and scaled parent', () => {
    const f = fixture();
    const parent = new THREE.Group();
    parent.position.set(2, 1, -1);
    parent.rotation.set(0.2, 0.4, -0.1);
    parent.scale.set(2, 1.5, 0.8);
    f.sceneEl.object3D.add(parent);
    parent.add(f.object);
    f.surface(0);
    f.attach();
    const initial = f.object.getWorldPosition(new THREE.Vector3());
    const start = f.controls.verticalGroup.position.clone();
    f.pointer('pointerdown', start);
    expect(f.controls.axis).toBe('vertical');
    f.pointer('pointermove', start.clone().add(new THREE.Vector3(0, 2, 0)));
    const moved = f.object.getWorldPosition(new THREE.Vector3());
    // Parent-local millimetre rounding is amplified by the parent's scale.
    const expected = initial.clone().add(new THREE.Vector3(0, 2, 0));
    const roundingBound = Math.sqrt(3) * 0.0005 * 2;
    expect(moved.distanceTo(expected)).toBeLessThan(roundingBound);
    f.pointer('pointerup', start.clone().add(new THREE.Vector3(0, 2, 0)));
    expect(f.commits).toHaveLength(1);
  });
});

describe('classified rays composed with real move gestures', () => {
  it('advances queued movement from the scene tick before render traversal', () => {
    const f = fixture();
    const child = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.1, 0.1),
      new THREE.MeshBasicMaterial()
    );
    child.position.x = 2;
    f.object.add(child);
    f.sceneEl.object3D.add(f.helpers);
    const nativeSet = f.el.setAttribute.bind(f.el);
    f.el.setAttribute = (name, value) => {
      if (name === 'position') {
        f.object.position.set(value.x, value.y, value.z);
      } else if (name === 'rotation') {
        f.object.rotation.set(
          THREE.MathUtils.degToRad(value.x),
          THREE.MathUtils.degToRad(value.y),
          THREE.MathUtils.degToRad(value.z)
        );
      } else {
        nativeSet(name, value);
      }
    };
    f.sceneEl.systems = {};
    f.sceneEl.initSystem = (name) => {
      const definition = globalThis.AFRAME.systems[name];
      const system = { ...definition, el: f.sceneEl, sceneEl: f.sceneEl };
      system.init();
      f.sceneEl.systems[name] = system;
    };
    vi.stubGlobal('AFRAME', {
      INSPECTOR: f.inspector,
      systems: {},
      registerSystem(name, definition) {
        this.systems[name] = definition;
        f.sceneEl.initSystem(name);
      }
    });
    f.surface(0);
    f.attach();
    f.start();
    f.pointer('pointermove', new THREE.Vector3(1, 0, 0));

    f.sceneEl.time += 16;
    f.sceneEl.systems['easy-gizmo-frame'].tick();
    f.sceneEl.object3D.updateMatrixWorld(true);

    expect(f.object.position.x).toBeGreaterThan(0.5);
    expect(child.matrixWorld.elements[12]).toBeCloseTo(
      f.object.position.x + 2,
      6
    );
    child.geometry.dispose();
    child.material.dispose();
  });

  for (const degrees of [30, 50]) {
    it(`follows the exact ${degrees} degree ramp without pitching the object`, () => {
      const f = fixture();
      const slope = Math.tan(THREE.MathUtils.degToRad(degrees));
      f.surface(0, { slope });
      f.attach();
      f.start();
      f.pointer('pointerup', new THREE.Vector3(1, 0, 0));
      f.frame();
      expect(f.object.position.x).toBeCloseTo(1, 3);
      expect(f.object.position.y).toBeCloseTo(slope, 3);
      expect(f.object.rotation.x).toBe(0);
      expect(f.object.rotation.z).toBe(0);
    });
  }

  it('crosses millimetre-high lane markings without latching to entity identity', () => {
    const f = fixture();
    f.surface(0);
    f.surface(0.003, { x: 0.3, width: 0.3 });
    f.attach();
    f.start();
    f.pointer('pointermove', new THREE.Vector3(0.3, 0, 0));
    f.frame();
    expect(f.object.position.y).toBeCloseTo(0.003, 3);
    f.pointer('pointerup', new THREE.Vector3(0.6, 0, 0));
    f.frame();
    expect(f.object.position.y).toBe(0);
  });

  it('ignores a polygon fill over a road', () => {
    const f = fixture();
    f.surface(0);
    const polygon = f.surface(0.15, { kind: 'polygon' });
    f.attach();
    f.start();
    f.pointer('pointerup', new THREE.Vector3(0.2, 0, 0));
    f.frame();
    expect(f.object.position.y).toBe(0);
    expect(f.controls.landingUpY).toBeNull();
    expect(
      f.controls.probe.lastHits.some((hit) => hit.object.el === polygon.el)
    ).toBe(false);
  });

  it('follows and lands on tiles terrain with no authored street', () => {
    const f = fixture({ base: 2 });
    f.surface(0, { kind: 'tiles', slope: 0.2 });
    f.attach();
    f.start();
    f.pointer('pointerup', new THREE.Vector3(0.5, 2, 0));
    f.frame();
    f.frame();
    expect(f.object.position.y).toBeCloseTo(2.1, 3);
    expect(f.controls.landingDownY).toBeCloseTo(0.1, 3);
    const target = f.controls.landingDownGroup.position.clone();
    f.pointer('pointerdown', target);
    f.pointer('pointerup', target);
    expect(f.object.position.y).toBeCloseTo(0.1, 3);
    expect(f.commits.at(-1).name).toBe('place');
  });

  it('holds height without landing targets on a satellite-only scene', () => {
    const f = fixture({ base: 1 });
    f.surface(0, { kind: 'satellite' });
    f.attach();
    f.start();
    f.pointer('pointerup', new THREE.Vector3(1, 1, 0));
    f.frame();
    expect(f.object.position.y).toBe(1);
    expect(f.controls.landingDownY).toBeNull();
    expect(f.controls.landingUpY).toBeNull();
    expect(f.controls.probe.lastHits).toHaveLength(0);
  });

  for (const roofHeight of [4, 40]) {
    it(`stays on pavement below a ${roofHeight} m roof`, () => {
      const f = fixture();
      f.surface(0);
      const roof = f.surface(roofHeight, {
        kind: 'import',
        x: 0.5,
        width: 0.8
      });
      f.attach();
      f.start();
      f.pointer('pointerup', new THREE.Vector3(0.5, 0, 0));
      f.frame();
      expect(f.object.position.y).toBe(0);
      expect(f.controls.landingUpY).toBeCloseTo(roofHeight, 6);
      expect(f.controls._landingUpEntity).toBe(roof.el);
    });
  }

  it('floats off a 20 m platform and spans the gap to its floor target', () => {
    const f = fixture({ base: 20, cameraY: 30 });
    f.surface(0);
    f.surface(20, { x: -0.5, width: 1.1 });
    f.attach();
    f.start();
    f.pointer('pointerup', new THREE.Vector3(1, 20, 0));
    f.frame();
    f.frame();
    expect(f.object.position.y).toBe(20);
    expect(f.controls.landingDownY).toBeCloseTo(0, 6);
    expect(
      f.controls.landingDownGroup.userData.chevrons.filter((c) => c.visible)
        .length
    ).toBeGreaterThan(1);
  });

  it('caps an above-horizon round drag and returns when the pointer comes back down', () => {
    const f = fixture();
    f.surface(0);
    f.attach();
    f.start();
    expect(f.controls.dragConstrained).toBe(false);
    const sky = new THREE.Vector3(0, 20, -10);
    f.pointer('pointermove', sky);
    f.frame();
    expect(f.object.position.z).toBeCloseTo(
      f.camera.position.z - HORIZON_CAP_METRES,
      3
    );
    expect(f.object.position.y).toBe(0);
    f.pointer('pointermove', sky.clone().add(new THREE.Vector3(0, 5, 0)));
    f.frame();
    expect(f.object.position.z).toBeCloseTo(
      f.camera.position.z - HORIZON_CAP_METRES,
      3
    );
    f.pointer('pointerup', new THREE.Vector3(0, 0, 0));
    f.frame();
    expect(f.object.position.length()).toBe(0);
    expect(f.commits).toHaveLength(1);
  });

  for (const height of [0.15, 1]) {
    for (const distance of [0.1, 1]) {
      it(`handles a ${height} m downward step at ${distance} m per frame`, () => {
        const f = fixture({ base: height });
        f.surface(0);
        f.surface(height, { x: -0.5, width: 1.1 });
        f.attach();
        f.start();
        const rays = vi.spyOn(f.controls.probe.raycaster, 'intersectObjects');
        f.pointer('pointerup', new THREE.Vector3(distance, height, 0));
        f.frame();
        expect(f.object.position.y).toBe(height === 0.15 ? 0 : 1);
        expect(rays.mock.calls.length).toBeLessThanOrEqual(13);
        if (distance === 1) expect(rays.mock.calls.length).toBeGreaterThan(1);
      });
    }
  }

  for (const enabled of [true, false]) {
    it(`fast roof approach ${enabled ? 'holds with' : 'hops without'} path evaluation`, () => {
      const f = fixture();
      f.surface(0);
      f.surface(1, { kind: 'import', x: 1, width: 1.6 });
      f.attach();
      f.controls.pathEvaluationEnabled = enabled;
      f.start();
      const rays = vi.spyOn(f.controls.probe.raycaster, 'intersectObjects');
      f.pointer('pointerup', new THREE.Vector3(1, 0, 0));
      f.frame();
      expect(f.object.position.y).toBe(enabled ? 0 : 1);
      expect(rays.mock.calls.length).toBe(enabled ? 5 : 1);
    });
  }
  it('starts, tracks and releases onto a kerb without a second frame budget', () => {
    const f = fixture();
    f.surface(0);
    f.surface(0.15, { x: 0.3, width: 0.4 });
    f.attach();
    f.start();
    const rays = vi.spyOn(f.controls.probe.raycaster, 'intersectObjects');
    f.pointer('pointermove', new THREE.Vector3(0.2, 0, 0));
    f.frame();
    expect(f.object.position.y).toBeCloseTo(0.15, 3);
    const spent = rays.mock.calls.length;
    f.pointer('pointerup', new THREE.Vector3(0.35, 0, 0));
    f.canvas.dispatchEvent(new Event('lostpointercapture', { bubbles: true }));
    f.frame(false);
    expect(rays).toHaveBeenCalledTimes(spent);
    expect(f.commits).toHaveLength(0);
    f.frame();
    expect(f.object.position.x).toBeCloseTo(0.35, 3);
    expect(f.object.position.y).toBeCloseTo(0.15, 3);
    expect(f.commits).toHaveLength(1);
    expect(f.controls.isDragging).toBe(false);
  });

  it('follows a multi-sample ramp, preserving initial clearance', () => {
    const f = fixture({ base: 0.4 });
    f.surface(0, { slope: 0.8 });
    f.attach();
    f.start();
    f.pointer('pointerup', new THREE.Vector3(1, 0.4, 0));
    f.frame();
    expect(f.object.position.x).toBeCloseTo(1, 3);
    expect(f.object.position.y).toBeCloseTo(1.2, 3);
  });

  it('holds over a cliff and offers the actual destination floor even over budget', () => {
    const f = fixture();
    f.surface(0, { x: -1, width: 2 });
    const floor = f.surface(-3);
    f.attach();
    f.start();
    const rays = vi.spyOn(f.controls.probe.raycaster, 'intersectObjects');
    f.pointer('pointerup', new THREE.Vector3(4, 0, 0));
    f.frame();
    expect(rays).toHaveBeenCalledTimes(1);
    expect(f.object.position.y).toBe(0);
    expect(f.controls.landingDownY).toBeCloseTo(-3, 6);
    expect(f.controls._landingDownEntity).toBe(floor.el);
  });

  it('casts every interior after an early drop and finishes on the endpoint', () => {
    const f = fixture();
    f.surface(-3);
    const destination = f.surface(-1, { x: 1, width: 0.1 });
    const rays = vi.spyOn(f.controls.probe.raycaster, 'intersectObjects');
    const result = evaluatePath({
      from: { x: 0, z: 0 },
      to: { x: 1, z: 0 },
      fromSupportY: 0,
      probeAt: f.controls._probeAt,
      budget: 12
    });
    expect(result.continuous).toBe(false);
    expect(result.cast).toBe(result.demanded);
    expect(rays).toHaveBeenCalledTimes(result.demanded + 1);
    expect(result.endColumn.below.entity).toBe(destination.el);
    expect(f.controls.probe.lastHits[0].object.el).toBe(destination.el);
  });

  it('prefers authored support over tiles and excludes a sub-step image plane', () => {
    const f = fixture();
    const ground = f.surface(0);
    f.surface(0.1, { kind: 'tiles' });
    f.surface(0.15, { kind: 'image' });
    f.attach();
    f.start();
    f.pointer('pointerup', new THREE.Vector3(0.1, 0, 0));
    f.frame();
    expect(f.object.position.y).toBe(0);
    expect(f.controls._landingDownEntity).toBe(ground.el);
    expect(f.controls.probe.probeColumn(0.1, 0, 0).above.y).toBeCloseTo(0.1, 6);
    expect(
      f.controls.probe.lastHits.some(
        (hit) => hit.object.el.getAttribute('data-asset-id') === 'image'
      )
    ).toBe(false);
  });

  it('holds below a tall imported roof and offers it as a landing target', () => {
    const f = fixture();
    f.surface(0);
    const roof = f.surface(3, { kind: 'import', x: 0.3, width: 0.4 });
    f.attach();
    f.start();
    f.pointer('pointerup', new THREE.Vector3(0.3, 0, 0));
    f.frame();
    expect(f.object.position.y).toBe(0);
    expect(f.controls.landingUpY).toBeCloseTo(3, 6);
    expect(f.controls._landingUpEntity).toBe(roof.el);
  });
});

describe('placement hierarchy composed with rays and landing gestures', () => {
  it('offers successive roofs of separate buildings, skipping their intermediate floors', () => {
    const f = fixture();
    f.surface(0);
    const lower = f.surface(3, { kind: 'building' });
    const lowerRoof = f.surface(6, { kind: 'building' });
    lower.mesh.el = lowerRoof.el;
    const upper = f.surface(9, { kind: 'building' });
    const upperRoof = f.surface(12, { kind: 'building' });
    upper.mesh.el = upperRoof.el;
    f.attach();
    // Retaining all floors picks 3; collapsing the column globally picks 12.
    expect(f.controls.landingUpY).toBeCloseTo(6);
    expect(f.controls._landingUpEntity).toBe(lowerRoof.el);
    for (const y of [6, 12]) {
      expect(f.controls.landingUpY).toBeCloseTo(y);
      f.controls.axis = 'landingUp';
      f.controls.startDrag('landingUp', {});
      f.controls.endGesture('pointerup');
      expect(f.controls.currentBaseY()).toBeCloseTo(y);
    }
    expect(f.controls.landingUpY).toBeNull();
    expect(f.controls.landingDownY).toBeNull();
    f.object.position.y = 11;
    f.controls._refreshSupport();
    // Applying roof filtering only above would still offer the 9 m floor below.
    expect(f.controls.landingDownY).toBeCloseTo(6);
    expect(f.commits).toHaveLength(2);
    // Reusing a previous column's roof would discard this lower exposed surface.
    lowerRoof.mesh.visible = false;
    upper.mesh.visible = false;
    upperRoof.mesh.visible = false;
    f.controls._refreshSupport();
    expect(f.controls.landingDownY).toBeCloseTo(3);
  });

  it('keeps stacked building roofs distinct inside one BatchedMesh', () => {
    const f = fixture();
    vi.stubGlobal('STREET', { catalog });
    const geometry = new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const batch = new THREE.BatchedMesh(4, 4, 6, material);
    const geometryId = batch.addGeometry(geometry);
    const owners = [0, 1].map(() => {
      const el = document.createElement('div');
      el.setAttribute('mixin', 'SM3D_Bld_Mixed_Corner_4fl');
      f.sceneEl.append(el);
      return el;
    });
    batch.el = document.createElement('div');
    f.sceneEl.append(batch.el);
    batch._batchIdToEl = [];
    for (const [i, y] of [3, 6, 9, 12].entries()) {
      const id = batch.addInstance(geometryId);
      batch.setMatrixAt(id, new THREE.Matrix4().makeTranslation(0, y, 0));
      batch._batchIdToEl[id] = owners[Math.floor(i / 2)];
    }
    f.sceneEl.object3D.add(batch);
    f.attach();
    // Grouping by mesh instead of mapped owner would keep only the upper roof.
    expect(f.controls.landingUpY).toBeCloseTo(6);
    expect(f.controls._landingUpEntity).toBe(owners[0]);
    f.controls.axis = 'landingUp';
    f.controls.startDrag('landingUp', {});
    f.controls.endGesture('pointerup');
    expect(f.controls.currentBaseY()).toBeCloseTo(6);
    expect(f.controls.landingUpY).toBeCloseTo(12);
    expect(f.controls._landingUpEntity).toBe(owners[1]);
    batch.dispose();
    geometry.dispose();
    material.dispose();
  });

  it('preserves intermediate imported-mesh surfaces even with a building mixin', () => {
    const f = fixture();
    const low = f.surface(3, { kind: 'building' });
    const high = f.surface(6, { kind: 'building' });
    high.mesh.el = low.el;
    low.el.setAttribute('gltf-model', 'url(imported)');
    low.el.setAttribute('data-asset-id', 'imported');
    f.attach();
    // Applying the catalog roof restriction to imports would pick 6 instead.
    expect(f.controls.landingUpY).toBeCloseTo(3);
    expect(f.controls.probe.lastHits.map((h) => h.point.y)).toContain(6);
  });

  it('lands a stop sign on a batched catalog building rather than its shared host', () => {
    const f = fixture({ base: 0.15 });
    vi.stubGlobal('STREET', { catalog });
    f.el.setAttribute('mixin', 'stop_sign');
    const geometry = new THREE.BoxGeometry(6, 6, 6).translate(0, 3.15, 0);
    const material = new THREE.MeshBasicMaterial();
    const batch = new THREE.BatchedMesh(2, 24, 36, material);
    const geometryId = batch.addGeometry(geometry);
    const host = document.createElement('div');
    host.id = 'batch-models-root';
    f.sceneEl.append(host);
    batch.el = host;
    batch._batchIdToEl = [];
    for (const x of [0, 10]) {
      const el = document.createElement('div');
      el.setAttribute('mixin', 'SM3D_Bld_Mixed_Corner_4fl');
      f.sceneEl.append(el);
      const instanceId = batch.addInstance(geometryId);
      batch.setMatrixAt(
        instanceId,
        new THREE.Matrix4().makeTranslation(x, 0, 0)
      );
      batch._batchIdToEl[instanceId] = el;
    }
    f.sceneEl.object3D.add(batch);
    f.attach();

    expect(f.controls.landingUpY).toBeCloseTo(6.15);
    expect(f.controls._landingUpEntity).toBe(batch._batchIdToEl[0]);
    expect(f.controls.probe.lastHits[0].object).toBe(batch);
    f.el.append(batch._batchIdToEl[0]);
    f.controls._refreshSupport();
    expect(f.controls.landingUpY).toBeNull();
    f.sceneEl.append(batch._batchIdToEl[0]);
    f.controls._refreshSupport();
    expect(f.controls.landingUpY).toBeCloseTo(6.15);
    f.controls.axis = 'landingUp';
    f.controls.startDrag('landingUp', {});
    f.controls.endGesture('pointerup');
    expect(f.controls.currentBaseY()).toBeCloseTo(6.15);
    expect(f.commits).toHaveLength(1);

    batch.dispose();
    geometry.dispose();
    material.dispose();
  });

  function selectKind(f, kind) {
    if (kind === 'street') f.el.setAttribute('managed-street', '');
    if (kind === 'building') f.el.setAttribute('mixin', 'building-1');
    if (kind === 'import') {
      f.el.setAttribute('gltf-model', 'url(selected)');
      f.el.setAttribute('data-asset-id', 'selected');
    }
  }

  function addStreetSlab(f) {
    f.mesh.geometry.dispose();
    f.mesh.geometry = new THREE.BoxGeometry(0.2, 0.15, 0.2);
    f.mesh.position.y = 0.075;
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial()
    );
    slab.position.y = -1;
    f.object.add(slab);
  }

  it.each([
    ['street', 0, 5],
    ['building', 0.5, 4],
    ['import', 1, 3],
    ['furniture', 1.5, 2.5]
  ])(
    'filters %s support and targets in both directions',
    (kind, below, above) => {
      const f = fixture({ base: 2 });
      f.surface(0, { kind: 'tiles' });
      f.surface(5, { kind: 'tiles' });
      f.surface(0.5);
      f.surface(4);
      f.surface(1, { kind: 'building' });
      f.surface(3, { kind: 'building' });
      f.surface(1.5, { kind: 'import' });
      f.surface(2.5, { kind: 'import' });
      selectKind(f, kind);
      f.attach();
      // An unfiltered probe or one filtering only above targets picks different heights.
      expect(f.controls.supportY).toBeCloseTo(below, 6);
      expect(f.controls.landingDownY).toBeCloseTo(below, 6);
      expect(f.controls.landingUpY).toBeCloseTo(above, 6);
      const expectedHeights = {
        street: [0, 5],
        building: [0, 0.5, 4, 5],
        import: [0, 0.5, 1, 3, 4, 5],
        furniture: [0, 0.5, 1, 1.5, 2.5, 3, 4, 5]
      };
      expect(
        [...new Set(f.controls.probe.lastHits.map((hit) => hit.point.y))].sort(
          (a, b) => a - b
        )
      ).toEqual(expectedHeights[kind]);
    }
  );

  it.each([
    ['street', 'segment'],
    ['street', 'building'],
    ['street', 'import'],
    ['building', 'building'],
    ['building', 'import'],
    ['import', 'import']
  ])('does not lift a %s onto a sub-step %s surface', (kind, supportKind) => {
    const f = fixture();
    vi.stubGlobal('STREET', {
      catalog: [{ id: 'building-1', category: 'buildings' }]
    });
    f.surface(0, { kind: 'tiles' });
    f.surface(0.15, { kind: supportKind, x: 0.3, width: 0.4 });
    selectKind(f, kind);
    f.attach();
    f.start();
    f.pointer(
      'pointerup',
      new THREE.Vector3(0.3, f.controls.currentBaseY(), 0)
    );
    f.frame();
    // The 0.15 m step is normally continuous; only hierarchy filtering prevents the lift.
    expect(f.object.position.x).toBeCloseTo(0.3, 3);
    expect(f.object.position.y).toBeCloseTo(0, 6);
    expect(f.controls.landingUpY).toBeNull();
  });

  it.each([
    ['building', 'segment'],
    ['import', 'building'],
    ['furniture', 'import']
  ])('lands a %s on an eligible %s surface', (kind, supportKind) => {
    const f = fixture({ base: 5 });
    const support = f.surface(0, { kind: supportKind });
    selectKind(f, kind);
    f.attach();
    const target = f.controls.landingDownGroup.position.clone();
    f.pointer('pointerdown', target);
    expect(f.controls.axis).toBe('landingDown');
    f.pointer('pointerup', target);
    f.frame();
    expect(f.object.position.y).toBeCloseTo(0, 6);
    expect(f.controls.supportY).toBeCloseTo(0, 6);
    expect(f.commits).toHaveLength(1);
    expect(f.controls.probe.excludeEl).toBe(f.el);
    expect(support.el).not.toBe(f.el);
  });

  it.each([1, 2])(
    'lands street road level with Y scale %s on tiles',
    (scaleY) => {
      const f = fixture({ base: 5 });
      selectKind(f, 'street');
      addStreetSlab(f);
      f.object.scale.y = scaleY;
      f.surface(0, { kind: 'tiles' });
      f.attach();
      // Origin or bounding-box anchoring leaves the actual road surface above terrain.
      expect(f.controls.baseY).toBeCloseTo(5 + 0.15 * scaleY, 6);
      expect(f.controls.baseOffset).toBeCloseTo(0.15 * scaleY, 6);
      const target = f.controls.landingDownGroup.position.clone();
      f.pointer('pointerdown', target);
      expect(f.controls.axis).toBe('landingDown');
      f.pointer('pointerup', target);
      f.frame();
      expect(f.object.position.y).toBeCloseTo(-0.15 * scaleY, 6);
      expect(new THREE.Box3().setFromObject(f.mesh).max.y).toBeCloseTo(0, 6);
      expect(new THREE.Box3().setFromObject(f.object).min.y).toBeCloseTo(
        -2.15 * scaleY,
        6
      );
      expect(f.commits).toHaveLength(1);
    }
  );

  it('follows tiles slopes using road level despite the underground slab', () => {
    const f = fixture({ base: -0.15 });
    selectKind(f, 'street');
    addStreetSlab(f);
    f.surface(0, { kind: 'tiles', slope: 0.8 });
    f.attach();
    f.start();
    f.pointer('pointerup', new THREE.Vector3(1, 0, 0));
    f.frame();
    expect(f.object.position.x).toBeCloseTo(1, 3);
    expect(f.object.position.y).toBeCloseTo(0.65, 3);
    expect(f.controls.currentBaseY()).toBeCloseTo(0.8, 3);
  });

  it('recomputes eligibility when the selected entity becomes an imported mesh', () => {
    const f = fixture();
    f.surface(2, { kind: 'import' });
    f.attach();
    expect(f.controls.landingUpY).toBeCloseTo(2, 6);
    selectKind(f, 'import');
    f.controls._refreshSupport();
    expect(f.controls.landingUpY).toBeNull();
    f.controls.detach();
    f.el.removeAttribute('gltf-model');
    f.el.removeAttribute('data-asset-id');
    f.attach();
    expect(f.controls.landingUpY).toBeCloseTo(2, 6);
  });

  it('suspends only selected-subtree flatteners and restores them on close and detach', () => {
    const f = fixture();
    const own = { setSuspended: vi.fn() };
    f.el.components = { 'geo-flatten': own };
    const child = document.createElement('div');
    child.setAttribute('geo-flatten', '');
    const nested = { setSuspended: vi.fn() };
    child.components = { 'geo-flatten': nested };
    f.el.append(child);
    const outside = document.createElement('div');
    outside.setAttribute('geo-flatten', '');
    const other = { setSuspended: vi.fn() };
    outside.components = { 'geo-flatten': other };
    f.sceneEl.append(outside);
    f.attach();
    expect(own.setSuspended).toHaveBeenLastCalledWith(f.controls.probe, true);
    expect(nested.setSuspended).toHaveBeenLastCalledWith(
      f.controls.probe,
      true
    );
    expect(other.setSuspended).not.toHaveBeenCalled();
    f.inspector.opened = false;
    f.frame();
    expect(own.setSuspended).toHaveBeenLastCalledWith(f.controls.probe, false);
    expect(nested.setSuspended).toHaveBeenLastCalledWith(
      f.controls.probe,
      false
    );
    f.inspector.opened = true;
    f.frame();
    expect(own.setSuspended).toHaveBeenLastCalledWith(f.controls.probe, true);
    f.controls.detach();
    expect(own.setSuspended).toHaveBeenLastCalledWith(f.controls.probe, false);
    expect(nested.setSuspended).toHaveBeenLastCalledWith(
      f.controls.probe,
      false
    );
    expect(other.setSuspended).not.toHaveBeenCalled();
  });
});

describe('release, touch and attachment lifecycle', () => {
  it('renders the exact parapet move and landing subsystems in independent regimes', () => {
    const f = fixture({ base: 2, cameraY: 0 });
    f.camera.position.z = 15;
    f.camera.lookAt(0, 0, 0);
    f.camera.updateMatrixWorld(true);
    f.surface(-6);
    f.attach();
    expect(f.controls.flat).toBe(true);
    expect(f.controls._shallowAmount).toBe(1);
    expect(f.controls.landingDownGroup.userData.faceAmount).toBe(0);
    expect(f.controls.landingDownGroup.visible).toBe(true);
  });
  for (const capture of ['absent', 'throws', 'works']) {
    it(`retains touch ownership when capture ${capture}`, () => {
      const f = fixture();
      f.surface(0);
      f.attach();
      if (capture === 'throws') {
        f.canvas.setPointerCapture = () => {
          throw new Error('capture unavailable');
        };
      }
      if (capture === 'works') f.canvas.setPointerCapture = vi.fn();
      f.start('touch');
      const originalMouse = f.controls.mouse.clone();
      const elsewhere = new THREE.Vector3(3, 0, 0);
      for (const type of [
        'pointerdown',
        'pointermove',
        'pointerup',
        'pointercancel',
        'lostpointercapture'
      ]) {
        f.pointer(type, elsewhere, 'touch', 2);
        f.frame();
        expect(f.controls.isDragging).toBe(true);
        expect(f.controls._pointerId).toBe(1);
        expect(f.controls._pressWasClaimed).toBe(true);
        expect(f.controls.mouse.equals(originalMouse)).toBe(true);
        expect(f.object.position.x).toBe(0);
        expect(f.commits).toHaveLength(0);
      }
      f.pointer('pointermove', new THREE.Vector3(0.2, 0, 0), 'touch');
      f.frame();
      expect(f.object.position.x).toBeCloseTo(0.2, 3);
      f.pointer('pointerup', new THREE.Vector3(0.3, 0, 0), 'touch');
      f.frame();
      expect(f.object.position.x).toBeCloseTo(0.3, 3);
      expect(f.commits).toHaveLength(1);
    });
  }

  it('does not let a second finger activate a held landing button', () => {
    const f = fixture({ base: 2 });
    f.surface(0);
    f.attach();
    const target = f.controls.landingDownGroup.position.clone();
    f.pointer('pointerdown', target, 'touch');
    f.pointer('pointerup', target, 'touch', 2);
    expect(f.controls.isDragging).toBe(true);
    expect(f.object.position.y).toBe(2);
    expect(f.commits).toHaveLength(0);
    f.pointer('pointerup', target, 'touch');
    expect(f.object.position.y).toBe(0);
    expect(f.commits).toHaveLength(1);
  });

  it('cancels only when native capture is lost by the owning pointer', () => {
    const f = fixture();
    f.surface(0);
    f.attach();
    f.start('touch');
    f.pointer('pointermove', new THREE.Vector3(0.2, 0, 0), 'touch');
    f.frame();
    f.pointer('lostpointercapture', new THREE.Vector3(0.2, 0, 0), 'touch', 2);
    expect(f.controls.isDragging).toBe(true);
    f.pointer('lostpointercapture', new THREE.Vector3(0.2, 0, 0), 'touch');
    expect(f.controls.isDragging).toBe(false);
    expect(f.object.position.x).toBe(0);
    expect(f.commits).toHaveLength(0);
  });
  it('keeps the chevron connection visible when both ends are outside opposite edges', () => {
    const f = fixture();
    f.attach();
    f.camera.position.set(0, 0, 10);
    f.camera.lookAt(0, 0, 0);
    f.camera.updateMatrixWorld(true);
    const group = f.controls.landingDownGroup;
    group.position.set(0, -20, 0);
    f.controls._layoutChevrons(group, -20, 20, 2, 0, 0);
    group.updateMatrixWorld(true);
    const projections = group.userData.chevrons
      .filter((c) => c.visible)
      .map((c) => c.getWorldPosition(new THREE.Vector3()).project(f.camera));
    expect(projections.some((p) => Math.abs(p.y + 0.95) < 1e-6)).toBe(true);
  });

  it('commits the latest tracked coordinate on mouseleave', () => {
    const f = fixture();
    f.surface(0);
    f.attach();
    f.start();
    f.pointer('pointermove', new THREE.Vector3(0.4, 0, 0));
    f.canvas.dispatchEvent(new Event('mouseleave'));
    f.frame();
    expect(f.object.position.x).toBeCloseTo(0.4, 3);
    expect(f.commits).toHaveLength(1);
  });

  it('cancels a move whose geometry changes and refreshes the new base', () => {
    const f = fixture();
    f.surface(0);
    f.attach();
    f.start();
    f.pointer('pointermove', new THREE.Vector3(0.5, 0, 0));
    f.frame();
    f.mesh.position.y = 1.5;
    f.el.dispatchEvent(new Event('shape-geometry-changed'));
    f.frame();
    expect(f.object.position.x).toBe(0);
    expect(f.controls.isDragging).toBe(false);
    expect(f.controls.baseY).toBe(1);
    expect(f.commits).toHaveLength(0);
  });
  it('starts the shallow strip on an upward ray that cannot intersect the base plane', () => {
    const f = fixture({ cameraY: 0.01 });
    f.surface(0);
    f.attach();
    const point = f.controls.moveGroup.position.clone();
    point.y += f.controls.squareSide * 0.05;
    f.pointer('pointerdown', point);
    expect(f.controls.raycaster.ray.direction.y).toBeGreaterThan(0);
    expect(f.controls.isDragging).toBe(true);
    expect(f.controls.dragConstrained).toBe(true);
    f.pointer('pointerup', point.clone().add(new THREE.Vector3(0.1, 0, 0)));
    f.frame();
    expect(f.object.position.x).toBeGreaterThan(0);
    expect(f.commits).toHaveLength(1);
  });

  it('rehits a landing release even without an intervening pointermove', () => {
    const f = fixture({ base: 2 });
    f.surface(0);
    f.attach();
    f.pointer('pointerdown', f.controls.landingDownGroup.position);
    expect(f.controls.axis).toBe('landingDown');
    expect(f.controls.isDragging).toBe(true);
    f.pointer('pointerup', new THREE.Vector3(20, 0, 0));
    expect(f.commits).toHaveLength(0);
    expect(f.object.position.y).toBe(2);
  });

  it('disarms touch landing feedback without sliding and places on a rearmed release', () => {
    const f = fixture({ base: 2 });
    f.surface(0);
    f.attach();
    const target = f.controls.landingDownGroup.position.clone();
    f.pointer('pointerdown', target, 'touch');
    f.frame();
    expect(f.controls.axis).toBe('landingDown');
    expect(f.controls.landingDownGroup.userData.slideFrom).toBeNull();
    expect(f.controls.materials.landingDown.flat.opacity).toBeCloseTo(
      OPACITY_ACTION
    );
    f.pointer('pointermove', new THREE.Vector3(20, 0, 0), 'touch');
    expect(f.controls.materials.landingDown.flat.opacity).toBeCloseTo(
      OPACITY_REST
    );
    f.pointer('pointermove', target, 'touch');
    expect(f.controls.materials.landingDown.flat.opacity).toBeCloseTo(
      OPACITY_ACTION
    );
    const rays = vi.spyOn(f.controls.probe.raycaster, 'intersectObjects');
    f.pointer('pointerup', target, 'touch');
    expect(rays).toHaveBeenCalledTimes(1);
    expect(f.object.position.y).toBe(0);
    expect(f.commits).toHaveLength(1);
    expect(f.controls.axis).toBeNull();
  });

  for (const change of ['removed', 'moved', 'replaced']) {
    it(`rejects a ${change} landing surface after press`, () => {
      const f = fixture({ base: 2 });
      const ground = f.surface(0);
      f.attach();
      const target = f.controls.landingDownGroup.position.clone();
      f.pointer('pointerdown', target);
      expect(f.controls.axis).toBe('landingDown');
      if (change === 'removed') ground.el.remove();
      if (change === 'moved') {
        ground.mesh.position.y = 0.5;
        ground.mesh.updateMatrixWorld(true);
      }
      if (change === 'replaced') {
        f.sceneEl.object3D.remove(ground.mesh);
        f.surface(0);
      }
      f.pointer('pointerup', target);
      expect(f.object.position.y).toBe(2);
      expect(f.commits).toHaveLength(0);
    });
  }

  it('clamps the final chevron without a hit target and scales it with the move square', () => {
    const f = fixture({ base: 2 });
    f.surface(-20);
    f.attach();
    const target = f.controls.landingDownGroup;
    const world = new THREE.Vector3();
    const chevrons = target.userData.chevrons.filter((c) => c.visible);
    const projections = chevrons.map((c) =>
      c.getWorldPosition(world).clone().project(f.camera)
    );
    expect(projections.some((p) => Math.abs(Math.abs(p.y) - 0.95) < 1e-6)).toBe(
      true
    );
    const hits = [];
    chevrons.forEach((c) => c.raycast(f.controls.raycaster, hits));
    expect(hits).toHaveLength(0);
    const size = chevrons[0].scale.clone();
    f.controls._layoutChevrons(
      target,
      -20,
      2,
      f.controls.squareSide * 4,
      0,
      100
    );
    expect(target.userData.chevrons[0].scale.x).toBe(size.x * 4);
    expect(target.userData.chevrons[0].scale.y).toBe(size.y * 4);
  });

  it('returning to the press on pointerup preserves the no-op history comparison', () => {
    const f = fixture();
    f.surface(0);
    f.attach();
    f.start();
    f.pointer('pointermove', new THREE.Vector3(0.5, 0, 0));
    f.frame();
    f.pointer('pointerup', new THREE.Vector3(0, 0, 0));
    f.pointer('pointerdown', new THREE.Vector3(0, 0, 0));
    f.frame();
    expect(f.commits).toHaveLength(1);
    expect(
      f.commits[0].changes.filter((c) => c.value !== c.oldValue)
    ).toHaveLength(0);
  });

  for (const exit of ['blur', 'pointercancel', 'close']) {
    it(`restores a queued release on ${exit}`, () => {
      const f = fixture();
      f.surface(0);
      f.attach();
      f.start();
      const changed = vi.fn();
      f.controls.addEventListener('objectChange', changed);
      f.pointer('pointermove', new THREE.Vector3(0.5, 0, 0));
      f.frame();
      f.pointer('pointerup', new THREE.Vector3(0.7, 0, 0));
      if (exit === 'close') f.inspector.opened = false;
      else if (exit === 'pointercancel') {
        f.pointer('pointercancel', new THREE.Vector3(0.7, 0, 0));
      } else window.dispatchEvent(new Event(exit));
      f.frame();
      expect(f.object.position.x).toBe(0);
      expect(f.commits).toHaveLength(0);
      expect(changed).toHaveBeenCalled();
    });
  }

  it('has touch action feedback without hover/dimming and clears the external hover signal', () => {
    const f = fixture();
    f.surface(0);
    f.attach();
    const hover = [];
    f.controls.addEventListener('axisHoverChange', (e) => hover.push(e.axis));
    f.start('touch');
    expect(f.controls.materials.move.flat.opacity).toBeCloseTo(OPACITY_ACTION);
    expect(f.controls.materials.rotate.flat.opacity).toBeCloseTo(OPACITY_REST);
    f.pointer('pointerup', new THREE.Vector3(0, 0, 0), 'touch');
    f.frame();
    expect(hover.at(-1)).toBeNull();
    expect(f.controls.axis).toBeNull();
  });

  it('refreshes changed shape bounds and seeds the initial regime from the base', () => {
    const f = fixture({ base: 0, cameraY: 1 });
    f.mesh.position.y = 8.5;
    f.surface(8);
    f.attach();
    expect(f.controls.flat).toBe(false);
    expect(f.controls._anim.endMs).toBe(f.controls._anim.startMs);
    f.mesh.position.y = 0.5;
    f.el.dispatchEvent(new Event('shape-geometry-changed'));
    f.frame();
    expect(f.controls.baseY).toBeCloseTo(0);
  });

  it('does not cast idle rays while the editor is closed', () => {
    vi.useFakeTimers();
    const f = fixture();
    f.surface(0);
    f.attach();
    const rays = vi.spyOn(f.controls.probe.raycaster, 'intersectObjects');
    f.inspector.opened = false;
    vi.advanceTimersByTime(IDLE_PROBE_INTERVAL_MS * 3);
    expect(rays).not.toHaveBeenCalled();
  });

  it('excludes every helper descendant from navigation picking, including after detach', () => {
    const f = fixture();
    f.attach();
    const meshes = [];
    f.controls.traverse((node) => {
      if (node.isMesh) meshes.push(node);
    });
    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      expect(cursorInternals._isExcludedObject(mesh)).toBe(true);
    }
    f.controls.detach();
    for (const mesh of meshes) {
      expect(cursorInternals._isExcludedObject(mesh)).toBe(true);
    }
  });
});

// --- what is drawn, on screen ---------------------------------------------

// The fixture canvas.
const SCREEN_W = 1200;
const SCREEN_H = 800;

/** Every drawn triangle under the given roots, in screen pixels: visible
 * meshes only, pick proxies and invisible pick quads left out, and each
 * geometry's draw range honoured, since the flattened arc is drawn short.
 * Screen-space lines are left out too: their geometry is a template the
 * shader places, not triangles in the scene. */
function screenTriangles(roots, camera) {
  const tris = [];
  const v = new THREE.Vector3();
  camera.updateMatrixWorld(true);
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverseVisible((node) => {
      if (!node.isMesh || node.isLineSegments2 || node.userData.isPickProxy) {
        return;
      }
      if (node.material && node.material.opacity === 0) return;
      const geometry = node.geometry;
      const position = geometry.attributes.position;
      const index = geometry.index;
      const count = index ? index.count : position.count;
      const start = geometry.drawRange.start;
      const end = Math.min(count, start + geometry.drawRange.count);
      const at = (k) => {
        const i = index ? index.getX(k) : k;
        v.fromBufferAttribute(position, i)
          .applyMatrix4(node.matrixWorld)
          .project(camera);
        return {
          x: ((v.x + 1) / 2) * SCREEN_W,
          y: ((1 - v.y) / 2) * SCREEN_H
        };
      };
      for (let k = start; k + 3 <= end; k += 3) {
        tris.push([at(k), at(k + 1), at(k + 2)]);
      }
    });
  }
  return tris;
}

/** Where a vertical screen line crosses a set of triangles: its topmost and
 * bottommost crossing in pixels (y down), or null if it misses them all. */
function columnExtent(tris, x) {
  let top = Infinity;
  let bottom = -Infinity;
  for (const tri of tris) {
    for (let e = 0; e < 3; e++) {
      const p = tri[e];
      const q = tri[(e + 1) % 3];
      if ((p.x - x) * (q.x - x) > 0 || p.x === q.x) continue;
      const y = p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  return top <= bottom ? { top, bottom } : null;
}

/**
 * The smallest on-screen gap, per quarter-pixel column, between the arc and
 * another drawn part, where the arc is meant to be above it (`arcAbove`) or
 * below it. Negative means they overlap. `columns` counts the columns where
 * both are drawn, so a caller can refuse a measurement of nothing.
 */
function arcSeparation(arcTris, otherTris, arcAbove) {
  const xs = (tris) => tris.flat().map((p) => p.x);
  const from = Math.max(Math.min(...xs(arcTris)), Math.min(...xs(otherTris)));
  const to = Math.min(Math.max(...xs(arcTris)), Math.max(...xs(otherTris)));
  let min = Infinity;
  let columns = 0;
  for (let x = Math.ceil(from * 4) / 4; x <= to; x += 0.25) {
    const arc = columnExtent(arcTris, x);
    const other = columnExtent(otherTris, x);
    if (!arc || !other) continue;
    columns++;
    const gap = arcAbove ? other.top - arc.bottom : arc.top - other.bottom;
    min = Math.min(min, gap);
  }
  return { min, columns };
}

describe('the flattened arc on screen', () => {
  const BASE = 5;

  /** Camera `distance` from the object's base at `elevationDeg` (positive
   * above), aimed at it. */
  function viewFrom(f, distance, elevationDeg, baseY = BASE) {
    const a = THREE.MathUtils.degToRad(elevationDeg);
    f.camera.position.set(
      0,
      baseY + distance * Math.sin(a),
      distance * Math.cos(a)
    );
    f.camera.lookAt(0, baseY, 0);
    f.camera.updateMatrixWorld(true);
  }

  /**
   * An object at `BASE`, seen flattened from `distance` and `elevationDeg`.
   * The regime is seeded at a lower angle and the camera then moved, because
   * the flattened presentation is entered below 10° and held to 12°.
   * `targets(S)` lists landing surfaces as `[offset from base, kind]`; they are
   * placed once the square's size is known, which fixes them in units of S.
   */
  function flatScene(distance, elevationDeg, targets = () => []) {
    const f = fixture({ base: BASE });
    const seedDeg =
      Math.sign(elevationDeg) * Math.min(Math.abs(elevationDeg), 8);
    viewFrom(f, distance, seedDeg);
    f.attach();
    const S = f.controls.squareSide;
    for (const [offset, kind] of targets(S)) {
      f.surface(BASE + offset, { kind });
    }
    f.controls._refreshSupport();
    viewFrom(f, distance, elevationDeg);
    f.frame();
    expect(f.controls._shallowAmount).toBe(1);
    return f;
  }

  const handleTris = (f) => screenTriangles([f.controls.moveGroup], f.camera);
  const arcTris = (f) => screenTriangles([f.controls.arcGroup], f.camera);
  const outlineTris = (f, group) =>
    screenTriangles(group.userData.bars, f.camera);
  const gapPx = (f) =>
    (ARC_FLAT_CLEAR_FRAC * f.controls.squareSide) / f.controls._mpp;

  it('adds no lift in the round presentation', () => {
    const f = fixture({ base: BASE });
    viewFrom(f, 8, 45);
    f.attach();
    f.surface(BASE - 0.4 * f.controls.squareSide);
    f.controls._refreshSupport();
    f.frame();
    expect(f.controls._shallowAmount).toBe(0);
    expect(f.controls.landingDownGroup.visible).toBe(true);
    expect(f.controls._dodge.flipArc).toBe(true);
    // At 45° the clamped lift would be about 0.82 S.
    expect(f.controls.arcGroup.position.y).toBeCloseTo(f.controls.baseY, 9);
  });

  it('reads the elevation at the handle as drawn, shifted to dodge a target', () => {
    // A target just below shifts the handle up, which lowers the angle the
    // camera looks down on it; the arc goes above the strip, on the camera's
    // side, so both forms of the lift apply.
    const f = flatScene(8, 4, () => [[-0.15, 'segment']]);
    const c = f.controls;
    expect(c.landingDownGroup.visible).toBe(true);
    expect(c._dodge.flipArc).toBe(true);
    expect(c._dodge.shift).toBeGreaterThan(0);
    const S = c.squareSide;
    const t = c._shallowAmount;
    const shift = c._dodge.shift * t;
    const { clearance } = dodgeExtents(S, c._mpp, t);
    const applied = c.arcGroup.position.y - (c.baseY + shift) - t * clearance;
    const camera = f.camera.getWorldPosition(new THREE.Vector3());
    const atHandle = elevationAngleDegrees(camera, {
      x: 0,
      y: c.baseY + shift,
      z: 0
    });
    const atAnchor = elevationAngleDegrees(camera, { x: 0, y: c.baseY, z: 0 });
    expect(applied).toBeCloseTo(t * flatArcLift(S, atHandle, 1), 9);
    expect(
      Math.abs(flatArcLift(S, atAnchor, 1) - flatArcLift(S, atHandle, 1))
    ).toBeGreaterThan(0.01 * S);
  });

  for (const distance of [8, 60]) {
    for (const elevationDeg of [2, 6, 10, 11.99]) {
      it(`keeps the arc clear of the handle above the strip, ${distance} m, ${elevationDeg}°, target below`, () => {
        const f = flatScene(distance, elevationDeg, (S) => [
          [-0.4 * S, 'segment']
        ]);
        expect(f.controls.landingDownGroup.visible).toBe(true);
        expect(f.controls._dodge.flipArc).toBe(true);
        const sep = arcSeparation(arcTris(f), handleTris(f), true);
        expect(sep.columns).toBeGreaterThan(0);
        expect(sep.min).toBeGreaterThanOrEqual(gapPx(f) - 0.1);
      });
    }
    // The camera-below poses are the ones where parallax draws the arc toward
    // the handle; from above with the arc below, it is drawn away from it.
    for (const elevationDeg of [-11.99, -6, -2, 11.99]) {
      it(`keeps the arc clear of the handle below the strip, ${distance} m, ${elevationDeg}°, no targets`, () => {
        const f = flatScene(distance, elevationDeg);
        expect(f.controls.landingDownGroup.visible).toBe(false);
        expect(f.controls.landingUpGroup.visible).toBe(false);
        expect(f.controls._dodge.flipArc).toBe(false);
        const sep = arcSeparation(arcTris(f), handleTris(f), false);
        expect(sep.columns).toBeGreaterThan(0);
        expect(sep.min).toBeGreaterThanOrEqual(gapPx(f) - 0.1);
      });
    }
  }

  it('keeps the arc clear of a handle shifted up between two close targets', () => {
    // 5 m, 2° from below. A target shown at 0.15 m stays shown when the object
    // is lowered to 0.06 m, inside the landing gate's hysteresis, so the handle
    // is shifted well up; a second target above keeps the arc below the strip,
    // on the camera's side.
    const f = fixture({ base: BASE });
    viewFrom(f, 5, -2);
    f.surface(BASE - 0.15);
    f.attach();
    const c = f.controls;
    expect(c.landingDownGroup.visible).toBe(true);
    const lowered = BASE - 0.09;
    f.object.position.y = lowered;
    f.object.updateMatrixWorld(true);
    c._refreshSupport();
    const { stripClear } = dodgeExtents(c.squareSide, c._mpp, 1);
    const shift = stripClear - 0.06;
    f.surface(lowered + shift + 0.5 * stripClear, { kind: 'import' });
    c._refreshSupport();
    viewFrom(f, 5, -2, lowered);
    f.frame();
    expect(c._shallowAmount).toBe(1);
    expect(c.landingDownGroup.visible).toBe(true);
    expect(c.landingUpGroup.visible).toBe(true);
    expect(c._dodge.flipArc).toBe(false);
    expect(c._dodge.shift).toBeGreaterThan(0);
    const sep = arcSeparation(arcTris(f), handleTris(f), false);
    expect(sep.columns).toBeGreaterThan(0);
    expect(sep.min).toBeGreaterThanOrEqual(gapPx(f) - 0.1);
  });

  for (const distance of [8, 60]) {
    for (const [label, offset] of [
      ['near', () => -0.15],
      ['far', (S) => -2 * S]
    ]) {
      it(`goes above the strip, clear of a lone ${label} target below, ${distance} m`, () => {
        const f = flatScene(distance, 10, (S) => [[offset(S), 'segment']]);
        expect(f.controls.landingDownGroup.visible).toBe(true);
        expect(f.controls._dodge.flipArc).toBe(true);
        const sep = arcSeparation(
          arcTris(f),
          outlineTris(f, f.controls.landingDownGroup),
          true
        );
        expect(sep.columns).toBeGreaterThan(0);
        expect(sep.min).toBeGreaterThanOrEqual(gapPx(f));
      });
    }

    it(`goes toward the farther of two targets, clear of it, ${distance} m`, () => {
      const f = flatScene(distance, 10, (S) => [
        [-0.15, 'segment'],
        [2 * S, 'import']
      ]);
      expect(f.controls.landingDownGroup.visible).toBe(true);
      expect(f.controls.landingUpGroup.visible).toBe(true);
      expect(f.controls._dodge.flipArc).toBe(true);
      const sep = arcSeparation(
        arcTris(f),
        outlineTris(f, f.controls.landingUpGroup),
        false
      );
      expect(sep.columns).toBeGreaterThan(0);
      expect(sep.min).toBeGreaterThanOrEqual(gapPx(f) - 0.1);
    });
  }

  it('returns the arc below the strip once the object has landed', () => {
    const f = flatScene(8, 10, () => [[-0.15, 'segment']]);
    expect(f.controls.landingDownGroup.visible).toBe(true);
    expect(f.controls._dodge.flipArc).toBe(true);
    f.object.position.y = BASE - 0.12; // 0.03 m above the surface
    f.object.updateMatrixWorld(true);
    f.controls._refreshSupport();
    f.frame();
    expect(f.controls.landingDownGroup.visible).toBe(false);
    expect(f.controls._dodge.flipArc).toBe(false);
  });
});

describe('the move square inside a landing outline', () => {
  const BASE = 5;

  /** A fixture whose camera sits at `position`, aimed at the object's base;
   * `up` is only needed straight overhead. */
  function sceneFrom(position, surfaces = [], { up } = {}) {
    const f = fixture({ base: BASE });
    if (up) f.camera.up.copy(up);
    f.camera.position.copy(position);
    f.camera.lookAt(0, BASE, 0);
    f.camera.updateMatrixWorld(true);
    for (const [y, kind] of surfaces) f.surface(y, { kind });
    f.attach();
    return f;
  }

  const overhead = (surfaces) =>
    sceneFrom(new THREE.Vector3(0, BASE + 8, 0), surfaces, {
      up: new THREE.Vector3(0, 0, -1)
    });

  function toScreen(f, world) {
    const v = world.clone().project(f.camera);
    return new THREE.Vector2(
      ((v.x + 1) / 2) * SCREEN_W,
      ((1 - v.y) / 2) * SCREEN_H
    );
  }

  /** What a press over this world point would take. */
  function pickThrough(f, world) {
    const v = world.clone().project(f.camera);
    f.controls.raycaster.setFromCamera(new THREE.Vector2(v.x, v.y), f.camera);
    return f.controls.pickAxis();
  }

  const outlinePoint = (group, x, z) =>
    group.userData.outline.localToWorld(new THREE.Vector3(x, 0, z));

  it('insets the square and keeps its arrowheads on its edges', () => {
    const f = overhead([[BASE - 0.15, 'segment']]);
    const c = f.controls;
    expect(c._shallowAmount).toBe(0);
    const S = c.squareSide;
    expect(c.movePlate.scale.x).toBeCloseTo(S * MOVE_PLATE_ROUND_FRAC, 9);
    for (const head of c.moveHeads.slice(2)) {
      const innerEdge = Math.abs(head.position.z) - (S * HEAD_LEN_FRAC) / 2;
      expect(innerEdge).toBeCloseTo((S * MOVE_PLATE_ROUND_FRAC) / 2, 9);
    }
  });

  it('keeps a visible gap between the square and an outline just below it, with no edge drawn', () => {
    const f = overhead([[BASE - 0.15, 'segment']]);
    const c = f.controls;
    expect(c.landingDownGroup.visible).toBe(true);
    expect(c.landingDownGroup.userData.faceAmount).toBe(0);
    const centre = toScreen(f, new THREE.Vector3(0, BASE, 0));
    const plateEdge = c.movePlate.localToWorld(new THREE.Vector3(0.5, 0, 0));
    const outward = plateEdge.clone().setY(0).normalize();
    const ringInner = new THREE.Vector3()
      .copy(outward)
      .multiplyScalar((0.5 - LANDING_OUTLINE_FRAC) * c.squareSide)
      .setY(c.landingDownY);
    const gap =
      toScreen(f, ringInner).distanceTo(centre) -
      toScreen(f, plateEdge).distanceTo(centre);
    expect(gap).toBeGreaterThanOrEqual(1.0);
  });

  it('draws a target below under the handle and one above over it, from above', () => {
    const a = THREE.MathUtils.degToRad(60);
    const f = sceneFrom(
      new THREE.Vector3(0, BASE + 8 * Math.sin(a), 8 * Math.cos(a)),
      [
        [BASE - 2, 'segment'],
        [BASE + 2, 'import']
      ]
    );
    const { landingDownGroup: down, landingUpGroup: up } = f.controls;
    expect(down.visible).toBe(true);
    expect(up.visible).toBe(true);
    expect(down.userData.faceAmount).toBe(0);
    expect(up.userData.faceAmount).toBe(0);
    for (const mesh of [...down.userData.bars, down.userData.pick]) {
      expect(mesh.renderOrder).toBe(RENDER_ORDER_LANDING_FAR);
    }
    for (const mesh of [...up.userData.bars, up.userData.pick]) {
      expect(mesh.renderOrder).toBe(RENDER_ORDER_LANDING_NEAR);
    }
    expect(RENDER_ORDER_LANDING_FAR).toBeLessThan(
      f.controls.movePlate.renderOrder
    );
    expect(RENDER_ORDER_LANDING_NEAR).toBeGreaterThan(
      f.controls.arcHalfA.renderOrder
    );
  });

  it('draws the target over the handle from below its surface, where a press takes it', () => {
    // Camera 3 m below a support surface, the object 0.3 m above it.
    const f = fixture({ base: 0.3 });
    f.camera.position.set(0, -3, 4);
    f.camera.lookAt(0, 0.3, 0);
    f.camera.updateMatrixWorld(true);
    f.surface(0);
    f.attach();
    const c = f.controls;
    const down = c.landingDownGroup;
    expect(down.visible).toBe(true);
    expect(down.userData.faceAmount).toBe(0);
    for (const bar of down.userData.bars) {
      expect(bar.renderOrder).toBe(RENDER_ORDER_LANDING_NEAR);
    }
    // The plate's edge farthest from the camera.
    const farEdge = [
      [0.5, 0],
      [-0.5, 0],
      [0, 0.5],
      [0, -0.5]
    ]
      .map(([x, y]) => c.movePlate.localToWorld(new THREE.Vector3(x, y, 0)))
      .reduce((a, b) => (b.z < a.z ? b : a));
    expect(pickThrough(f, farEdge)).toBe('landingDown');
    expect(down.userData.bars[0].renderOrder).toBeGreaterThan(
      c.movePlate.renderOrder
    );
  });

  it('draws the square over the outline where the outline has passed under it, overhead', () => {
    const f = overhead([[BASE - 3, 'segment']]);
    const c = f.controls;
    const down = c.landingDownGroup;
    expect(down.visible).toBe(true);
    const stroke = LANDING_OUTLINE_FRAC;
    const onRing = outlinePoint(down, 0.5 - stroke / 2, 0);
    expect(pickThrough(f, onRing)).toBe('move');
    expect(c.movePlate.renderOrder).toBeGreaterThan(
      down.userData.bars[0].renderOrder
    );
  });

  it('lets a press take the outline where it shows outside the square, overhead', () => {
    const f = overhead([[BASE - 0.4, 'segment']]);
    const c = f.controls;
    const down = c.landingDownGroup;
    expect(down.visible).toBe(true);
    const stroke = LANDING_OUTLINE_FRAC;
    const corner = outlinePoint(down, 0.5 - stroke / 2, 0.5 - stroke / 2);
    expect(pickThrough(f, corner)).toBe('landingDown');
    const head = c.moveHeads[2];
    expect(pickThrough(f, head.getWorldPosition(new THREE.Vector3()))).toBe(
      'move'
    );
    expect(head.renderOrder).toBeGreaterThan(down.userData.bars[0].renderOrder);
  });

  it('gives the near arrowhead the press and the top of the drawing, at 45 degrees', () => {
    const a = THREE.MathUtils.degToRad(45);
    const f = sceneFrom(
      new THREE.Vector3(0, BASE + 8 * Math.sin(a), 8 * Math.cos(a)),
      [[BASE - 0.2, 'segment']]
    );
    const c = f.controls;
    const down = c.landingDownGroup;
    expect(down.visible).toBe(true);
    expect(down.userData.faceAmount).toBe(0);
    const near = c.moveHeads
      .filter((head) => head.visible)
      .map((head) => head.getWorldPosition(new THREE.Vector3()))
      .reduce((a, b) => (b.z > a.z ? b : a));
    expect(pickThrough(f, near)).toBe('move');
    expect(c.moveHeads[0].renderOrder).toBeGreaterThan(
      down.userData.bars[0].renderOrder
    );
  });
});

describe('the dark edge around the yellow parts', () => {
  const BASE = 5;

  function edgesOf(controls) {
    const edges = [];
    controls.traverse((node) => {
      if (node.userData.isEdge) edges.push(node);
    });
    return edges;
  }

  /** The object at `BASE` turned by `yawDeg`, the camera 8 m away at
   * `elevationDeg`, and optionally a surface `surfaceBelow` metres down. */
  function sceneAt(elevationDeg, { yawDeg = 0, surfaceBelow = null } = {}) {
    const f = fixture({ base: BASE });
    f.object.rotation.y = THREE.MathUtils.degToRad(yawDeg);
    f.object.updateMatrixWorld(true);
    const a = THREE.MathUtils.degToRad(elevationDeg);
    if (elevationDeg === 90) f.camera.up.set(0, 0, -1);
    f.camera.position.set(0, BASE + 8 * Math.sin(a), 8 * Math.cos(a));
    f.camera.lookAt(0, BASE, 0);
    f.camera.updateMatrixWorld(true);
    if (surfaceBelow !== null) f.surface(BASE - surfaceBelow);
    f.attach();
    return f;
  }

  const px = (f, world) => {
    const v = world.clone().project(f.camera);
    return { x: ((v.x + 1) / 2) * SCREEN_W, y: ((1 - v.y) / 2) * SCREEN_H };
  };

  /** Each drawn segment of an edge, as its projected midpoint. */
  function edgeMidpoints(f, edge) {
    const array = edge.geometry.attributes.instanceStart.data.array;
    const mids = [];
    for (let i = 0; i < edge.geometry.instanceCount; i++) {
      const a = new THREE.Vector3().fromArray(array, 6 * i);
      const b = new THREE.Vector3().fromArray(array, 6 * i + 3);
      const mid = a.add(b).multiplyScalar(0.5).applyMatrix4(edge.matrixWorld);
      mids.push(px(f, mid));
    }
    return mids;
  }

  /**
   * For each side of a filled polygon (world corners, in order), the
   * perpendicular on-screen distance from the nearest edge segment's midpoint
   * to the line through the side's projected ends — signed, positive outside
   * the fill.
   */
  function sideDistances(f, corners, mids, inward = false) {
    const pts = corners.map((c) => px(f, c));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    return pts.map((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const len = Math.hypot(q.x - p.x, q.y - p.y);
      const signed = (m) =>
        ((q.x - p.x) * (m.y - p.y) - (q.y - p.y) * (m.x - p.x)) / len;
      const centreSide = Math.sign(signed({ x: cx, y: cy }));
      const along = (m) =>
        ((m.x - p.x) * (q.x - p.x) + (m.y - p.y) * (q.y - p.y)) / len / len;
      // The segment drawn along this side is the one whose midpoint is
      // nearest its line, among those beside it.
      let best = null;
      for (const m of mids) {
        const t = along(m);
        if (t < 0 || t > 1) continue;
        const d = -centreSide * signed(m) * (inward ? -1 : 1);
        if (best === null || Math.abs(d) < Math.abs(best)) best = d;
      }
      return best;
    });
  }

  const worldCorners = (mesh, outline) =>
    outline.map(([x, y]) => mesh.localToWorld(new THREE.Vector3(x, y, 0)));
  const QUAD = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5]
  ];
  const TRIANGLE = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0, 0.5]
  ];

  function expectOutside(distances) {
    expect(distances.length).toBeGreaterThan(0);
    for (const d of distances) {
      expect(d).not.toBeNull();
      expect(d).toBeGreaterThanOrEqual(0.73);
      expect(d).toBeLessThanOrEqual(0.77);
    }
  }

  for (const elevationDeg of [14, 20, 45, 90]) {
    for (const yawDeg of [0, 30, 45]) {
      it(`sits half its width outside every side of the square and arrowheads, ${elevationDeg}°, yaw ${yawDeg}°`, () => {
        const f = sceneAt(elevationDeg, { yawDeg });
        const c = f.controls;
        expect(c._shallowAmount).toBe(0);
        expectOutside(
          sideDistances(
            f,
            worldCorners(c.movePlate, QUAD),
            edgeMidpoints(f, c.plateEdge)
          )
        );
        const zMids = edgeMidpoints(f, c.zHeadsEdge);
        const xMids = edgeMidpoints(f, c.xHeadsEdge);
        for (const [head, mids] of [
          [c.moveHeads[2], zMids],
          [c.moveHeads[3], zMids],
          [c.moveHeads[0], xMids],
          [c.moveHeads[1], xMids]
        ]) {
          expectOutside(sideDistances(f, worldCorners(head, TRIANGLE), mids));
        }
      });
    }
  }

  it('sits half its width outside the square under an orthographic camera, which has no aspect', () => {
    const f = fixture({ base: BASE });
    // The fixture canvas is 1200 × 800; the frustum matches it.
    const ortho = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.1, 1000);
    const a = THREE.MathUtils.degToRad(45);
    ortho.position.set(0, BASE + 8 * Math.sin(a), 8 * Math.cos(a));
    ortho.lookAt(0, BASE, 0);
    ortho.updateMatrixWorld(true);
    f.camera = ortho;
    f.controls.camera = ortho;
    f.attach();
    const c = f.controls;
    expect(c._shallowAmount).toBe(0);
    expectOutside(
      sideDistances(
        f,
        worldCorners(c.movePlate, QUAD),
        edgeMidpoints(f, c.plateEdge)
      )
    );
  });

  it('sits half its width outside a landing outline far below, measured at its own depth', () => {
    const f = sceneAt(90, { surfaceBelow: 5 });
    const c = f.controls;
    const down = c.landingDownGroup;
    expect(down.visible).toBe(true);
    expect(down.userData.faceAmount).toBe(0);
    const outline = down.userData.outline;
    const inner = 0.5 - LANDING_OUTLINE_FRAC;
    const rect = (h) =>
      [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h]
      ].map(([x, z]) => outline.localToWorld(new THREE.Vector3(x, 0, z)));
    const mids = edgeMidpoints(f, down.userData.edge);
    expect(mids).toHaveLength(8);
    expectOutside(sideDistances(f, rect(0.5), mids));
    expectOutside(sideDistances(f, rect(inner), mids, true));
  });

  it('outlines a flattened target as one stroke while retaining its broad picker', () => {
    for (const distance of [60, 8]) {
      const f = fixture({ base: BASE });
      const a = THREE.MathUtils.degToRad(5);
      f.camera.position.set(
        0,
        BASE + distance * Math.sin(a),
        distance * Math.cos(a)
      );
      f.camera.lookAt(0, BASE, 0);
      f.camera.updateMatrixWorld(true);
      f.attach();
      f.surface(BASE - 0.4 * f.controls.squareSide);
      f.controls._refreshSupport();
      f.frame();
      const down = f.controls.landingDownGroup;
      expect(down.visible).toBe(true);
      expect(down.userData.faceAmount).toBe(1);
      expect(down.userData.bars[0].visible).toBe(true);
      expect(down.userData.bars[1].visible).toBe(false);
      expect(down.userData.bars[2].visible).toBe(false);
      expect(down.userData.bars[0].position.z).toBeCloseTo(0, 12);
      expect(down.userData.bars[0].scale.y).toBe(LANDING_OUTLINE_FRAC);
      expect(down.userData.pick.scale.y).toBeCloseTo(
        LANDING_BAR_HEIGHT_FRAC,
        12
      );
      expect(down.userData.edge.geometry.instanceCount).toBe(4);
    }
  });

  it('keeps every geometry edge in the gizmo, never culled and never picked', () => {
    const f = sceneAt(45, { surfaceBelow: 1 });
    const c = f.controls;
    const edges = edgesOf(c);
    expect(edges).toHaveLength(23);
    const noPick = c.landingDownGroup.userData.chevrons[0].raycast;
    for (const edge of edges) {
      expect(c.getObjectById(edge.id)).toBe(edge);
      expect(edge.frustumCulled).toBe(false);
      expect(edge.raycast).toBe(noPick);
    }
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), f.camera);
    const hits = raycaster.intersectObject(c, true);
    expect(hits.some((hit) => hit.object.userData.isEdge)).toBe(false);
  });

  it('draws below every fill', () => {
    const f = sceneAt(45, { surfaceBelow: 1 });
    const fills = new Set([
      RENDER_ORDER_LANDING_FAR,
      RENDER_ORDER_LANDING_NEAR
    ]);
    const edges = new Set();
    f.controls.traverse((node) => {
      if (!node.isMesh) return;
      (node.userData.isEdge ? edges : fills).add(node.renderOrder);
    });
    expect([...edges]).toEqual([RENDER_ORDER_EDGE]);
    expect(Math.min(...fills)).toBeGreaterThan(RENDER_ORDER_EDGE);
  });

  it('only outlines the hovered or active yellow control', () => {
    const f = sceneAt(45, { surfaceBelow: 1 });
    const c = f.controls;
    expect(c.landingDownGroup.visible).toBe(true);
    const check = (axis) => {
      expect(c.edgeMaterials.move.opacity).toBeCloseTo(
        axis === 'move'
          ? c.materials.move.flat.opacity * EDGE_OPACITY_RATIO
          : 0,
        12
      );
      expect(c.edgeMaterials.moveFading.opacity).toBeCloseTo(
        axis === 'move'
          ? c.materials.moveHeadFading.opacity * EDGE_OPACITY_RATIO
          : 0,
        12
      );
      expect(c.edgeMaterials.landingDown.opacity).toBeCloseTo(
        axis === 'landingDown'
          ? c.materials.landingDown.flat.opacity * EDGE_OPACITY_RATIO
          : 0,
        12
      );
      expect(c.edgeMaterials.vertical.opacity).toBeCloseTo(
        axis === 'vertical'
          ? c.materials.vertical.flat.opacity * EDGE_OPACITY_RATIO
          : 0,
        12
      );
      for (const chev of c.landingDownGroup.userData.chevrons) {
        if (!chev.visible) continue;
        expect(chev.userData.edge.material.opacity).toBeCloseTo(
          axis === 'landingDown'
            ? chev.material.opacity *
                EDGE_OPACITY_RATIO *
                chev.userData.edgeFacing
            : 0,
          12
        );
      }
    };
    for (const axis of [null, 'rotate', 'move', 'vertical', 'landingDown']) {
      c.highlight(axis);
      check(axis);
    }
    f.start();
    f.frame();
    check(c.axis);
  });

  it('stores every segment of both vertical arrowhead outlines', () => {
    const f = sceneAt(45);
    const edge = f.controls.verticalHeadsEdge;
    expect(edge.geometry.instanceCount).toBe(8);
    const positions = edge.geometry.attributes.instanceStart.data.array;
    expect(positions.length).toBeGreaterThanOrEqual(8 * 6);
    for (let segment = 0; segment < 8; segment++) {
      const start = new THREE.Vector3().fromArray(positions, segment * 6);
      const end = new THREE.Vector3().fromArray(positions, segment * 6 + 3);
      expect(start.distanceTo(end)).toBeGreaterThan(0);
    }
  });

  it('draws no chevron edge seen edge-on from overhead, even after a bare highlight', () => {
    const f = sceneAt(90, { surfaceBelow: 2 });
    const c = f.controls;
    const visible = c.landingDownGroup.userData.chevrons.filter(
      (ch) => ch.visible
    );
    expect(visible.length).toBeGreaterThan(0);
    for (const chev of visible) expect(chev.userData.edgeFacing).toBe(0);
    c.highlight();
    for (const chev of visible) {
      expect(chev.userData.edge.material.opacity).toBe(0);
    }
  });

  it('keeps its geometry through a change of view, and releases everything on disposal', () => {
    let now = 1000;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    try {
      keepsGeometry(
        () => now,
        (t) => (now = t)
      );
    } finally {
      clock.mockRestore();
    }
  });

  function keepsGeometry(getNow, setNow) {
    // Near enough below that the target is seen flattened from 5°.
    const f = sceneAt(45, { surfaceBelow: 0.3 });
    const c = f.controls;
    const before = edgesOf(c).map((edge) => edge.geometry);
    const settle = () => {
      for (let i = 0; i < 4; i++) {
        setNow(getNow() + 300);
        f.frame();
      }
    };
    // Down to a flattened view, then back: the handle and the landing target
    // each flatten and unflatten.
    const a = THREE.MathUtils.degToRad(5);
    f.camera.position.set(0, BASE + 8 * Math.sin(a), 8 * Math.cos(a));
    f.camera.lookAt(0, BASE, 0);
    settle();
    expect(c._shallowAmount).toBe(1);
    expect(c.landingDownGroup.userData.faceAmount).toBe(1);
    const b = THREE.MathUtils.degToRad(45);
    f.camera.position.set(0, BASE + 8 * Math.sin(b), 8 * Math.cos(b));
    f.camera.lookAt(0, BASE, 0);
    settle();
    expect(c._shallowAmount).toBe(0);
    expect(c.landingDownGroup.userData.faceAmount).toBe(0);
    edgesOf(c).forEach((edge, i) => expect(edge.geometry).toBe(before[i]));

    const drawn = [];
    c.traverse((node) => {
      if (!node.isMesh) return;
      drawn.push(node.geometry, node.material);
    });
    for (const resource of drawn) expect(c.registry.has(resource)).toBe(true);
    const spies = c.registry.entries.map((entry) => vi.spyOn(entry, 'dispose'));
    fixtures.splice(fixtures.indexOf(f), 1);
    c.dispose();
    spies.forEach((spy) => expect(spy).toHaveBeenCalled());
    expect(c.registry.entries).toHaveLength(0);
  }
});
