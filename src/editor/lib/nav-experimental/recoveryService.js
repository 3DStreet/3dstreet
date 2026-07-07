import { isLegitPose } from './navMath.js';
import { FALL_DURATION_MS } from './constants.js';

// The gesture-end recovery policy — the one bounded automatic camera motion the
// nav principle allows. After a camera-drag (pan/rotate) ends, if the pose is no
// longer legit (buried in solid geometry), ease the camera back to the most
// recent legit pose (the runner's Door-1 recovery, which re-validates every tick
// and hands off once to pop-to-roof on a mid-tween target invalidation) — or, if
// there is no still-valid stored pose, pop straight to the roof.
//
// Reads the legit-pose snapshot from the situation sensor and hands the motion to
// the committed-motion runner; the pop-to-roof fallback is the transition
// controller's, reached through the context.
export class RecoveryService {
  constructor(ctx) {
    this._ctx = ctx;
  }

  maybeRecoverAtGestureEnd() {
    const camera = this._ctx.camera;
    const probe = this._ctx.sensor.enclosureProbe();
    const legitNow = isLegitPose({
      enclosed: probe.enclosed,
      camY: camera.position.y,
      floorY: probe.floorY
    });
    if (legitNow) return; // gesture ended clear — nothing to do.

    const stored = this._ctx.sensor.lastLegitPose;
    if (stored && this._ctx.runner.poseStillLegit(stored)) {
      // Recovery ease-back (runner Door 1). On a mid-tween target invalidation
      // it hands off once to pop-to-roof.
      this._ctx.runner.runRecovery(stored, FALL_DURATION_MS, () =>
        this._ctx.transition.popToRoof()
      );
    } else {
      this._ctx.transition.popToRoof();
    }
  }
}
