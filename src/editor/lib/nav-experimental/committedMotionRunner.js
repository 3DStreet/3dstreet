/* global THREE */

import { isSolidFloorHit, classifyHitEntity } from './cursorAnchor.js';
import { isLegitPose } from './navMath.js';
import { ENCLOSURE_PROBE_UP_MARGIN_METRES } from './constants.js';

// Downward direction for the candidate re-validation up-ray. Module-level frozen
// constant so the per-tick recovery re-probe never allocates. (Kept per-module
// rather than in constants.js, which must stay THREE-free for the pure navMath
// test layer.)
const GROUND_PROBE_DIR = Object.freeze(new THREE.Vector3(0, -1, 0));

// The committed-motion runner (M2). Every camera-owning tween the nav system
// runs — recovery ease-back, double-click teleport, and the four preset-pose
// motions (pop-to-roof / swoop-to / rise-to-drone / fall-to) — is a "committed
// motion": only its ENDPOINT is validated; the path may pass through solid.
// This module concentrates the parts those tweens duplicated — the ownership
// flags, the anti-stranding cancel, the per-tick write-funnel commit, and the
// onDone settle epilogue — behind TWO entry points:
//
//   - runRecovery(pose, durationMs, onHandoff): the recovery ease-back. It is
//     the ONLY path that re-validates its target every tick and can hand off
//     mid-tween to a pop-to-roof (the `_tick._currentTween` dance). Relocated
//     near-verbatim from the orchestrator — not reworked.
//   - run(policy): the generic committed lerp for the five PRE-validated motions
//     (teleport + the four presets). No per-tick re-validation; each caller
//     supplies its own per-tick pose math (`onTick`) + exact endpoint
//     (`commitPose`) + a parameterized settle policy.
//
// The settle epilogue is NOT uniform across motions (grounded handling differs;
// letterbox / context-snapshot refresh appear on only some paths), so `run`
// takes a `settle` policy object rather than a shared block. The legit-pose
// snapshot + context-snapshot writers themselves live on the SituationSensor
// (reached via ctx) — the runner's settle only calls into them.
export class CommittedMotionRunner {
  constructor(ctx) {
    this._ctx = ctx;
    // "A recovery ease-back / preset motion owns the camera" and "the double-click
    // teleport owns the camera" — the two passive-input gates. Mirror the old
    // orchestrator fields exactly; `ownsCamera()` = their OR.
    this._recoveryActive = false;
    this._teleportActive = false;
    // Own scratch + raycaster for the candidate re-validation probe, so a
    // recovery re-probe never aliases another gesture's scratch even if the
    // suppress-during-tween gate is ever weakened.
    this._tmpV3a = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
  }

  // A camera-owning tween (recovery ease-back / preset motion OR the double-click
  // teleport) is in flight. The PASSIVE input gates (wheel, WASD, toolbar zoom,
  // the legit-snapshot) read this so neither races the tween.
  ownsCamera() {
    return this._recoveryActive || this._teleportActive;
  }

  // A recovery ease-back / preset motion (NOT the teleport) is in flight. Read
  // by the gesture-end recovery guard and the context-button busy predicate.
  isRecovering() {
    return this._recoveryActive;
  }

  // Cancel whatever camera-owning tween is in flight and clear its ownership
  // flags. `tick.cancel()` does NOT run the tween's onDone, so the flag clear
  // must happen here — a naive per-flag clear would strand on any cross-tween
  // pre-emption. Every tween-START path routes through this first. Clears
  // recovery + teleport only — NOT plan-view / compass (those own their own
  // lifecycles; a teleport can never start mid-plan-view/compass).
  cancel() {
    this._ctx.tick.cancel();
    this._recoveryActive = false;
    this._teleportActive = false;
  }

