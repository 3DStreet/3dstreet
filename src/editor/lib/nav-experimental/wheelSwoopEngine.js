/* global THREE */

import { isSolidFloorHit } from './cursorAnchor.js';
import {
  ZOOM_PER_WHEEL_TICK,
  FOV_PER_WHEEL_TICK,
  WHEEL_MAX_ACCUM_TICKS,
  WHEEL_ACCUM_EPS_TICKS,
  WHEEL_ANCHOR_DENOM_EPS_METRES,
  WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF,
  WHEEL_GROUND_REACH_CEILING_METRES,
  FALLBACK_FORWARD_DIST,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_MAX_TICKS_PER_FRAME,
  SWOOP_PHASE2_FLOOR_SNAP_METRES,
  SWOOP_PHASE3_FOV_FLOOR_DEGREES,
  SWOOP_LANDING_FOV_DEGREES,
  SWOOP_FOV_RAMP_EXPONENT,
  DEFAULT_MAP_FOV_DEGREES,
  PHASE3_FOV_WIDE_CAP_DEGREES,
  REAIM_FADE_NEAR_METRES,
  REAIM_FADE_FAR_METRES,
  PHASE3_REAIM_NDC_EPS,
  DEFAULT_OVERVIEW_TILT_DEGREES,
  SWOOP_PHASE3_STICKY_TOLERANCE_METRES,
  CAMERA_FAR_PLANE_MIN_METRES,
  CAMERA_FAR_PLANE_MAX_METRES,
  CAMERA_FAR_PLANE_DISTANCE_FACTOR
} from './constants.js';
import {
  cameraTiltDegrees,
  wheelDeltaToTicks,
  dollyFactorForTicks,
  fovFactorForTicks,
  cappedDollyStep,
  levelForwardAnchor,
  lateralCap,
  classifySwoopTickTarget,
  reaimWeight,
  decideSwoopPhase,
  phase2TargetTilt,
  phase2AscentTilt,
  swoopLandingFov,
  phase2HeightFrac,
  nextZoomUndo,
  phase2NextElevation
} from './navMath.js';

const DEG2RAD = Math.PI / 180;

// The wheel-swoop engine. Owns the continuous wheel accumulator and the entire
// three-phase "swoop" zoom (Phase 1 cursor-anchored dolly, Phase 2 pedestal +
// tilt-toward-horizontal, Phase 3 street-level FOV zoom with cursor-lock re-aim),
// plus the Ctrl+wheel / no-ground / low-tilt plain-dolly regimes and the
// transient zoom-undo memory. The orchestrator's `_onWheel` router feeds events
// in via `accumulate`; `_onTick` drains one pass per frame via `drain`.
//
// Reads the live camera/scene/services through the shared controls context and
// carries its own scratch (Vector3s, Quaternions, and the re-aim raycaster) so a
// wheel pass never aliases another gesture's scratch.
//
// Per-tick camera writes go through the write funnel as `commitMove('wheel')`
// (dispatch only — the wheel preserves its OWN zoom-undo memory across its own
// moves). The zoom-undo memory is invalidated for NON-wheel moves via
// `clearZoomUndo`, which the funnel's `clearWheelMemory` callback and the WASD /
// preset-tween / compass paths reach.
export class WheelSwoopEngine {
  constructor(ctx) {
    this._ctx = ctx;

    // Continuous wheel accumulator, signed fractional "nominal ticks".
    // `accumulate` normalises each event and adds here (clamped to
    // ±WHEEL_MAX_ACCUM_TICKS); `drain` applies it per frame.
    this._wheelAccum = 0;

    // Transient zoom-undo memory {valid, tilt, fov}. Init valid:false so
    // a session opening inside the swoop band eases to the default overview on
    // the first swoop-out. Mutated only via the nextZoomUndo reducer.
    this._zoomUndo = {
      valid: false,
      tilt: cameraTiltDegrees(ctx.camera),
      fov: ctx.camera.fov
    };

    // Cursor-lock re-aim baseline session | null.
    this._phase3Reaim = null;
    // The regime the last Phase-2 zoom-in tick resolved to.
    this._lastSwoopRegime = null;
    // Break-out dolly excursion depth (nominal ticks).
    this._breakoutDollyDepth = 0;
    // Swoop-OUT ascent anchor {frac, tilt} | null.
    this._ascentAnchor = null;
    // Per-pass ground snapshot below the camera + whether the probe hit a real
    // surface (set at the top of each drain pass).
    this._frameGroundY = 0;
    this._frameGroundHit = false;
    // Latest cursor position + Ctrl state at the last wheel event, read at drain
    // time (null until the first event; the drain guards on == null).
    this._lastWheelClientX = null;
    this._lastWheelClientY = null;
    this._lastWheelCtrlKey = false;

    // Own scratch — never aliases another gesture's.
    this._tmpV3a = new THREE.Vector3();
    this._tmpV3b = new THREE.Vector3();
    this._tmpV3c = new THREE.Vector3();
    this._tmpV3d = new THREE.Vector3();
    this._tmpV3f = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._tmpQuatB = new THREE.Quaternion();
    this._tmpQuatC = new THREE.Quaternion();
    this._reaimRaycaster = new THREE.Raycaster();
    // Caller-owned targets for the navMath / cursorAnchor out-param idiom. Each
    // is filled and consumed within a single drain pass (copied to the camera,
    // or compared then cloned) before the next step reuses it — the three
    // dolly/level-anchor sites are mutually exclusive per drain.
    this._dollyScratch = new THREE.Vector3(); // cappedDollyStep target
    this._levelAnchorScratch = new THREE.Vector3(); // levelForwardAnchor target
    this._ndcScratch = new THREE.Vector2(); // ndcFor target
  }

  // Is a wheel pass pending? (Feeds the situation-sensor idle gate.)
  hasAccum() {
    return this._wheelAccum !== 0;
  }

