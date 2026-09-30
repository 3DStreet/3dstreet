import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import Events from '@/editor/lib/Events.js';
import useStore from '@/store';
import { getGroupBounds } from '@/editor/lib/groups/groupBounds.js';
import { SCOPE_MARKS } from '@/editor/lib/groups/scopePresentation.js';
import { boxMesh } from './_groupFixtures.js';
import { group, item, mountEditor, solid } from './_editorHarness.js';

vi.mock('@/editor/lib/cameras', () => ({ copyCameraPosition: vi.fn() }));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/nav-experimental/index.js', async () => {
  const { EventDispatcher, Vector3 } = await import('three');
  return {
    isStreetLevelNav: () => false,
    ExperimentalControls: class extends EventDispatcher {
      center = new Vector3();
      setAspectRatio() {}
      setCamera() {}
      focus() {}
      navigateDoubleClick() {}
      newSceneCameraZoom() {}
    }
  };
});

// The outline and scrim of an open group, and the order in which it and the
// outside treatment appear, through the real viewport, scope controller, easy
// gizmo and editor frame (see _editorHarness). The canvas is 1200 × 800 px at
// the page's top left.

const DEG = Math.PI / 180;
const WIDTH = 1200;
const HEIGHT = 800;

let h;
let canvas;
let controls;

beforeEach(() => {
  h = mountEditor({ gizmo: true });
  canvas = h.inspector.container;
  controls = h.inspector.easyGizmoControls;
});

