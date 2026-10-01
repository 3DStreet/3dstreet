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
import { formatGesturePose } from '@/editor/lib/gizmos/easyGizmoMath.js';
import { group, item, mountEditor, posable, solid } from './_editorHarness.js';

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

// `detail` is the click count, which the browser puts on mousedown, mouseup
// and click. Chrome's pointer events carry 0 (the pad double-click trace:
// pointerdown 0 > pointerup 0 > click 1 > pointerdown 0 > pointerup 0 >
// click 2 > dblclick 2), so a gizmo that read the count off a pointer event
// would see 0 here too.
// A move carries button -1 (no button changed), as the browser sends it; the
// stock transform control moves only for that.
function send(type, at, options = {}) {
  const {
    pointerType = 'mouse',
    pointerId = 1,
    isPrimary = true,
    detail = 1,
    timeStamp,
    coalesced,
    target = canvas
  } = options;
  const pointer = type.startsWith('pointer') || type === 'lostpointercapture';
  const released = type === 'pointerup' || type === 'mouseup';
  const event = new MouseEvent(type, {
    clientX: at.x,
    clientY: at.y,
    button: type === 'pointermove' ? -1 : 0,
    buttons: released || type === 'click' ? 0 : 1,
    detail: pointer ? 0 : detail,
    bubbles: true,
    cancelable: true
  });
  if (pointer) {
    Object.defineProperties(event, {
      pointerType: { value: pointerType },
      pointerId: { value: pointerId },
      isPrimary: { value: isPrimary }
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
// click still follows (Pointer Events, "PREVENT MOUSE EVENT flag"). A touch
// sends touchstart after its pointerdown and touchend after its pointerup,
// and no mouse events or click: the A-Frame cursor cancels the touch.
let mouseSuppressed = false;
function touch(type, options) {
  (options.target || canvas).dispatchEvent(
    new TouchEvent(type, { bubbles: true, cancelable: true })
  );
}

function press(at, options = {}) {
  mouseSuppressed = send('pointerdown', at, options).defaultPrevented;
  if (isMouse(options)) {
    if (!mouseSuppressed) send('mousedown', at, options);
  } else if (options.pointerType === 'touch') {
    touch('touchstart', options);
  }
}

function move(at, options = {}) {
  send('pointermove', at, options);
}

function release(at, options = {}) {
  send('pointerup', at, options);
  if (isMouse(options)) {
    if (!mouseSuppressed) send('mouseup', at, options);
    send('click', at, options);
  } else if (options.pointerType === 'touch') {
    touch('touchend', options);
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

  it('moves its pad in the same frame the members move, with no event, onto their new bottom (fails with a box read once at attach)', () => {
    const { g, member } = farGroup();
    select(g);
    // Across and up: the center gives the pad's X, the box's bottom its Y.
    member.object3D.position.set(3, 2, 0);
    let pad;
    h.frame(() => {
      pad = new THREE.Vector3().setFromMatrixPosition(
        controls.moveGroup.matrixWorld
      );
    });
    expect(pad.x).toBeCloseTo(15, 6);
    expect(pad.y).toBeCloseTo(2.5, 6);
  });

  it('gives a group its own stock control at its center in Advanced move and rotate, Y ring alone, a placeholder in scale and the easy gizmo in easy; items keep theirs (fails on handles at the origin, or a setting given to one control only)', () => {
    const { g } = farGroup();
    const stock = groupStock();
    const item = itemStock();
    expect(stock).not.toBe(item);
    const center = new THREE.Vector3(12, 1.25, 22);
    select(g);
    const axes = (control) => [control.showX, control.showY, control.showZ];

    for (const mode of ['translate', 'rotate']) {
      advanced(mode);
      expect(stock.object).toBe(stockGesture().handleAnchor);
      expect(stock.mode).toBe(mode);
      expect(stock.worldPosition.distanceTo(center)).toBeLessThan(1e-6);
      expect(axes(stock)).toEqual(
        mode === 'rotate' ? [false, true, false] : [true, true, true]
      );
      expect(item.object).toBeUndefined();
      expect(controls.el).toBeUndefined();
    }

    advanced('scale');
    expect(stock.object).toBeUndefined();
    expect(item.object).toBeUndefined();
    const placeholder = h.inspector.groupScope.affordances.scalePlaceholder;
    expect(placeholder.visible).toBe(true);
    expect(worldOf(placeholder).distanceTo(center)).toBeLessThan(1e-6);

    advanced('easy');
    expect(controls.el).toBe(g);
    expect(stock.object).toBeUndefined();
    expect(placeholder.visible).toBe(false);

    // Into rotate with an item selected, then the group selected: the group's
    // axes are set on that route too, and the item's never come from them.
    const plain = posable(solid(h.streetContainer, [0, 0, 0], [1, 1, 1]));
    select(plain);
    advanced('rotate');
    expect(item.object).toBe(plain.object3D);
    expect(axes(item)).toEqual([true, true, true]);
    expect(stock.object).toBeUndefined();
    select(g);
    expect(stock.object).toBe(stockGesture().handleAnchor);
    expect(axes(stock)).toEqual([false, true, false]);
    expect(item.object).toBeUndefined();
    select(plain);
    expect(item.object).toBe(plain.object3D);
    expect(axes(item)).toEqual([true, true, true]);
    expect(item.object).not.toBe(stockGesture().handleAnchor);

    // Every setting reaches both controls.
    Events.emit('transformspacechanged', 'local');
    Events.emit('translationsnapchanged', 0.25);
    Events.emit('rotationsnapchanged', Math.PI / 12);
    const second = new THREE.PerspectiveCamera(50, 1.5, 0.1, 500);
    Events.emit('cameratoggle', { camera: second, value: 'perspective' });
    for (const key of [
      'space',
      'translationSnap',
      'rotationSnap',
      'camera',
      'size'
    ]) {
      expect(stock[key]).toBe(item[key]);
    }
    expect(stock.space).toBe('local');
    expect(stock.camera).toBe(second);

    // Plan View hands back the perspective camera before its own tween: both
    // controls take it there too.
    const perspective = new THREE.PerspectiveCamera(50, 1.5, 0.1, 500);
    h.inspector.cameras = { perspective };
    h.inspector.controls.handlePlanViewRequest = vi.fn();
    Events.emit('cameratoggle', { camera: second, value: 'orthotop' });
    expect(h.inspector.controls.handlePlanViewRequest).toHaveBeenCalledTimes(1);
    expect(item.camera).toBe(perspective);
    expect(stock.camera).toBe(perspective);
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

  it.each(['segments-changed', 'alignment-changed', 'shape-geometry-changed'])(
    'keeps moving the group when a member sends %s, which ends a drag of an item (fails if geometry changing inside a group ends its gesture)',
    (type) => {
      const { g, member } = farGroup();
      select(g);
      const start = pad();
      press(start);
      move(offset(start, 3));
      expect(controls.isDragging).toBe(true);
      member.dispatchEvent(new Event(type, { bubbles: true }));
      expect(controls.isDragging).toBe(true);
      move(offset(start, 40));
      h.frame();
      release(offset(start, 40));
      h.frame();
      expect(g.object3D.position.x).not.toBe(0);
      expect(history()).toBe(1);

      // The same event ends the drag of an ordinary item.
      const box = posable(solid(h.streetContainer, [0, 0, 0], [1, 1, 1]), {
        position: [20, 0, 22]
      });
      select(box);
      lookAtGizmo();
      const itemStart = pad();
      press(itemStart);
      move(offset(itemStart, 3));
      expect(controls.isDragging).toBe(true);
      box.dispatchEvent(new Event(type, { bubbles: true }));
      expect(controls.isDragging).toBe(false);
      release(offset(itemStart, 3));
    }
  );

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
    // The center really is still: the group's own transform keeps it there.
    g.object3D.updateMatrixWorld(true);
    const groupCenter = new THREE.Vector3(12, 1.25, 22);
    expect(
      groupCenter
        .clone()
        .applyMatrix4(g.object3D.matrixWorld)
        .distanceTo(groupCenter)
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
    const center = new THREE.Vector3(12, 0.5, 22);

    const turnTo = (degrees) => {
      const at = handlePoint('rotate');
      const grab = planePoint(at, 0.5).sub(center);
      const angle = Math.atan2(grab.x, grab.z) + degrees * DEG;
      const radius = Math.hypot(grab.x, grab.z);
      const target = screenOf(
        new THREE.Vector3(
          center.x + radius * Math.sin(angle),
          0.5,
          center.z + radius * Math.cos(angle)
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
    // Read back as A-Frame does, through radians: not exactly the degrees
    // written, so compare with the reading before the gestures.
    const start = { ...g.getAttribute('rotation') };

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
    expect(rotation.x).toBe(start.x);
    expect(rotation.z).toBe(start.z);
    expect(rotation.y).not.toBe(start.y);

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

  it('puts a group back exactly where it started when a move or a turn is cancelled, unrounded yaw and position included (fails if a cancel restores the rounded pose)', () => {
    const { g } = farGroup({
      position: [0.123456, 0.000321, -0.987654],
      rotation: [0, 12.3456, 0]
    });
    select(g);
    lookAtGizmo();
    const calls = spyExecute();
    const start = {
      position: { ...g.getAttribute('position') },
      rotation: { ...g.getAttribute('rotation') }
    };
    for (const at of [pad(), handlePoint('rotate')]) {
      press(at);
      move(offset(at, 0, 3));
      move(offset(at, 40, 20));
      h.frame();
      expect(g.getAttribute('position')).not.toEqual(start.position);
      escape();
      expect(controls.isDragging).toBe(false);
      expect(g.getAttribute('position')).toEqual(start.position);
      expect(g.getAttribute('rotation')).toEqual(start.rotation);
      release(offset(at, 40, 20));
      h.frame();
    }
    expect(calls).toHaveLength(0);
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
    const moved = { ...g.getAttribute('position') };
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
  it('opens the selected group on a two-second press that moves at most 0.8 px, leaving nothing selected and no handles, with no history, by timestamps and by the clock', () => {
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
    expect(h.inspector.selectedEntity).toBe(null);
    expect(controls.el).toBeUndefined();
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
    h.groupScope.close(g);
    h.frame();
    expect(h.inspector.selectedEntity).toBe(g);
    // The same spot through the pad: opened once. The pad claims its press by
    // cancelling the pointerdown, so the canvas gets no mousedown or mouseup
    // to resolve it again with (which would now select the member inside).
    clickAt(at);
    expect(h.openIds()).toEqual([g.id]);
    expect(h.inspector.selectedEntity).toBe(null);
    expect(h.inspector.selectedEntity).not.toBe(member);
  });

  it('moves the group for a release far from the press with no pointer move between (fails if such a release is read as a click, or dropped)', () => {
    const { g } = farGroup();
    select(g);
    const calls = spyExecute();
    const start = pad();
    press(start);
    release(offset(start, 40));
    h.frame();
    h.frame();
    expect(g.object3D.position.x).not.toBe(0);
    expect(calls.map((c) => c.args[0])).toEqual(['multi']);
    expect(h.openIds()).toEqual([]);
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

  it('on a selected closed group inside an open one: opens it over its box, and does nothing off it over a sibling', () => {
    aimCamera([0, 10, 12], [0, 0, 0]);
    const a = posable(group(h.streetContainer));
    const b = posable(group(a));
    posable(solid(b, [-0.15, 0, -0.15], [0.15, 0.3, 0.15]));
    select(a);
    h.groupScope.open(a);
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
    expect(h.inspector.selectedEntity).toBe(null);
  });

  it('does not frame after an open on the pad and a select-member by the quick second click, which lands on the canvas', () => {
    // Opening deselects the group, so its handles go and the second press
    // reaches the canvas, where the cursor ray decides it.
    const aimCursorAt = (at) => {
      const ray = rayThrough(at);
      h.aim(ray.origin.toArray(), ray.direction.toArray());
      h.poll();
    };
    const { g, member } = farGroup();
    select(g);
    const at = handlePoint('move', { overBoxOf: g });
    clickAt(at, { detail: 1 });
    expect(h.openIds()).toEqual([g.id]);
    expect(h.inspector.selectedEntity).toBe(null);
    aimCursorAt(at);
    clickAt(at, { detail: 2 });
    expect(h.inspector.selectedEntity).toBe(member);
    send('dblclick', at, { detail: 2 });
    expect(focused).toEqual([]);
    expect(teleported).toEqual([]);

    flags.streetLevel = true;
    select(g);
    expect(h.openIds()).toEqual([]);
    const again = handlePoint('move', { overBoxOf: g });
    clickAt(again, { detail: 1 });
    aimCursorAt(again);
    clickAt(again, { detail: 2 });
    expect(h.inspector.selectedEntity).toBe(member);
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
    expect(h.inspector.selectedEntity).toBe(null);
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
    h.groupScope.open(outer);
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
    expect(h.inspector.selectedEntity).toBe(outer);
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
    expect(h.inspector.selectedEntity).toBe(outer);
  });

  it.each([
    ['blur', () => window.dispatchEvent(new Event('blur'))],
    ['pointercancel', (at) => send('pointercancel', at)],
    ['the selection being cleared', () => h.inspector.selectEntity(null)]
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

describe('a held press on a group handle when the editor is left', () => {
  it('is forgotten: back in the editor no press shows and nothing has opened (fails if leaving the editor keeps the press)', () => {
    const { g } = farGroup();
    select(g);
    const at = handlePoint('move', { overBoxOf: g });
    press(at);
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.4);
    useStore.getState().setIsInspectorEnabled(false);
    h.frame();
    release(at);
    useStore.getState().setIsInspectorEnabled(true);
    h.frame();
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.3);
    expect(h.openIds()).toEqual([]);
  });
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
    h.groupScope.close(null);
    h.frame();
    h.aimDown(30.5, 30.5);
    h.poll();
    expect(h.hoverBox.visible).toBe(true);
    expect(h.hoverBox.object).toBe(plain.object3D);
    expect(h.hoverBox.material.color.getHex()).toBe(0xff0000);
  });
});

describe('the boxes drawn around a group that moves or turns as a whole', () => {
  // A whole-group move leaves its bounds (measured in its own axes) unchanged,
  // so only the group's world pose says where its boxes belong.
  function expectOnGroup(helper, groupEl) {
    expect(helper.visible).toBe(true);
    expect(helper.object).toBe(groupEl.object3D);
    const helperPosition = new THREE.Vector3();
    const helperQuaternion = new THREE.Quaternion();
    const groupPosition = new THREE.Vector3();
    const groupQuaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    helper.matrixWorld.decompose(helperPosition, helperQuaternion, scale);
    groupEl.object3D.matrixWorld.decompose(
      groupPosition,
      groupQuaternion,
      scale
    );
    expect(helperPosition.distanceTo(groupPosition)).toBeLessThan(1e-9);
    // q and -q are the same turn.
    expect(Math.abs(helperQuaternion.dot(groupQuaternion))).toBeCloseTo(1, 9);
  }

  function expectSameBox(helper, other) {
    expect([...helper.geometry.attributes.position.array]).toEqual([
      ...other.geometry.attributes.position.array
    ]);
  }

  // The magenta box shown, by hover, over the selected closed group's box.
  function hoverToOpen(g) {
    h.aimDown(12, 22);
    h.poll();
    expect(h.groupHoverBox.visible).toBe(true);
    expect(h.groupHoverBox.object).toBe(g.object3D);
  }

  it('keeps the magenta box on the group in every frame of a pad drag, after release and after an undo (fails if it keeps the pose hover began with)', () => {
    const { g } = farGroup();
    select(g);
    hoverToOpen(g);
    const followed = () => {
      expectOnGroup(h.groupHoverBox, g);
      expectSameBox(h.groupHoverBox, h.selectionBox);
    };

    const at = pad();
    press(at);
    move(offset(at, 0, 3));
    for (let i = 1; i <= 4; i++) {
      move(offset(at, i * 50, 3));
      h.frame(followed);
    }
    release(offset(at, 200, 3));
    h.frame(followed);
    // It really moved, by metres.
    expect(g.object3D.position.length()).toBeGreaterThan(5);

    h.inspector.history.undo();
    h.frame(followed);
    expect(g.object3D.position.toArray()).toEqual([0, 0, 0]);
  });

  it('turns the magenta box with the group on the rotate arc, in the frame it turns (fails on a re-pose that copies the position only)', () => {
    const { g } = farGroup();
    select(g);
    hoverToOpen(g);
    const followed = () => {
      expectOnGroup(h.groupHoverBox, g);
      expectSameBox(h.groupHoverBox, h.selectionBox);
    };

    const center = new THREE.Vector3(12, 0.5, 22);
    const at = handlePoint('rotate');
    const grab = planePoint(at, 0.5).sub(center);
    const radius = Math.hypot(grab.x, grab.z);
    const towards = (degrees) => {
      const angle = Math.atan2(grab.x, grab.z) + degrees * DEG;
      return screenOf(
        new THREE.Vector3(
          center.x + radius * Math.sin(angle),
          0.5,
          center.z + radius * Math.cos(angle)
        )
      );
    };
    press(at);
    move(offset(at, 0, 3));
    for (const degrees of [30, 60, 90]) {
      move(towards(degrees));
      h.frame(followed);
    }
    release(towards(90));
    h.frame(followed);
    expect(g.getAttribute('rotation').y).toBeCloseTo(90, 1);
  });

  it('keeps the red hover on an unselected group that a redo moves, in the frame it moves (fails if only the magenta box follows)', () => {
    const { g } = farGroup();
    h.frame();
    // A move made while nothing is selected, undone, so a redo can make it
    // again without selecting anything.
    h.inspector.execute('entityupdate', {
      entity: g,
      component: 'position',
      value: '5 0 0',
      oldValue: '0 0 0'
    });
    h.inspector.history.undo();
    h.frame();
    h.aimDown(12, 22);
    h.poll();
    expect(h.inspector.selectedEntity).toBe(null);
    expect(h.hoverBox.visible).toBe(true);
    expect(h.hoverBox.object).toBe(g.object3D);

    h.inspector.history.redo();
    h.frame(() => expectOnGroup(h.hoverBox, g));
    expect(g.object3D.position.toArray()).toEqual([5, 0, 0]);
  });

  it('redraws a group box only in frames the group moved (fails if every frame redraws it)', () => {
    const { g } = farGroup();
    select(g);
    hoverToOpen(g);
    const update = vi.spyOn(Object.getPrototypeOf(h.selectionBox), 'update');

    // Moved with no event: the frame that draws it redraws both boxes.
    g.object3D.position.x += 1;
    h.frame(() => {
      expectOnGroup(h.selectionBox, g);
      expectOnGroup(h.groupHoverBox, g);
    });
    expect(update).toHaveBeenCalled();

    update.mockClear();
    for (let i = 0; i < 5; i++) h.frame();
    expect(update).not.toHaveBeenCalled();
  });

  it('re-poses the other boxes in a frame one of them fails to, and that one in the next frame (fails if one failure stops the rest, or for good)', () => {
    const { g } = farGroup();
    select(g);
    hoverToOpen(g);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    // The selection box is redrawn first, and throws this frame only. The
    // group moves in that frame alone, by a write nothing announces.
    h.selectionBox.update = () => {
      throw new Error('measuring failed');
    };
    g.object3D.position.x += 2;
    h.frame(() => {
      expectOnGroup(h.groupHoverBox, g);
    });
    expect(errors).toHaveBeenCalledTimes(1);
    delete h.selectionBox.update;

    h.frame(() => {
      expectOnGroup(h.selectionBox, g);
      expectOnGroup(h.groupHoverBox, g);
    });
    expect(errors).toHaveBeenCalledTimes(1);
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

// ------------------------------------------------------------ Advanced modes

const stockGesture = () => h.inspector.groupStockGesture;
const groupStock = () => stockGesture().controls;
const itemStock = () =>
  h.inspector.sceneHelpers.children.find(
    (child) => child.isTransformControlsRoot
  ).controls;

function advanced(mode) {
  Events.emit('transformmodechange', mode);
  h.frame();
  h.frame();
}

// The stock control's normalised pointer at a client point (the canvas is
// 1200 x 800 at the page's corner).
const ndc = (at) => ({ x: at.x / 600 - 1, y: 1 - at.y / 400, button: 0 });

/** Where the group's stock control stands on screen, as last laid out. */
function stockCentre() {
  return screenOf(groupStock().worldPosition.clone());
}

/**
 * A screen point on the group stock control's `axis` handle, over
 * `groupEl`'s box or off it as asked, at least `from` pixels from its center
 * (the selected group's marker covers the middle), searched outwards in
 * rings, as the control picks (against its handles as last laid out, along
 * the current camera's ray). Leaves the control's hover as it was. Throws if
 * there is none.
 */
function stockHandlePoint(
  axis,
  { overBoxOf = null, offBoxOf = null, from = 2 } = {}
) {
  const stock = groupStock();
  const hovered = stock.axis;
  const centre = stockCentre();
  try {
    for (let r = from; r <= 300; r += 2) {
      for (let deg = 0; deg < 360; deg += 4) {
        const at = {
          x: Math.round(centre.x + r * Math.cos(deg * DEG)),
          y: Math.round(centre.y + r * Math.sin(deg * DEG))
        };
        stock.pointerHover(ndc(at));
        if (stock.axis !== axis) continue;
        if (overBoxOf && !onBoxOf(overBoxOf, at)) continue;
        if (offBoxOf && onBoxOf(offBoxOf, at)) continue;
        return { ...at, centre };
      }
    }
  } finally {
    stock.axis = hovered;
  }
  throw new Error(`no point on the stock ${axis} handle as asked`);
}

/**
 * `px` pixels on from `at`, away from the control's center as it stood when
 * `at` was found (along an arrow).
 */
function along(at, px, centre = at.centre) {
  const dx = at.x - centre.x;
  const dy = at.y - centre.y;
  const length = Math.hypot(dx, dy);
  return { x: at.x + (dx / length) * px, y: at.y + (dy / length) * px };
}

/** `px` pixels on from `at`, across the line to that center (around a ring). */
function across(at, px, centre = at.centre) {
  const dx = at.x - centre.x;
  const dy = at.y - centre.y;
  const length = Math.hypot(dx, dy);
  return { x: at.x - (dy / length) * px, y: at.y + (dx / length) * px };
}

function aimCursorAt(at) {
  const ray = rayThrough(at);
  h.aim(ray.origin.toArray(), ray.direction.toArray());
  h.poll();
}

const copy = (v) => ({ x: v.x, y: v.y, z: v.z });

function worldOrigin(el) {
  el.object3D.updateMatrixWorld(true);
  return new THREE.Vector3().setFromMatrixPosition(el.object3D.matrixWorld);
}

describe('a group in the Advanced move and rotate modes', () => {
  it('commits a move with a long pause in it as one undo step, which undoes exactly, and moves for a release far from the press with no move between (fails if each change is recorded, or the release sample is dropped)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const g = posable(group(h.streetContainer), {
      position: [1.234, 0.5, -2.345]
    });
    posable(solid(g, [-1, 0, -1], [1, 1, 1]));
    aimCamera([1.234, 12, 12], [1.234, 0.5, -2.345]);
    select(g);
    advanced('translate');
    const calls = spyExecute();
    const before = history();

    let at = stockHandlePoint('X');
    press(at);
    move(along(at, 3));
    move(along(at, 60));
    h.frame();
    vi.setSystemTime(Date.now() + 700);
    move(along(at, 120));
    h.frame();
    release(along(at, 120));
    expect(history()).toBe(before + 1);
    expect(calls.map((c) => c.args[0])).toEqual(['multi']);
    expect(g.object3D.position.x).not.toBe(1.234);
    expect(g.object3D.position.y).toBe(0.5);
    expect(g.object3D.position.z).toBe(-2.345);

    h.inspector.history.undo();
    expect(copy(g.getAttribute('position'))).toEqual({
      x: 1.234,
      y: 0.5,
      z: -2.345
    });
    h.frame();
    h.frame();

    at = stockHandlePoint('X');
    press(at);
    release(along(at, 40));
    expect(history()).toBe(before + 1);
    expect(calls.map((c) => c.args[0])).toEqual(['multi', 'multi']);
    expect(g.object3D.position.x).not.toBe(1.234);

    // The release is a sample of its own: released further on than the last
    // move, the group goes further.
    h.frame();
    h.frame();
    at = stockHandlePoint('X');
    press(at);
    move(along(at, 3));
    move(along(at, 30));
    const lastMoved = g.object3D.position.x;
    release(along(at, 90));
    expect(Math.abs(g.object3D.position.x - lastMoved)).toBeGreaterThan(0.01);
  });

  it('records nothing for a move dragged out and back to its press point, whatever the unrounded position (fails if the before-value is not formatted as the commit is)', () => {
    const g = posable(group(h.streetContainer), {
      position: [1.23456, 0, -2.98765]
    });
    posable(solid(g, [-1, 0, -1], [1, 1, 1]));
    aimCamera([1.23, 12, 12], [1.23, 0, -3]);
    select(g);
    advanced('translate');
    const before = history();
    const at = stockHandlePoint('X');
    press(at);
    move(along(at, 3));
    move(along(at, 30));
    move(at);
    release(at);
    expect(history()).toBe(before);
  });

  it("moves nothing for a press whose ray misses the drag plane, then drags as usual from the next press (fails if a drag starts from the last drag's start point)", () => {
    const g = posable(group(h.streetContainer), { position: [1, 0, -2] });
    posable(solid(g, [-1, 0, -1], [1, 1, 1]));
    aimCamera([1, 12, 12], [1, 0, -2]);
    select(g);
    advanced('translate');
    const before = history();
    // A drag first, so the control holds a start point from it.
    let at = stockHandlePoint('X');
    press(at);
    move(along(at, 3));
    move(along(at, 40));
    release(along(at, 40));
    expect(history()).toBe(before + 1);
    h.frame();
    h.frame();
    const moved = copy(g.object3D.position);

    // A grazing ray: the press misses the control's plane, later samples hit.
    at = stockHandlePoint('X');
    const plane = groupStock()._plane;
    plane.raycast = () => {};
    press(at);
    move(along(at, 3));
    delete plane.raycast;
    move(along(at, 60));
    release(along(at, 60));
    expect(copy(g.object3D.position)).toEqual(moved);
    expect(history()).toBe(before + 1);

    h.frame();
    h.frame();
    at = stockHandlePoint('X');
    press(at);
    move(along(at, 3));
    move(along(at, 40));
    release(along(at, 40));
    expect(history()).toBe(before + 2);
    expect(g.object3D.position.x).not.toBe(moved.x);
  });

  // A pitched and rolled group, turned so its origin is far from its center.
  function pitchedGroup(position = [0, 0, 0]) {
    const g = posable(group(h.streetContainer), {
      position,
      rotation: [10.123456, 20.123456, -0.000789]
    });
    const member = posable(solid(g, [10, 0.5, 20], [14, 2, 24]));
    const centerLocal = new THREE.Vector3(12, 1.25, 22);
    g.object3D.updateMatrixWorld(true);
    const center = centerLocal.clone().applyMatrix4(g.object3D.matrixWorld);
    aimCamera([center.x, center.y + 14, center.z + 16], center.toArray());
    return { g, member, centerLocal, center };
  }

  function centerNow(g, centerLocal) {
    g.object3D.updateMatrixWorld(true);
    return centerLocal.clone().applyMatrix4(g.object3D.matrixWorld);
  }

  it('turns a pitched group about its center on the Y ring, keeping pitch and roll exactly, in one undo step that restores its pose (fails if it turns about the origin, or writes through the quaternion)', () => {
    const { g, member, centerLocal, center } = pitchedGroup();
    select(g);
    advanced('rotate');
    const calls = spyExecute();
    const before = history();
    const pose = formatGesturePose(g);
    const memberPose = {
      position: copy(member.getAttribute('position')),
      rotation: copy(member.getAttribute('rotation'))
    };
    // The two costs of turning from the rounded start yaw: the center is
    // displaced by the yaw rounded away, and positions are written to the
    // millimetre.
    const r = new THREE.Vector3()
      .setFromMatrixPosition(g.object3D.matrixWorld)
      .distanceTo(center);
    const y0 = 20.123456;
    const bound =
      (r * Math.abs(y0 - 20.12) * Math.PI) / 180 + Math.sqrt(3) * 5e-4 + 1e-9;

    const at = stockHandlePoint('Y');
    press(at);
    move(across(at, 3));
    let turned = 0;
    for (let step = 1; step <= 80 && turned < 85; step++) {
      move(across(at, 3 + step * 10));
      h.frame();
      expect(centerNow(g, centerLocal).distanceTo(center)).toBeLessThan(bound);
      turned = Math.abs(g.getAttribute('rotation').y - y0);
    }
    expect(turned).toBeGreaterThanOrEqual(85);
    release(across(at, 3 + 80 * 10));
    expect(centerNow(g, centerLocal).distanceTo(center)).toBeLessThan(bound);
    expect(history()).toBe(before + 1);
    expect(calls.map((c) => c.args[0])).toEqual(['multi']);
    const rotation = calls[0].args[1]
      .map(([, c]) => c)
      .find((c) => c.component === 'rotation');
    const [x, , z] = rotation.value.split(' ');
    const [x0, , z0] = pose.rotation.split(' ');
    expect([x, z]).toEqual([x0, z0]);
    expect(copy(member.getAttribute('position'))).toEqual(memberPose.position);
    expect(copy(member.getAttribute('rotation'))).toEqual(memberPose.rotation);

    // Undo writes back the formatted start pose, as the easy gizmo's does.
    h.inspector.history.undo();
    const probe = posable(item(h.streetContainer));
    probe.setAttribute('position', pose.position);
    probe.setAttribute('rotation', pose.rotation);
    expect(copy(g.getAttribute('position'))).toEqual(
      copy(probe.getAttribute('position'))
    );
    expect(copy(g.getAttribute('rotation'))).toEqual(
      copy(probe.getAttribute('rotation'))
    );
    expect(g.getAttribute('rotation').y).toBeCloseTo(20.12, 9);
  });

  it('records nothing for a turn taken back to its start angle (fails if the origin orbits from the unrounded yaw)', () => {
    const position = [0.4, 0, -0.3];
    const { g } = pitchedGroup(position);
    select(g);
    advanced('rotate');
    // Orbiting from the unrounded start yaw to the rounded one moves the
    // origin by more than the millimetre a position is written to here, so
    // this fixture can tell the two apart.
    const object = g.object3D;
    const posStart = object.position.clone();
    const pivot = new THREE.Vector3(12, 1.25, 22).applyMatrix4(object.matrix);
    const qStart = object.quaternion.clone();
    const qRounded = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(object.rotation.x, 20.12 * DEG, object.rotation.z, 'YXZ')
    );
    const rawRelease = positionForRotationAboutCenter(
      posStart,
      qStart,
      qRounded,
      pivot,
      new THREE.Vector3()
    );
    expect(toString3(rawRelease)).not.toBe(toString3(posStart));

    const before = history();
    const at = stockHandlePoint('Y');
    press(at);
    move(across(at, 3));
    move(across(at, 80));
    h.frame();
    expect(Math.abs(g.getAttribute('rotation').y - 20.123456)).toBeGreaterThan(
      10
    );
    move(at);
    release(at);
    expect(history()).toBe(before);
  });

  it('moves a turned group along its heading in local space and along world X in world space; a touch press after the camera moved with no frame since moves from where it lands (fails on an anchor without the heading, or on a press measured against the plane as last drawn)', () => {
    const g = posable(group(h.streetContainer), { rotation: [0, 30, 0] });
    posable(solid(g, [-1, 0, -1], [1, 1, 1]));
    aimCamera([0, 12, 12], [0, 0, 0]);
    select(g);
    advanced('translate');
    const headingX = new THREE.Vector3(1, 0, 0).applyAxisAngle(
      new THREE.Vector3(0, 1, 0),
      30 * DEG
    );
    const drag = (pointerType = 'mouse') => {
      const start = worldOrigin(g);
      const at = stockHandlePoint('X');
      press(at, { pointerType });
      move(along(at, 3), { pointerType });
      move(along(at, 100), { pointerType });
      release(along(at, 100), { pointerType });
      h.frame();
      h.frame();
      return worldOrigin(g).sub(start);
    };

    Events.emit('transformspacechanged', 'local');
    h.frame();
    let moved = drag();
    expect(moved.length()).toBeGreaterThan(0.1);
    expect(Math.abs(moved.normalize().dot(headingX))).toBeGreaterThanOrEqual(
      0.999
    );

    Events.emit('transformspacechanged', 'world');
    h.frame();
    moved = drag();
    expect(moved.length()).toBeGreaterThan(0.1);
    expect(Math.abs(moved.normalize().x)).toBeGreaterThanOrEqual(0.999);

    // The camera moves, and no frame lays the control out again before a
    // touch lands on the X arrow with no hover first.
    aimCamera([4, 9, 13], [0, 0, 0]);
    const at = stockHandlePoint('X');
    const to = along(at, 40);
    const start = worldOrigin(g);
    press(at, { pointerType: 'touch' });
    move(to, { pointerType: 'touch' });
    const first = worldOrigin(g).sub(start);
    h.frame();
    move(to, { pointerType: 'touch' });
    const after = worldOrigin(g).sub(start);
    release(to, { pointerType: 'touch' });
    expect(first.length()).toBeGreaterThan(0);
    expect(after.distanceTo(first)).toBeLessThan(1e-6);
  });

  it.each([false, true])(
    'opens the group on a long still press of an arrow over its box, drags from 2 px or a coalesced sample, and lets no second touch through (cursor listening first: %s; fails if the press is not claimed, only press and release are compared, or a second pointer reaches the canvas)',
    (cursorFirst) => {
      h.dispose();
      document.body.replaceChildren();
      h = mountEditor({ gizmo: true, cursorFirst });
      canvas = h.inspector.container;
      controls = h.inspector.easyGizmoControls;
      vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout'] });
      const { g, member } = farGroup();
      select(g);
      advanced('translate');
      const stock = groupStock();
      const before = history();
      const selections = [];
      Events.on('objectselect', (object) => selections.push(object));

      let at = stockHandlePoint('X', { overBoxOf: g });
      const t0 = performance.now();
      press(at, { timeStamp: t0 });
      vi.advanceTimersByTime(1000);
      move(offset(at, 0.5, 0.6), { timeStamp: t0 + 1000 });
      vi.advanceTimersByTime(1000);
      move(offset(at, 0.8, 0), { timeStamp: t0 + 2000 });
      release(offset(at, 0.8, 0), { timeStamp: t0 + 2000 });
      expect(h.openIds()).toEqual([g.id]);
      expect(h.inspector.selectedEntity).toBe(null);
      expect(history()).toBe(before);
      expect(copy(g.getAttribute('position'))).toEqual({ x: 0, y: 0, z: 0 });
      expect(selections).toEqual([null]);

      // Out 3 px and exactly back: a drag, which opens nothing.
      select(g);
      expect(stock.object).toBe(stockGesture().handleAnchor);
      at = stockHandlePoint('X', { overBoxOf: g });
      press(at);
      move(offset(at, 3));
      expect(stock.dragging).toBe(true);
      move(at);
      release(at);
      expect(h.openIds()).toEqual([]);
      expect(history()).toBe(before);

      // A sample coalesced into a 0 px move went 2 px out.
      press(at);
      move(at, { coalesced: [[at.x + 1.5, at.y + 1.5]] });
      expect(stock.dragging).toBe(true);
      release(at);
      expect(h.openIds()).toEqual([]);

      // A second finger lands on a member while the first is held.
      const memberAt = screenOf(new THREE.Vector3(13, 2, 23));
      aimCursorAt(memberAt);
      expect(h.raycaster.intersections[0]?.object.el).toBe(member);
      const first = { pointerType: 'touch' };
      const second = { pointerType: 'touch', pointerId: 2, isPrimary: false };
      press(at, first);
      press(memberAt, second);
      release(memberAt, second);
      expect(h.inspector.selectedEntity).toBe(g);
      release(at, first);
      expect(h.openIds()).toEqual([g.id]);
      expect(h.inspector.selectedEntity).toBe(null);
    }
  );

  it('hides the red hover while the cursor is on a group handle, also after a click or a drag on it, and brings it back off the handle (fails if the cursor is not tracked on the handle, or the hover is let go at the end of a gesture)', () => {
    aimCamera([0, 10, 12], [0, 0, 0]);
    const g = posable(group(h.streetContainer));
    posable(solid(g, [-0.15, 0, -0.15], [0.15, 0.3, 0.15]));
    select(g);
    advanced('translate');
    // Clear of the selected group's marker, a pick target of its own.
    const at = stockHandlePoint('X', { offBoxOf: g, from: 30 });
    const under = planePoint(at, 0);
    const other = posable(
      solid(
        h.streetContainer,
        [under.x - 0.05, -0.05, under.z - 0.05],
        [under.x + 0.05, 0, under.z + 0.05]
      )
    );
    h.frame();
    move(at);
    aimCursorAt(at);
    expect(h.raycaster.intersections[0]?.object.el).toBe(other);
    expect(h.hoverBox.visible).toBe(false);

    // Off the handle, the red hover previews the entity beneath.
    const away = { x: at.x, y: at.y - 200 };
    move(away);
    expect(groupStock().axis).toBe(null);
    expect(h.hoverBox.visible).toBe(true);
    expect(h.hoverBox.object).toBe(other.object3D);
    move(at);
    expect(h.hoverBox.visible).toBe(false);

    clickAt(at);
    expect(h.inspector.selectedEntity).toBe(g);
    expect(h.openIds()).toEqual([]);
    expect(h.hoverBox.visible).toBe(false);

    // A drag released with the cursor still on the arrow it moved.
    const before = history();
    press(at);
    move(along(at, 3));
    h.frame();
    move(along(at, 20));
    h.frame();
    release(along(at, 20));
    expect(history()).toBe(before + 1);
    expect(groupStock().axis).toBe('X');
    expect(h.hoverBox.visible).toBe(false);

    // A drag released with the cursor off the handle: the red hover waits
    // for the pointer to move, as after any gesture.
    h.frame();
    h.frame();
    const again = stockHandlePoint('X', { offBoxOf: g, from: 30 });
    // The pointer moves off the handle (red hover back) and onto it again.
    move({ x: again.x, y: again.y - 200 });
    expect(h.hoverBox.visible).toBe(true);
    move(again);
    expect(h.hoverBox.visible).toBe(false);
    press(again);
    move(along(again, 3));
    h.frame();
    release({ x: again.x, y: again.y - 200 });
    expect(history()).toBe(before + 2);
    expect(groupStock().axis).toBe(null);
    expect(h.hoverBox.visible).toBe(false);
  });

  // A drag on the X arrow, promoted and held 700 ms.
  function heldDrag(g) {
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = stockHandlePoint('X');
    press(at);
    move(along(at, 3));
    move(along(at, 60));
    h.frame();
    vi.setSystemTime(Date.now() + 700);
    move(along(at, 90));
    expect(groupStock().dragging).toBe(true);
    expect(g.object3D.position.x).not.toBe(0);
    return at;
  }

  it.each([
    ['Escape', () => escape()],
    ['window blur', () => window.dispatchEvent(new Event('blur'))],
    ['pointercancel', (at) => send('pointercancel', at)],
    ['another selection', (at, other) => h.inspector.selectEntity(other)],
    [
      'the editor closing',
      () => useStore.getState().setIsInspectorEnabled(false)
    ],
    [
      'the group being deleted',
      (at, other, g) => h.inspector.execute('entityremove', g)
    ]
  ])(
    'puts a held group drag back exactly on %s, with no command, and leaves the editor working (fails with no cancel, or a cancel that leaves keys swallowed or the camera off)',
    (cause, lose) => {
      const { g, member } = farGroup();
      const other = posable(solid(h.streetContainer, [30, 0, 30], [31, 1, 31]));
      select(g);
      advanced('translate');
      const start = {
        position: g.object3D.position.clone(),
        rotation: g.object3D.rotation.clone()
      };
      const calls = spyExecute();
      const capture = vi.spyOn(canvas, 'releasePointerCapture');
      const deleting = cause === 'the group being deleted';

      const at = heldDrag(g);
      lose(at, other, g);
      // The capture is let go at once, before the button is.
      expect(capture).toHaveBeenCalledWith(1);
      release(along(at, 90));

      expect(
        calls.filter((c) => c.args[0] !== 'entityremove').map((c) => c.args)
      ).toEqual([]);
      expect(groupStock().dragging).toBe(false);
      expect(h.inspector.controls.enabled).toBe(true);
      if (cause === 'the editor closing') {
        useStore.getState().setIsInspectorEnabled(true);
      }
      const tools = [];
      Events.on('toolchange', (tool) => tools.push(tool));
      const key = new KeyboardEvent('keyup', { key: 'h', bubbles: true });
      Object.defineProperty(key, 'keyCode', { value: 72 });
      document.body.dispatchEvent(key);
      expect(tools).toEqual(['hand']);
      if (deleting) {
        expect(g.isConnected).toBe(false);
        return;
      }

      expect(g.object3D.position.equals(start.position)).toBe(true);
      expect(g.object3D.rotation.equals(start.rotation)).toBe(true);
      // The box is measured again: the bounds are not held.
      const box = getGroupBounds(g).clone();
      member.object3D.position.x += 1;
      h.frame();
      expect(getGroupBounds(g).equals(box)).toBe(false);
      member.object3D.position.x -= 1;
      if (h.inspector.selectedEntity !== g) select(g);
      h.frame();

      const next = stockHandlePoint('X');
      press(next);
      move(along(next, 3));
      expect(groupStock().dragging).toBe(true);
      release(along(next, 3));
    }
  );

  it('lets go of a held group drag on Escape without leaving a level; the next Escape leaves one', () => {
    const { g: outer } = farGroup();
    const inner = posable(group(outer));
    posable(solid(inner, [11, 0.5, 21], [13, 1.5, 23]));
    select(outer);
    h.groupScope.open(outer);
    select(inner);
    advanced('translate');
    const pose = inner.object3D.position.clone();
    const at = stockHandlePoint('X');
    press(at);
    move(along(at, 3));
    move(along(at, 60));
    expect(inner.object3D.position.equals(pose)).toBe(false);
    escape();
    expect(inner.object3D.position.equals(pose)).toBe(true);
    expect(h.openIds()).toEqual([outer.id]);
    expect(h.inspector.selectedEntity).toBe(inner);
    release(along(at, 60));
    escape();
    expect(h.openIds()).toEqual([]);
    expect(h.inspector.selectedEntity).toBe(outer);
  });

  it.each([
    [
      'on a release off the canvas',
      (at) => release(at, { target: document.body })
    ],
    [
      'on the release after capture was lost mid-drag',
      (at) => {
        send('lostpointercapture', at);
        move(offset(at, 10));
        release(offset(at, 10));
      }
    ],
    [
      'when the cursor leaves the canvas holding capture',
      (at) =>
        canvas.dispatchEvent(
          new MouseEvent('mouseleave', { clientX: at.x, clientY: at.y })
        )
    ]
  ])(
    'ends a group drag as one undo step %s, and keys reach the editor after (fails if only a canvas release ends it, lost capture cancels it, or leaving the canvas does not end it)',
    (_, end) => {
      const { g } = farGroup();
      select(g);
      advanced('translate');
      const before = history();
      const at = stockHandlePoint('X');
      press(at);
      move(along(at, 3));
      move(along(at, 60));
      end(along(at, 60));
      expect(groupStock().dragging).toBe(false);
      expect(history()).toBe(before + 1);
      const tools = [];
      Events.on('toolchange', (tool) => tools.push(tool));
      const key = new KeyboardEvent('keyup', { key: 'h', bubbles: true });
      Object.defineProperty(key, 'keyCode', { value: 72 });
      document.body.dispatchEvent(key);
      expect(tools).toEqual(['hand']);
    }
  );

  it('shows the magenta box over an arrow on its box: on mouse hover, stronger on the press, gone at 3 px; on a touch only from the press, and a still tap opens once (fails if the press shows only on hover, or a touch reaches the cursor)', () => {
    const { g, member } = farGroup();
    select(g);
    advanced('translate');
    const stock = groupStock();
    const at = stockHandlePoint('X', { overBoxOf: g });

    move(at);
    expect(stock.axis).toBe('X');
    aimCursorAt(at);
    expect(h.groupHoverBox.visible).toBe(true);
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.3);
    press(at);
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.4);
    // The press is over; the hover over the box stays.
    move(offset(at, 3));
    expect(h.groupHoverBox.visible).toBe(true);
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.3);
    release(offset(at, 3));
    h.frame();
    h.frame();

    // Touch: no hover before the press.
    const touchAt = stockHandlePoint('X', { overBoxOf: g });
    h.aimDown(-100, -100);
    h.poll();
    expect(h.groupHoverBox.visible).toBe(false);
    const finger = { pointerType: 'touch' };
    press(touchAt, finger);
    expect(h.groupHoverBox.visible).toBe(true);
    expect(h.groupHoverBox.boxFill.material.opacity).toBe(0.4);
    move(offset(touchAt, 3), finger);
    expect(h.groupHoverBox.visible).toBe(false);
    release(offset(touchAt, 3), finger);
    h.frame();
    h.frame();

    // A still tap, with the cursor's ray on a member beneath.
    const tapAt = stockHandlePoint('X', { overBoxOf: g });
    aimCursorAt(tapAt);
    expect(h.raycaster.intersections[0]?.object.el).toBe(member);
    const changes = [];
    Events.on('groupscopechanged', () => changes.push(h.openIds()));
    clickAt(tapAt, finger);
    expect(changes).toEqual([[g.id]]);
    expect(h.inspector.selectedEntity).toBe(null);
  });

  it('does not frame after an open on an arrow and a select-member by the quick second click on the canvas (fails if the handle click does not mark the double-click as entering)', () => {
    const { g, member } = farGroup();
    select(g);
    advanced('translate');
    let at = stockHandlePoint('X', { overBoxOf: g });
    clickAt(at, { detail: 1 });
    expect(h.openIds()).toEqual([g.id]);
    aimCursorAt(at);
    clickAt(at, { detail: 2 });
    expect(h.inspector.selectedEntity).toBe(member);
    send('dblclick', at, { detail: 2 });
    expect(focused).toEqual([]);

    flags.streetLevel = true;
    select(g);
    expect(h.openIds()).toEqual([]);
    at = stockHandlePoint('X', { overBoxOf: g });
    clickAt(at, { detail: 1 });
    expect(h.openIds()).toEqual([g.id]);
    aimCursorAt(at);
    clickAt(at, { detail: 2 });
    expect(h.inspector.selectedEntity).toBe(member);
    send('dblclick', at, { detail: 2 });
    expect(teleported).toEqual([]);
    expect(focused).toEqual([]);
  });

  it('leaves an ordinary item its stock gestures after group gestures: a drag with a pause records per change, Escape deselects without putting it back, and a still click on its arrow selects what is beneath (fails if the group press is still armed, or item drags go through it)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { g } = farGroup();
    select(g);
    advanced('translate');
    // A group drag kept, and one cancelled.
    let at = stockHandlePoint('X');
    press(at);
    move(along(at, 3));
    move(along(at, 40));
    release(along(at, 40));
    h.frame();
    at = stockHandlePoint('X');
    press(at);
    move(along(at, 3));
    move(along(at, 40));
    escape();
    release(along(at, 40));

    aimCamera([0, 10, 12], [0, 0, 0]);
    const box = posable(
      solid(h.streetContainer, [-0.3, 0, -0.3], [0.3, 1, 0.3])
    );
    select(box);
    const item = itemStock();
    expect(item.object).toBe(box.object3D);
    const itemArrow = () => {
      const centre = screenOf(item.worldPosition.clone());
      for (let r = 2; r <= 300; r += 2) {
        for (let deg = 0; deg < 360; deg += 4) {
          const p = {
            x: Math.round(centre.x + r * Math.cos(deg * DEG)),
            y: Math.round(centre.y + r * Math.sin(deg * DEG))
          };
          item.pointerHover(ndc(p));
          const onItem =
            new THREE.Raycaster(
              rayThrough(p).origin,
              rayThrough(p).direction
            ).intersectObject(box.object3D, true).length > 0;
          if (item.axis === 'X' && !onItem) {
            item.axis = null;
            return { p, centre };
          }
        }
      }
      throw new Error('no point on the item X arrow');
    };

    // Two moves 700 ms apart: two entity updates, as on base.
    const before = history();
    let { p, centre } = itemArrow();
    press(p);
    move(along(p, 20, centre));
    vi.setSystemTime(Date.now() + 700);
    move(along(p, 40, centre));
    release(along(p, 40, centre));
    expect(history()).toBe(before + 2);

    // Escape mid-drag deselects and leaves the item where it is.
    h.frame();
    ({ p, centre } = itemArrow());
    press(p);
    move(along(p, 30, centre));
    const moved = box.object3D.position.clone();
    escape();
    expect(h.inspector.selectedEntity).toBe(null);
    expect(box.object3D.position.equals(moved)).toBe(true);
    release(along(p, 30, centre));
    select(box);
    h.frame();
    expect(item.dragging).toBe(false);

    // A still click on its arrow, with another entity under the cursor ray.
    ({ p, centre } = itemArrow());
    const under = planePoint(p, 0);
    const other = posable(
      solid(
        h.streetContainer,
        [under.x - 0.05, -0.05, under.z - 0.05],
        [under.x + 0.05, 0, under.z + 0.05]
      )
    );
    h.frame();
    aimCursorAt(p);
    expect(h.raycaster.intersections[0]?.object.el).toBe(other);
    clickAt(p);
    expect(h.inspector.selectedEntity).toBe(other);
  });
});
