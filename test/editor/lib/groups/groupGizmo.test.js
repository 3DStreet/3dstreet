import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import Events from '@/editor/lib/Events.js';
import useStore from '@/store';
import { TRANSFORM_REFUSED } from '@/editor/lib/transformGuard.js';
import { getGroupBounds } from '@/editor/lib/groups/groupBounds.js';
import {
  positionForRotationAboutCenter,
  rayHitsGroupBox
} from '@/editor/lib/groups/groupTransformMath.js';
import {
  OPACITY_ACTION,
  OPACITY_HOVER
} from '@/editor/lib/gizmos/easyGizmoConstants.js';
import { group, item, mountEditor, solid } from './_editorHarness.js';

const flags = vi.hoisted(() => ({ streetLevel: false }));
const focus = vi.hoisted(() => ({ calls: [] }));

vi.mock('@/editor/lib/cameras', () => ({ copyCameraPosition: vi.fn() }));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/nav-experimental/flag.js', async (importOriginal) => ({
  ...(await importOriginal()),
  isStreetLevelNav: () => flags.streetLevel
}));
vi.mock('@/editor/lib/nav-experimental/index.js', async () => {
  const { EventDispatcher, Vector3 } = await import('three');
  return {
    isStreetLevelNav: () => flags.streetLevel,
    ExperimentalControls: class extends EventDispatcher {
      center = new Vector3();
      setAspectRatio() {}
      setCamera() {}
      focus(...args) {
        focus.calls.push(args);
      }
      navigateDoubleClick() {}
      newSceneCameraZoom() {}
    }
  };
});

// A user group under the easy gizmo, driven with pointer events through the
// real viewport, raycaster, scope controller, shortcuts and gizmo (see
// _editorHarness). Commands run through the real transform guard and history.

const DEG = Math.PI / 180;

let h;
let canvas;
let controls;
let focused;
let teleported;
const onFocus = (object) => focused.push(object);
const onTeleport = (payload) => teleported.push(payload);

beforeEach(() => {
  h = mountEditor({ gizmo: true });
  canvas = h.inspector.container;
  controls = h.inspector.easyGizmoControls;
  focused = [];
  teleported = [];
  focus.calls = [];
  Events.on('objectfocus', onFocus);
  Events.on('nav-experimental:doubleclick', onTeleport);
});

afterEach(() => {
  useStore.setState({ isInspectorEnabled: true, osmWayCandidate: null });
  h.dispose();
  Events.removeAllListeners();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  flags.streetLevel = false;
});

// ------------------------------------------------------------------ scene

// An entity whose transform attributes drive its object3D as A-Frame's do
// (rotation order YXZ) and read back exactly what was written.
function posable(
  el,
  { position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1] } = {}
) {
  const set = el.setAttribute;
  el.setAttribute = (name, value) => {
    const result = set(name, value);
    const v = el.getAttribute(name);
    if (name === 'position') el.object3D.position.set(v.x, v.y, v.z);
    if (name === 'rotation') {
      el.object3D.rotation.set(v.x * DEG, v.y * DEG, v.z * DEG, 'YXZ');
    }
    if (name === 'scale') el.object3D.scale.set(v.x, v.y, v.z);
    return result;
  };
  const vec = ([x, y, z]) => ({ x, y, z });
  el.setAttribute('position', vec(position));
  el.setAttribute('rotation', vec(rotation));
  el.setAttribute('scale', vec(scale));
  return el;
}

function aimCamera(position, target) {
  h.camera.position.set(...position);
  h.camera.lookAt(...target);
  h.camera.updateMatrixWorld(true);
}

// §9 example 1: the origin at (0,0,0), the member's box from (10,0.5,20) to
// (14,2,24), so the center is (12,1.25,22); the member's origin is not its
// geometric center either.
function farGroup(options = {}) {
  const g = posable(group(h.streetContainer), options);
  const member = posable(solid(g, [10, 0.5, 20], [14, 2, 24]));
  aimCamera([12, 14, 38], [12, 0, 22]);
  return { g, member };
}

function select(el) {
  h.inspector.selectEntity(el);
  h.frame();
  h.frame();
}

/** Look at the gizmo from above and in front, wherever it stands. */
function lookAtGizmo() {
  const at = worldOf(controls.moveGroup);
  aimCamera([at.x, at.y + 14, at.z + 16], [at.x, at.y, at.z]);
  h.frame();
  h.frame();
}

function toString3(v) {
  const q = (n) => Number(n.toFixed(3));
  return `${q(v.x)} ${q(v.y)} ${q(v.z)}`;
}

// ------------------------------------------------------------------ pointer

function screenOf(world) {
  const p = world.clone().project(h.camera);
  return { x: (p.x + 1) * 600, y: (1 - p.y) * 400 };
}

