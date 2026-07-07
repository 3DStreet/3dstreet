/* Characterization-test harness for ExperimentalControls.
 *
 * Leading underscore => not collected as a `*.test.js` suite. Imported by
 * the per-module test files. Owns: the THREE global install, non-degenerate
 * camera / DOM / scene fixtures, construction via the dependency-injection
 * seam, the drive layer (the single place private entry points are named),
 * observation helpers, the clock stub, hermetic teardown, and the break-it
 * monkey-patch helper.
 *
 * Nothing here asserts. Assertions live in the test files.
 */

import * as THREE from 'three';
import { cameraTiltDegrees } from '../../../../src/editor/lib/nav-experimental/navMath.js';

// ---------------------------------------------------------------------------
// THREE global + SUT import
// ---------------------------------------------------------------------------

export function installThree() {
  globalThis.THREE = THREE;
}

// The SUT touches THREE at module-load time, so it must be imported AFTER the
// global is set. Each test file calls `await loadControls()` at top level
// (module scope) — but the global has to be present first. We set it eagerly
// here (harness import runs before the dynamic import below) and again in each
// file's beforeAll for belt-and-braces.
installThree();

const _sutPromise =
  import('../../../../src/editor/lib/nav-experimental/ExperimentalControls.js');

export async function loadControls() {
  installThree();
  const mod = await _sutPromise;
  return mod.ExperimentalControls;
}

export { THREE };

// ---------------------------------------------------------------------------
// Fixtures — non-degenerate by mandate
// ---------------------------------------------------------------------------

// Aspect defaults to 1.6 (≠ 1); a symmetric camera would hide split-NDC bugs.
export function makePerspectiveCam({
  pos = [0, 50, 0],
  lookAt = [0, 0, 0],
  fov = 60,
  aspect = 1.6,
  up = null
} = {}) {
  const cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100000);
  cam.position.set(pos[0], pos[1], pos[2]);
  if (up) cam.up.set(up[0], up[1], up[2]);
  cam.lookAt(lookAt[0], lookAt[1], lookAt[2]);
  cam.updateMatrixWorld(true);
  return cam;
}

// Non-square rect with nonzero left/top: a width/height transposition
// or a dropped offset in the split NDC code is otherwise invisible.
export function makeDomElement({
  width = 1280,
  height = 720,
  left = 37,
  top = 19
} = {}) {
  const el = document.createElement('div');
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top
    })
  });
  return el;
}

// A minimal A-Frame entity `.el` stub: answers hasAttribute / getAttribute /
// id the way classifyHitEntity walks for. Attach to the THREE object the
// raycast returns (or an ancestor on its `.parent` chain).
function makeEl(attrs) {
  return {
    id: attrs && attrs.id != null ? attrs.id : undefined,
    hasAttribute: (n) =>
      attrs != null && Object.prototype.hasOwnProperty.call(attrs, n),
    getAttribute: (n) => (attrs != null ? attrs[n] : undefined)
  };
}

// A DOM-capable scene object: a real jsdom element so TickAnimator's
// `sceneEl.appendChild(document.createElement('a-entity'))` works, plus the
// `.object3D` root and a no-op `.emit` the controls guard on. Not attached to
// document.body (host entity stays inert — we drive the tick manually).
function makeSceneEl(rootObj) {
  const sceneEl = document.createElement('a-scene');
  sceneEl.object3D = rootObj;
  sceneEl.emit = () => {};
  return sceneEl;
}

// Tier 1.5 — a single large horizontal ground-plane mesh at `y`, tagged as a
// street-segment so it classifies as a real solid floor (a genuine fresh
// probe hit, not the suppressed-clamp miss path).
export function groundPlaneScene({ y = 0, size = 100000 } = {}) {
  const root = new THREE.Group();
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  ground.rotation.x = -Math.PI / 2; // face up
  ground.position.y = y;
  ground.el = makeEl({ 'street-segment': '' });
  ground.updateMatrixWorld(true);
  root.add(ground);
  return makeSceneEl(root);
}

