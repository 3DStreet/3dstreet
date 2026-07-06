/* global THREE, performance */

import { isSolidFloorHit } from './cursorAnchor.js';
import {
  ENCLOSURE_PROBE_UP_MARGIN_METRES,
  DRONE_ELEVATED_ENTRY_METRES,
  DRONE_ELEVATED_EXIT_METRES
} from './constants.js';
import { isLegitPose, cueState, elevationState } from './navMath.js';

// Downward direction for the enclosure up-ray. Module-level frozen constant so
// the per-tick probe never allocates.
const GROUND_PROBE_DIR = Object.freeze(new THREE.Vector3(0, -1, 0));

// Bounded-fallback cadence (ms) for the idle-gated enclosure probe: while the
// camera is stationary and no scene-geometry-dirty signal fired, re-evaluate at
// most once per this interval so a streaming geometry source we didn't wire
// (e.g. Google 3D Tiles, whose load event lives on the internal TilesRenderer)
// is still picked up within a quarter-second. Caps idle cost at ~4 raycasts/sec.
const ENCLOSURE_FALLBACK_INTERVAL_MS = 250;

// Per-tick situation sensor. From ONE downward enclosure/overhead ray it derives
// three outputs:
//   - lastLegitPose  — the running snapshot recovery eases back to;
//   - the recovery cue (show/hide with hysteresis, emitted on transition);
//   - contextSnapshot — what the view-button resolver reads.
// Idle-gated: a motionless, idle camera (no input/gesture/tween, no geometry-
// dirty signal) costs no raycast. Owns the enclosure probe and this derived
// state; the collision-floor probe (CollisionProbe) is a separate service it
// calls through the context. Reads the live camera/scene/center + the
// `isCameraBusy` predicate + the `dispatch` capability through the context.
export class SituationSensor {
  constructor(ctx) {
    this._ctx = ctx;
    this._origin = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();

    // The most-recent legit camera pose ({ position, quaternion, center }), or
    // null. Read by the gesture-end recovery.
    this.lastLegitPose = null;
    // The per-tick context snapshot the view-button resolver reads (a pure read
    // — the resolver never probes). Initialised so the first poll is valid.
    this.contextSnapshot = {
      enclosed: false,
      floorY: null,
      lookAtFloorY: null,
      topOverhead: null,
      elevationState: 'street'
    };
    this._cueShown = false;
    // Idle-gate eval cache (null until the first tick evaluates).
    this._lastEvalPos = null;
    this._lastEvalQuat = null;
    this._lastEvalTime = 0;
    // Scene-geometry-dirty trigger. Started true so the first settled state
    // always evaluates; set by the scene-geometry listeners (via markGeometryDirty),
    // cleared each time update() actually evaluates.
    this._sceneGeometryDirty = true;
  }

  // Called by the scene-geometry listeners: solid geometry may have changed
  // around a motionless camera (scene load, teleport inside a building, tiles
  // streaming in), so force one re-evaluation on the next tick.
  markGeometryDirty() {
    this._sceneGeometryDirty = true;
  }