function worldOf(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

const offset = (at, dx, dy = 0) => ({ x: at.x + dx, y: at.y + dy });

function send(type, at, options = {}) {
  const {
    pointerType = 'mouse',
    detail = 1,
    timeStamp,
    coalesced,
    target = canvas
  } = options;
  const released = type === 'pointerup' || type === 'mouseup';
  const event = new MouseEvent(type, {
    clientX: at.x,
    clientY: at.y,
    button: 0,
    buttons: released || type === 'click' ? 0 : 1,
    detail,
    bubbles: true,
    cancelable: true
  });
  if (type.startsWith('pointer')) {
    Object.defineProperties(event, {
      pointerType: { value: pointerType },
      pointerId: { value: 1 },
      isPrimary: { value: true }
    });
  }
  if (timeStamp !== undefined) {
    Object.defineProperty(event, 'timeStamp', { value: timeStamp });
  }
  if (coalesced) {
    event.getCoalescedEvents = () =>
      coalesced.map(([x, y]) => ({ clientX: x, clientY: y }));
  }
  target.dispatchEvent(event);
  return event;
}

const isMouse = (options) => (options.pointerType || 'mouse') === 'mouse';

// A press as the browser delivers it: the pointer event, then (for a mouse)
// the compatibility mousedown carrying the click count, unless something
// cancelled the pointerdown, as a gizmo claiming the press does: that
// suppresses the compatibility mousedown and mouseup of the press, and the
// click still follows (Pointer Events, "PREVENT MOUSE EVENT flag").
let mouseSuppressed = false;
function press(at, options = {}) {
  mouseSuppressed = send('pointerdown', at, options).defaultPrevented;
  if (isMouse(options) && !mouseSuppressed) send('mousedown', at, options);
}

function move(at, options = {}) {
  send('pointermove', at, options);
}

function release(at, options = {}) {
  send('pointerup', at, options);
  if (isMouse(options)) {
    if (!mouseSuppressed) send('mouseup', at, options);
    send('click', at, options);
  }
  mouseSuppressed = false;
}

function clickAt(at, options = {}) {
  press(at, options);
  release(at, options);
}

function rayThrough(at) {
  controls.updateMouse({ clientX: at.x, clientY: at.y });
  return controls.raycaster.ray;
}

function onBoxOf(groupEl, at) {
  const box = getGroupBounds(groupEl);
  if (!box) return false;
  return (
    rayHitsGroupBox(rayThrough(at), box, groupEl.object3D.matrixWorld) !== null
  );
}

// Distance on screen from `p` to the segment a-b.
function segmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length2 = dx * dx + dy * dy;
  const t = length2
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length2))
    : 0;
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

// Distance on screen from `p` to the triangle a-b-c: 0 inside it.
function triangleDistance(p, a, b, c) {
  const side = (u, v) => (v.x - u.x) * (p.y - u.y) - (v.y - u.y) * (p.x - u.x);
  const s1 = side(a, b);
  const s2 = side(b, c);
  const s3 = side(c, a);
  const inside =
    (s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0);
  if (inside) return 0;
  return Math.min(
    segmentDistance(p, a, b),
    segmentDistance(p, b, c),
    segmentDistance(p, c, a)
  );
}

/**
 * How near to `centre` on screen the gizmo's `axis` control is drawn: no
 * nearer point can pick it. Zero when that cannot be told from its triangles
 * (a part behind the camera, or one that is not a mesh).
 */
function controlScreenDistance(axis, centre) {
  const camera = controls.camera;
  const view = camera.matrixWorld.clone().invert();
  const v = new THREE.Vector3();
  let nearest = Infinity;
  let bounded = true;
  for (const picker of controls.getPickers()) {
    picker.traverse((node) => {
      let owner = node;
      while (owner && !owner.userData.gizmoAxis) owner = owner.parent;
      if (owner?.userData.gizmoAxis !== axis || !node.geometry) return;
      const position = node.isMesh && node.geometry.attributes.position;
      if (!position) {
        bounded = false;
        return;
      }
      const screen = [];
      for (let i = 0; i < position.count; i++) {
        v.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
        if (v.clone().applyMatrix4(view).z >= -camera.near) bounded = false;
        screen.push(screenOf(v));
      }
      const index = node.geometry.index;
      const corner = (k) => screen[index ? index.getX(k) : k];
      const count = index ? index.count : position.count;
      for (let k = 0; k + 2 < count; k += 3) {
        nearest = Math.min(
          nearest,
          triangleDistance(centre, corner(k), corner(k + 1), corner(k + 2))
        );
      }
    });
  }
  return bounded && nearest !== Infinity ? nearest : 0;
}

/**
 * A screen point on the gizmo's `axis` control, over `groupEl`'s box or off
 * it as asked: the nearest to the pad, searched outwards in rings. Throws if
 * the scene offers none, so a test cannot pass on a point that is not where
 * it says.
 */
function handlePoint(axis, { overBoxOf = null, offBoxOf = null } = {}) {
  const centre = screenOf(worldOf(controls.moveGroup));
  // Picking is a raycast against every control, so the rings too near the
  // pad to reach this one are passed over without one (a point is rounded to
  // a whole pixel, at most a pixel from its ring).
  const from = Math.max(0, Math.floor(controlScreenDistance(axis, centre)) - 1);
  for (let r = from; r <= 240; r += 1) {
    for (let deg = 0; deg < 360; deg += r === 0 ? 360 : 5) {
      // Whole pixels, so a test's pixel offsets from here are exact.
      const at = {
        x: Math.round(centre.x + r * Math.cos(deg * DEG)),
        y: Math.round(centre.y + r * Math.sin(deg * DEG))
      };
      rayThrough(at);
      if (controls.pickAxis() !== axis) continue;
      if (overBoxOf && !onBoxOf(overBoxOf, at)) continue;
      if (offBoxOf && onBoxOf(offBoxOf, at)) continue;
      return at;
    }
  }
  throw new Error(`no point on the ${axis} control as asked`);
}

