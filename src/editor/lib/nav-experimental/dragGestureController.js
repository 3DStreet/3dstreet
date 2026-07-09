/* global THREE */

import { RotationIndicator } from './rotationIndicator.js';
import {
  LB_PAN_MAX_STEP_METRES,
  EYE_MARGIN_METRES,
  MIN_ORBIT_RADIUS_METRES,
  LB_TWEEN_HYSTERESIS_DEGREES
} from './constants.js';
import {
  cameraTiltDegrees,
  decideLbMode,
  decideLbModeHysteresis,
  decideDragModeSwitch,
  clampOrbitRadius,
  shiftRotateStep,
  viewRayGroundPoint
} from './navMath.js';
import { captureNavDiscovery } from '../navAnalytics.js';

// Frozen read-only world-up axis (cross-product operand). Never mutated,
// never returned.
const _WORLD_UP = Object.freeze(new THREE.Vector3(0, 1, 0));

// The drag-gesture controller — the merged pan + rotate mouse gesture core. Owns
// the letterbox sub-mode comparator (the `nav-experimental:modechange` LB
// stream), the rotation ring indicator, the live-Shift pan<->rotate switch, all
// three pan sub-modes (screen / truck / pedestal) and both rotation regimes (Map
// orbit around a cursor pivot / Street rotate-in-place). The orchestrator keeps
// the mouse entry points (_onMouseDown / _onMouseMove / _onMouseUp) as thin
// routers that own only the window-listener attach/detach + the gesture-end
// recovery call; everything gesture-specific lives here behind
// beginGesture / onMove / endGesture.
//
// Reads the live camera / DOM / scene / services through the shared controls
// context, carries its own scratch, and commits camera writes through the write
// funnel (invalidate zoom-undo on ACTUAL movement only — the jitter guard —
// but always dispatch).
export class DragGestureController {
  constructor(ctx) {
    this._ctx = ctx;
    // The rotation ring (Map-orbit pivot indicator) — DRG-private.
    this._indicator = new RotationIndicator(ctx.sceneEl);
    // Last emitted LB sub-mode (letterbox comparator state); lazily seeded.
    this._currentLbMode = null;
    // Which mouse button latched the current gesture (0 = LB, 2 = RMB); the
    // mid-drag Shift mode-switch applies to LB drags only.
    this._gestureButton = null;
    // Last cursor coords, kept fresh so a mid-drag Shift toggle can re-latch the
    // sub-gesture at the current position.
    this._lastClientX = null;
    this._lastClientY = null;
    // Pointer delta scratch.
    this._pointer = new THREE.Vector2();
    this._pointerOld = new THREE.Vector2();
    // Own scratch — never aliases another gesture's.
    this._tmpV3c = new THREE.Vector3();
    this._tmpNDC = new THREE.Vector2();
    this._raycaster = new THREE.Raycaster();
    this._anchorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    // Per-move pan/rotate scratch. The three pan sub-modes are mutually
    // exclusive within one onMove (dispatched on the latched sub-mode), so they
    // share these slots; each is a pure-local temp consumed within the handler.
    this._tmpHNow = new THREE.Vector3();
    this._tmpDelta = new THREE.Vector3();
    this._tmpRight = new THREE.Vector3();
    this._tmpCamRight = new THREE.Vector3();
  }

  // --- Gesture lifecycle (driven by the orchestrator's thin mouse routers) ---

  // Begin a mouse gesture. The orchestrator has already decided the mode and
  // aborted any in-flight camera tween; this seeds the pointer baseline, catches
  // a stale-from-tween LB-mode, records the button, latches the sub-gesture, and
  // emits the coarse modechange.
  beginGesture(event, mode) {
    this._pointerOld.set(event.clientX, event.clientY);
    this._lastClientX = event.clientX;
    this._lastClientY = event.clientY;
    // Catch stale-from-tween states (a Plan View / focus tween moved the
    // camera across the tilt boundary without going through _shiftRotate). Emit a
    // fresh LB-mode if changed, before the gesture latches.
    this.resolveLetterbox();
    this._gestureButton = event.button;
    if (mode === 'pan') {
      this._beginPanSubGesture(event.clientX, event.clientY);
    } else if (mode === 'rotate') {
      this._beginRotateSubGesture(event.clientX, event.clientY);
    }
    this._ctx.emitModeChange(mode);
  }