  // Overwrite the legit-pose snapshot from the current committed camera pose.
  reseedLegitPose() {
    const camera = this._ctx.camera;
    this.lastLegitPose = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      center: this._ctx.center.clone()
    };
  }

  // Recompute the context snapshot from a fresh probe. Called from every tween
  // onDone (after reseedLegitPose) so the post-settle resolver answer is correct
  // on the first frame the button polls — the idle-gated tick would otherwise
  // leave the icon stale until the next non-idle frame.
  refreshContextSnapshot() {
    this._computeContextSnapshot(this.enclosureProbe());
  }

  // Refresh lastLegitPose if the current pose is legit, and emit the cue on a
  // show/hide transition. One enclosure up-ray (double duty: enclosure +
  // collision floor under the camera) per call. Idle-gated.
  update() {
    const camera = this._ctx.camera;

    // Idle gate. A motionless camera with no active input/gesture/tween cannot
    // change its enclosure/legit/cue state, so skip the whole-scene recursive
    // enclosure raycast. Evaluate when ANY of: the pose moved since last eval,
    // the camera is busy (input/gesture/tween), a geometry-dirty signal fired,
    // the bounded fallback window elapsed, or there is no cache yet.
    const POS_EPS_SQ = 1e-8; // ~1e-4 m
    const QUAT_EPS = 1e-6; // 1 - |dot| threshold
    const moved =
      this._lastEvalPos == null ||
      this._lastEvalQuat == null ||
      camera.position.distanceToSquared(this._lastEvalPos) > POS_EPS_SQ ||
      1 - Math.abs(camera.quaternion.dot(this._lastEvalQuat)) > QUAT_EPS;
    const busy = this._ctx.isCameraBusy();
    const now =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    const fallbackDue =
      now - this._lastEvalTime >= ENCLOSURE_FALLBACK_INTERVAL_MS;
    if (!moved && !busy && !this._sceneGeometryDirty && !fallbackDue) return;

    this._sceneGeometryDirty = false;
    this._lastEvalTime = now;

    if (this._lastEvalPos == null) {
      this._lastEvalPos = camera.position.clone();
      this._lastEvalQuat = camera.quaternion.clone();
    } else {
      this._lastEvalPos.copy(camera.position);
      this._lastEvalQuat.copy(camera.quaternion);
    }

    const probe = this.enclosureProbe();
    const camY = camera.position.y;
    const legit = isLegitPose({
      enclosed: probe.enclosed,
      camY,
      floorY: probe.floorY
    });
    if (legit) {
      if (!this.lastLegitPose) {
        this.lastLegitPose = {
          position: camera.position.clone(),
          quaternion: camera.quaternion.clone(),
          center: this._ctx.center.clone()
        };
      } else {
        this.lastLegitPose.position.copy(camera.position);
        this.lastLegitPose.quaternion.copy(camera.quaternion);
        this.lastLegitPose.center.copy(this._ctx.center);
      }
    }

    // Discoverability cue: keyed off height above the collision floor below,
    // with show/hide hysteresis; enclosure forces show. Street-level mode off:
    // the 'drop' cue advertises the gated street action, so only the enclosure
    // cue may show — the gate feeds the shown state so _cueShown keeps tracking
    // what is displayed.
    const agl = probe.floorY != null ? camY - probe.floorY : 0;
    const nextShown =
      cueState(this._cueShown, agl, probe.enclosed) &&
      (probe.enclosed || this._ctx.streetLevelEnabled);
    if (nextShown !== this._cueShown) {
      this._cueShown = nextShown;
      if (nextShown) {
        this._emitRecoveryCue(probe.enclosed ? 'enclosed' : 'drop');
      } else {
        this._emitRecoveryCue(null);
      }
    }

    // Refresh the context snapshot from this same probe (no extra raycast). MUST
    // live in the post-gate body — never before the idle early-return, or an
    // idle frame would write a snapshot with no fresh probe.
    this._computeContextSnapshot(probe);
  }

  // Build contextSnapshot from an enclosure probe ({ enclosed, floorY,
  // overheadHits }). The agl used for the elevation hysteresis preserves NULL on
  // a probe miss (elevationState HOLDS the previous state on null rather than
  // collapsing to 'street'). topOverhead is the highest overhead solid, or null.
  _computeContextSnapshot(probe) {
    const camY = this._ctx.camera.position.y;
    // The `enclosed` flag would strobe as the view ray crosses a wall mid-orbit
    // (sunshine icon flickers while orbiting THROUGH a building). Gate it on the
    // gesture latch: while a pointer drag/orbit is latched, carry forward the
    // previous `enclosed` only — recompute on settle (pointer-up triggers a
    // non-idle tick; tween onDones call refreshContextSnapshot). Do NOT freeze
    // elevationState (its hysteresis already anti-flickers height). WASD-walking
    // into a building (no latch) still classifies enclosed promptly.
    const enclosed = this._ctx.latch.isActive()
      ? this.contextSnapshot.enclosed
      : probe.enclosed;
    // Look-at-aware elevation. When the straight-down probe MISSES (camera above/
    // outside the footprint), the floor below is null even though the centre ray
    // may be staring at the street — derive a fallback ground from the look-at
    // hit, the SAME point the street action swoops to. Only when floorY == null
    // (when the floor below hits, it governs — skip the extra raycast). Use the
    // per-column floor at P (read-only, refreshCache:false) so it does not
    // perturb the wheel floor cache.
    let lookAtFloorY = null;
    if (!enclosed && probe.floorY == null) {
      const P = this._ctx.probe.centerRayGroundHit();
      if (P) {
        const floorAtP = this._ctx.probe.floorYBelowAt(P.x, P.z, {
          refreshCache: false
        });
        lookAtFloorY = floorAtP.source !== 'cache' ? floorAtP.y : P.y;
      }
    }
    const aglForState =
      probe.floorY != null
        ? camY - probe.floorY
        : lookAtFloorY != null
          ? camY - lookAtFloorY
          : null;
    const topOverhead = probe.overheadHits.length
      ? probe.overheadHits[probe.overheadHits.length - 1]
      : null;
    this.contextSnapshot = {
      enclosed,
      floorY: probe.floorY,
      lookAtFloorY,
      topOverhead,
      elevationState: elevationState(
        this.contextSnapshot.elevationState,
        aglForState,
        DRONE_ELEVATED_ENTRY_METRES,
        DRONE_ELEVATED_EXIT_METRES
      )
    };
  }

  // Emit a transient recovery cue on the sceneEl bus and the controls instance,
  // mirroring the modechange dual-dispatch. `kind` is 'enclosed' | 'drop' to
  // show, or null to hide. Dispatched via the instance-bound `ctx.dispatch` so
  // the `change`/cue event identity matches the frozen external contract.
  _emitRecoveryCue(kind) {
    const event = { type: 'nav-experimental:recovery-cue', kind };
    this._ctx.dispatch(event);
    const sceneEl = this._ctx.sceneEl;
    if (sceneEl && sceneEl.emit) {
      sceneEl.emit('nav-experimental:recovery-cue', { kind }, false);
    }
  }

  // Enclosure / overhead probe at the live camera column. Casts (0,-1,0) from
  // (camera.x, camera.y + UP_MARGIN, camera.z); any accepted hit above the
  // camera means solid overhead → enclosed; the priority floor below is the
  // collision floor (one ray, double duty).
  enclosureProbe() {
    const camera = this._ctx.camera;
    return this.enclosureProbeAt(
      camera.position.x,
      camera.position.y,
      camera.position.z
    );
  }

  // The parameterised enclosure probe — classifies an arbitrary (x, y, z) column.
  // The drone-rise end-pose overhang check calls it with the target pose. Routes
  // the floor selection through the SAME priority picker as the WASD/swoop path
  // (via the collision probe) so isLegitPose / the cue / the resolver read the
  // same floor. `enclosed`/`floorY`/`overheadHits` are relative to the GIVEN y.
  enclosureProbeAt(x, y, z) {
    const sceneEl = this._ctx.sceneEl;
    if (!sceneEl || !sceneEl.object3D) {
      return { enclosed: false, floorY: null, overheadHits: [] };
    }
    this._origin.set(x, y + ENCLOSURE_PROBE_UP_MARGIN_METRES, z);
    this._raycaster.set(this._origin, GROUND_PROBE_DIR);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    const overhead = [];
    for (const hit of hits) {
      if (!isSolidFloorHit(hit)) continue;
      if (hit.point.y > y + 1e-3) {
        overhead.push(hit.point.y);
      }
    }
    overhead.sort((a, b) => a - b);
    const pick = this._ctx.probe.pickFloorFromHits(hits, y, {
      acceptBuildings: true,
      acceptTiles: true
    });
    const floorY = pick ? pick.hit.point.y : null;
    return { enclosed: overhead.length > 0, floorY, overheadHits: overhead };
  }
}