/** Where the pointer ray at `at` meets the horizontal plane y = `y`. */
function planePoint(at, y) {
  const hit = new THREE.Vector3();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y);
  expect(rayThrough(at).intersectPlane(plane, hit)).not.toBe(null);
  return hit;
}

function pad() {
  return handlePoint('move');
}

function history() {
  return h.inspector.history.undos.length;
}

function spyExecute() {
  const calls = [];
  const execute = h.inspector.execute;
  h.inspector.execute = (...args) => {
    const result = execute(...args);
    calls.push({ args, result });
    return result;
  };
  return calls;
}

function escape() {
  const event = new KeyboardEvent('keyup', { key: 'Escape', bubbles: true });
  Object.defineProperty(event, 'keyCode', { value: 27 });
  document.body.dispatchEvent(event);
}

// ------------------------------------------------------------------ tests

describe('the easy gizmo on a group', () => {
  it('stands on the bottom of the members at the center, not at the origin', () => {
    const { g } = farGroup();
    select(g);
    expect(controls.el).toBe(g);
    const at = worldOf(controls.moveGroup);
    expect(at.x).toBeCloseTo(12, 6);
    expect(at.y).toBeCloseTo(0.5, 6);
    expect(at.z).toBeCloseTo(22, 6);
  });

  it('moves its pad in the same frame the members move, with no event', () => {
    const { g, member } = farGroup();
    select(g);
    member.object3D.position.x = 3;
    let padX;
    h.frame(() => {
      padX = new THREE.Vector3().setFromMatrixPosition(
        controls.moveGroup.matrixWorld
      ).x;
    });
    expect(padX).toBeCloseTo(15, 6);
  });

  it('offers it in every transform mode, and the stock gizmo only to items', () => {
    const { g } = farGroup();
    const stock = h.inspector.sceneHelpers.children.find(
      (child) => child.isTransformControlsRoot
    ).controls;
    select(g);
    for (const mode of ['translate', 'rotate', 'scale']) {
      Events.emit('transformmodechange', mode);
      expect(controls.el).toBe(g);
      expect(stock.object).toBeUndefined();
    }
    const plain = posable(solid(h.streetContainer, [0, 0, 0], [1, 1, 1]));
    select(plain);
    Events.emit('transformmodechange', 'rotate');
    expect(stock.object).toBe(plain.object3D);
    expect([stock.showX, stock.showY, stock.showZ]).toEqual([true, true, true]);
    expect(controls.el).toBeUndefined();
  });

  it('moves at a constant height with no ground probe or landing targets, while an item follows a kerb', () => {
    aimCamera([0, 12, 14], [0, 0, 0]);
    // Ground with a 0.3 m step up at x = 1.
    [
      [-4, 0],
      [6, 0.3]
    ].forEach(([x, y]) => {
      const groundEl = document.createElement('a-entity');
      groundEl.setAttribute('street-segment', '');
      h.streetContainer.append(groundEl);
      const geometry = new THREE.PlaneGeometry(10, 20);
      geometry.rotateX(-Math.PI / 2);
      const ground = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      ground.position.set(x, y, 0);
      ground.el = groundEl;
      h.sceneEl.object3D.add(ground);
    });
    h.sceneEl.object3D.updateMatrixWorld(true);

    // A group floating 1 m up: an item there would be offered a landing.
    const g = posable(group(h.streetContainer), { position: [-1, 1, 0] });
    posable(solid(g, [-0.2, 0, -0.2], [0.2, 0.4, 0.2]));
    select(g);
    const probe = vi.spyOn(controls.probe, 'probeColumn');
    const start = pad();
    press(start);
    for (let i = 1; i <= 8; i++) {
      move(screenOf(new THREE.Vector3(-1 + i * 0.4, 1, 0)));
      h.frame();
      expect(g.object3D.position.y).toBe(1);
      expect(controls.landingDownGroup.visible).toBe(false);
      expect(controls.getPickers()).not.toContain(controls.landingDownGroup);
    }
    release(screenOf(new THREE.Vector3(2.2, 1, 0)));
    h.frame();
    expect(g.object3D.position.x).toBeGreaterThan(1.5);
    expect(g.object3D.position.y).toBe(1);
    expect(probe).not.toHaveBeenCalled();

    // The same drag on an ordinary item follows the step.
    const box = posable(
      solid(h.streetContainer, [-0.2, 0, -0.2], [0.2, 0.4, 0.2]),
      {
        position: [-1, 0, 0]
      }
    );
    select(box);
    press(pad());
    for (let i = 1; i <= 8; i++) {
      move(screenOf(new THREE.Vector3(-1 + i * 0.4, 0, 0)));
      h.frame();
    }
    release(screenOf(new THREE.Vector3(2.2, 0, 0)));
    h.frame();
    expect(box.object3D.position.x).toBeGreaterThan(1.5);
    expect(box.object3D.position.y).toBeCloseTo(0.3, 3);
  });

  it('measures nothing while it moves the group, holding its box until release', () => {
    const { g, member } = farGroup();
    select(g);
    const inSubtree = (object) => {
      for (let node = object; node; node = node.parent) {
        if (node === g.object3D) return true;
      }
      return false;
    };
    // Bounds are measured with traverseVisible; a box re-measured from the
    // meshes goes through expandByObject.
    const walks = vi.spyOn(THREE.Object3D.prototype, 'traverseVisible');
    const expands = vi.spyOn(THREE.Box3.prototype, 'expandByObject');
    const measured = () =>
      walks.mock.contexts.filter(inSubtree).length +
      expands.mock.calls.filter(([object]) => inSubtree(object)).length;

    const start = pad();
    press(start);
    move(offset(start, 3));
    expect(controls.isDragging).toBe(true);
    const offsetX = worldOf(controls.moveGroup).x - g.object3D.position.x;
    for (let i = 1; i <= 10; i++) {
      move(offset(start, 3 + i * 8));
      h.frame();
      expect(worldOf(controls.moveGroup).x - g.object3D.position.x).toBeCloseTo(
        offsetX,
        6
      );
    }
    expect(g.object3D.position.x).not.toBe(0);
    expect(measured()).toBe(0);

    // A member moved during the gesture shows once it ends.
    member.object3D.position.z = 2;
    release(offset(start, 83));
    h.frame();
    expect(walks.mock.contexts.filter((c) => c === g.object3D)).toHaveLength(1);
    expect(worldOf(controls.moveGroup).z).toBeCloseTo(24, 6);
  });

  it('turns about the center held from the press, even when a member moves meanwhile', () => {
    const { g, member } = farGroup();
    select(g);
    const at = handlePoint('rotate');
    press(at);
    move(offset(at, 0, 4));
    expect(controls.isDragging).toBe(true);
    expect(controls.axis).toBe('rotate');
    member.object3D.position.x = 6;
    for (let i = 1; i <= 3; i++) {
      move(offset(at, i * 15, 4));
      h.frame();
      // Positions are written to the millimetre.
      const arc = worldOf(controls.arcGroup);
      expect(arc.x).toBeCloseTo(12, 3);
      expect(arc.z).toBeCloseTo(22, 3);
    }
    // The pivot really is still: the group's own transform keeps it there.
    g.object3D.updateMatrixWorld(true);
    const pivot = new THREE.Vector3(12, 1.25, 22);
    expect(
      pivot.clone().applyMatrix4(g.object3D.matrixWorld).distanceTo(pivot)
    ).toBeLessThan(0.002);
    release(offset(at, 45, 4));
    h.frame();
    h.frame();
    // Released: the pad follows the members' new box.
    const center = getGroupBounds(g)
      .getCenter(new THREE.Vector3())
      .applyMatrix4(g.object3D.matrixWorld);
    const arc = worldOf(controls.arcGroup);
    expect(arc.x).toBeCloseTo(center.x, 5);
    expect(arc.z).toBeCloseTo(center.z, 5);
    expect(Math.hypot(arc.x - 12, arc.z - 22)).toBeGreaterThan(1);
  });

  it('turns 90 degrees about the center in one undo step, from the rounded yaw, without touching members', () => {
    const { g, member } = farGroup();
    select(g);
    const calls = spyExecute();
    const before = history();
    const centre = new THREE.Vector3(12, 0.5, 22);

    const turnTo = (degrees) => {
      const at = handlePoint('rotate');
      const grab = planePoint(at, 0.5).sub(centre);
      const angle = Math.atan2(grab.x, grab.z) + degrees * DEG;
      const radius = Math.hypot(grab.x, grab.z);
      const target = screenOf(
        new THREE.Vector3(
          centre.x + radius * Math.sin(angle),
          0.5,
          centre.z + radius * Math.cos(angle)
        )
      );
      press(at);
      move(offset(at, 0, 3));
      move(target);
      release(target);
    };

    turnTo(90);
    expect(history()).toBe(before + 1);
    expect(calls).toHaveLength(1);
    expect(calls[0].args[0]).toBe('multi');
    expect(calls[0].result).not.toBe(TRANSFORM_REFUSED);
    const expected = positionForRotationAboutCenter(
      new THREE.Vector3(0, 0, 0),
      new THREE.Quaternion(),
      new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        90 * DEG
      ),
      new THREE.Vector3(12, 1.25, 22),
      new THREE.Vector3()
    );
    const changes = Object.fromEntries(
      calls[0].args[1].map(([, c]) => [c.component, c.value])
    );
    expect(changes.rotation).toBe('0 90 0');
    expect(changes.position).toBe(toString3(expected));
    expect(g.getAttribute('rotation')).toEqual({ x: 0, y: 90, z: 0 });
    expect(member.getAttribute('position')).toEqual({ x: 0, y: 0, z: 0 });
    expect(member.getAttribute('rotation')).toEqual({ x: 0, y: 0, z: 0 });
    // The center did not move.
    g.object3D.updateMatrixWorld(true);
    const centerNow = new THREE.Vector3(12, 1.25, 22).applyMatrix4(
      g.object3D.matrixWorld
    );
    expect(centerNow.distanceTo(new THREE.Vector3(12, 1.25, 22))).toBeLessThan(
      0.002
    );

    h.inspector.history.undo();
    expect(g.getAttribute('position')).toEqual({ x: 0, y: 0, z: 0 });
    expect(g.getAttribute('rotation')).toEqual({ x: 0, y: 0, z: 0 });
    h.frame();
    h.frame();

    // Turned out and back to 0.004 degrees: the pose it started with, and
    // no undo entry.
    const undos = history();
    turnTo(0.004);
    expect(history()).toBe(undos);
    expect(g.getAttribute('position')).toEqual({ x: 0, y: 0, z: 0 });
    expect(g.getAttribute('rotation')).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('moves and yaws a pitched group, keeping its pitch and roll exactly, and restores them on Escape', () => {
    const { g } = farGroup({ rotation: [10.123456, 30, -0.000789] });
    select(g);
    lookAtGizmo();
    const calls = spyExecute();

    const drag = (at, to) => {
      press(at);
      move(offset(at, 0, 3));
      move(to);
      release(to);
      h.frame();
      h.frame();
    };
    let at = handlePoint('rotate');
    drag(at, offset(at, 40, 20));
    at = pad();
    drag(at, offset(at, 30, 0));

    expect(calls.map((c) => c.args[0])).toEqual(['multi', 'multi']);
    expect(calls.map((c) => c.result)).toEqual([undefined, undefined]);
    const rotation = g.getAttribute('rotation');
    expect(rotation.x).toBe(10.123456);
    expect(rotation.z).toBe(-0.000789);
    expect(rotation.y).not.toBe(30);

    const yawed = { ...rotation };
    const position = { ...g.getAttribute('position') };
    at = handlePoint('rotate');
    press(at);
    move(offset(at, 0, 3));
    move(offset(at, 50, 10));
    expect(g.getAttribute('rotation').y).not.toBe(yawed.y);
    escape();
    expect(controls.isDragging).toBe(false);
    expect(g.getAttribute('rotation')).toEqual(yawed);
    expect(g.getAttribute('position')).toEqual(position);
    expect(calls).toHaveLength(2);
  });

  it('commits nothing for an item turned and released where it started, whatever its unrounded yaw', () => {
    aimCamera([0, 12, 14], [0, 0, 0]);
    const tree = posable(
      solid(h.streetContainer, [-0.3, 0, -0.3], [0.3, 1, 0.3]),
      {
        rotation: [0, 30.123456, 0]
      }
    );
    select(tree);
    const commits = [];
    controls.addEventListener('commitDrag', (event) => commits.push(event));
    const at = handlePoint('rotate');
    press(at);
    move(offset(at, 25, 5));
    move(at);
    release(at);
    expect(commits).toHaveLength(1);
    for (const change of commits[0].changes) {
      expect(change.value).toBe(change.oldValue);
    }
  });

  it('moves and yaws an empty group about its origin, one undo step each, with a finite pad', () => {
    aimCamera([3, 12, 12], [3, 1.5, -2]);
    const g = posable(group(h.streetContainer), { position: [3, 1.5, -2] });
    select(g);
    const at = worldOf(controls.moveGroup);
    expect([at.x, at.y, at.z]).toEqual(
      [3, 1.5, -2].map((v) => expect.closeTo(v, 6))
    );
    const before = history();

    let from = pad();
    press(from);
    move(offset(from, 3));
    move(offset(from, 40));
    h.frame();
    release(offset(from, 40));
    h.frame();
    h.frame();
    expect(history()).toBe(before + 1);
    expect(g.object3D.position.y).toBe(1.5);
    const moved = g.getAttribute('position');
    expect(moved.x).not.toBe(3);

    from = handlePoint('rotate');
    press(from);
    move(offset(from, 0, 3));
    move(offset(from, 40, 20));
    release(offset(from, 40, 20));
    expect(history()).toBe(before + 2);
    expect(g.getAttribute('rotation').y).not.toBe(0);
    // About its own origin: the position is where the move left it.
    expect(g.getAttribute('position')).toEqual(moved);
  });
});

describe('a press on a group handle', () => {
  it('opens the selected group on a two-second press that moves at most 0.8 px, with no history, by timestamps and by the clock', () => {
    vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout'] });
    const { g } = farGroup();
    select(g);
    const before = history();
    const at = handlePoint('move', { overBoxOf: g });
    const t0 = performance.now();
    press(at, { timeStamp: t0 });
    vi.advanceTimersByTime(1000);
    move(offset(at, 0.5, 0.6), { timeStamp: t0 + 1000 });
    vi.advanceTimersByTime(1000);
    move(offset(at, 0.8, 0), { timeStamp: t0 + 2000 });
    release(offset(at, 0.8, 0), { timeStamp: t0 + 2000 });
    expect(h.openIds()).toEqual([g.id]);
    expect(h.inspector.selectedEntity).toBe(g);
    expect(history()).toBe(before);
    expect(g.getAttribute('position')).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('resolves a still click on the pad once, even right after a canvas click at the same spot', () => {
    const { g, member } = farGroup();
    select(g);
    const at = handlePoint('move', { overBoxOf: g });
    const ray = rayThrough(at);
    h.aim(ray.origin.toArray(), ray.direction.toArray());
    h.poll();
    // A plain canvas click at the spot (no gizmo press): it opens the group.
    send('mousedown', at);
    send('mouseup', at);
    expect(h.openIds()).toEqual([g.id]);
    h.scope.close(g);
    h.frame();
    expect(h.inspector.selectedEntity).toBe(g);
    // The same spot through the pad: opened once, and the release that the
    // canvas also receives does not resolve the press again (which would now
    // select the member inside).
    clickAt(at);
    expect(h.openIds()).toEqual([g.id]);
    expect(h.inspector.selectedEntity).toBe(g);
    expect(h.inspector.selectedEntity).not.toBe(member);
  });

  it('drags rather than opens when a coalesced sample went 2 px out, though every event reported 0 px', () => {
    const { g } = farGroup();
    select(g);
    const at = handlePoint('move', { overBoxOf: g });
    press(at);
    move(at, { coalesced: [[at.x + 1.5, at.y + 1.5]] });
    expect(controls.isDragging).toBe(true);
    release(at);
    expect(h.openIds()).toEqual([]);
  });

  it.each(['mouse', 'touch'])(
    'treats 3 px out and exactly back as a drag that never opens, and moves nothing below 2 px (%s)',
    (pointerType) => {
      const { g } = farGroup();
      select(g);
      const before = history();
      const at = handlePoint('move', { overBoxOf: g });
      press(at, { pointerType });
      move(offset(at, 1.9), { pointerType });
      h.frame();
      expect(controls.isDragging).toBe(false);
      expect(g.object3D.position.x).toBe(0);
      move(offset(at, 3), { pointerType });
      expect(controls.isDragging).toBe(true);
      h.frame();
      expect(g.object3D.position.x).not.toBe(0);
      move(at, { pointerType });
      release(at, { pointerType });
      h.frame();
      h.frame();
      expect(h.openIds()).toEqual([]);
      expect(h.inspector.selectedEntity).toBe(g);
      expect(g.getAttribute('position')).toEqual({ x: 0, y: 0, z: 0 });
      expect(history()).toBe(before);
    }
  );

  it('opens on a still touch press as on a mouse click', () => {
    const { g } = farGroup();
    select(g);
    const at = handlePoint('move', { overBoxOf: g });
    clickAt(at, { pointerType: 'touch' });
    expect(h.openIds()).toEqual([g.id]);
  });

  it('does nothing on a still click on a handle off the box, even over another entity, and drags from 2 px', () => {
    aimCamera([0, 10, 12], [0, 0, 0]);
    const g = posable(group(h.streetContainer));
    posable(solid(g, [-0.15, 0, -0.15], [0.15, 0.3, 0.15]));
    select(g);
    const at = handlePoint('rotate', { offBoxOf: g });
    // Another entity right under that spot.
    const under = planePoint(at, 0);
    const other = posable(
      solid(
        h.streetContainer,
        [under.x - 0.05, -0.05, under.z - 0.05],
        [under.x + 0.05, 0, under.z + 0.05]
      )
    );
    h.frame();
    const selections = [];
    Events.on('objectselect', (object) => selections.push(object));
    clickAt(at);
    expect(h.inspector.selectedEntity).toBe(g);
    expect(h.inspector.selectedEntity).not.toBe(other);
    expect(selections).toEqual([]);
    expect(h.openIds()).toEqual([]);

    press(at);
    move(offset(at, 1.99));
    expect(controls.isDragging).toBe(false);
    move(offset(at, 2));
    expect(controls.isDragging).toBe(true);
    release(offset(at, 2));
  });

  it('on an open, selected group falls through to the member beneath, once, and still drags from 2 px', () => {
    const { g, member } = farGroup();
    select(g);
    h.scope.open(g);
    h.frame();
    expect(controls.el).toBe(g);
    const selections = [];
    Events.on('objectselect', (object) => selections.push(object));
    const at = handlePoint('move');
    clickAt(at);
    expect(h.inspector.selectedEntity).toBe(member);
    expect(selections).toEqual([member.object3D]);
    expect(h.openIds()).toEqual([g.id]);

    select(g);
    const before = history();
    const from = handlePoint('move');
    press(from);
    move(offset(from, 30));
    release(offset(from, 30));
    h.frame();
    h.frame();
    expect(history()).toBe(before + 1);
    expect(h.inspector.selectedEntity).toBe(g);
  });

  it('on a selected closed group inside an open one: opens it over its box, and does nothing off it over a sibling', () => {
    aimCamera([0, 10, 12], [0, 0, 0]);
    const a = posable(group(h.streetContainer));
    const b = posable(group(a));
    posable(solid(b, [-0.15, 0, -0.15], [0.15, 0.3, 0.15]));
    select(a);
    h.scope.open(a);
    select(b);
    expect(h.openIds()).toEqual([a.id]);
    const off = handlePoint('rotate', { offBoxOf: b });
    const under = planePoint(off, 0);
    const sibling = posable(
      solid(
        a,
        [under.x - 0.05, -0.05, under.z - 0.05],
        [under.x + 0.05, 0, under.z + 0.05]
      )
    );
    h.frame();
    h.frame();
    clickAt(off);
    expect(h.inspector.selectedEntity).toBe(b);
    expect(h.inspector.selectedEntity).not.toBe(sibling);
    expect(h.openIds()).toEqual([a.id]);

    clickAt(handlePoint('move', { overBoxOf: b }));
    expect(h.openIds()).toEqual([a.id, b.id]);
    expect(h.inspector.selectedEntity).toBe(b);
  });

  it('does not frame after an open and a select-member made by two quick clicks on the pad', () => {
    const { g, member } = farGroup();
    select(g);
    const at = handlePoint('move', { overBoxOf: g });
    clickAt(at, { detail: 1 });
    expect(h.openIds()).toEqual([g.id]);
    clickAt(at, { detail: 2 });
    expect(h.inspector.selectedEntity).toBe(member);
    send('dblclick', at, { detail: 2 });
    expect(focused).toEqual([]);
    expect(teleported).toEqual([]);

    flags.streetLevel = true;
    select(g);
    h.scope.close(g);
    h.frame();
    const again = handlePoint('move', { overBoxOf: g });
    clickAt(again, { detail: 1 });
    clickAt(again, { detail: 2 });
    send('dblclick', again, { detail: 2 });
    expect(teleported).toEqual([]);
  });

  it('opens once on a still mouse release that no click event follows, when the release is over, and not before', async () => {
    const { g } = farGroup();
    select(g);
    const at = handlePoint('move', { overBoxOf: g });
    press(at);
    send('pointerup', at);
    // The count comes with the click event; without one, the release's task
    // ends first.
    expect(h.openIds()).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.openIds()).toEqual([g.id]);
    expect(h.inspector.selectedEntity).toBe(g);
  });

  it('frames as usual on a double-click on a handle that entered nothing', () => {
    aimCamera([0, 10, 12], [0, 0, 0]);
    const g = posable(group(h.streetContainer));
    posable(solid(g, [-0.15, 0, -0.15], [0.15, 0.3, 0.15]));
    select(g);
    const at = handlePoint('rotate', { offBoxOf: g });
    clickAt(at, { detail: 1 });
    clickAt(at, { detail: 2 });
    send('dblclick', at, { detail: 2 });
    expect(focused).toEqual([g.object3D]);
  });
});

describe('Escape and lost presses on a group handle', () => {
  function nested() {
    const { g: outer, member } = farGroup();
    const inner = posable(group(outer));
    posable(solid(inner, [11, 0.5, 21], [13, 1.5, 23]));
    select(outer);
    h.scope.open(outer);
    select(inner);
    return { outer, inner, member };
  }

  it('cancels a group rotate without a command or a scope change; the next Escape leaves one level', () => {
    const { outer, inner } = nested();
    const calls = spyExecute();
    const pose = {
      position: { ...inner.getAttribute('position') },
      rotation: { ...inner.getAttribute('rotation') }
    };
    const at = handlePoint('rotate');
    press(at);
    move(offset(at, 0, 3));
    move(offset(at, 40, 10));
    expect(inner.getAttribute('rotation')).not.toEqual(pose.rotation);
    escape();
    expect(inner.getAttribute('rotation')).toEqual(pose.rotation);
    expect(inner.getAttribute('position')).toEqual(pose.position);
    expect(calls).toEqual([]);
    expect(h.openIds()).toEqual([outer.id]);
    expect(h.inspector.selectedEntity).toBe(inner);
    escape();
    expect(h.openIds()).toEqual([]);
  });

  it('lets go of a held press on Escape without leaving a level, and the release then opens nothing', () => {
    const { outer, inner } = nested();
    const at = handlePoint('move', { overBoxOf: inner });
    press(at);
    escape();
    expect(h.openIds()).toEqual([outer.id]);
    expect(h.inspector.selectedEntity).toBe(inner);
    release(at);
    expect(h.openIds()).toEqual([outer.id]);
    escape();
    expect(h.openIds()).toEqual([]);
  });

  it.each([
    ['blur', () => window.dispatchEvent(new Event('blur'))],
    ['pointercancel', (at) => send('pointercancel', at)],
    ['a tool switch', () => h.inspector.selectEntity(null)]
  ])(
    'forgets a held press and its magenta box on %s, and the release opens nothing',
    (_, lose) => {
      const { g } = farGroup();
      select(g);
      const at = handlePoint('move', { overBoxOf: g });
      press(at);
      expect(h.groupHoverBox.visible).toBe(true);
      expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.4);
      lose(at);
      expect(h.groupHoverBox.visible).toBe(false);
      expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.3);
      release(at);
      expect(h.openIds()).toEqual([]);
    }
  );
});

