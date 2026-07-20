/* global THREE */

import { classifyHitEntity, owningEntity } from './cursorAnchor.js';
import {
  DEFAULT_FOV_DEGREES,
  DOUBLECLICK_MAX_FRAMING_PITCH_DEGREES,
  DOUBLECLICK_STANDOFF_PULLBACK_MAX_METRES,
  DOUBLECLICK_STANDOFF_PULLBACK_STEP_METRES,
  EYE_MARGIN_METRES,
  FALL_DURATION_MS
} from './constants.js';
import {
  classifyDoubleClick,
  pullBackTowardTarget,
  desiredDoubleClickPose,
  clampFramingPitch
} from './navMath.js';

const RAD2DEG = 180 / Math.PI;

// The double-click navigation controller. Classifies what is under the cursor
// from the inbound `nav-experimental:doubleclick` payload, computes a predictable
// "good view" desired pose (navMath, pure), resolves it onto a clear non-buried
// camera pose (standoff + the shared clearance machinery), and hands the teleport
// tween to the committed-motion runner. The endpoint is the ONLY thing validated;
// the tween is a committed motion (it may descend through an intervening roof).
export class DoubleClickNav {
  constructor(ctx) {
    this._ctx = ctx;
  }

  // Double-click navigation. Wired from viewport.js
  // (`nav-experimental:doubleclick` → here) when the experimental flag is on.
  // Classifies what is under the cursor, computes a predictable "good view"
  // desired pose (navMath, pure), resolves it onto a clear non-buried camera
  // pose (never-raise + the shared clearance machinery), and eases
  // the camera there. The endpoint is the ONLY thing validated — the tween is
  // a committed motion (it may descend through an intervening roof).
  navigateDoubleClick(_payload) {
    if (this._ctx.isInactive()) return; // ortho / plan-view / compass — no-op
    const camera = this._ctx.camera;
    if (!camera || camera.type !== 'PerspectiveCamera') return;

    // (1) Single source of truth for "what's under the cursor": the
    // raw A-Frame cursor intersection — NOT getIntersectedEl() (which remaps a
    // lane-child car up to the parent segment) and NOT cursorAnchor's own
    // differently-excluded raycast. The cursor raycasts continuously
    // (interval 100 ms) and the mouse is stationary at a double-click, so its
    // cached intersection is fresh; the payload coords are a redundant
    // fallback we don't need.
    const cursorEntity =
      typeof document !== 'undefined'
        ? document.getElementById('aframeInspectorMouseCursor')
        : null;
    const comps = cursorEntity ? cursorEntity.components : null;
    const cursorComp = comps ? comps.cursor : null;
    const raycasterComp = comps ? comps.raycaster : null;
    const rawEl = cursorComp ? cursorComp.intersectedEl : null;
    let hit = null;
    if (rawEl && raycasterComp) {
      if (typeof raycasterComp.getIntersection === 'function') {
        hit = raycasterComp.getIntersection(rawEl);
      }
      // Defensive: `getIntersection(el)` can return null in some A-Frame
      // states even when the cursor has an `intersectedEl`. The cursor derived
      // `rawEl` from the raycaster's closest intersection, so fall back to it —
      // `intersections[0]` carries `.point` and a `.object` we can walk up to
      // the owning entity.
      if (!hit && Array.isArray(raycasterComp.intersections)) {
        hit = raycasterComp.intersections[0] || null;
      }
    }

    // (2) Classify by owning-entity identity → category. D (no hit) → no-op.
    // (Street-level mode off: raycaster.js routes canvas double-clicks to the
    // legacy objectfocus instead, so this path only runs with the mode on.)
    const category = classifyDoubleClick(classifyHitEntity(hit));
    if (category === 'D') return;

    const hitPoint = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
    let objectBox = null;
    if (category === 'B' || category === 'C') {
      const el = owningEntity(hit.object);
      const obj3D = el && el.object3D ? el.object3D : hit.object;
      objectBox = new THREE.Box3().setFromObject(obj3D);
      if (objectBox.isEmpty()) return; // degenerate — nothing to frame
    }

    // (3) Pre-click heading bearing (0 = +X/North, increasing toward +Z).
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const currentYaw = Math.atan2(fwd.z, fwd.x) * RAD2DEG;

    // (4) Desired pose (pure math).
    const desired = desiredDoubleClickPose({
      category,
      hitPoint,
      objectBox,
      currentYaw,
      eyeHeight: EYE_MARGIN_METRES
    });
    if (!desired) return;
    const position = desired.position;
    const lookTarget = desired.lookTarget;

    // (5) Never-raise, AGL-relative: the
    // camera may never sit higher above the LOCAL collision floor than it
    // currently does. Measure the current height above the floor beneath the
    // camera; the per-column cap is applied in the clearance step below. A void
    // below the camera (no floor) → no downward reference → no cap.
    const currentCamY = camera.position.y;
    const curFloor = this._ctx.probe.collisionFloorAt(
      camera.position.x,
      camera.position.z,
      {
        refreshCache: false
      }
    );
    const currentAGL =
      curFloor.source === 'cache'
        ? Infinity
        : Math.max(0, currentCamY - curFloor.y);

    // (6) Resolve onto a sensible pose against the live scene (probe from the
    // CANDIDATE, not the live camera). A double-click ALWAYS moves; the
    // AGL cap constrains WHERE it lands, never WHETHER.
    if (category === 'A') {
      // Lane landing: eye height above the clicked point, AGL-capped, not
      // buried. (A's clicked point guaranteed a hit; a 'cache' miss is
      // degenerate — keep the desired eye-height Y.)
      const floor = this._ctx.probe.collisionFloorAt(position.x, position.z, {
        fromY: position.y,
        refreshCache: false
      });
      if (floor.source !== 'cache') {
        const cap = floor.y + currentAGL; // AGL never-raise
        if (position.y > cap) position.y = cap; // clamp down — never raise above AGL
        if (position.y < floor.y) position.y = floor.y; // not buried
      }
    } else {
      // B/C: frame at the desired (centre / ⅓-height) Y, AGL-capped, with
      // standoff pull-back out of solid. Always returns a pose (never no-op).
      position.copy(
        this._resolveStandoff(position, lookTarget, currentAGL, objectBox)
      );
    }

    // (7) End orientation from the (possibly lowered/capped) position toward
    // the look target. No double-click path approaches nadir, so a plain
    // up=+Y lookAt is roll-safe (KD-28).
    // Category B: re-apply the framing-pitch cap against the FINAL position
    // — never-raise/standoff lowered the camera since the pure
    // helper's first-pass cap, and the street-level look-up at a tall tower
    // is exactly the case where the final height is well below the desired one.
    let finalLook = lookTarget;
    if (category === 'B') {
      finalLook = clampFramingPitch(
        position,
        lookTarget,
        DOUBLECLICK_MAX_FRAMING_PITCH_DEGREES
      );
    }
    const scratch = new THREE.PerspectiveCamera();
    scratch.position.copy(position);
    scratch.up.set(0, 1, 0);
    scratch.lookAt(finalLook);
    const endQuat = scratch.quaternion.clone();

    // (8) Commit the motion (runner Door 2, teleport). A mid-tween re-click
    // cancels the in-flight tween and restarts from the current (in-flight)
    // pose — the live reads above already used the mid-flight camera, so no
    // jump. `run()` does the cancel + ownership set internally.
    //
    // Like every committed motion, the teleport clears the zoom-undo memory per
    // tick, so an interrupted teleport can't leave stale zoom-undo armed. FOV
    // tweens from its current (in-flight on a re-click) value to the default so a
    // telephoto arrival reframes smoothly; the DEFAULT_FOV_DEGREES literal is
    // used because a construction-time `camera.fov` capture proved unreliable
    // on a re-attach mid-zoom, and 50 is the shared resting FOV across nav views.
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const fromFov = camera.fov;
    const toFov = DEFAULT_FOV_DEGREES;
    const endPos = position.clone();
    this._ctx.runner.run({
      ownership: 'teleport',
      durationMs: FALL_DURATION_MS,
      onTick: (eased) => {
        camera.position.lerpVectors(startPos, endPos, eased);
        camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        camera.fov = fromFov + (toFov - fromFov) * eased;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      },
      commitPose: () => {
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        camera.fov = toFov;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      },
      // Settle: reseed legit-pose so recovery can't ease back to the
      // pre-teleport pose, derive grounded (teleport = a load/teleport edge),
      // and refresh the context-button snapshot so its icon reflects the landed
      // pose immediately. Zoom-undo is cleared and the letterbox re-evaluated
      // from the landed tilt by the terminal `funnel.dispatch()` (uniform for
      // every settle).
      settle: {
        grounded: 'derive',
        reseedLegit: true
      }
    });
  }