  // Accumulate only — apply no motion here (the drain
  // owns motion + recovery suppression). Normalise the event to a signed
  // fractional "nominal tick" count (deltaMode-aware, per-event clamped) and add
  // it to the continuous accumulator; latch the cursor position + Ctrl state for
  // drain time.
  accumulate(event) {
    const viewportH =
      typeof window !== 'undefined' && window.innerHeight
        ? window.innerHeight
        : 800;
    this._wheelAccum += wheelDeltaToTicks(
      event.deltaY,
      event.deltaMode,
      viewportH
    );
    // Bound the accumulator so a sustained fast scroll can't build a runaway
    // tail that keeps descending long after the input stops.
    if (this._wheelAccum > WHEEL_MAX_ACCUM_TICKS) {
      this._wheelAccum = WHEEL_MAX_ACCUM_TICKS;
    } else if (this._wheelAccum < -WHEEL_MAX_ACCUM_TICKS) {
      this._wheelAccum = -WHEEL_MAX_ACCUM_TICKS;
    }
    this._lastWheelClientX = event.clientX;
    this._lastWheelClientY = event.clientY;
    // Ctrl+wheel (incl. Mac trackpad pinch) = fixed-tilt zoom escape hatch.
    this._lastWheelCtrlKey = !!event.ctrlKey;
  }

  // Continuous single-drain. ONE frame, ONE ground
  // snapshot, ONE net-vertical bracket, ONE recovery guard. The high & FOV
  // regimes apply the WHOLE pending accumulator as a single continuous step (no
  // quantisation, no multi-frame lag), while the swoop still consumes whole
  // ticks under its per-frame rate-cap, carrying any sub-tick remainder to a
  // later frame. The five responsibilities the safety guard
  // depends on (floor snapshot, recovery suppression, swoop rate-cap,
  // net-vertical un-ground/captureH bracket, active phase-boundary hand-offs)
  // all stay in this one method.
  drain() {
    // A recovery OR teleport tween owns the
    // camera — drop queued wheel.
    if (this._ctx.runner.ownsCamera()) {
      this._wheelAccum = 0;
      return;
    }
    if (this._wheelAccum === 0) return;
    // Snapshot the collision floor once per pass. Every
    // step in the loop — including the recursive swoop ↔ high hand-offs —
    // reads this._frameGroundY so they see a single consistent ground for the
    // frame. The swoop reads the COLLISION floor (ground OR building roof OR
    // tiles), so a swoop over a building lands on the roof.
    const frameFloor = this._ctx.probe.collisionFloorAt(
      this._ctx.camera.position.x,
      this._ctx.camera.position.z
    );
    this._frameGroundY = frameFloor.y;
    // Solid-geometry guard: track whether the probe hit a real
    // surface. On a miss (outside finite bounds) the swoop phase handlers skip
    // every ground-relative clamp so the wheel is a plain anchored dolly.
    this._frameGroundHit = frameFloor.source !== 'cache';
    let changed = false;
    // Capture y before the drain so the net vertical
    // move over the whole pass drives the grounded / H edges once — covering
    // reverse-swoop, low-tilt dolly-up, Phase-2 zoom-out and Ctrl+wheel
    // uniformly, without scattering flags across every wheel branch.
    const wheelStartY = this._ctx.camera.position.y;
    // The swoop rate-cap is a whole-tick budget,
    // latched once at the start of the frame and held for it (re-reading per
    // iteration would unlock extra ticks at a boundary crossing).
    let swoopTicksLeft = SWOOP_PHASE2_MAX_TICKS_PER_FRAME;
    const EPS_TICK = WHEEL_ACCUM_EPS_TICKS;
    while (Math.abs(this._wheelAccum) >= EPS_TICK) {
      const sign = this._wheelAccum > 0 ? 1 : -1;
      const regime = this._decideWheelRegime();
      if (regime === 'swoop') {
        // Within the swoop band, a zoom-IN craning UP at a
        // solid wall / open sky breaks out to a cursor dolly; a zoom-OUT
        // unwinds any such break-out excursion back to the rail
        // before resuming the swoop ascent.
        let breakout;
        if (sign < 0) {
          const r = this._classifyPhase2Target();
          this._notePhase2Regime(r);
          breakout = r === 'dolly';
        } else {
          breakout = this._breakoutDollyDepth > EPS_TICK;
        }
        if (breakout) {
          // Continuous break-out dolly. On the way out, cap the step at the
          // remaining excursion depth so it lands back on the rail and the
          // remainder re-dispatches to the swoop ascent next iteration.
          const t =
            sign < 0
              ? this._wheelAccum
              : Math.min(this._wheelAccum, this._breakoutDollyDepth);
          const tApplied = this._applyBreakoutDolly(t);
          if (tApplied === 0) break;
          this._wheelAccum -= tApplied;
          if (sign < 0) this._breakoutDollyDepth += Math.abs(tApplied);
          else {
            this._breakoutDollyDepth = Math.max(
              0,
              this._breakoutDollyDepth - Math.abs(tApplied)
            );
          }
          changed = true;
        } else {
          // Only fire the swoop on a WHOLE available tick AND with rate-cap
          // headroom. A sub-tick remainder (e.g. 0.3) must NOT drive a full
          // whole-tick descent — carry it to a later frame instead.
          if (swoopTicksLeft < 1 || Math.abs(this._wheelAccum) < 1) break;
          // Restore the entry zoom-undo memory when the swoop
          // is reached without a Phase-1 boundary capture (the no-ground
          // free-descent bypass). Guarded by `!valid` ⇒ a no-op once captured.
          if (sign < 0 && !this._zoomUndo.valid) {
            this._zoomUndo = nextZoomUndo(this._zoomUndo, {
              type: 'wheel-in-crossing',
              tilt: cameraTiltDegrees(this._ctx.camera),
              fov: this._ctx.camera.fov
            });
          }
          this._applyPhase2WheelTick(sign);
          this._wheelAccum -= sign; // consume one whole tick
          swoopTicksLeft -= 1;
          this._breakoutDollyDepth = 0; // a swoop tick commits the excursion
          changed = true;
        }
      } else {
        // high / lowtilt / fov: leaving the swoop band — reset the break-out
        // dolly excursion + regime tracker (KD-14) so a stale value can't
        // spuriously clear a fresh descent's memory. Apply the ENTIRE remaining
        // accumulator as one
        // continuous step (a zoom-in crossing phase1→phase2 stops at the
        // boundary; the remainder re-dispatches to the swoop). Returns the
        // ticks actually consumed.
        this._lastSwoopRegime = null;
        this._breakoutDollyDepth = 0;
        const tApplied = this._applyContinuousHighStep(
          this._wheelAccum,
          regime
        );
        if (tApplied === 0) break; // safety: no progress → stop (no spin)
        this._wheelAccum -= tApplied;
        changed = true;
      }
    }
    if (Math.abs(this._wheelAccum) < EPS_TICK) this._wheelAccum = 0;
    if (changed) {
      const EPS = 1e-3;
      if (this._ctx.camera.position.y > wheelStartY + EPS) {
        // Net-upward pass — deliberate up-move leaves the surface.
        this._ctx.grounded.checkUngroundOnRise(wheelStartY);
      } else if (
        this._ctx.camera.position.y < wheelStartY - EPS &&
        !this._ctx.grounded.grounded
      ) {
        // Net-downward pass while still flying (a swoop landing this pass would
        // have grounded us, so the `!_grounded` test excludes that case) →
        // deliberate vertical nav: lower H.
        this._ctx.grounded.captureH();
      }
      this._ctx.funnel.commitMove('wheel');
    }
  }