describe('the magenta box during a press', () => {
  it.each(['mouse', 'touch'])(
    'shows stronger through a still press over the box and clears at 2 px (%s)',
    (pointerType) => {
      const { g } = farGroup();
      select(g);
      const at = handlePoint('move', { overBoxOf: g });
      press(at, { pointerType });
      expect(h.groupHoverBox.visible).toBe(true);
      expect(h.groupHoverBox.object).toBe(g.object3D);
      expect(h.groupHoverBox.boxFill.material.color.getHex()).toBe(0x880088);
      expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.4);
      move(offset(at, 1), { pointerType });
      expect(h.groupHoverBox.visible).toBe(true);
      move(offset(at, 2), { pointerType });
      expect(h.groupHoverBox.visible).toBe(false);
      expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.3);
      release(offset(at, 2), { pointerType });
    }
  );

  it('clears on release, when the group opens', () => {
    const { g } = farGroup();
    select(g);
    const at = handlePoint('move', { overBoxOf: g });
    press(at, { pointerType: 'touch' });
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.4);
    release(at, { pointerType: 'touch' });
    expect(h.openIds()).toEqual([g.id]);
    expect(h.groupHoverBox.visible).toBe(false);
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.3);
  });

  it('is not shown for a press on a handle off the box', () => {
    aimCamera([0, 10, 12], [0, 0, 0]);
    const g = posable(group(h.streetContainer));
    posable(solid(g, [-0.15, 0, -0.15], [0.15, 0.3, 0.15]));
    select(g);
    const at = handlePoint('rotate', { offBoxOf: g });
    press(at, { pointerType: 'touch' });
    expect(h.groupHoverBox.visible).toBe(false);
    release(at, { pointerType: 'touch' });
  });

  it('shows with the hovered handle over the box, both at once; red hover on an item is unchanged', () => {
    const { g } = farGroup();
    select(g);
    const at = handlePoint('move', { overBoxOf: g });
    move(at);
    expect(controls.axis).toBe('move');
    expect(controls.materials.move.flat.opacity).toBeCloseTo(OPACITY_HOVER, 6);
    const ray = rayThrough(at);
    h.aim(ray.origin.toArray(), ray.direction.toArray());
    h.poll();
    expect(h.groupHoverBox.visible).toBe(true);
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.3);
    expect(controls.axis).toBe('move');

    press(at);
    expect(controls.materials.move.flat.opacity).toBeCloseTo(OPACITY_ACTION, 6);
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.4);
    // The hover poll during a still press leaves the pressed box alone.
    h.poll();
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.4);
    release(at);

    const plain = posable(solid(h.streetContainer, [30, 0, 30], [31, 1, 31]));
    h.scope.close(null);
    h.frame();
    h.aimDown(30.5, 30.5);
    h.poll();
    expect(h.hoverBox.visible).toBe(true);
    expect(h.hoverBox.object).toBe(plain.object3D);
    expect(h.hoverBox.material.color.getHex()).toBe(0xff0000);
  });
});