  // Door 1 — the recovery ease-back. Tween the camera back to a stored pose
  // (position + quaternion + center), re-validating the TARGET against current
  // geometry every tick: a newly-streamed tile can render it no longer legit,
  // so hand off to `onHandoff` (pop-to-roof) exactly once. On a clean finish,
  // reseed the legit-pose snapshot from the committed pose (derived grounded).
  runRecovery(pose, durationMs, onHandoff) {
    const ctx = this._ctx;
    const camera = ctx.camera;
    const center = ctx.center;
    const funnel = ctx.funnel;
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const startCenter = center.clone();
    const endPos = pose.position.clone();
    const endQuat = pose.quaternion.clone();
    const endCenter = pose.center.clone();
    // Route the start through the shared cancel so a prior camera-owning tween
    // can't strand its flag. No prior tween in the normal recovery flow → no-op
    // there (behaviour-preserving).
    this.cancel();
    this._recoveryActive = true;
    // Single mid-tween hand-off latch. When the hand-off fires on the SAME frame
    // the tween reaches its final frame, TickAnimator's `sub` still runs its
    // trailing terminal block AFTER onTick returns — it would (a) null
    // `_currentTween`, clobbering the just-started pop tween's handle, and (b)
    // run this stale `onDone`, re-clearing recovery and reseeding to the
    // superseded ease-back target. `handedOff` short-circuits onDone;
    // `handoffTween` (the captured pop handle) is restored as `_currentTween` so
    // the pop tween isn't orphaned.
    let handedOff = false;
    let handoffTween = null;
    ctx.tick.animate({
      durationMs,
      onTick: (eased) => {
        // Re-validate the stored TARGET against current geometry each tick
        // (cheap — the same short probe used at tween start). Hand off to
        // pop-to-roof exactly once.
        if (!handedOff && !this.poseStillLegit(pose)) {
          handedOff = true;
          ctx.tick.cancel();
          this._recoveryActive = false;
          onHandoff();
          // Capture the pop tween's handle (if the handoff started one) so a
          // trailing terminal block on this same final frame can't orphan it.
          handoffTween = ctx.tick._currentTween;
          return;
        }
        camera.position.lerpVectors(startPos, endPos, eased);
        camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        center.lerpVectors(startCenter, endCenter, eased);
        camera.updateMatrixWorld();
        // Per-tick commit: the ease-back moves the camera by a non-wheel
        // mechanism, so clear the wheel zoom-undo memory + dispatch `change`.
        funnel.commitMove('tween');
      },
      onDone: () => {
        // Superseded by a same-frame hand-off — do not run the stale terminal
        // commit. Restore the pop tween's handle in case the trailing block
        // nulled it.
        if (handedOff) {
          if (handoffTween) ctx.tick._currentTween = handoffTween;
          return;
        }
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        center.copy(endCenter);
        camera.updateMatrixWorld();
        funnel.invalidateWheelMemory('tween');
        this._recoveryActive = false;
        // A recovery returns to lastLegitPose, but "legit" is at-or-ABOVE the
        // floor + eye-margin — it can settle you hovering. DERIVE grounded from
        // the settled pose rather than force-true, so a hover recovery does not
        // falsely ground.
        ctx.grounded.deriveFromPose();
        ctx.sensor.reseedLegitPose();
        funnel.dispatch();
      }
    });
  }

  // Door 2 — the generic committed lerp for the five PRE-validated motions
  // (teleport + the four presets). The caller supplies:
  //   - ownership: 'teleport' | 'recovery' (which passive-input gate to hold)
  //   - durationMs
  //   - onTick(eased): the per-motion camera math (position / quaternion /
  //     center / fov). Does NOT clear/dispatch — the runner adds the per-tick
  //     commit.
  //   - commitPose(): snap the exact endpoint (position / quaternion / fov).
  //     Does NOT clear/dispatch.
  //   - perTick: 'commit' (clear wheel memory + dispatch — the 4 presets) or
  //     'dispatch' (dispatch ONLY — the teleport never clears zoom-undo per
  //     tick; it clears once in the settle).
  //   - settle: the parameterized onDone epilogue (see _applySettle).
  // Returns the TickAnimator handle.
  run({
    ownership,
    durationMs,
    onTick,
    commitPose,
    perTick = 'commit',
    settle
  }) {
    const funnel = this._ctx.funnel;
    // Anti-stranding: route every start through cancel first.
    this.cancel();
    // Explicit two-value ownership: 'teleport' or 'recovery'. Reject anything
    // else rather than silently defaulting a typo'd knob into the recovery gate.
    if (ownership === 'teleport') {
      this._teleportActive = true;
    } else if (ownership === 'recovery') {
      this._recoveryActive = true;
    } else {
      throw new Error(
        `CommittedMotionRunner.run: ownership must be 'teleport' or 'recovery', got ${ownership}`
      );
    }
    return this._ctx.tick.animate({
      durationMs,
      onTick: (eased) => {
        onTick(eased);
        if (perTick === 'commit') funnel.commitMove('tween');
        else funnel.dispatch();
      },
      onDone: () => {
        commitPose();
        // Clear the wheel zoom-undo memory (a non-wheel move), then run the
        // per-motion settle, then dispatch the terminal `change`. The clear is
        // first and the dispatch last, with the settle side-effects between —
        // matching every original onDone's ordering.
        funnel.invalidateWheelMemory('tween');
        this._recoveryActive = false;
        this._teleportActive = false;
        this._applySettle(settle);
        funnel.dispatch();
      }
    });
  }