  // Decide which regime the wheel is in RIGHT NOW (read each loop iteration
  // off the current, post-step camera pose). Elevation-first: the swoop runs
  // regardless of tilt. 'high' and 'lowtilt' both dolly toward the cursor (the
  // lurch is bounded by the lateral cap in the dolly step, not by switching
  // anchor source), so the two are treated identically by the drain; the labels
  // are retained only to mark the Ctrl / no-ground / low-tilt cases.
  //   'swoop'   — Phase 2 pedestal+tilt band (whole-tick, rate-capped)
  //   'fov'     — Phase 3 street-level FOV-only
  //   'lowtilt' — Ctrl+wheel, no-ground, or live tilt ≤ threshold dolly
  //   'high'    — cursor-anchored Phase 1 dolly
  _decideWheelRegime() {
    const camera = this._ctx.camera;
    // Ctrl+wheel (incl. Mac trackpad pinch) bypasses the swoop — plain
    // camera-Z dolly at the current tilt/elevation.
    if (this._lastWheelCtrlKey) return 'lowtilt';
    // Street-level mode off: never dispatch to the swoop (phase 2) or the
    // street FOV zoom (phase 3) — the wheel is a plain anchored dolly at
    // every height, the same behaviour Ctrl+wheel gives with the mode on.
    if (!this._ctx.streetLevelEnabled) {
      return cameraTiltDegrees(camera) <= this._ctx.tiltThreshold
        ? 'lowtilt'
        : 'high';
    }
    // Solid-geometry guard: no ground below → no swoop floor to
    // land on. Plain anchored dolly at the current tilt, never Phase 2/3.
    if (!this._frameGroundHit) {
      return cameraTiltDegrees(camera) <= this._ctx.tiltThreshold
        ? 'lowtilt'
        : 'high';
    }
    const yAgl = camera.position.y - this._frameGroundY;
    let phase = decideSwoopPhase(yAgl);
    // Float-robust / sticky street level — AGL within
    // a sub-centimetre tolerance of the floor counts as Phase 3 ('fov'), so a
    // rounding ulp at the just-landed boundary (`(groundY+1.5)−groundY` can
    // round to `1.5+ulp`) can't route a street FOV-zoom-out into an immediate
    // reverse swoop. 1 cm shift, imperceptible for swoop entry.
    if (
      phase === 'phase2' &&
      yAgl <=
        SWOOP_PHASE2_EXIT_ELEVATION_METRES +
          SWOOP_PHASE3_STICKY_TOLERANCE_METRES
    ) {
      phase = 'phase3';
    }
    if (phase === 'phase2') return 'swoop';
    if (phase === 'phase3') return 'fov';
    // phase1: tilt-conditional split (LIVE — read instantaneous tilt).
    return cameraTiltDegrees(camera) <= this._ctx.tiltThreshold
      ? 'lowtilt'
      : 'high';
  }

  // Classify the current cursor target as a swoop landing
  // surface or a break-out dolly target. Resolves the cursor anchor (with the
  // additive hit normal) + camera look-direction and defers the cut to
  // navMath.classifySwoopTickTarget.
  _classifyPhase2Target() {
    const hit = this._ctx.cursorAnchor.worldPointAt(
      this._lastWheelClientX,
      this._lastWheelClientY,
      { maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES }
    );
    const isSolidFloor =
      hit.source === 'mesh' ? isSolidFloorHit(hit.raw) : true;
    // Break out only when craning UP at a wall/sky — looking down/level always
    // swoops. Tilt < 0 ⇒ looking above horizontal.
    const lookingUp = cameraTiltDegrees(this._ctx.camera) < 0;
    return classifySwoopTickTarget({
      source: hit.source,
      normalY: hit.normal ? hit.normal.y : null,
      isSolidFloor,
      lookingUp
    });
  }

  // A swoop↔dolly regime switch mid-descent is an intent
  // change — invalidate the transient zoom-undo memory (which also drops the
  // ascent anchor). Per-tick; no latched mode.
  _notePhase2Regime(regime) {
    if (this._lastSwoopRegime != null && regime !== this._lastSwoopRegime) {
      this.clearZoomUndo();
    }
    this._lastSwoopRegime = regime;
  }

  // One continuous break-out dolly step of `t` nominal
  // ticks (the same cursor-anchored dolly as Phase 1, but WITHOUT the
  // phase1→phase2 entry-boundary clamp — we are already inside the band). The
  // caller tracks the excursion depth and caps the unwind. Returns the ticks
  // applied (== t, or 0 if no cursor latch / no real anchor and vertical sky).
  _applyBreakoutDolly(t) {
    const camera = this._ctx.camera;
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    if (x == null || y == null) return t; // no cursor latch → consume, no-op
    let hit = this._ctx.cursorAnchor.worldPointAt(x, y, {
      maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES
    });
    if (hit.source !== 'mesh' && hit.source !== 'ground') {
      hit = levelForwardAnchor(
        camera,
        FALLBACK_FORWARD_DIST,
        this._levelAnchorScratch
      );
      if (hit == null) return t; // near-vertical at sky → consume, no move
    }
    this._dollyAlongRay(dollyFactorForTicks(t, ZOOM_PER_WHEEL_TICK), hit);
    return t;
  }

