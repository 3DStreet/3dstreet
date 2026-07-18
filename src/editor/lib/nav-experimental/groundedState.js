import { groundedAtLoad } from './navMath.js';
import { EYE_MARGIN_METRES } from './constants.js';

// Grounded-vs-flying state for the experimental nav controls.
// Shared: the wheel drain, WASD flight, the LB pedestal move, and the preset
// transitions all read AND write it, so it lives in one object rather than
// private to any single gesture.
//
//   grounded — "I'm walking on the surface" vs "I'm flying above it". Ground-
//     true only on a deliberate descent reaching the surface; never because
//     terrain rose under the camera. Cannot be computed truthfully at
//     construction (pose/scene not ready), so it defaults false and is
//     re-derived at every load/teleport edge.
//   H — absolute cruise-height scalar; null = not yet captured. Captured at
//     every un-ground edge, lazily seeded on the first not-grounded step.
//
// Reads the live camera + collision probe through the shared controls context.
export class GroundedState {
  constructor(ctx) {
    this._ctx = ctx;
    this.grounded = false;
    this.H = null;
  }

  // Re-derive `grounded` from the current settled pose: grounded iff the
  // collision floor under the camera was a real hit (not a cache miss) AND the
  // camera sits within eye-margin of it. Forces H=null so the next un-ground
  // edge lazily re-captures a cruise height. Called at every load/teleport edge
  // (reset / new-scene / swoop-land / recovery-tween settle).
  deriveFromPose() {
    const cam = this._ctx.camera;
    const floor = this._ctx.probe.collisionFloorAt(
      cam.position.x,
      cam.position.z
    );
    this.grounded = groundedAtLoad({
      camY: cam.position.y,
      floorY: floor.y,
      source: floor.source,
      eyeMargin: EYE_MARGIN_METRES
    });
    this.H = null;
  }

  // Capture the cruise height H from the current pose (absolute camera y).
  // Called AFTER grounded is set false, at every un-ground edge, and again on
  // deliberate vertical nav while already not-grounded.
  captureH() {
    this.H = this._ctx.camera.position.y;
  }

  // Shared net-upward-rise un-ground check. Given the camera y captured BEFORE a
  // motion (a wheel-drain pass or a toolbar zoom), if the camera ended
  // net-higher the user deliberately left the surface upward → un-ground and
  // re-capture H. A pure-FOV or descending zoom produces no rise and never
  // flips the flag.
  checkUngroundOnRise(startY) {
    const EPS = 1e-3;
    if (this._ctx.camera.position.y > startY + EPS) {
      this.grounded = false;
      this.captureH();
    }
  }
}