  // The parameterized settle epilogue. Order — grounded → reseed → lbMode →
  // refresh — is observationally identical to each motion's inline onDone (the
  // four steps read the committed pose and write independent state; only lbMode
  // and the terminal dispatch emit events, in that order, in every original).
  _applySettle(settle) {
    if (!settle) return;
    const ctx = this._ctx;
    if (settle.grounded === 'derive') {
      ctx.grounded.deriveFromPose();
    } else if (settle.grounded === 'force-true') {
      ctx.grounded.grounded = true;
    } else if (settle.grounded === 'force-false-captureH') {
      ctx.grounded.grounded = false;
      ctx.grounded.captureH();
    }
    if (settle.reseedLegit) ctx.sensor.reseedLegitPose();
    if (settle.lbMode) ctx.emitLbModeChange();
    if (settle.refreshSnapshot) ctx.sensor.refreshContextSnapshot();
  }

  // Re-validate a stored / candidate pose against CURRENT geometry (a tile may
  // have streamed in around it). Probes enclosure + the collision floor at the
  // stored position. `pose` may be a `{ position }` bag (recovery) OR a bare
  // THREE.Vector3-like point (teleport B/C standoff clearance).
  poseStillLegit(pose, opts = {}) {
    const sceneEl = this._ctx.sceneEl;
    if (!sceneEl || !sceneEl.object3D) return true;
    const p = pose.position || pose;
    this._tmpV3a.set(p.x, p.y + ENCLOSURE_PROBE_UP_MARGIN_METRES, p.z);
    this._raycaster.set(this._tmpV3a, GROUND_PROBE_DIR);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    let enclosed = false;
    for (const hit of hits) {
      if (isSolidFloorHit(hit) && hit.point.y > p.y + 1e-3) {
        enclosed = true;
        break;
      }
    }
    // Select the floor via the SHARED priority picker (segment/building beats a
    // higher tiles rooftop) — same as the collision / enclosure probes — so
    // legit-pose re-validation reads the same floor the WASD/swoop path does.
    const pick = this._ctx.probe.pickFloorFromHits(hits, p.y, {
      acceptBuildings: true,
      acceptTiles: true
    });
    const floorY = pick ? pick.hit.point.y : null;
    // Overhead solid always disqualifies (enclosure half of the predicate).
    if (enclosed) return false;
    // Floor-clearance (eye-margin above the surface beneath the candidate). The
    // B/C standoff caller has ALREADY raised the candidate to floor+eye-margin
    // using its OWN probe and gated on it, so re-checking here against an
    // INDEPENDENT re-probe is redundant — and worse, the two probes can disagree
    // at the exact boundary by a sub-millimetre, wrongly rejecting a low
    // candidate pinned at the boundary. Trust the caller via `skipFloorClearance`.
    // Recovery callers pass no opts → full check, byte-identical to before.
    if (
      !opts.skipFloorClearance &&
      !isLegitPose({ enclosed, camY: p.y, floorY })
    ) {
      return false;
    }
    // The enclosure half rejects a candidate with solid directly overhead, but a
    // downward-only probe can miss a candidate at mid-interior height inside a
    // closed building with no solid straight up. 3DStreet building glTF is
    // single-sided (FrontSide), so a normal-parity test gives a false negative —
    // instead test AABB containment against the building(s) whose column this
    // candidate sits in. Opt-in (`checkBuried`) so existing recovery callers,
    // which pass no opts, are byte-identical.
    if (
      opts.checkBuried &&
      this.pointInsideBuildingHit(p, hits, opts.extraBox)
    ) {
      return false;
    }
    return true;
  }

  // Is `point` inside the AABB of any building entity struck by the candidate
  // column's downward probe? Reuses the existing `hits` (a downward ray through
  // a building the candidate is inside passes through its roof above and its
  // floor below, so the owning building entity is in the list). Sidedness-
  // independent (AABB, not normal parity). De-dupes by owning entity so each
  // building's Box3 is computed at most once. `extraBox`: the Category-B/C
  // TARGET building's Box3, tested unconditionally (the probe-hit scan only
  // catches buildings the candidate's downward ray actually strikes — a shell
  // building with no interior floor slab would be missed). AABB containment
  // treats the full bounding box as solid, so a concave footprint can
  // false-positive a clear standoff in a notch and pull it inward — accepted as
  // low-cost (the camera never ends up buried, only framed from further back).
  pointInsideBuildingHit(point, hits, extraBox) {
    const inBox = (box) =>
      point.x >= box.min.x &&
      point.x <= box.max.x &&
      point.y >= box.min.y &&
      point.y <= box.max.y &&
      point.z >= box.min.z &&
      point.z <= box.max.z;
    if (extraBox && !extraBox.isEmpty() && inBox(extraBox)) return true;
    const seen = new Set();
    for (const hit of hits) {
      if (classifyHitEntity(hit) !== 'building') continue;
      let node = hit.object;
      let el = null;
      while (node) {
        if (node.el) {
          el = node.el;
          break;
        }
        node = node.parent;
      }
      if (!el || !el.object3D || seen.has(el)) continue;
      seen.add(el);
      if (inBox(new THREE.Box3().setFromObject(el.object3D))) return true;
    }
    return false;
  }
}