  // Apply `t` nominal ticks of high/lowtilt/FOV zoom
  // as ONE continuous step. Returns the ticks actually consumed (== `t` for
  // the interior case; a partial value when a boundary or clamp is hit so the
  // loop re-dispatches the remainder). `regime` is one of 'high' | 'lowtilt'
  // | 'fov' from `_decideWheelRegime`.
  //
  // Boundary handling (zoom-in crossing AGL 20 downward): clamp to the
  // Phase-2 entry and capture the transient zoom-undo memory (entry
  // tilt + fov) via `nextZoomUndo`, exactly as the earlier per-tick
  // `_applyPhase1WheelTick` did — Phase 2's descent lerp reads `_zoomUndo.tilt`.
  _applyContinuousHighStep(t, regime) {
    const camera = this._ctx.camera;
    const sign = t > 0 ? 1 : -1;

    if (regime === 'fov') {
      // Phase 3 — FOV zoom at street level (continuous). The wide end is the
      // constant PHASE3_FOV_WIDE_CAP_DEGREES (no per-entry latched baseline).
      // The world point under the cursor is PINNED as FOV changes by re-aiming
      // the camera (_applyPhase3Reaim). The return rule is split by sign so
      // a remainder is never left stuck in the FOV regime (which would spin).
      const fovBefore = camera.fov; // snapshot BEFORE any mutation
      const cap = PHASE3_FOV_WIDE_CAP_DEGREES;
      const floor = SWOOP_PHASE3_FOV_FLOOR_DEGREES;
      // Zoom-out at/above the wide cap → ACTIVE hand-off to the swoop (consume
      // ONE whole tick via the swoop kick-start; just returning the remainder
      // would re-dispatch to 'fov' forever since camera.y hasn't changed). Ends
      // the re-aim session (leaving Phase 3 upward).
      if (sign > 0 && camera.fov >= cap - 1e-6) {
        this._phase3Reaim = null;
        this._applyPhase2WheelTick(sign); // whole-tick swoop kick-start
        return sign;
      }
      let fov = camera.fov * fovFactorForTicks(t, FOV_PER_WHEEL_TICK);
      if (fov < floor) fov = floor;
      if (sign > 0 && fov > cap) fov = cap;
      camera.fov = fov;
      camera.updateProjectionMatrix();
      // Re-aim (skip on Ctrl, or a floored/capped no-op step).
      if (!this._lastWheelCtrlKey && fov !== fovBefore) {
        this._applyPhase3Reaim(fovBefore);
      }
      // Interior FOV step, or zoom-in pinned at the 15° floor. Consume the
      // ENTIRE remaining `t` so the loop terminates rather than spinning.
      return t;
    }

    // Dolly. Cursor-anchored at EVERY tilt (the lurch is bounded by the
    // lateral cap in `_dollyAlongRay`, not by switching anchor source). Anchor
    // dispatch on the
    // hit *source*: mesh/ground → a real target; fallback (open sky) → a
    // LEVEL-forward anchor so zoom-in advances forward at constant height
    // rather than drifting up into empty sky; near-vertical-at-sky → no move.
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    if (x == null || y == null) return t; // no cursor latch → consume, no-op
    let hit = this._ctx.cursorAnchor.worldPointAt(x, y, {
      maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES
    });
    if (hit.source !== 'mesh' && hit.source !== 'ground') {
      hit = levelForwardAnchor(
        camera,
        FALLBACK_FORWARD_DIST,
        this._levelAnchorScratch
      );
      if (hit == null) return t; // near-vertical at sky → consume, no move
    }

    const groundY = this._frameGroundY;
    const yEntry = SWOOP_PHASE2_ENTRY_ELEVATION_METRES;

    // Boundary-aware zoom-in: if the full step would drop AGL below the
    // Phase-2 entry (and there IS a ground), stop exactly at the boundary and
    // hand the remainder to the swoop. Ctrl+wheel is the swoop
    // BYPASS escape hatch — a plain cursor dolly at the current tilt that may
    // descend past AGL 20 without entering the swoop, so skip the boundary when
    // Ctrl is held. Street-level mode off: same bypass — there is no swoop to
    // hand off to, so the dolly descends freely.
    if (
      sign < 0 &&
      this._frameGroundHit &&
      !this._lastWheelCtrlKey &&
      this._ctx.streetLevelEnabled
    ) {
      const denom = camera.position.y - hit.y;
      const targetY = groundY + yEntry;
      // Would the full step land below the entry boundary?
      const fullFactor = dollyFactorForTicks(t, ZOOM_PER_WHEEL_TICK);
      const fullY = hit.y + fullFactor * denom;
      if (fullY < targetY) {
        // Degenerate denominator (near-horizontal anchor ≈ camera height)
        // — the analytic solve divides by ~0. Fall back to the proven
        // per-tick path: apply the full step, then post-step y-clamp exactly
        // as `_applyPhase1WheelTick` does, and consume the whole `t`.
        if (Math.abs(denom) <= WHEEL_ANCHOR_DENOM_EPS_METRES) {
          this._dollyAlongRay(fullFactor, hit);
          if (camera.position.y - groundY < yEntry) {
            camera.position.y = targetY;
            this._zoomUndo = nextZoomUndo(this._zoomUndo, {
              type: 'wheel-in-crossing',
              tilt: cameraTiltDegrees(camera),
              fov: camera.fov
            });
            camera.updateMatrixWorld();
          }
          return t;
        }
        // Solve for the tick fraction t* that lands AGL exactly at the entry:
        //   factor* = (groundY + yEntry − hit.y) / (cam.y − hit.y)
        //   t*      = −ln(factor*) / ln(1 − α)
        const factorStar = (targetY - hit.y) / denom;
        // factorStar should be in (0,1) for a normal descent toward a lower
        // anchor; guard against a non-positive (numerically degenerate) value.
        if (factorStar > 0 && factorStar < 1) {
          const alpha = ZOOM_PER_WHEEL_TICK;
          const tStar = -Math.log(factorStar) / Math.log(1 - alpha);
          this._dollyAlongRay(factorStar, hit);
          camera.position.y = targetY; // exact y-clamp at the entry boundary
          this._zoomUndo = nextZoomUndo(this._zoomUndo, {
            type: 'wheel-in-crossing',
            tilt: cameraTiltDegrees(camera),
            fov: camera.fov
          });
          camera.updateMatrixWorld();
          return tStar; // remainder (t − tStar) re-dispatches to the swoop
        }
        // Degenerate factor* — fall back to the full step + post-step clamp.
        this._dollyAlongRay(fullFactor, hit);
        if (camera.position.y - groundY < yEntry) {
          camera.position.y = targetY;
          this._zoomUndo = nextZoomUndo(this._zoomUndo, {
            type: 'wheel-in-crossing',
            tilt: cameraTiltDegrees(camera),
            fov: camera.fov
          });
          camera.updateMatrixWorld();
        }
        return t;
      }
    }

    // Interior step (no boundary crossing, or free descent with no ground):
    // apply the full continuous dolly and consume the whole `t`.
    this._dollyAlongRay(dollyFactorForTicks(t, ZOOM_PER_WHEEL_TICK), hit);
    return t;
  }