describe('hiding the selected group', () => {
  it('takes its handles away and gives them back when shown', () => {
    const { g } = farGroup();
    g.setAttribute('visible', true);
    select(g);
    expect(controls.el).toBe(g);
    h.inspector.execute('entityupdate', {
      entity: g,
      component: 'visible',
      value: false
    });
    expect(h.inspector.selectedEntity).toBe(g);
    expect(controls.el).toBeUndefined();
    h.inspector.history.undo();
    expect(controls.el).toBe(g);
  });
});

describe('an ordinary item under the easy gizmo', () => {
  it('stays selected after a still click on its pad, and a press on the pad drags at once with no handle events', () => {
    aimCamera([0, 12, 14], [0, 0, 0]);
    const box = posable(
      solid(h.streetContainer, [-0.3, 0, -0.3], [0.3, 1, 0.3])
    );
    select(box);
    const handles = [];
    ['handlePress', 'handleClick', 'handlePressEnd'].forEach((type) =>
      controls.addEventListener(type, (event) => handles.push(event.type))
    );
    const at = pad();
    clickAt(at);
    h.frame();
    expect(controls.isDragging).toBe(false);
    expect(h.inspector.selectedEntity).toBe(box);
    // A press on an item's handle is a drag at once.
    press(at);
    expect(controls.isDragging).toBe(true);
    move(offset(at, 1));
    release(offset(at, 1));
    h.frame();
    expect(controls.isDragging).toBe(false);
    expect(handles).toEqual([]);
  });
});

