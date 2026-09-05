/* global describe, it */

/**
 * heli-flight-model — the pure math behind play-mode-helicopter.
 *
 * These tests pin the arcade-flight invariants the in-game feel relies
 * on. The headline ones encode the 2026-09 kids' playtest complaints
 * as regressions:
 *   - releasing W after a climb ARRESTS the climb (the old latching
 *     collective lever kept accelerating skyward forever),
 *   - releasing S after a descent arrests it without ballooning back
 *     up (the throttle-oscillation complaint),
 *   - the commanded forward pitch is modest (~24°, not the old 57°
 *     cartoon dive) while full stick still reaches real cruise speed.
 * Plus the pre-existing invariants: rotor spool-up, torque sign
 * conventions, auto-level, bank-compensated lift, hover assist.
 */

const assert = require('assert');
const {
  GRAVITY,
  MAX_CLIMB_RATE,
  MAX_DESCENT_RATE,
  IDLE_SINK_RATE,
  SPOOL_TIME,
  HORIZ_DRAG,
  VERT_DRAG,
  MAX_PITCH_TILT,
  DEFAULT_PARAMS,
  createHeliState,
  stepHeliState,
  computeHeliForces,
  applyQuat
} = require('../../src/aframe-components/play/heli-flight-model.js');

const NO_INPUT = { pitch: 0, roll: 0, yaw: 0, collective: 0, assist: false };

function levelBody(overrides) {
  return {
    mass: 100,
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    angvel: { x: 0, y: 0, z: 0 },
    linvel: { x: 0, y: 0, z: 0 },
    ...overrides
  };
}

/** Quaternion for rotation of `rad` around the X axis. */
function quatX(rad) {
  return { x: Math.sin(rad / 2), y: 0, z: 0, w: Math.cos(rad / 2) };
}

/** Spooled-up state (skip the takeoff wind-up in most tests). */
function spooledState() {
  const s = createHeliState();
  s.spool = 1;
  return s;
}

/**
 * Integrate the VERTICAL axis only: level attitude, gravity applied by
 * the caller (as Rapier would), 60 Hz sub-steps. Returns {y, vy}
 * traces sampled every step.
 */
function simulateVertical(state, phases, body) {
  const dt = 1 / 60;
  const trace = [];
  let y = 0;
  for (const { input, seconds } of phases) {
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      stepHeliState(state, input, dt, DEFAULT_PARAMS);
      const { force } = computeHeliForces(state, input, body, DEFAULT_PARAMS);
      body.linvel.y += (force.y / body.mass - GRAVITY) * dt;
      y += body.linvel.y * dt;
      trace.push({ y, vy: body.linvel.y });
    }
  }
  return trace;
}