// Tier 2 — a minimal representative scene at nonzero ground elevation:
//   - a bounded ground segment surface at `groundY`,
//   - one solid building box (segment-tagged → solid floor + wall block +
//     roof + enclosure),
//   - one non-floor scatter (mixin, no STREET catalog → classified scatter →
//     rejected by isSolidFloorHit).
// A column outside the bounded ground is a genuine probe-miss.
//
// building: { cx, cz, width, depth, base, height } (metres). The box spans
// [base, base+height] in Y so a camera inside it reads enclosed.
export function representativeScene({
  groundY = 12,
  groundSize = 400,
  building = { cx: 0, cz: -40, width: 30, depth: 30, base: 12, height: 40 },
  scatter = { cx: 40, cz: 40, size: 2, y: 12 }
} = {}) {
  const root = new THREE.Group();

  // Bounded ground segment.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, groundY, 0);
  ground.el = makeEl({ 'street-segment': '' });
  ground.updateMatrixWorld(true);
  root.add(ground);

  // Solid building box (DoubleSide so inside/outside faces both register:
  // roof from above, near wall forward, top face overhead when enclosed).
  if (building) {
    const b = building;
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(b.width, b.height, b.depth),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    box.position.set(b.cx, b.base + b.height / 2, b.cz);
    box.el = makeEl({ 'street-segment': '' });
    box.updateMatrixWorld(true);
    root.add(box);
    root.userData.building = b;
  }

  // Non-floor scatter (must be REJECTED as a floor).
  if (scatter) {
    const s = scatter;
    const tree = new THREE.Mesh(
      new THREE.BoxGeometry(s.size, s.size, s.size),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    );
    tree.position.set(s.cx, s.y + s.size / 2, s.cz);
    tree.el = makeEl({ mixin: 'tree3' }); // no STREET catalog → scatter
    tree.updateMatrixWorld(true);
    root.add(tree);
  }

  return makeSceneEl(root);
}

// A gently sloped ground: a large plane tilted about X so the collision floor
// y decreases as z increases. Used by the grounded-vs-flying two-arm proxy —
// grounded WASD follows the slope down; flying holds absolute height.
export function rampScene({ baseY = 12, slopeDeg = 8, size = 2000 } = {}) {
  const root = new THREE.Group();
  const g = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
  );
  g.rotation.x = -Math.PI / 2 + (slopeDeg * Math.PI) / 180;
  g.position.set(0, baseY, 0);
  g.el = makeEl({ 'street-segment': '' });
  g.updateMatrixWorld(true);
  root.add(g);
  return makeSceneEl(root);
}

// ---------------------------------------------------------------------------
// Construction (via the dependency-injection seam) + teardown registry
// ---------------------------------------------------------------------------

let _ControlsClass = null;
const _liveControls = new Set();

// Call once in a test file's beforeAll: `_ControlsClass = await loadControls()`
// is done for you if you pass it; otherwise makeControls resolves it lazily on
// first use via the cached promise.
export function useControlsClass(cls) {
  _ControlsClass = cls;
}

export function makeControls({
  camera,
  dom,
  scene = null,
  wasd = false,
  streetLevel = false,
  tiltThreshold = null
} = {}) {
  if (!_ControlsClass) {
    throw new Error(
      'makeControls: call useControlsClass(await loadControls()) in beforeAll first'
    );
  }
  const cam = camera || makePerspectiveCam();
  const domEl = dom || makeDomElement();
  const controls = new _ControlsClass(cam, domEl, scene);
  if (wasd) controls.setWasdEnabled(true);
  if (streetLevel) controls.setStreetLevelEnabled(true);
  if (tiltThreshold != null) controls.setTiltThreshold(tiltThreshold);
  _liveControls.add(controls);
  return controls;
}

// ---------------------------------------------------------------------------
// Drive layer (the single place private entry points are named)
// ---------------------------------------------------------------------------

// Wheel: accumulate only (motion applies on the next drain/tick). dy<0 = zoom
// in (swoop down), dy>0 = zoom out.
export function wheel(
  controls,
  { dy, clientX = 640, clientY = 360, ctrl = false } = {}
) {
  controls._onWheel({
    deltaY: dy,
    deltaMode: 0,
    clientX,
    clientY,
    ctrlKey: ctrl,
    preventDefault() {}
  });
}

export function keyDown(controls, code, { shiftKey = false } = {}) {
  controls._onKeyDown({
    code,
    key: code,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    preventDefault() {}
  });
}

export function keyUp(controls, code, { shiftKey = false } = {}) {
  controls._onKeyUp({
    code,
    key: code,
    shiftKey,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    target: null,
    preventDefault() {}
  });
}

export function mouseDown(
  controls,
  { clientX, clientY, button = 0, shiftKey = false, ctrlKey = false } = {}
) {
  controls._onMouseDown({ clientX, clientY, button, shiftKey, ctrlKey });
}

export function mouseMove(controls, { clientX, clientY } = {}) {
  controls._onMouseMove({ clientX, clientY });
}

export function mouseUp(controls) {
  controls._onMouseUp();
}