describe('camera focus on a group', () => {
  it('aims at the center and frames the members, a batched one included; an empty group from its origin', () => {
    const g = posable(group(h.streetContainer), { position: [5, 0, 5] });
    posable(solid(g, [38, 0, -1], [42, 2, 1]));
    const batched = posable(item(g));
    batched.object3D._batchLocalBbox = new THREE.Box3(
      new THREE.Vector3(38, 0, 6),
      new THREE.Vector3(40, 3, 8)
    );
    h.sceneEl.object3D.updateMatrixWorld(true);
    Events.emit('objectfocus', g.object3D);
    const [target, frame] = focus.calls.at(-1);
    expect(target).toBe(g.object3D);
    const box = new THREE.Box3(
      new THREE.Vector3(38, 0, -1),
      new THREE.Vector3(42, 3, 8)
    );
    const center = box
      .getCenter(new THREE.Vector3())
      .add(new THREE.Vector3(5, 0, 5));
    expect(frame.center.distanceTo(center)).toBeLessThan(1e-9);
    for (let i = 0; i < 8; i++) {
      const corner = new THREE.Vector3(
        i & 1 ? 42 : 38,
        i & 2 ? 3 : 0,
        i & 4 ? 8 : -1
      ).add(new THREE.Vector3(5, 0, 5));
      expect(corner.distanceTo(frame.center)).toBeLessThanOrEqual(
        frame.radius + 1e-9
      );
    }
    expect(frame.radius).toBeLessThan(
      box.getSize(new THREE.Vector3()).length()
    );

    const empty = posable(group(h.streetContainer), { position: [-7, 1, 2] });
    h.sceneEl.object3D.updateMatrixWorld(true);
    Events.emit('objectfocus', empty.object3D);
    const [, emptyFrame] = focus.calls.at(-1);
    expect(emptyFrame.radius).toBe(null);
    expect(emptyFrame.center.toArray()).toEqual([-7, 1, 2]);

    const plain = posable(solid(h.streetContainer, [0, 0, 0], [1, 1, 1]));
    Events.emit('objectfocus', plain.object3D);
    expect(focus.calls.at(-1)).toEqual([plain.object3D]);
  });
});