describe('heli-flight-model', () => {
  describe('applyQuat', () => {
    it('rotates world-up correctly for a 90° X rotation', () => {
      const up = applyQuat(quatX(Math.PI / 2), { x: 0, y: 1, z: 0 });
      assert.ok(Math.abs(up.x) < 1e-9);
      assert.ok(Math.abs(up.y) < 1e-9);
      assert.ok(Math.abs(up.z - 1) < 1e-9);
    });
  });

  describe('stepHeliState', () => {
    it('spools the rotor up over SPOOL_TIME and caps at 1', () => {
      const s = createHeliState();
      stepHeliState(s, NO_INPUT, SPOOL_TIME / 2, DEFAULT_PARAMS);
      assert.ok(Math.abs(s.spool - 0.5) < 1e-9);
      stepHeliState(s, NO_INPUT, SPOOL_TIME * 2, DEFAULT_PARAMS);
      assert.strictEqual(s.spool, 1);
    });
  });

  describe('vertical-speed command', () => {
    it('produces no thrust before the rotor spools', () => {
      const s = createHeliState(); // spool = 0
      const { force, thrustFrac } = computeHeliForces(
        s,
        { ...NO_INPUT, collective: 1 },
        levelBody(),
        DEFAULT_PARAMS
      );
      assert.strictEqual(force.y, 0);
      assert.strictEqual(thrustFrac, 0);
    });

    it('rests on the ground: at zero velocity with no input, lift stays below gravity', () => {
      const { force } = computeHeliForces(
        spooledState(),
        NO_INPUT,
        levelBody(),
        DEFAULT_PARAMS
      );
      assert.ok(force.y > 0); // rotor is working...
      assert.ok(force.y < 100 * GRAVITY); // ...but not lifting off
    });

    it('balances gravity when sinking at the commanded idle rate', () => {
      const body = levelBody({ linvel: { x: 0, y: -IDLE_SINK_RATE, z: 0 } });
      const { force } = computeHeliForces(
        spooledState(),
        NO_INPUT,
        body,
        DEFAULT_PARAMS
      );
      // Servo equilibrium (up to the small vertical drag term).
      assert.ok(Math.abs(force.y - 100 * GRAVITY) < 100 * 0.2);
    });

    it('full up-collective from rest commands max thrust (clamped at liftPower)', () => {
      const { force, thrustFrac } = computeHeliForces(
        spooledState(),
        { ...NO_INPUT, collective: 1 },
        levelBody(),
        DEFAULT_PARAMS
      );
      assert.ok(
        Math.abs(force.y - 100 * GRAVITY * DEFAULT_PARAMS.liftPower) < 1e-9
      );
      assert.strictEqual(thrustFrac, 1);
    });

    it('an (almost) inverted rotor produces no thrust', () => {
      const { force, thrustFrac } = computeHeliForces(
        spooledState(),
        { ...NO_INPUT, collective: 1 },
        levelBody({ rotation: quatX(Math.PI) }), // upside down
        DEFAULT_PARAMS
      );
      assert.strictEqual(thrustFrac, 0);
      assert.ok(Math.abs(force.x) < 1e-6);
      // Only the (weak) vertical drag term may remain.
      assert.ok(Math.abs(force.y) < 1e-6);
    });

    it('REGRESSION: releasing W after a climb arrests the climb (no runaway)', () => {
      // The old latching lever: 2s of W from hover left the collective
      // pinned at 100% and vy still ACCELERATING 10s later (~90 m/s).
      const body = levelBody();
      const trace = simulateVertical(
        spooledState(),
        [
          { input: { ...NO_INPUT, collective: 1 }, seconds: 2 },
          { input: NO_INPUT, seconds: 6 }
        ],
        body
      );
      const release = trace[2 * 60 - 1];
      assert.ok(release.vy > 5); // the climb was real
      const end = trace[trace.length - 1];
      // Settled at the gentle idle sink, not still climbing.
      assert.ok(end.vy < 0.1 && end.vy > -1);
      // Altitude leveled off: barely any gain over the last 2 sim seconds.
      const twoSecAgo = trace[trace.length - 120];
      assert.ok(Math.abs(end.y - twoSecAgo.y) < 1.5);
    });

    it('REGRESSION: releasing S after a descent arrests it without ballooning up', () => {
      const body = levelBody();
      const trace = simulateVertical(
        spooledState(),
        [
          { input: { ...NO_INPUT, collective: -1 }, seconds: 2 },
          { input: NO_INPUT, seconds: 6 }
        ],
        body
      );
      const release = trace[2 * 60 - 1];
      assert.ok(release.vy < -5); // the descent was real
      const after = trace.slice(2 * 60);
      // Never overshoots into a climb (the overshoot-oscillation
      // complaint) and settles near the idle sink.
      assert.ok(Math.max(...after.map((p) => p.vy)) < 0.5);
      const end = after[after.length - 1];
      assert.ok(end.vy > -1 && end.vy < 0.1);
    });

    it('held collective tracks the commanded climb/descent rates', () => {
      const up = simulateVertical(
        spooledState(),
        [{ input: { ...NO_INPUT, collective: 1 }, seconds: 8 }],
        levelBody()
      );
      const climb = up[up.length - 1].vy;
      assert.ok(Math.abs(climb - MAX_CLIMB_RATE) < 1.5);
      const down = simulateVertical(
        spooledState(),
        [{ input: { ...NO_INPUT, collective: -1 }, seconds: 8 }],
        levelBody()
      );
      const sink = down[down.length - 1].vy;
      assert.ok(Math.abs(sink + MAX_DESCENT_RATE) < 1.5);
    });

    it('bank-compensates: vertical lift holds through a forward tilt', () => {
      const level = computeHeliForces(
        spooledState(),
        NO_INPUT,
        levelBody({ linvel: { x: 0, y: -IDLE_SINK_RATE, z: 0 } }),
        DEFAULT_PARAMS
      );
      const tilted = computeHeliForces(
        spooledState(),
        NO_INPUT,
        levelBody({
          rotation: quatX(-MAX_PITCH_TILT),
          linvel: { x: 0, y: -IDLE_SINK_RATE, z: 0 }
        }),
        DEFAULT_PARAMS
      );
      assert.ok(Math.abs(tilted.force.y - level.force.y) < 100 * 0.1);
      assert.ok(tilted.force.z < -1); // and the tilt vectors thrust forward
    });

    it('vertical drag is much weaker than horizontal drag (dead-rotor falls stay heavy)', () => {
      assert.ok(VERT_DRAG < HORIZ_DRAG / 2);
      const s = createHeliState(); // spool 0 -> no thrust
      const falling = computeHeliForces(
        s,
        NO_INPUT,
        levelBody({ linvel: { x: 0, y: -10, z: 0 } }),
        DEFAULT_PARAMS
      );
      const cruising = computeHeliForces(
        s,
        NO_INPUT,
        levelBody({ linvel: { x: 10, y: 0, z: 0 } }),
        DEFAULT_PARAMS
      );
      assert.ok(falling.force.y > 0); // drag opposes the fall...
      assert.ok(falling.force.y < -cruising.force.x / 2); // ...but gently
    });
  });

  describe('cyclic / forward flight', () => {
    it('REGRESSION: commanded forward pitch is a modest cruise attitude, not a 57° dive', () => {
      assert.ok(MAX_PITCH_TILT <= 0.45); // ~26° cap on the visual
    });

    it('pitch-forward input = nose-down torque (about -X when level)', () => {
      const { torque } = computeHeliForces(
        createHeliState(),
        { ...NO_INPUT, pitch: 1 },
        levelBody(),
        DEFAULT_PARAMS
      );
      assert.ok(torque.x < 0);
    });

    it('cyclic drive pulls the airframe along the stick direction', () => {
      // Level body: tilted thrust contributes nothing horizontal yet,
      // so forward force here is the rotor drive term alone.
      const { force } = computeHeliForces(
        spooledState(),
        { ...NO_INPUT, pitch: 1 },
        levelBody(),
        DEFAULT_PARAMS
      );
      assert.ok(force.z < -100); // forward = -Z, ~m * K_CYCLIC_DRIVE
    });

    it('REGRESSION: full forward stick reaches real cruise speed, promptly', () => {
      // Playtest: "the stick has to be jammed all the way forward and
      // it still wasn't fast enough". Integrate the horizontal axis
      // with the attitude settled at the commanded tilt and the
      // vertical servo holding altitude.
      const body = levelBody({ rotation: quatX(-MAX_PITCH_TILT) });
      const input = { ...NO_INPUT, pitch: 1 };
      const s = spooledState();
      const dt = 1 / 60;
      let at20 = null;
      for (let i = 0; i < 30 * 60; i++) {
        const { force } = computeHeliForces(s, input, body, DEFAULT_PARAMS);
        body.linvel.z += (force.z / body.mass) * dt;
        body.linvel.y = 0; // altitude held (verified separately above)
        if (at20 === null && -body.linvel.z >= 20) at20 = i * dt;
      }
      const cruise = -body.linvel.z;
      // Second playtest round: "max forward speed is still kinda
      // slow" at ~33 m/s — retuned for an MH-65-class airframe to
      // ~55 m/s (~200 km/h; the real aircraft cruises ~75 m/s).
      assert.ok(cruise > 45, `cruise ${cruise} m/s too slow`); // > 160 km/h
      assert.ok(cruise < 70, `cruise ${cruise} m/s implausibly fast`);
      assert.ok(at20 !== null && at20 < 4.5, `0->20 m/s took ${at20}s`);
    });

    it('yaw-left input = +Y torque; roll-right = -Z torque', () => {
      const s = createHeliState();
      const yawed = computeHeliForces(
        s,
        { ...NO_INPUT, yaw: 1 },
        levelBody(),
        DEFAULT_PARAMS
      );
      assert.ok(yawed.torque.y > 0);
      const rolled = computeHeliForces(
        s,
        { ...NO_INPUT, roll: 1 },
        levelBody(),
        DEFAULT_PARAMS
      );
      assert.ok(rolled.torque.z < 0);
    });

    it('auto-level restores a nose-up tilt with a nose-down torque', () => {
      const body = levelBody({ rotation: quatX(Math.PI / 9) });
      const { torque } = computeHeliForces(
        createHeliState(),
        NO_INPUT,
        body,
        DEFAULT_PARAMS
      );
      assert.ok(torque.x < 0); // restoring toward level
    });

    it('never tumbles: past the commanded max tilt, full stick torque reverses', () => {
      // Regression for the original raw-torque model, where full cyclic
      // input faded the leveling spring and the helicopter somersaulted.
      const body = levelBody({ rotation: quatX(-(80 * Math.PI) / 180) });
      const { torque } = computeHeliForces(
        createHeliState(),
        { ...NO_INPUT, pitch: 1 },
        body,
        DEFAULT_PARAMS
      );
      assert.ok(torque.x > 0);
    });

    it('stability: 0 disables the auto-level spring', () => {
      const body = levelBody({ rotation: quatX(Math.PI / 9) });
      const { torque } = computeHeliForces(createHeliState(), NO_INPUT, body, {
        ...DEFAULT_PARAMS,
        stability: 0
      });
      assert.strictEqual(torque.x, 0);
    });

    it('damps tilt rate but leaves pure yaw rate alone', () => {
      const s = createHeliState();
      const tilting = computeHeliForces(
        s,
        NO_INPUT,
        levelBody({ angvel: { x: 1, y: 0, z: 0 } }),
        DEFAULT_PARAMS
      );
      assert.ok(tilting.torque.x < 0);
      const yawing = computeHeliForces(
        s,
        NO_INPUT,
        levelBody({ angvel: { x: 0, y: 1, z: 0 } }),
        DEFAULT_PARAMS
      );
      assert.strictEqual(yawing.torque.y, 0);
    });
  });

  describe('hover assist', () => {
    it('brakes horizontal drift and arrests a descent', () => {
      const body = levelBody({ linvel: { x: 5, y: -2, z: -3 } });
      const { force } = computeHeliForces(
        spooledState(),
        { ...NO_INPUT, assist: true },
        body,
        DEFAULT_PARAMS
      );
      assert.ok(force.x < 0);
      assert.ok(force.z > 0);
      assert.ok(force.y > 100 * GRAVITY); // more than hover: braking the sink
    });

    it('commands a true zero-sink hover (no idle sink)', () => {
      const trace = simulateVertical(
        spooledState(),
        [{ input: { ...NO_INPUT, assist: true }, seconds: 6 }],
        levelBody({ linvel: { x: 0, y: -4, z: 0 } })
      );
      const end = trace[trace.length - 1];
      assert.ok(Math.abs(end.vy) < 0.1);
    });
  });
});