afterEach(() => {
  useStore.setState({ isInspectorEnabled: true });
  h.dispose();
  Events.removeAllListeners();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

// ------------------------------------------------------------------ scene

function aimCamera(position, target) {
  h.camera.position.set(...position);
  h.camera.lookAt(...target);
  h.camera.updateMatrixWorld(true);
}

// An entity whose transform attributes drive its object3D as A-Frame's do
// (rotation order YXZ), so the gizmo can read and commit its pose.
function posable(el, { rotation = [0, 0, 0] } = {}) {
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
  const [x, y, z] = rotation;
  el.setAttribute('position', { x: 0, y: 0, z: 0 });
  el.setAttribute('rotation', { x, y, z });
  el.setAttribute('scale', { x: 1, y: 1, z: 1 });
  return el;
}

// A group turned 30 degrees whose members span (10,0.5,20)-(14,2,24) in its
// frame, well away from its origin; seen from above and in front.
function yawedGroup() {
  const g = posable(group(h.streetContainer), { rotation: [0, 30, 0] });
  const member = posable(solid(g, [10, 0.5, 20], [14, 2, 24]));
  const center = new THREE.Vector3(12, 1.25, 22).applyEuler(
    new THREE.Euler(0, 30 * DEG, 0)
  );
  aimCamera([center.x, 14, center.z + 16], [center.x, 0, center.z]);
  h.sceneEl.object3D.updateMatrixWorld(true);
  return { g, member };
}

function select(el) {
  h.inspector.selectEntity(el);
  h.frame();
  h.frame();
}

function openGroup(g) {
  select(g);
  h.scope.open(g);
}

// ------------------------------------------------------------------ screen

function screenOf(world) {
  const p = world.clone().project(h.camera);
  return { x: ((p.x + 1) * WIDTH) / 2, y: ((1 - p.y) * HEIGHT) / 2 };
}

const scrim = () => document.querySelector('[data-group-scope-scrim]');
const scrimShown = () => !!scrim() && scrim().style.display !== 'none';
const outline = () =>
  h.inspector.sceneHelpers.children.find(
    (c) => c.name === 'group-scope-outline'
  );

// The part of the canvas the scrim leaves uncovered, as points, or null when
// it covers the whole canvas.
function aperture() {
  const d = scrim().querySelector('path').getAttribute('d');
  const [cover, hole] = d
    .split('M')
    .map((part) => part.trim())
    .filter(Boolean);
  expect(cover).toBe(`0 0 H ${WIDTH} V ${HEIGHT} H 0 Z`);
  if (!hole) return null;
  return hole
    .replace('Z', '')
    .split('L')
    .map((pair) => {
      const [x, y] = pair.trim().split(/\s+/).map(Number);
      return { x, y };
    });
}

const cross = (o, a, b) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function inside(polygon, p) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const c = cross(polygon[i], polygon[(i + 1) % polygon.length], p);
    if (Math.abs(c) < 1e-9) continue;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
}

function area(polygon) {
  let sum = 0;
  polygon.forEach((p, i) => {
    const q = polygon[(i + 1) % polygon.length];
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
}

// This test's own view of where a box is on screen, for a box wholly in front
// of the camera: the convex hull of its eight projected corners (gift
// wrapping).
function projectedHull(box, matrixWorld) {
  const points = [];
  for (let i = 0; i < 8; i++) {
    const corner = new THREE.Vector3(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    ).applyMatrix4(matrixWorld);
    points.push(screenOf(corner));
  }
  const hull = [];
  let current = points.reduce((a, b) => (b.x < a.x ? b : a));
  do {
    hull.push(current);
    let next = points[0] === current ? points[1] : points[0];
    for (const p of points) {
      if (p !== current && cross(current, next, p) < 0) next = p;
    }
    current = next;
  } while (current !== hull[0] && hull.length <= 8);
  return hull;
}

function expectSamePolygon(actual, expected) {
  expect(actual).not.toBe(null);
  expect(actual).toHaveLength(expected.length);
  for (const p of expected) {
    const match = actual.find(
      (q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6
    );
    expect(match, `corner ${p.x}, ${p.y}`).toBeDefined();
  }
}

function boxCenterOnScreen(groupEl) {
  const center = getGroupBounds(groupEl).getCenter(new THREE.Vector3());
  return screenOf(center.applyMatrix4(groupEl.object3D.matrixWorld));
}

// ------------------------------------------------------------------ outline

describe('the outline of an open group', () => {
  it('is drawn and the scene outside its box is covered in the same task as the group opens', () => {
    const { g } = yawedGroup();
    select(g);
    expect(scrimShown()).toBe(false);
    expect(outline()?.visible ?? false).toBe(false);

    h.scope.open(g);
    // No frame has run since the group opened.
    expect(scrimShown()).toBe(true);
    expect(outline().visible).toBe(true);
    const hole = aperture();
    expect(inside(hole, boxCenterOnScreen(g))).toBe(true);
  });

  it('goes around the open group, not around the member selected inside it', () => {
    const { g, member } = yawedGroup();
    const other = solid(g, [0, 0, 0], [1, 1, 1]);
    openGroup(g);
    h.inspector.selectEntity(member);
    h.frame();
    expect(h.openIds()).toEqual([g.id]);
    expect(h.selectionBox.object).toBe(member.object3D);

    // The outline's segments are the group's box in the group's frame, placed
    // by the group.
    const box = getGroupBounds(g);
    expect(box.min.toArray()).toEqual([0, 0, 0]);
    expect(box.max.toArray()).toEqual([14, 2, 24]);
    const lines = outline();
    const starts = lines.geometry.attributes.instanceStart;
    const ends = lines.geometry.attributes.instanceEnd;
    const drawn = new THREE.Box3();
    for (let i = 0; i < starts.count; i++) {
      drawn.expandByPoint(new THREE.Vector3().fromBufferAttribute(starts, i));
      drawn.expandByPoint(new THREE.Vector3().fromBufferAttribute(ends, i));
    }
    expect(drawn.equals(box)).toBe(true);
    expect(lines.matrixWorld.equals(g.object3D.matrixWorld)).toBe(true);
    expect(other.isConnected).toBe(true);
  });

  it('is not a surface: nothing raycasting the scene hits it', () => {
    const { g } = yawedGroup();
    openGroup(g);
    h.frame();
    const lines = outline();
    expect(lines.visible).toBe(true);
    // A ray straight down through one of the outline's corners.
    const corner = new THREE.Vector3(14, 2, 24).applyMatrix4(
      g.object3D.matrixWorld
    );
    const raycaster = new THREE.Raycaster(
      corner.clone().add(new THREE.Vector3(0, 10, 0)),
      new THREE.Vector3(0, -1, 0)
    );
    raycaster.camera = h.camera;
    raycaster.params.Line2 = { threshold: 50 };
    expect(raycaster.intersectObject(lines, true)).toEqual([]);
    // The same ray does hit an ordinary mesh at that spot.
    const control = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    control.position.copy(corner);
    control.updateMatrixWorld(true);
    expect(raycaster.intersectObject(control, true).length).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ scrim

describe('the scrim of an open group', () => {
  it("leaves uncovered exactly the box's outline on screen, not the rectangle around it", () => {
    const { g } = yawedGroup();
    openGroup(g);
    h.frame();
    const hull = projectedHull(getGroupBounds(g), g.object3D.matrixWorld);
    const hole = aperture();
    expectSamePolygon(hole, hull);

    // A point inside the rectangle around the outline but outside the outline.
    const xs = hull.map((p) => p.x);
    const ys = hull.map((p) => p.y);
    const corner = { x: Math.min(...xs) + 2, y: Math.min(...ys) + 2 };
    expect(inside(hull, corner)).toBe(false);
    expect(inside(hole, corner)).toBe(false);
    expect(inside(hole, boxCenterOnScreen(g))).toBe(true);
  });

  it('is rebuilt when the camera moves, and not on a frame where nothing changed', () => {
    const { g } = yawedGroup();
    openGroup(g);
    h.frame();
    const path = scrim().querySelector('path');
    const writes = vi.spyOn(path, 'setAttribute');
    const before = path.getAttribute('d');

    h.camera.position.x += 3;
    h.camera.updateMatrixWorld(true);
    h.frame();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(path.getAttribute('d')).not.toBe(before);
    expectSamePolygon(
      aperture(),
      projectedHull(getGroupBounds(g), g.object3D.matrixWorld)
    );

    h.frame();
    h.frame();
    expect(writes).toHaveBeenCalledTimes(1);
  });

  it('follows the open group as it is dragged, in the frame it moves', () => {
    const { g } = yawedGroup();
    openGroup(g);
    h.frame();
    const start = handlePoint('move');
    press(start);
    move(offset(start, 3));
    expect(controls.isDragging).toBe(true);
    const x0 = g.object3D.position.x;
    let dx = 3;
    let checked = 0;
    while (g.object3D.position.x - x0 < 5) {
      dx += 20;
      expect(dx).toBeLessThan(1200);
      move(offset(start, dx));
      h.frame(() => {
        // What this frame draws: the scrim and outline where the group is now.
        const matrix = g.object3D.matrixWorld;
        expectSamePolygon(aperture(), projectedHull(getGroupBounds(g), matrix));
        expect(outline().matrixWorld.equals(matrix)).toBe(true);
        checked++;
      });
    }
    release(offset(start, dx));
    expect(g.object3D.position.x - x0).toBeGreaterThanOrEqual(5);
    expect(checked).toBeGreaterThan(0);
  });

  it('covers the whole canvas with the camera inside the box, and leaves a valid outline when the box reaches behind the camera or off the canvas', () => {
    const { g } = yawedGroup();
    openGroup(g);
    const inBox = new THREE.Vector3(12, 1, 22).applyMatrix4(
      g.object3D.matrixWorld
    );

    // Camera inside the box: everything in view is inside.
    aimCamera(inBox.toArray(), [inBox.x + 5, 1, inBox.z]);
    h.frame();
    const whole = aperture();
    expect(area(whole)).toBeCloseTo(WIDTH * HEIGHT, 3);

    // Beside the box, level with its middle and looking along it: its far
    // half is in view, its near half behind the camera.
    const toWorld = (x, y, z) =>
      new THREE.Vector3(x, y, z).applyMatrix4(g.object3D.matrixWorld);
    const beside = toWorld(14.5, 1.25, 22);
    const ahead = toWorld(14.5, 1.25, 40);
    aimCamera(beside.toArray(), ahead.toArray());
    h.frame();
    const partial = aperture();
    expect(partial.length).toBeGreaterThanOrEqual(3);
    for (const p of partial) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      expect(p.x).toBeLessThanOrEqual(WIDTH + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6);
      expect(p.y).toBeLessThanOrEqual(HEIGHT + 1e-6);
    }
    expect(area(partial)).toBeGreaterThan(0);
    expect(area(partial)).toBeLessThan(WIDTH * HEIGHT);

    // Looking away from the box: nothing to leave uncovered.
    aimCamera(beside.toArray(), toWorld(30, 1.25, 22).toArray());
    h.frame();
    expect(scrimShown()).toBe(true);
    expect(aperture()).toBe(null);
  });

  it('covers the whole canvas for an open group with no geometry, keeps its marker, and opens a hole in the frame its first geometry appears', () => {
    const { g: other } = yawedGroup();
    const g = group(h.streetContainer);
    const member = item(g);
    // A member whose model has not arrived: the group has no bounds.
    openGroup(g);
    h.frame();
    expect(getGroupBounds(g)).toBe(null);
    expect(scrimShown()).toBe(true);
    expect(aperture()).toBe(null);
    expect(outline()?.visible ?? false).toBe(false);
    expect(h.markers()).toHaveLength(1);

    // The model arrives: no event, only a mesh.
    boxMesh(member, [2, 0, 2], [4, 1, 4]);
    let seen = null;
    h.frame(() => {
      seen = { hole: aperture(), outlined: outline().visible };
    });
    expect(seen.outlined).toBe(true);
    expectSamePolygon(
      seen.hole,
      projectedHull(getGroupBounds(g), g.object3D.matrixWorld)
    );
    expect(other.isConnected).toBe(true);
  });
});

// ------------------------------------------------------------------ closing

describe('closing an open group', () => {
  it('takes the scrim and outline away before any further render: on Escape, and on leaving the editor', () => {
    const { g } = yawedGroup();
    openGroup(g);
    h.frame();
    expect(scrimShown()).toBe(true);

    h.escape();
    expect(h.openIds()).toEqual([]);
    expect(scrimShown()).toBe(false);
    expect(outline().visible).toBe(false);

    openGroup(g);
    h.frame();
    expect(scrimShown()).toBe(true);
    useStore.getState().setIsInspectorEnabled(false);
    expect(scrimShown()).toBe(false);
    expect(outline().visible).toBe(false);
  });
});

// ------------------------------------------------------------------ entry

describe('entering a group', () => {
  let frameRequests;
  let marks;
  let attenuation;

  beforeEach(() => {
    frameRequests = [];
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      frameRequests.push(callback);
      return frameRequests.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    marks = vi.spyOn(performance, 'mark');
    attenuation = { apply: vi.fn(), restore: vi.fn(), close: vi.fn() };
    h.scope.presentation.attenuation = attenuation;
  });

  const scopeMarks = () =>
    marks.mock.calls
      .filter(([name]) => name.startsWith('group-scope:'))
      .map(([name, options]) => [name, options.detail.generation]);

  function runFrameRequests() {
    const pending = frameRequests;
    frameRequests = [];
    pending.forEach((callback) => callback(performance.now()));
  }

  it('treats the outside only after a render has shown the outline and scrim, and one animation frame more', () => {
    const { g } = yawedGroup();
    select(g);
    h.scope.open(g);
    const generation = h.scope.generation;
    expect(scrimShown()).toBe(true);
    expect(scopeMarks()).toEqual([[SCOPE_MARKS.open, generation]]);
    expect(frameRequests).toHaveLength(0);

    h.frame();
    expect(scopeMarks()).toEqual([
      [SCOPE_MARKS.open, generation],
      [SCOPE_MARKS.outlinedFrame, generation]
    ]);
    expect(frameRequests).toHaveLength(1);
    expect(attenuation.apply).not.toHaveBeenCalled();

    runFrameRequests();
    expect(attenuation.apply).toHaveBeenCalledTimes(1);
    expect(attenuation.apply).toHaveBeenCalledWith(g, generation);
    expect(scopeMarks()).toEqual([
      [SCOPE_MARKS.open, generation],
      [SCOPE_MARKS.outlinedFrame, generation],
      [SCOPE_MARKS.attenuationEnabled, generation]
    ]);

    // Later frames schedule nothing more.
    h.frame();
    h.frame();
    expect(frameRequests).toHaveLength(0);
    expect(attenuation.apply).toHaveBeenCalledTimes(1);
  });

  it('does not count a render already under way when the group opened as the one that showed it', () => {
    const { g } = yawedGroup();
    select(g);
    // Opened after this render's frame window, before its end.
    h.frame(() => h.scope.open(g));
    const generation = h.scope.generation;
    expect(scopeMarks()).toEqual([[SCOPE_MARKS.open, generation]]);
    expect(frameRequests).toHaveLength(0);

    h.frame();
    expect(scopeMarks()).toEqual([
      [SCOPE_MARKS.open, generation],
      [SCOPE_MARKS.outlinedFrame, generation]
    ]);
    expect(frameRequests).toHaveLength(1);
  });

  it('never treats the outside of a group closed before its treatment was due, and treats it when opened again', () => {
    const { g } = yawedGroup();
    openGroup(g);
    h.frame();
    expect(frameRequests).toHaveLength(1);
    expect(attenuation.close).not.toHaveBeenCalled();

    h.escape();
    expect(h.openIds()).toEqual([]);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(attenuation.close).toHaveBeenCalledTimes(1);
    // Even if the cancelled request still ran.
    runFrameRequests();
    h.frame();
    expect(attenuation.apply).not.toHaveBeenCalled();
    expect(
      scopeMarks().filter(([name]) => name === SCOPE_MARKS.attenuationEnabled)
    ).toEqual([]);

    // The same steps with the group left open do treat it.
    openGroup(g);
    h.frame();
    runFrameRequests();
    expect(attenuation.apply).toHaveBeenCalledTimes(1);
    expect(attenuation.apply).toHaveBeenCalledWith(g, h.scope.generation);
  });

  it('opening a nested group before the outer one was treated treats only the nested one, once', () => {
    const { g: a } = yawedGroup();
    const b = group(a);
    solid(b, [11, 0.5, 21], [12, 1.5, 22]);
    openGroup(a);
    const generationA = h.scope.generation;
    h.frame();
    const [enableA] = frameRequests;
    frameRequests = [];

    h.inspector.selectEntity(b);
    h.scope.open(b);
    const generationB = h.scope.generation;
    expect(generationB).not.toBe(generationA);
    expect(h.openIds()).toEqual([a.id, b.id]);
    h.frame();
    const [enableB] = frameRequests;
    frameRequests = [];

    // The outer group's request runs after all, then the nested one's.
    enableA(performance.now());
    enableB(performance.now());
    expect(attenuation.apply).toHaveBeenCalledTimes(1);
    expect(attenuation.apply).toHaveBeenCalledWith(b, generationB);
    const enabled = scopeMarks().filter(
      ([name]) => name === SCOPE_MARKS.attenuationEnabled
    );
    expect(enabled).toEqual([[SCOPE_MARKS.attenuationEnabled, generationB]]);
  });
});

// ------------------------------------------------------------------ pointer

function send(type, at) {
  const released = type === 'pointerup' || type === 'mouseup';
  const event = new MouseEvent(type, {
    clientX: at.x,
    clientY: at.y,
    button: 0,
    buttons: released || type === 'click' ? 0 : 1,
    detail: 1,
    bubbles: true,
    cancelable: true
  });
  if (type.startsWith('pointer')) {
    Object.defineProperties(event, {
      pointerType: { value: 'mouse' },
      pointerId: { value: 1 },
      isPrimary: { value: true }
    });
  }
  canvas.dispatchEvent(event);
  return event;
}

// A mouse press as the browser delivers it: a cancelled pointerdown (a gizmo
// claiming the press) suppresses the compatibility mousedown and mouseup,
// and the click still follows (Pointer Events, "PREVENT MOUSE EVENT flag").
let mouseSuppressed = false;
function press(at) {
  mouseSuppressed = send('pointerdown', at).defaultPrevented;
  if (!mouseSuppressed) send('mousedown', at);
}

function move(at) {
  send('pointermove', at);
}

function release(at) {
  send('pointerup', at);
  if (!mouseSuppressed) send('mouseup', at);
  send('click', at);
  mouseSuppressed = false;
}

const offset = (at, dx, dy = 0) => ({ x: at.x + dx, y: at.y + dy });

// A whole-pixel screen point on the gizmo's `axis` control.
function handlePoint(axis) {
  const centre = screenOf(
    controls.moveGroup.getWorldPosition(new THREE.Vector3())
  );
  for (let r = 0; r <= 240; r += 1) {
    for (let deg = 0; deg < 360; deg += r === 0 ? 360 : 5) {
      const at = {
        x: Math.round(centre.x + r * Math.cos(deg * DEG)),
        y: Math.round(centre.y + r * Math.sin(deg * DEG))
      };
      controls.updateMouse({ clientX: at.x, clientY: at.y });
      if (controls.pickAxis() === axis) return at;
    }
  }
  throw new Error(`no point on the ${axis} control`);
}