  // Per-move step: route to the latched pan sub-mode or the rotate step.
  onMove(event) {
    if (this._ctx.isInactive() || !this._ctx.latch.isActive()) return;
    this._pointer.set(event.clientX, event.clientY);
    const dx = this._pointer.x - this._pointerOld.x;
    const dy = this._pointer.y - this._pointerOld.y;
    this._pointerOld.copy(this._pointer);
    // Keep the last-cursor coords fresh for Shift toggles.
    this._lastClientX = event.clientX;
    this._lastClientY = event.clientY;

    const mode = this._ctx.latch.get('mode');
    if (mode === 'pan') {
      // Count the first real pan drag here (not at mousedown), so a click that
      // never moves doesn't register as a pan.
      captureNavDiscovery('pan');
      const subMode = this._ctx.latch.get('subMode');
      if (subMode === 'pan-screen') {
        this._lbScreenPan(event.clientX, event.clientY);
      } else if (subMode === 'pan-pedestal') {
        this._lbPedestalMove(event.clientX, event.clientY);
      } else {
        this._lbTruckMove(event.clientX, event.clientY);
      }
    } else if (mode === 'rotate') {
      captureNavDiscovery('rotate');
      this._shiftRotate(dx, dy);
      // The letterbox re-evaluates the moment the tilt crosses T: `_shiftRotate`
      // ends in `funnel.dispatch()`, which resolves it at exact T — no explicit
      // call needed here.
    }
  }

  // End the active gesture; returns the ended mode ('pan' | 'rotate' | null) so
  // the orchestrator can decide gesture-end recovery. Window-listener detach +
  // the recovery call stay on the orchestrator.
  endGesture() {
    this._gestureButton = null;
    let endedMode = null;
    if (this._ctx.latch.isActive()) {
      // Capture the mode BEFORE latch.end() nulls the value bag.
      endedMode = this._ctx.latch.get('mode');
      this._ctx.latch.end();
      this._ctx.emitModeChange(null);
      // Hide the ring on any latch-end via mouseup so it can't leak visible.
      this._indicator.hide();
      // Safety-net recompute in case the final move was missed.
      this.resolveLetterbox();
    }
    return endedMode;
  }

  // Hide the rotation ring (orchestrator window-blur cleanup).
  hideIndicator() {
    this._indicator.hide();
  }

  // Release the rotation ring's resources (orchestrator dispose).
  dispose() {
    if (this._indicator) this._indicator.dispose();
  }

  // LB sub-mode from the live tilt. Street-level mode off (Stage 1): a
  // single screen-space pan ('pan-screen') at every tilt — the legacy
  // THREE.EditorControls LB behaviour. The tilt-gated truck/pedestal split
  // (and the letterbox indicator driven off it) is the Stage 2 street mode
  // and only engages when street-level is enabled. The single decision point
  // for all three callers (the mode cache, the mode-change emitter, and the
  // pan gesture latch).
  // Compute the LB sub-mode from the live camera. Street-level off (Stage 1)
  // short-circuits to 'pan-screen'. `useHysteresis` selects the eval mode: exact
  // T (the default — every real-time write, every settle, and the indicator's
  // initial seed) or a dead-band δ around T (only a committed-motion-runner tween
  // frame, so a tween settling on / running along T can't strobe the indicator).
  // A null `_currentLbMode` anchor falls through to exact T even under hysteresis
  // (nothing to hold across the band yet — seed first).
  _decideLbModeLive(useHysteresis = false) {
    if (!this._ctx.streetLevelEnabled) return 'pan-screen';
    const tilt = cameraTiltDegrees(this._ctx.camera);
    if (useHysteresis && this._currentLbMode != null) {
      return decideLbModeHysteresis(
        tilt,
        this._ctx.tiltThreshold,
        LB_TWEEN_HYSTERESIS_DEGREES,
        this._currentLbMode
      );
    }
    return decideLbMode(tilt, this._ctx.tiltThreshold);
  }

  // Phase 2: read the cached LB sub-mode for the visual indicator. The
  // hook (`useNavMode`) calls this on mount to seed initial state, then
  // listens for `nav-experimental:modechange` for updates. Forces a
  // recompute if the cache is empty so the first read is always honest.
  getCurrentLbMode() {
    if (this._currentLbMode == null && this._ctx.camera) {
      this._currentLbMode = this._decideLbModeLive();
    }
    return this._currentLbMode;
  }

  // Recompute the LB sub-mode from the live camera and emit `modechange` on a
  // transition (emit-on-change — a no-op otherwise). This is the single
  // letterbox resolution point: the camera-write funnel calls it on every write
  // (exact-T via `dispatch`, hysteresis via `commitTween`), and the handful of
  // non-camera-write triggers (gesture-start seed, gesture-end safety-net, the
  // Shift-switch re-latch, the WASD-yield, and the T / street-level setters,
  // which flip the comparator at a fixed pose with no camera write to ride)
  // call it directly with exact T (`useHysteresis` omitted).
  resolveLetterbox(useHysteresis = false) {
    if (!this._ctx.camera) return;
    const next = this._decideLbModeLive(useHysteresis);
    if (next !== this._currentLbMode) {
      this._currentLbMode = next;
      this._ctx.emitModeChange(next);
    }
  }