// Per-frame INPUT drain only (drains wheel + WASD, updates the legit/cue
// snapshot). Does NOT advance in-flight tweens.
export function tickInput(controls, dt = 16, n = 1) {
  for (let i = 0; i < n; i++) controls._onTick(dt);
}

// Full-frame drive: fans out to EVERY tick subscriber — the in-flight tween
// AND _onTick — in subscription order. Use where tween progress or
// subscriber ordering matters.
export function tickAll(controls, dt = 16, n = 1) {
  for (let i = 0; i < n; i++) controls._tick._tick(dt);
}

// Real-DOM dispatch variants (wiring smoke set only).
export function dispatchWheel(
  controls,
  { dy, clientX = 640, clientY = 360, ctrl = false } = {}
) {
  const evt = new WheelEvent('wheel', {
    deltaY: dy,
    deltaMode: 0,
    clientX,
    clientY,
    ctrlKey: ctrl,
    cancelable: true,
    bubbles: true
  });
  controls._domElement.dispatchEvent(evt);
}

export function dispatchMouseDown(
  controls,
  { clientX, clientY, button = 0, shiftKey = false } = {}
) {
  controls._domElement.dispatchEvent(
    new MouseEvent('mousedown', {
      clientX,
      clientY,
      button,
      shiftKey,
      bubbles: true,
      cancelable: true
    })
  );
}

export function dispatchWindowMouseMove({ clientX, clientY }) {
  window.dispatchEvent(
    new MouseEvent('mousemove', { clientX, clientY, bubbles: true })
  );
}

export function dispatchWindowMouseUp() {
  window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
}

export function dispatchKey(type, code, { shiftKey = false } = {}) {
  window.dispatchEvent(
    new KeyboardEvent(type, {
      code,
      key: code,
      shiftKey,
      bubbles: true,
      cancelable: true
    })
  );
}

// ---------------------------------------------------------------------------
// Observation helpers (frozen surface only)
// ---------------------------------------------------------------------------

export function tilt(camera) {
  return cameraTiltDegrees(camera);
}

export function pose(camera) {
  return {
    pos: camera.position.clone(),
    quat: camera.quaternion.clone(),
    fov: camera.fov
  };
}

// Project a world point to pixel coordinates in the dom rect (for the
// "pivot stays fixed" assertions). Returns { x, y, behind }.
export function screenOf(camera, dom, worldPoint) {
  const rect = dom.getBoundingClientRect();
  const v = worldPoint.clone().project(camera); // NDC
  return {
    x: rect.left + ((v.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - v.y) / 2) * rect.height,
    behind: v.z > 1
  };
}

// Attach an event listener for an arbitrary controls event type; returns
// { count, events }.
export function onEvent(controls, type) {
  const rec = { count: 0, events: [] };
  const fn = (e) => {
    rec.count++;
    rec.events.push(e);
  };
  controls.addEventListener(type, fn);
  rec.stop = () => controls.removeEventListener(type, fn);
  return rec;
}

// ---------------------------------------------------------------------------
// Clock stub (§2 — performance.now/Date.now are on an exercised path)
// ---------------------------------------------------------------------------

let _clockState = null;

export function stubClock() {
  const realPerfNow = performance.now.bind(performance);
  const realDateNow = Date.now.bind(Date);
  _clockState = { realPerfNow, realDateNow, t: 1000 };
  performance.now = () => _clockState.t;
  Date.now = () => _clockState.t;
}

function restoreClock() {
  if (_clockState) {
    performance.now = _clockState.realPerfNow;
    Date.now = _clockState.realDateNow;
    _clockState = null;
  }
}

// ---------------------------------------------------------------------------
// Teardown (§2 — hermetic; dispose every instance, drop globals, restore clock)
// ---------------------------------------------------------------------------

// Clear scene-derived globals a test relies on being ABSENT. Notably the
// representative scene's scatter mesh classifies as a rejected scatter (not a
// solid floor) ONLY while `globalThis.STREET` (the asset catalog) is
// undefined — a STREET left behind by another suite would reclassify it and
// silently break the floor/scatter fixtures. Run at BOTH setup and teardown.
export function clearSceneGlobals() {
  delete globalThis.STREET;
  if (globalThis.AFRAME) delete globalThis.AFRAME;
}

export function teardownAll() {
  for (const c of _liveControls) {
    try {
      c.dispose();
    } catch (_e) {
      /* best-effort */
    }
  }
  _liveControls.clear();
  // THREE is deliberately NOT deleted here: the SUT captured it at module-load
  // time (dynamic import, cached across the whole worker), so dropping the
  // global mid-run would strand the already-loaded class with a dangling
  // reference. STREET/AFRAME, by contrast, are read live per test and must be
  // cleared so scene classification stays hermetic.
  clearSceneGlobals();
  restoreClock();
}