  // Resolve a B/C standoff onto a
  // sensible, non-buried camera point. Per candidate column:
  //   - Floor present below the candidate → clamp the height to
  //     `floor + currentAGL` (never higher above the local floor than
  //     the camera currently is) and keep it above the floor (not buried).
  //   - Void below the candidate (probe miss — beyond a bounded scene's edge)
  //     → no floor to measure against, so keep the desired framing height
  //     unclamped. A double-click is NEVER bounded to the finite scene:
  //     a camera hanging over the void at framing distance, looking
  //     back at the edge item, is a valid pose — the finite-scene-boundary
  //     concept was removed system-wide, consistent with WASD/fly,
  //     which holds height over the void rather than snapping back inside.
  // The accept-gate (`_poseStillLegit`, skipping the floor-clearance half —
  // the AGL clamp + not-buried already own height) runs for BOTH floored and
  // void columns: the floor's only jobs are the AGL cap and not-buried, and a
  // void column triggers neither. Pull the standoff inward (toward the look
  // target) ONLY when the candidate is inside SOLID (a building) —
  // never merely because there is no ground beneath it. ALWAYS returns a
  // THREE.Vector3 — never null: the double-click must always move (the cap
  // constrains *where*, not *whether*). If no clear standoff is found within
  // the pull-back budget, fall back to the nominal (outermost floored)
  // candidate — the intended framing distance — rather than refusing.
  _resolveStandoff(position, lookTarget, currentAGL, targetBox) {
    const cand = position.clone();
    const step = DOUBLECLICK_STANDOFF_PULLBACK_STEP_METRES;
    let pulled = 0;
    let fallback = null; // first column with a real floor (nominal framing)
    // Reuse each struck building's AABB across the pull-back iterations (the
    // scene is static, so a box computed once stays valid for the whole walk).
    const boxCache = new Map();
    while (pulled <= DOUBLECLICK_STANDOFF_PULLBACK_MAX_METRES) {
      const floor = this._ctx.probe.collisionFloorAt(cand.x, cand.z, {
        fromY: cand.y,
        refreshCache: false
      });
      // Floor present → AGL never-raise + not-buried clamp. Void (probe
      // miss, beyond bounds) → leave the desired framing height untouched.
      if (floor.source !== 'cache') {
        const cap = floor.y + currentAGL; // AGL never-raise
        if (cand.y > cap) cand.y = cap; // clamp down — never raise above AGL
        if (cand.y < floor.y) cand.y = floor.y; // not buried (below the floor)
        if (!fallback) fallback = cand.clone(); // nominal framing distance
      }
      // Accept unless inside SOLID. Same gate for floored and void columns; a
      // void standoff (not inside the target box, no overhead solid) passes
      // here and is taken at framing distance — never dragged inside.
      if (
        this._ctx.runner.poseStillLegit(
          { position: cand },
          {
            checkBuried: true,
            extraBox: targetBox,
            skipFloorClearance: true,
            boxCache
          }
        )
      ) {
        return cand;
      }
      // Inside solid → pull the standoff inward (toward the look target) and
      // re-test.
      const next = pullBackTowardTarget(cand, lookTarget, step);
      cand.set(next.x, next.y, next.z);
      pulled += step;
    }
    // Always move: no clear standoff found within budget → the nominal floored
    // candidate, or (if no column had a floor at all) the desired position.
    return fallback || position.clone();
  }
}