  // Translate the camera along the camera→hit ray by the continuous `factor`
  // (factor < 1 = closer; > 1 = farther), with the HORIZONTAL component of the
  // translation capped (via cappedDollyStep). The cap scales the
  // whole step vector uniformly, so the move stays on the camera→hit ray
  // (target stays under the cursor) and reversibility about a fixed target is
  // exact. `factor` is the continuous form of the whole-tick step
  // (dollyFactorForTicks(t)·dollyFactorForTicks(−t) === 1). A non-finite step
  // (degenerate grazing ray) is dropped — a no-op rather than NaN-ing the
  // camera. The cap scales with height — max(lowerBound,
  // 0.1×AGL) — bounding the lurch proportionally; falls to the lower bound on
  // the no-AGL path (Ctrl+wheel / out of bounds, where AGL is non-finite).
  _dollyAlongRay(factor, hit) {
    const camera = this._ctx.camera;
    const yAgl = this._frameGroundHit
      ? camera.position.y - this._frameGroundY
      : NaN;
    const cap = lateralCap(
      yAgl,
      this._ctx.wheelZoomLateralCapLowerBound,
      WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF
    );
    const newPos = cappedDollyStep(
      {
        camPos: camera.position,
        hit,
        factor,
        lateralCapMetres: cap
      },
      this._dollyScratch
    );
    if (newPos == null) return; // non-finite step: skip this tick
    camera.position.copy(newPos);

    // Track far plane based on distance.
    const distance = camera.position.distanceTo(this._ctx.center);
    camera.far = Math.min(
      CAMERA_FAR_PLANE_MAX_METRES,
      Math.max(
        CAMERA_FAR_PLANE_MIN_METRES,
        distance * CAMERA_FAR_PLANE_DISTANCE_FACTOR
      )
    );
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // Whole-tick Phase 1 / low-tilt dolly used by the swoop's active hand-offs
  // (Phase 2 → Phase 1 zoom-out). These only ever hand off one whole tick's
  // worth, in the same drain pass that latched the cursor — so they keep the
  // whole-tick form (a fractional swoop-exit anchor
  // never arises). Routes to the same `_dollyAlongRay` math the continuous
  // step uses, at the per-whole-tick factor.
  _applyPhase1WheelTick(sign) {
    const camera = this._ctx.camera;
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    if (x == null || y == null) return;
    // Collapsed anchor dispatch (same as the continuous step):
    // cursor at every tilt, level-forward on a no-real-hit (sky), no move when
    // the heading is vertical-undefined.
    let hit = this._ctx.cursorAnchor.worldPointAt(x, y, {
      maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES
    });
    if (hit.source !== 'mesh' && hit.source !== 'ground') {
      hit = levelForwardAnchor(
        camera,
        FALLBACK_FORWARD_DIST,
        this._levelAnchorScratch
      );
      if (hit == null) return; // near-vertical at sky → no move
    }
    this._dollyAlongRay(dollyFactorForTicks(sign, ZOOM_PER_WHEEL_TICK), hit);

    // Solid-geometry guard: no ground below → no Phase-2 boundary.
    if (!this._frameGroundHit) return;

    // Boundary: Phase 1 → Phase 2 on zoom-in (post-step y-clamp). Capture
    // the zoom-undo memory at the crossing, same as the continuous step.
    const groundY = this._frameGroundY;
    if (
      sign < 0 &&
      this._ctx.streetLevelEnabled && // mode off: no Phase-2 boundary to clamp at
      camera.position.y - groundY < SWOOP_PHASE2_ENTRY_ELEVATION_METRES
    ) {
      camera.position.y = groundY + SWOOP_PHASE2_ENTRY_ELEVATION_METRES;
      this._zoomUndo = nextZoomUndo(this._zoomUndo, {
        type: 'wheel-in-crossing',
        tilt: cameraTiltDegrees(camera),
        fov: camera.fov
      });
      camera.updateMatrixWorld();
    }
  }

  // Phase 2 — pedestal + tilt-toward-horizontal. No cursor anchoring.
  // Yaw and (x,z) preserved across the tick; only y and tilt change.
  //
  // Boundary handling at zoom-out is *active*, not deferred to next
  // tick. The naive "clamp at boundary, let next tick re-dispatch"
  // model deadlocks because `decideSwoopPhase(yCeil)` returns 'phase2'
  // (the table is inclusive on the Phase 2 side at y = yCeil) and the
  // next tick fires the boundary again. The active hand-off applies
  // this tick's energy in the destination phase.
  //
  // Runs entirely in AGL space (yAgl = camera.y − groundY), reading the
  // per-pass ground snapshot `this._frameGroundY`, and writes the result
  // back as absolute camera.y = groundY + yAglNext. On a flat
  // scene at y=0 this is behaviour-identical to plain absolute-Y math
  // (modulo one cheap extra probe per pass).
  //
  // Boundary handling (all in AGL):
  //   zoom-in: yAglNext ≤ yFloor → snap to floor, tilt to 0°, FOV eased to the
  //     landing FOV. Next tick dispatches naturally to Phase 3.
  //   zoom-in: yAglNext within SWOOP_PHASE2_FLOOR_SNAP_METRES of yFloor →
  //     snap.
  //   zoom-out: yAgl in [0, yFloor + snap] → kick-start to yFloor + snap.
  //     The multiplicative reciprocal `1.5 + (yAgl-1.5)/(1-α)` is zero at
  //     yAgl=yFloor exactly, so without the kick-start zoom-out from
  //     street level produces no motion. The `yAgl >= 0` lower bound
  //     suppresses a stale-cache teleport (negative AGL — see below)
  //     while preserving every legitimate fresh-probe kick-start.
  //   zoom-out: yAglNext ≥ yCeil → clamp to groundY + yCeil, set tilt to
  //     the recomputed ascentTarget, hand the tick's energy to Phase 1.
  //
  // The DESCENT (zoom-in) tilt lerps
  // the captured entry tilt (`_zoomUndo.tilt`) toward 0° via phase2TargetTilt.
  // The ASCENT (zoom-out) interpolates from the camera's LIVE current tilt
  // toward a target — the captured entry tilt if `_zoomUndo.valid`, else the
  // DEFAULT_OVERVIEW_TILT_DEGREES default — anchored at (startFrac, startTilt)
  // captured on the ascent's first tick (no jump; exact reverse for an
  // immediate undo). Both legs go through the roll-safe re-tilt below.
  _applyPhase2WheelTick(sign) {
    const camera = this._ctx.camera;
    const groundY = this._frameGroundY; // pass snapshot
    const yFloor = SWOOP_PHASE2_EXIT_ELEVATION_METRES; // AGL floor 1.5
    const yCeil = SWOOP_PHASE2_ENTRY_ELEVATION_METRES; // AGL ceil 20
    const snap = SWOOP_PHASE2_FLOOR_SNAP_METRES; // 1.0

    let yAgl = camera.position.y - groundY; // ← convert in

    // The swoop-OUT target, recomputed per-tick (NOT stored — the
    // wheel path never flips `_zoomUndo.valid` mid-ascent, so it is constant
    // across an ascent whether read once or per-tick). Memory valid → reverse
    // to the captured entry tilt; else ease to the default overview.
    const ascentTarget = this._zoomUndo.valid
      ? this._zoomUndo.tilt
      : DEFAULT_OVERVIEW_TILT_DEGREES;
    // The swoop-OUT FOV target mirrors the tilt — memory valid
    // → exact FOV undo (the captured entry FOV); else the default map FOV.
    const ascentTargetFov = this._zoomUndo.valid
      ? this._zoomUndo.fov
      : DEFAULT_MAP_FOV_DEGREES;

    if (sign > 0) {
      // ASCENT (zoom-out): atomically capture the ascent anchor on the FIRST
      // out-tick of this ascent (the sole writer, under the == null guard).
      // Only the TILT needs an anchor (the user can crane the camera mid-swoop,
      // so the ascent tilt must start from the live pose without a jump). FOV
      // can't be perturbed mid-band (only the wheel changes it), so the ascent
      // FOV is a pure function of height (swoopLandingFov) — no anchor needed.
      // `yAgl` here is the PRE-step height (matches the camera's live tilt read
      // below).
      if (this._ascentAnchor == null) {
        this._ascentAnchor = {
          frac: phase2HeightFrac(yAgl),
          tilt: cameraTiltDegrees(camera)
        };
      }
    } else {
      // DESCENT (zoom-in): reset the ascent anchor so the next ascent
      // re-captures from the live pose.
      this._ascentAnchor = null;
    }

    // Zoom-out kick-start (AGL-relative). A FRESH downward probe
    // always yields yAgl >= 0 (the hit ground is below the camera), so
    // the `yAgl >= 0` lower bound preserves EVERY legitimate case —
    // including the saved-scene-below-floor kick-start (a camera at
    // AGL 0.5 on real ground must still kick-start). A NEGATIVE yAgl can
    // only arise from the stale cache (cached ground ABOVE the camera —
    // camera over a gap, reachable via WASD-during-Phase-3 then
    // zoom-out); that is exactly the teleport case to suppress.
    if (sign > 0 && yAgl >= 0 && yAgl <= yFloor + snap) {
      yAgl = yFloor + snap;
    }

    let yAglNext = phase2NextElevation(yAgl, sign);

    // Floor snap on zoom-in — AGL-relative.
    if (sign < 0 && yAglNext - yFloor < snap) {
      yAglNext = yFloor;
    }

    // Boundary: Phase 2 → Phase 3 on zoom-in.
    if (sign < 0 && yAglNext <= yFloor) {
      camera.position.y = groundY + yFloor; // ← write back
      this._setCameraTiltPreservingYaw(0);
      // Reach the landing FOV exactly at the floor (no latched
      // baseline; the wide cap is the PHASE3_FOV_WIDE_CAP_DEGREES constant).
      camera.fov = swoopLandingFov(
        yFloor,
        this._zoomUndo.fov,
        SWOOP_LANDING_FOV_DEGREES,
        SWOOP_FOV_RAMP_EXPONENT
      );
      camera.updateProjectionMatrix();
      // Phase-3 entry ends any ascent geometry; reset the anchor so
      // a fresh ascent re-captures from the live pose (already null on a
      // descent run, but explicit at the band exit).
      this._ascentAnchor = null;
      camera.updateMatrixWorld();
      // The wheel swoop has no onDone — landing
      // IS this Phase-2→3 boundary crossing. DERIVE (don't force-true): the
      // landing height is groundY + SWOOP_PHASE2_EXIT_ELEVATION, a constant
      // INDEPENDENT of EYE_MARGIN, so deriving runs the real ≤ eye-margin test
      // against a fresh collision-floor probe and survives either constant
      // being retuned. `groundY` here is the collision floor under the camera,
      // so a swoop onto a roof grounds to the roof.
      this._ctx.grounded.deriveFromPose();
      return;
    }

    // Boundary: Phase 2 → Phase 1 on zoom-out. Hand the tick off
    // actively so the wheel click visibly continues past AGL=yCeil
    // rather than deadlocking at the boundary.
    if (sign > 0 && yAglNext >= yCeil) {
      camera.position.y = groundY + yCeil; // ← write back
      // The ceiling tilt is the recomputed ascentTarget (the
      // captured entry tilt if memory valid, else the default overview) — the
      // same target the per-tick ascent ramps toward. A ≤90° single-step arc,
      // applied via the roll-safe re-tilt (antiparallel guard not triggered).
      this._setCameraTiltPreservingYaw(ascentTarget);
      // Set FOV to the ascent target in one step (mirrors the
      // tilt), so leaving the band upward always restores a sane FOV (entry FOV
      // if memory valid, else the 60° map default) — closing the stale-FOV
      // window where a re-descent would read a leftover-narrow `_zoomUndo.fov`.
      camera.fov = ascentTargetFov;
      camera.updateProjectionMatrix();
      // Ascent complete at the ceiling: reset the anchor. Above the
      // ceiling the tilt is the user's to set freely (Phase 1 tilt-preserving).
      this._ascentAnchor = null;
      camera.updateMatrixWorld();
      // Now dispatch a Phase 1 tick. This is always the cursor-anchored
      // Phase-1 tick (reads the same
      // `this._frameGroundY` snapshot). This is a sign > 0 (zoom-out) tick
      // and the Phase-1 boundary clamp body is sign < 0-gated, so routing
      // through the full Phase-1 tick does NOT re-fire the clamp or re-latch
      // the ascent/undo tilt state — exactly one anchored dolly
      // step happens here.
      return this._applyPhase1WheelTick(sign);
    }

    camera.position.y = groundY + yAglNext; // ← write back
    // Per-tick re-tilt, branched on direction.
    //   sign < 0 (descent): lerp the captured entry tilt → 0°.
    //   sign > 0 (ascent):  interpolate the ascent anchor (startFrac,
    //     startTilt) → ascentTarget, anchored so there is no jump and
    //     an immediate undo retraces the descent exactly.
    if (sign < 0) {
      this._setCameraTiltPreservingYaw(
        phase2TargetTilt(yAglNext, this._zoomUndo.tilt)
      );
      // Descent FOV ramp — ease the entry FOV open toward the
      // landing FOV as AGL falls, back-loaded into the final stretch.
      camera.fov = swoopLandingFov(
        yAglNext,
        this._zoomUndo.fov,
        SWOOP_LANDING_FOV_DEGREES,
        SWOOP_FOV_RAMP_EXPONENT
      );
    } else {
      this._setCameraTiltPreservingYaw(
        phase2AscentTilt(
          yAglNext,
          this._ascentAnchor.frac,
          this._ascentAnchor.tilt,
          ascentTarget
        )
      );
      // Ascent FOV — a pure function of height (narrow =
      // ascent target), the SAME curve the descent drew, so an immediate undo
      // retraces it exactly; no anchor needed (FOV can't be perturbed mid-band).
      camera.fov = swoopLandingFov(
        yAglNext,
        ascentTargetFov,
        SWOOP_LANDING_FOV_DEGREES,
        SWOOP_FOV_RAMP_EXPONENT
      );
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Phase 2's tilt lerp crosses the tilt threshold silently from the LB-mode
    // comparator's perspective; the wheel drain's terminal `commitMove('wheel')`
    // resolves the letterbox at exact T once per frame, so the toolbar restyles
    // in lock-step with the swoop. (Phase 1 and Phase 3 are tilt-preserving.)
  }

  // Cursor-lock re-aim. Re-aims the camera so the world point
  // under the cursor stays pinned to the same screen pixel as FOV changes. The
  // orientation is rebuilt ABSOLUTELY from a captured baseline pose every tick
  // (not composed incrementally), so it is a pure function of FOV → exactly
  // reversible and unwinds to the entry pose at baseline FOV. The
  // exact ordering is load-bearing — do not reorder:
  //   FOV already applied + updateProjectionMatrix (caller) →
  //   copy baselineQuat + updateMatrixWorld → raycast cursor pixel →
  //   slerp the minimal-arc QUATERNION by the continuity weight → premultiply.
  _applyPhase3Reaim(fovBefore) {
    const camera = this._ctx.camera;
    const ndc = this._ctx.cursorAnchor.ndcFor(
      this._lastWheelClientX,
      this._lastWheelClientY,
      this._ndcScratch
    );

    // Baseline session: capture on the first Phase-3 tick; re-capture at the
    // current pose when the cursor PIXEL moves (a new aim — Δ starts at 0, no
    // jump). The target world point `P` is resolved ONCE at capture and held
    // for the whole session: re-resolving the cursor target
    // every tick breaks the unwind — once the re-aim cranes the camera, the
    // cursor pixel points somewhere else (e.g. sky above the building), so on
    // zoom-out it can't find the original target to un-crane back to. A stable
    // P makes the re-aim a pure function of fov for the session → it unwinds
    // exactly back to the baseline (street) pose as the FOV widens. (Tile
    // streaming voids the retrace — the accepted cost.) baselineFov is the
    // PRE-step FOV.
    if (
      !this._phase3Reaim ||
      ndc.distanceTo(this._phase3Reaim.ndc) > PHASE3_REAIM_NDC_EPS
    ) {
      const hit = this._ctx.cursorAnchor.worldPointAt(
        this._lastWheelClientX,
        this._lastWheelClientY,
        { maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES }
      );
      this._phase3Reaim = {
        baselineQuat: camera.quaternion.clone(),
        baselineFov: fovBefore,
        ndc: ndc.clone(),
        // No real hit (open sky) at capture → no target to pin this session.
        targetP:
          hit.source === 'fallback'
            ? null
            : new THREE.Vector3(hit.x, hit.y, hit.z),
        targetDist: hit.distance
      };
    }
    const reaim = this._phase3Reaim;
    if (!reaim.targetP) return; // sky aim → centre-anchored FOV change

    // camPos is fixed through Phase 3, so the captured P gives a stable aim.
    const toP = this._tmpV3f
      .subVectors(reaim.targetP, camera.position)
      .normalize();
    if (toP.lengthSq() < 1e-12) return; // P ≈ camera position: nothing to aim at

    // Re-orient to the BASELINE quat and refresh matrixWorld BEFORE the
    // raycast, so the cursor-pixel world ray is sampled under (baselineQuat,
    // NEW fov) — not the previous tick's premultiplied orientation.
    camera.quaternion.copy(reaim.baselineQuat);
    camera.updateMatrixWorld();
    this._reaimRaycaster.setFromCamera(reaim.ndc, camera);
    const rayDir = this._reaimRaycaster.ray.direction; // unit, world space

    // Continuity weight: fade re-aim to 0 as the target recedes toward the
    // horizon, so the façade → sky crossing is continuous. Scale the
    // QUATERNION via slerp from identity — never lerp the directions (that would
    // change the axis with the weight and break reversibility).
    const w = reaimWeight(
      reaim.targetDist,
      REAIM_FADE_NEAR_METRES,
      REAIM_FADE_FAR_METRES
    );
    const fullArc = this._tmpQuatB.setFromUnitVectors(rayDir, toP);
    const delta = this._tmpQuatC.identity().slerp(fullArc, w);
    camera.quaternion.premultiply(delta);
    camera.quaternion.normalize();
    camera.updateMatrixWorld();
  }

  // Invalidate the transient zoom-undo memory. Call from a site that
  // has just committed an actual non-wheel camera move (past its own no-op
  // early-returns AND any zero-delta gate). Idempotent (reducer returns
  // valid:false again). One wheel-path caller exists: a
  // swoop↔dolly regime switch mid-descent (`_notePhase2Regime`) is a
  // deliberate intent change that clears the memory — the only sanctioned
  // wheel-path call.
  clearZoomUndo() {
    this._zoomUndo = nextZoomUndo(this._zoomUndo, { type: 'non-wheel-move' });
    // A real non-wheel move also ends any in-flight cursor-lock
    // re-aim session and any Phase-2 descent regime run —
    // the camera is no longer where the captured baseline/regime assumed.
    this._phase3Reaim = null;
    this._lastSwoopRegime = null;
    this._breakoutDollyDepth = 0;
    // ...and any in-flight swoop-out ascent: the anchor captured the pose the
    // ascent tilt eases from, which the move has just invalidated. Dropping it
    // makes the next ascent re-capture from the live pose (no tilt snap).
    this._ascentAnchor = null;
  }

  // Apply a tilt (in degrees from horizontal, positive = looking down)
  // while preserving the camera's current yaw. Used by Phase 2 (both swoop
  // legs).
  //
  // Re-tilt is ROLL-SAFE and NADIR-CONTINUOUS (KD-28). We build the
  // absolute target forward from the live yaw + commanded tiltDeg (so descent
  // and ascent passing through the same height command identically-pointed
  // forwards), then rotate the camera's TRUE current forward onto it with the
  // minimal-arc rotation and apply it via premultiply. The
  // shortest-arc axis `curFwd × newFwd` lies in the yaw-tilt plane (≈ the
  // camera's right axis), never the forward axis, so it adds NO roll — any
  // roll the camera carries in is preserved exactly, and there is no world-up
  // lookAt singularity at nadir.
  _setCameraTiltPreservingYaw(tiltDeg) {
    const camera = this._ctx.camera;
    // (1) Capture the TRUE current forward BEFORE any yaw-flattening — keep it
    //     un-flattened through the rotation build. Flattening it first would
    //     make the "current" forward read as tilt=0 every tick, so the arc to
    //     newFwd would pitch by the FULL tiltDeg every tick (a runaway).
    const curFwd = this._tmpV3d;
    camera.getWorldDirection(curFwd); // TRUE current forward — keep
    // Current yaw from a FLATTENED COPY of the forward.
    const fwd = this._tmpV3a;
    fwd.copy(curFwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) {
      // Camera looking straight up/down — yaw is undefined. Use camera's
      // local +Y projected to horizontal as a stand-in (matches the
      // WASD-degenerate convention).
      this._tmpV3b.set(0, 1, 0).applyQuaternion(camera.quaternion);
      this._tmpV3b.y = 0;
      if (this._tmpV3b.lengthSq() > 1e-6) {
        fwd.copy(this._tmpV3b).normalize();
      } else {
        fwd.set(0, 0, -1);
      }
    } else {
      fwd.normalize();
    }
    // (2) Build the absolute target forward newFwd from yaw + tiltDeg.
    const tiltRad = tiltDeg * DEG2RAD;
    const cos = Math.cos(tiltRad);
    const sin = Math.sin(tiltRad);
    const newFwd = this._tmpV3c.set(fwd.x * cos, -sin, fwd.z * cos);
    // (3) Minimal-arc rotation from the TRUE current forward onto newFwd,
    //     applied via premultiply (drops lookAt).
    const R = this._tmpQuat;
    if (curFwd.dot(newFwd) < -0.9999) {
      // Antiparallel (180° flip): setFromUnitVectors' cross product underflows
      // and picks an arbitrary axis → unpredictable roll/flip. Choose a fixed,
      // roll-free axis — the camera's right — explicitly. (No Phase-2 path
      // reaches this: the per-tick step is ≤ a few °, and the largest
      // single-step hand-off is a ≤90° arc. The guard is mandatory to cover
      // the degenerate-axis case regardless.)
      const axis = this._tmpV3b.set(1, 0, 0).applyQuaternion(camera.quaternion); // camera-right in world
      R.setFromAxisAngle(axis, Math.PI);
    } else {
      R.setFromUnitVectors(curFwd, newFwd);
    }
    camera.quaternion.premultiply(R);
    camera.quaternion.normalize(); // drift guard
  }
}