  // Mouse-mode dispatch. Phase 1 returns 'pan' (LB) or 'rotate' (Shift+LB).
  // Phase 2 splits the 'pan' branch further at gesture-start time via
  // `decideLbMode(cameraTiltDegrees(camera))`.
  decideMouseMode(event) {
    // RMB = rotate, identical to Shift+LB — legacy-EditorControls parity
    // (its mapping was LB pan / MMB zoom / RMB rotate; the canvas context
    // menu is suppressed). Unlike LB, an RMB drag never mode-switches on
    // Shift (see the `_gestureButton` guard in `_syncDragModeToShift`),
    // matching the legacy controls' LB-only Shift toggle.
    if (event.button === 2) return 'rotate';
    if (event.button !== 0) return null;
    if (event.shiftKey) return 'rotate';
    return 'pan';
  }

  // Start (or restart, mid-drag) the pan sub-gesture. The
  // truck-vs-pedestal pick reads the *current* tilt here (not at the call
  // site), so a mid-drag rotate→pan switch re-picks the sub-mode from the
  // live tilt — the pan-side mirror of the rotate-side regime re-eval.
  // truck-mode (> T looking down) keeps the horizontal-plane anchor;
  // pedestal-mode (everything else) uses a vertical plane through the
  // anchor. `_latch.start` replaces the latch's value bag wholesale, so a
  // rotate→pan switch wipes the stale rotate keys (center/regime).
  _beginPanSubGesture(clientX, clientY) {
    // A pan sub-gesture never shows the ring. Hide it
    // here at the single pan-start point so a mid-drag Map-rotate→pan
    // switch (Shift released while the button is still held) clears the
    // ring left visible by the rotate — otherwise it leaks on the stale
    // pivot for the rest of the drag (it only marks a Map-rotate pivot).
    this._indicator.hide();
    const subMode = this._decideLbModeLive();
    const anchor = this._ctx.cursorAnchor.worldPointAt(clientX, clientY);

    if (subMode === 'pan-screen') {
      // Stage 1 screen-space pan: plane through the anchor whose normal is
      // the camera-facing direction (i.e. parallel to the image plane).
      // Translating the camera within this plane keeps the anchor under the
      // cursor and moves purely in the camera's right/up basis — the legacy
      // ⊥-to-camera pan. The plane is latched at gesture start (the pan
      // never rotates the camera, so it stays parallel to the image plane).
      const fwd = new THREE.Vector3();
      this._ctx.camera.getWorldDirection(fwd);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const planeAnchor = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
      this._anchorPlane.setFromNormalAndCoplanarPoint(fwd, planeAnchor);
      this._ctx.latch.start({
        mode: 'pan',
        subMode,
        anchor: planeAnchor
      });
    } else if (subMode === 'pan-truck') {
      this._anchorPlane.set(
        new THREE.Vector3(0, 1, 0),
        -anchor.y // signed dist; plane equation y = anchor.y
      );
      this._ctx.latch.start({
        mode: 'pan',
        subMode,
        anchor,
        anchorY: anchor.y
      });
    } else {
      // Pedestal: vertical plane through anchor, normal =
      // camera-forward-horizontal (camera -Z projected onto the
      // horizontal plane and normalized). Spans world-Y plus camera-
      // right-horizontal — sits "in front of" the camera like a
      // window.
      const fwd = new THREE.Vector3();
      this._ctx.camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) {
        // Camera looking straight up or down — degenerate horizontal
        // forward. Fall back to world -Z so the gesture still latches
        // a sane plane; pedestal mode is normally unreachable from
        // straight-up via the tilt clamp, but be defensive.
        fwd.set(0, 0, -1);
      }
      fwd.normalize();
      const planeAnchor = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
      this._anchorPlane.setFromNormalAndCoplanarPoint(fwd, planeAnchor);
      this._ctx.latch.start({
        mode: 'pan',
        subMode,
        anchor: planeAnchor,
        // Stash the plane normal so move-time math doesn't need to
        // re-derive it from the (possibly mid-rotated) camera.
        planeNormal: fwd.clone()
      });
    }
  }

  // Start (or restart, mid-drag) the rotate sub-gesture.
  // `_latchRotationCenter` reads the current tilt to pick the regime
  // (Map orbit vs rotate-in-place) and the pivot, and toggles the ring.
  _beginRotateSubGesture(clientX, clientY) {
    this._latchRotationCenter(this._ctx.camera, clientX, clientY);
  }

  // Make the active LB drag's sub-gesture match the live
  // Shift state. Idempotent and driven by `event.shiftKey` (not by
  // edge-detecting the Shift key), so it is symmetric on keydown/keyup,
  // correct for two Shift keys / autorepeat and Ctrl+Shift
  // orderings. Inert when no LB drag is latched — the latch-active
  // gate is the safety guarantee (not any "drags don't happen while
  // typing" claim): a latched window-bound LB drag survives the cursor
  // moving off-canvas, and a Shift toggle while the button is held is a
  // deliberate switch regardless of focus.
  syncDragModeToShift(shiftHeld) {
    if (this._ctx.isInactive() || !this._ctx.latch.isActive()) return; // only mid-drag
    // LB drags only: an RMB rotate is Shift-independent (legacy parity —
    // EditorControls' Shift toggle applied to `event.buttons === 1` only).
    if (this._gestureButton !== 0) return;
    const desired = decideDragModeSwitch(
      this._ctx.latch.get('mode'),
      shiftHeld
    );
    if (desired === null) return; // already in the desired mode
    if (desired === 'rotate') {
      this._beginRotateSubGesture(this._lastClientX, this._lastClientY);
    } else {
      this._beginPanSubGesture(this._lastClientX, this._lastClientY);
    }
    // Reset the pointer-delta baseline so the first move after the
    // switch doesn't apply an accumulated jump.
    this._pointerOld.set(this._lastClientX, this._lastClientY);
    // Two emit channels, matching the mousedown/mouseup contract:
    // `emitModeChange` carries the coarse 'pan'/'rotate' mode the hook
    // tolerates; `resolveLetterbox` drives the separate pan-truck/pan-pedestal
    // letterbox stream. This is a fixed-pose re-latch (no camera write to ride),
    // so resolve directly at exact T. Firing both keeps the indicator and
    // letterbox consistent after a switch.
    this._ctx.emitModeChange(desired);
    this.resolveLetterbox();
  }

  // WASD ↔ rotation interplay: entering WASD mode (first movement key
  // down) or releasing any held movement key ends an in-progress rotation
  // gesture (Shift+LB or RMB — both latch mode 'rotate'). The latch ends
  // NOW — the still-held button keeps the window listeners until mouseup,
  // but every subsequent move no-ops and the Shift sync can't re-latch
  // (both gate on an active latch) — so rotating again requires a fresh
  // click / Shift press. Pan gestures are left alone (only rotation is
  // specced to yield to WASD).
  endRotationForWasd() {
    if (!this._ctx.latch.isActive()) return;
    if (this._ctx.latch.get('mode') !== 'rotate') return;
    this._ctx.latch.end();
    this._ctx.emitModeChange(null);
    this._indicator.hide();
    this.resolveLetterbox();
  }

  // --- LB screen-space pan (Stage 1 parity-plus) ---
  //
  // The legacy THREE.EditorControls LB behaviour, restored: one continuous
  // pan in the camera's own right/up basis with no tilt-gated mode switch.
  // The drag is anchored on a plane through the cursor's world point whose
  // normal is the camera-facing direction (parallel to the image plane), so
  // the world point under the cursor stays under the cursor. Because that
  // plane tilts with the camera, the same gesture slides across the ground
  // when looking down and pedestals straight up when looking at the horizon
  // — one behaviour that degrades gracefully across tilt. No floor clamp /
  // grounding (Stage 2 machinery): matching legacy, dragging up always lifts
  // back out.
  _lbScreenPan(clientX, clientY) {
    const camera = this._ctx.camera;
    const anchor = this._ctx.latch.get('anchor');
    if (!anchor) return;

    const rect = this._ctx.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._tmpNDC.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._tmpNDC, camera);

    const hNow = this._tmpHNow;
    const ok = this._raycaster.ray.intersectPlane(this._anchorPlane, hNow);
    if (!ok) return; // ray parallel to plane — no-op

    // Both points are coplanar with the image plane, so `delta` has no
    // camera-forward component: the camera translates purely in its
    // right/up basis and the anchor's screen projection is preserved.
    const delta = this._tmpDelta.subVectors(anchor, hNow);
    if (!isFinite(delta.x) || !isFinite(delta.y) || !isFinite(delta.z)) return;

    // Sanity cap to avoid teleports from a degenerate plane solution.
    const stepMag = delta.length();
    const cap = LB_PAN_MAX_STEP_METRES;
    if (stepMag > cap) delta.multiplyScalar(cap / stepMag);

    camera.position.add(delta);
    this._ctx.center.add(delta);
    // Invalidate on ACTUAL movement only — a jitter drag that nets ~0 on the
    // latched plane must NOT invalidate — but always dispatch.
    if (delta.x || delta.y || delta.z) {
      this._ctx.funnel.invalidateWheelMemory('pan');
    }
    camera.updateMatrixWorld();
    this._ctx.funnel.dispatch();
  }

  _lbTruckMove(clientX, clientY) {
    const camera = this._ctx.camera;
    const anchor = this._ctx.latch.get('anchor');
    if (!anchor) return;

    // Compute world point currently under the cursor on the latched
    // horizontal plane y = anchor.y.
    const rect = this._ctx.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._tmpNDC.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._tmpNDC, camera);

    const hNow = this._tmpHNow;
    const ok = this._raycaster.ray.intersectPlane(this._anchorPlane, hNow);
    if (!ok) return; // ray parallel to plane (camera looking horizontally) — no-op

    const dx = anchor.x - hNow.x;
    const dz = anchor.z - hNow.z;
    if (!isFinite(dx) || !isFinite(dz)) return;

    // Sanity cap to avoid teleports if the anchor solution is degenerate.
    const stepMag = Math.hypot(dx, dz);
    let sx = dx;
    let sz = dz;
    const cap = LB_PAN_MAX_STEP_METRES;
    if (stepMag > cap) {
      const k = cap / stepMag;
      sx *= k;
      sz *= k;
    }
    camera.position.x += sx;
    camera.position.z += sz;
    this._ctx.center.x += sx;
    this._ctx.center.z += sz;
    // Invalidate on ACTUAL movement only — a jitter drag that nets ~0 on the
    // latched plane must NOT invalidate — but always dispatch. (no-hit /
    // non-finite cases already early-returned above.)
    if (sx || sz) this._ctx.funnel.invalidateWheelMemory('pan');
    camera.updateMatrixWorld();
    this._ctx.funnel.dispatch();
  }

  // --- LB pedestal move (Phase 2) ---
  //
  // Mirrors `_lbTruckMove` but operates on a *vertical* plane through
  // the latched anchor. Plane normal = camera-forward-horizontal (latched
  // at gesture start). Mouse-X drives camera-right-horizontal motion
  // (truck-right); mouse-Y drives world-Y motion (pedestal-up).
  //
  // The "world point under cursor stays under cursor in 2D" property is
  // preserved as long as the camera-yaw doesn't change during the
  // gesture (which it can't — pedestal mode doesn't rotate the camera).
  _lbPedestalMove(clientX, clientY) {
    const camera = this._ctx.camera;
    const anchor = this._ctx.latch.get('anchor');
    if (!anchor) return;

    const rect = this._ctx.domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._tmpNDC.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._tmpNDC, camera);

    const hNow = this._tmpHNow;
    const ok = this._raycaster.ray.intersectPlane(this._anchorPlane, hNow);
    if (!ok) return; // ray parallel to plane — no-op

    // Decompose the (anchor - hNow) delta onto (camera-right-horizontal,
    // world-up) so a horizontal mouse drag never accidentally introduces
    // a y-component and vice-versa. The intersection point already lies
    // in the plane; this is just choosing a basis to read it in.
    const planeNormal = this._ctx.latch.get('planeNormal');
    if (!planeNormal) return;
    const right = this._tmpRight.crossVectors(planeNormal, _WORLD_UP);
    if (right.lengthSq() < 1e-6) return;
    right.normalize();

    const delta = this._tmpDelta.subVectors(anchor, hNow);
    const stepRight = delta.dot(right);
    const stepUp = delta.y;
    if (!isFinite(stepRight) || !isFinite(stepUp)) return;

    // Sanity cap — same as `_lbTruckMove`. Numerically-degenerate hits
    // (drag near-parallel to plane normal) get clamped, not zeroed.
    const stepMag = Math.hypot(stepRight, stepUp);
    let sR = stepRight;
    let sU = stepUp;
    const cap = LB_PAN_MAX_STEP_METRES;
    if (stepMag > cap) {
      const k = cap / stepMag;
      sR *= k;
      sU *= k;
    }

    camera.position.x += right.x * sR;
    camera.position.z += right.z * sR;
    let newY = camera.position.y + sU;
    // Descent clamp — pedestal-down can't sink
    // through a solid surface. Clamp to collisionFloor + eye-margin at the
    // (post-truck) XZ column. y-write only; the truck-right component is
    // unaffected.
    const floor = this._ctx.probe.collisionFloorAt(
      camera.position.x,
      camera.position.z
    );
    const minY = floor.y + EYE_MARGIN_METRES;
    // Solid-geometry guard: a probe miss (source 'cache' = stale
    // last-known ground, no real surface below) means "no floor below" —
    // outside a finite scene's bounds. No floor clamp, no grounding, so
    // pedestal-down stays available to reach street level.
    const hasFloor = floor.source !== 'cache';
    // Grounded / H edges for pedestal nav.
    // `clampedToFloor` is read BEFORE the assignment — a descent that would
    // have sunk below collisionFloor + eye is "a deliberate down-nav reaching
    // the surface". `dY` (clamped) is the up/down signal; safe to read
    // because the descent clamp is one-directional (only ever raises newY),
    // so for an up-move dY == sU.
    const clampedToFloor = hasFloor && newY < minY;
    if (clampedToFloor) newY = minY;
    const dY = newY - camera.position.y;
    camera.position.y = newY; // commit before any _captureH (reads camera.y)
    this._ctx.center.x += right.x * sR;
    this._ctx.center.z += right.z * sR;
    this._ctx.center.y += dY;
    const EPS = 1e-3;
    if (clampedToFloor) {
      // Pedestal-down reached the descent clamp → grounded.
      this._ctx.grounded.grounded = true;
    } else if (dY > EPS) {
      // Pedestal-up leaves the surface → un-ground + capture H.
      this._ctx.grounded.grounded = false;
      this._ctx.grounded.captureH();
    } else if (dY < -EPS && !this._ctx.grounded.grounded) {
      // Pedestal-down NOT reaching the clamp, while already flying, is
      // deliberate vertical nav → lower H.
      this._ctx.grounded.captureH();
    }
    // Invalidate on ACTUAL movement only — a near-zero-delta drag (no truck, no
    // clamped y-change) must NOT invalidate — but always dispatch.
    // (no-hit / degenerate cases already early-returned above.)
    if (sR || dY) this._ctx.funnel.invalidateWheelMemory('pan');
    camera.updateMatrixWorld();
    this._ctx.funnel.dispatch();
  }

  // Pick the rotation pivot from the live tilt and the cursor position,
  // and latch it for the whole rotate sub-gesture. Two regimes split on T:
  //   Map (tilt > T):    orbit the world point under the cursor (fallback
  //                      chain + far-cap clamp). Show the ring on that point.
  //   Street (tilt ≤ T): rotate in place around the camera's own
  //                      position. No ring.
  // The regime and the ring are LATCHED here at sub-gesture start; the
  // letterbox is driven separately by LIVE tilt (`resolveLetterbox`, exact T on
  // each drag write via the funnel), so mid-drag the two can disagree by design.
  // Do NOT wire the ring off live tilt.
  _latchRotationCenter(camera, clientX, clientY) {
    // Street-level mode off: the Street rotate-in-place regime never
    // engages — rotation is always the Map orbit. At/above the horizon
    // `_mapModePivot`'s defensive fallback (a bounds-radius-ahead ground
    // point) takes over, since the screen-centre ground point is null there.
    const tiltDeg = cameraTiltDegrees(camera);
    const isMap =
      !this._ctx.streetLevelEnabled || tiltDeg > this._ctx.tiltThreshold;
    // Stage 1 (street-level off): rotate about the SCREEN-CENTRE collision
    // point, not the cursor. Cursor-anchored orbit is deferred to Stage 2.
    // We still use the new collision raycast
    // (mesh → ground via `worldPointAt`) and still show the ring — it is
    // just fired through the screen centre instead of the pointer. With
    // street-level on, the cursor pivot (Stage 2) is used as before.
    let pivotX = clientX;
    let pivotY = clientY;
    if (!this._ctx.streetLevelEnabled) {
      const rect = this._ctx.domElement.getBoundingClientRect();
      pivotX = rect.left + rect.width / 2;
      pivotY = rect.top + rect.height / 2;
    }
    const center = isMap
      ? this._mapModePivot(pivotX, pivotY) // bounds sphere + fallback
      : camera.position.clone(); // street: rotate-in-place
    this._ctx.latch.start({
      mode: 'rotate',
      center,
      regime: isMap ? 'map' : 'street'
    });
    if (isMap) {
      this._indicator.show(center);
      // Set the ring's apparent size for the latched pivot *now*, on the
      // same frame as show(). `show()` only sets position + visibility;
      // without this, the first rendered frame (before the first
      // mousemove drives `_shiftRotate`→`update`) uses the previous
      // gesture's scale, which flashes the ring at the wrong size ("circle
      // briefly flashes up massive").
      this._indicator.update(camera);
    } else {
      this._indicator.hide();
    }
  }

  // Map-mode pivot. The fallback rotation centre is the screen-centre
  // ground point `sc` (where the view ray meets y=0). The "bounds" is a
  // circle on the ground CENTRED ON `sc`, radius `_mapPivotBoundsRadius`:
  //   • cursor's ground/mesh hit within that radius of `sc` → orbit the
  //     cursor's point (rigid orbit keeps it pinned under the cursor).
  //   • cursor over sky, OR its hit beyond the radius from `sc` → orbit
  //     `sc` itself (the ring sits there).
  // Both pivots are on the ground (y=0), so rotation visibly pivots a
  // ground feature. (Ideally the pivot's height would be true ground
  // level rather than y=0 — a future improvement gated on the AGL work,
  // not yet landed.)
  //
  // NOTE: `_latchRotationCenter` passes the SCREEN-CENTRE coords here when
  // street-level mode is off (Stage 1 rotate-about-centre), so "the cursor"
  // in the comments below is the screen centre in that path; the cursor-
  // anchored pivot only applies with street-level on (Stage 2).
  //
  // History: replaced (a) the MAX_ORBIT_RADIUS inward cap along the
  // cursor ray, which drifted on tilt when zoomed out; and (b) a
  // fixed-distance point straight ahead, which sat off the ground and
  // read as rotating about the cursor. The bounds centre is `sc`, not the
  // camera nadir/position. Orbiting a far pivot at a shallow
  // ground-skimming angle is otherwise prevented by the two-regime split
  // (below the tilt threshold, rotation is in-place about the camera), so
  // in Map mode (tilt > T, looking down) the view ray always meets y=0.
  _mapModePivot(clientX, clientY) {
    const camPos = this._ctx.camera.position;
    const fwd = this._tmpV3c;
    this._ctx.camera.getWorldDirection(fwd); // unit view direction
    // Screen-centre ground point: bounds centre AND fallback pivot.
    const sc = viewRayGroundPoint(camPos, fwd);
    // Street-level mode off: Map rotation runs at EVERY tilt, and at shallow
    // tilt sc races toward the horizon — orbiting that far point (or a far
    // accepted hit) from a low camera is a violent swing, which then trips
    // gesture-end recovery (read as a position jump on mouseup). Two guards,
    // both computed with the tilt FLOORED at the threshold T ("as if looking
    // down at least T-steep"), so with tilt ≥ T and a near click this path
    // is identical to the unguarded one:
    //   • fallbackCentre — sc recomputed at the floored tilt: identical to
    //     sc while tilt ≥ T; at shallower tilt it stays a NEAR ground point
    //     ahead (height/tan(T) ≈ 2.1×height at the default T) instead of
    //     the horizon point.
    //   • maxHitDist — a cursor hit becomes the pivot only if it is within
    //     gain × height/sin(max(tilt, T)) of the camera; a farther click
    //     REJECTS to the centre pivot, exactly like a sky click. It is NOT
    //     pulled in along the cursor ray — that inward pull-in is the drift
    //     the old MAX_ORBIT_RADIUS cap was removed for (history note (a)
    //     above) and it re-tested as bad here. Near top-down the budget is
    //     gain × height, so any visible click passes.
    // Every pivot stays ON THE GROUND (this module's design value, see the
    // doc comment). Skipped at/below the ground plane (camY <= 0 is
    // degenerate recovery territory) and with street-level mode on, where
    // tilt > T bounds the geometry by construction (parity rule).
    let fallbackCentre = sc;
    let maxHitDist = Infinity;
    if (!this._ctx.streetLevelEnabled && camPos.y > 0) {
      const tEffRad = THREE.MathUtils.degToRad(
        Math.max(cameraTiltDegrees(this._ctx.camera), this._ctx.tiltThreshold)
      );
      maxHitDist =
        (camPos.y / Math.sin(tEffRad)) * this._ctx.mapPivotFarAcceptGain;
      const fwdH = Math.hypot(fwd.x, fwd.z);
      // fwdH ~ 0 = looking straight down; sc is already the nadir point.
      if (fwdH > 1e-6) {
        const ahead = camPos.y / Math.tan(tEffRad);
        fallbackCentre = new THREE.Vector3(
          camPos.x + (fwd.x / fwdH) * ahead,
          0,
          camPos.z + (fwd.z / fwdH) * ahead
        );
      }
    }
    const hit = this._ctx.cursorAnchor.worldPointAt(clientX, clientY);
    let p = fallbackCentre;
    if (hit.source !== 'fallback') {
      // Cursor hit a mesh OR the ground plane: orbit it if it lies within
      // the bounds radius of the screen-centre point (horizontal ground
      // distance). Street-level mode off: ALSO accept a hit within the
      // radius of the CAMERA (horizontal). Map rotation now runs at every
      // tilt, and at shallow tilt sc races to the horizon — the sc-centred
      // test then rejects every nearby ground click (the cursor pivot
      // stops registering and rotation pins to the horizon point). The
      // camera-centred test is gated so the tuned Map-mode bounds are
      // unchanged with the street regime on (where tilt > T keeps sc near
      // the view centre by construction).
      const candidate = new THREE.Vector3(hit.x, hit.y, hit.z);
      const fromSc = sc
        ? Math.hypot(candidate.x - sc.x, candidate.z - sc.z)
        : Infinity;
      const fromCam = this._ctx.streetLevelEnabled
        ? Infinity
        : Math.hypot(candidate.x - camPos.x, candidate.z - camPos.z);
      if (
        Math.min(fromSc, fromCam) <= this._ctx.mapPivotBoundsRadius &&
        candidate.distanceTo(camPos) <= maxHitDist
      ) {
        p = candidate;
      }
    }
    if (!p) {
      // Defensive: no ground intersection ahead (view at/above the
      // horizon — not normally reachable in Map mode) and no cursor
      // ground hit. Drop a fixed-distance-ahead point to the ground.
      const d = this._ctx.mapPivotBoundsRadius;
      p = new THREE.Vector3(camPos.x + fwd.x * d, 0, camPos.z + fwd.z * d);
    }
    // maxR = Infinity → no inward cap; MIN still guards a twitchy
    // very-close pivot.
    return clampOrbitRadius(camPos, p, MIN_ORBIT_RADIUS_METRES, Infinity, fwd);
  }

  // Shift+LB rotation step. Rigid orbit about the latched centre: a
  // single yaw+pitch rotation is applied to both the camera's
  // position-offset-from-centre and its view direction, so the latched
  // pivot stays pinned on screen (under the cursor) at any tilt. In the
  // Street regime the centre is the camera position, so the offset is
  // zero and this degrades to rotate-in-place. Math lives in
  // navMath.shiftRotateStep.
  _shiftRotate(dxPx, dyPx) {
    const camera = this._ctx.camera;
    const center = this._ctx.latch.get('center');
    if (!center) return;

    const fwd = this._tmpV3c;
    camera.getWorldDirection(fwd); // unit, camera -Z in world space
    // In the Map-orbit regime, pass the COLLISION
    // floor under the latched pivot as a reversible floor bound.
    // `shiftRotateStep` caps the *input* down-tilt so the resulting
    // `pos.y >= pivotFloor + EYE_MARGIN` (fixing the old flat-plane y=0+0.5
    // guard), without accumulating over-drag — reversing the drag retraces
    // exactly. Street-mode rotate is rotate-in-place (no vertical motion),
    // so no floor bound there.
    let floorY = null;
    if (this._ctx.latch.get('regime') === 'map') {
      // Only apply the floor bound when the
      // probe actually HIT real geometry. Outside the finite scene the
      // probe misses and returns a stale cached floor (`source==='cache'`)
      // — using it would over-restrict downward orbit tilt. A miss ⇒ no
      // floor bound.
      const pivotFloor = this._ctx.probe.collisionFloorAt(center.x, center.z);
      if (pivotFloor.source !== 'cache') floorY = pivotFloor.y;
    }
    // Camera's screen-right axis (local +X in world space). Used
    // by shiftRotateStep as the pitch axis only at exact nadir, where
    // `view × up` degenerates — lets tilt work out of top-down.
    const camRight = this._tmpCamRight
      .set(1, 0, 0)
      .applyQuaternion(camera.quaternion);
    const { pos, R } = shiftRotateStep({
      camPos: camera.position,
      viewDir: fwd,
      centre: center,
      dxPx,
      dyPx,
      speed: this._ctx.rotationSpeed,
      floorY,
      camRight
    });

    camera.position.copy(pos);
    // Apply the step's rotation as an orientation delta instead
    // of re-deriving it via lookAt(lookTarget). lookAt rebuilds the basis
    // from camera.up = (0,1,0), which is singular at nadir (forward ∥ up)
    // → roll snaps to an arbitrary value (the ~90°/135° jump). premultiply
    // is continuous everywhere and preserves the inherited roll. R is the
    // same rotation shiftRotateStep applied to pos/lookTarget (for the
    // floor-bounded clampedTilt), so position and orientation
    // stay locked. The map-regime floor guard is now the input-tilt bound
    // inside shiftRotateStep (the old applyGroundFloor y-shove was removed),
    // which keeps pos and R consistent — so premultiply is unconditional.
    camera.quaternion.premultiply(R);
    camera.quaternion.normalize(); // guard against drift over a long drag
    // `this._ctx.center` (EditorControls API field) reflects the orbit
    // anchor — distance-from-camera reference used by ActionBar / wheel
    // zoom. Use the latched rotation centre in the orbit case; for the
    // rotate-in-place case (centre coincides with camera) `pos === camPos`
    // and the latched centre equals camera position anyway.
    this._ctx.center.copy(center);
    // Invalidate on ACTUAL movement only (shared with the pan sites — the WE-6 /
    // C1 zero-motion guard: a drag that doesn't move the camera must preserve the
    // wheel zoom-undo memory). The pans express "moved" as a non-zero world-space
    // step; a ROTATE has no world-translation step (a rotate-in-place changes
    // orientation with pos===camPos, zero position delta), so gating on a
    // position delta would wrongly skip the clear on a real rotation. The
    // gesture-appropriate "moved" quantity for a rotate is its non-zero pixel
    // input: R≈identity iff dxPx==dyPx==0, so this is the exact rotate analogue of
    // the pans' world-step gate. Always dispatch regardless.
    if (dxPx || dyPx) this._ctx.funnel.invalidateWheelMemory('rotate');
    camera.updateMatrixWorld();
    // Billboard the ring as the camera orbits. No-op when
    // the ring is hidden (Street regime / not rotating).
    this._indicator.update(camera);
    this._ctx.funnel.dispatch();
  }
}