// ---------------------------------------------------------------------------
// Break-it harness — per-proxy invariant disablement
// ---------------------------------------------------------------------------

// Monkey-patch a specific invariant OFF for the duration of `fn`, then
// restore. `which` selects which invariant's implementation is disabled.
export function withInvariantDisabled(controls, which, fn) {
  const saved = {};
  try {
    if (which === 'clearZoomUndo') {
      // Strategy B (TASK-036 step 6): the zoom-undo reset moved to the
      // wheel-swoop engine — patch it there. Every clear path (funnel callback,
      // WASD, preset tweens, compass) reaches this same method.
      saved.fn = controls._wheel.clearZoomUndo;
      controls._wheel.clearZoomUndo = () => {};
    } else if (which === 'grounded') {
      // Force grounded re-derivation to a no-op: _deriveGroundedFromPose
      // normally re-reads grounded from the settled pose; disable it so the
      // stale grounded flag persists across the settle.
      saved.fn = controls._groundedState.deriveFromPose;
      controls._groundedState.deriveFromPose = () => {};
    } else if (which === 'rotationEndForWasd') {
      saved.fn = controls._endRotationGestureForWasd;
      controls._endRotationGestureForWasd = () => {};
    } else if (which === 'idleGateStale') {
      // Model "the situation sensor goes stale DURING motion": let the first
      // evaluation run (establishing the baseline) then skip every subsequent
      // one, so a cue that should transition mid-flight never fires. This is a
      // sharper break than disabling the whole method — it reproduces a sensor
      // that stops re-probing once the camera starts moving.
      saved.fn = controls._updateLegitSnapshotAndCue;
      let firstDone = false;
      controls._updateLegitSnapshotAndCue = function () {
        if (firstDone) return undefined;
        firstDone = true;
        return saved.fn.call(this);
      };
    } else {
      throw new Error(`withInvariantDisabled: unknown target '${which}'`);
    }
    return fn();
  } finally {
    if (which === 'clearZoomUndo') {
      controls._wheel.clearZoomUndo = saved.fn;
    } else if (which === 'grounded') {
      controls._groundedState.deriveFromPose = saved.fn;
    } else if (which === 'rotationEndForWasd') {
      controls._endRotationGestureForWasd = saved.fn;
    } else if (which === 'idleGateStale') {
      controls._updateLegitSnapshotAndCue = saved.fn;
    }
  }
}

// ---------------------------------------------------------------------------
// Scene-probe read-outs (used by tests to confirm a real hit — the real-surface gate)
// ---------------------------------------------------------------------------

// The collision floor directly below the camera: { y, source }. Read-only
// (refreshCache:false) so an observation never mutates `_lastGroundY` and
// perturbs a subsequent probe-miss fallback.
export function floorBelow(controls, camera) {
  // Collision probing lives in the CollisionProbe module (controls._probe).
  // This drive/observation layer is the single place the moved private surface
  // is re-pointed; the assertion files never name it.
  return controls._probe.collisionFloorAt(
    camera.position.x,
    camera.position.z,
    {
      refreshCache: false
    }
  );
}

// AGL = camera.y − collision floor y directly below.
export function aglBelow(controls, camera) {
  return camera.position.y - floorBelow(controls, camera).y;
}

// Drive wheel-IN (swoop descent) one frame at a time until AGL ≤ targetAgl or
// maxTicks is reached. Returns the number of ticks driven.
export function driveSwoopIn(
  controls,
  camera,
  targetAgl,
  { maxTicks = 400, clientX = 640, clientY = 360 } = {}
) {
  let i = 0;
  for (; i < maxTicks; i++) {
    if (aglBelow(controls, camera) <= targetAgl) break;
    wheel(controls, { dy: -100, clientX, clientY });
    tickInput(controls, 16);
  }
  return i;
}

// Drive wheel-OUT (ascent) for n frames.
export function driveSwoopOut(
  controls,
  n = 80,
  { clientX = 640, clientY = 360 } = {}
) {
  for (let i = 0; i < n; i++) {
    wheel(controls, { dy: +100, clientX, clientY });
    tickInput(controls, 16);
  }
}

// Capture whether an assertion callback threw (used by break-it checks to
// assert a proxy reds under disablement).
export function assertionFails(fn) {
  try {
    fn();
    return false;
  } catch (_e) {
    return true;
  }
}
