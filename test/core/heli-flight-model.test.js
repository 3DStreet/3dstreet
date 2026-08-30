/* global describe, it */

/**
 * heli-flight-model — the pure math behind play-mode-helicopter.
 *
 * These tests pin the arcade-flight invariants the in-game feel relies
 * on: hover equilibrium at collective = 1/liftPower, clamped lever
 * travel, rotor spool-up, torque sign conventions (pitch forward =
 * nose-down torque, yaw left = +Y torque), the auto-level spring
 * restoring a tilted body toward world-up, and hover-assist braking
 * horizontal drift.
 */

const assert = require('assert');
const {
  GRAVITY,
  SPOOL_TIME,
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
    it('ramps and clamps collective to [0, 1]', () => {
      const s = createHeliState();
      // Hold full-up for 10 seconds of substeps.
      for (let i = 0; i < 600; i++) {
        stepHeliState(s, { collective: 1 }, 1 / 60, DEFAULT_PARAMS);
      }
      assert.strictEqual(s.collective, 1);
      for (let i = 0; i < 600; i++) {
        stepHeliState(s, { collective: -1 }, 1 / 60, DEFAULT_PARAMS);
      }
      assert.strictEqual(s.collective, 0);
    });

    it('spools the rotor up over SPOOL_TIME and caps at 1', () => {
      const s = createHeliState();
      stepHeliState(s, NO_INPUT, SPOOL_TIME / 2, DEFAULT_PARAMS);
      assert.ok(Math.abs(s.spool - 0.5) < 1e-9);
      stepHeliState(s, NO_INPUT, SPOOL_TIME * 2, DEFAULT_PARAMS);
      assert.strictEqual(s.spool, 1);
    });

    it('assist trims collective toward hover (1/liftPower) when the lever is idle', () => {
      const s = createHeliState();
      s.spool = 1;
      s.collective = 1;
      for (let i = 0; i < 300; i++) {
        stepHeliState(s, { collective: 0, assist: true }, 1 / 60, {
          liftPower: 2
        });
      }
      assert.ok(Math.abs(s.collective - 0.5) < 1e-3);
    });
  });

  describe('computeHeliForces', () => {
    it('exactly balances gravity at hover collective, level attitude', () => {
      const s = createHeliState();
      s.spool = 1;
      s.collective = 1 / DEFAULT_PARAMS.liftPower;
      const body = levelBody();
      const { force, torque } = computeHeliForces(
        s,
        NO_INPUT,
        body,
        DEFAULT_PARAMS
      );
      assert.ok(Math.abs(force.y - body.mass * GRAVITY) < 1e-9);
      assert.strictEqual(force.x, 0);
      assert.strictEqual(force.z, 0);
      // Level + still + no input -> no torque at all.
      assert.strictEqual(torque.x, 0);
      assert.strictEqual(torque.y, 0);
      assert.strictEqual(torque.z, 0);
    });

    it('produces no thrust before the rotor spools', () => {
      const s = createHeliState(); // spool = 0
      s.collective = 1;
      const { force } = computeHeliForces(
        s,
        NO_INPUT,
        levelBody(),
        DEFAULT_PARAMS
      );
      assert.strictEqual(force.y, 0);
    });

    it('tilts thrust with the body (vectored thrust)', () => {
      const s = createHeliState();
      s.spool = 1;
      s.collective = 1 / DEFAULT_PARAMS.liftPower;
      // Nose-down 30°: up vector gains a -Z component -> forward force.
      const body = levelBody({ rotation: quatX(-Math.PI / 6) });
      const { force } = computeHeliForces(s, NO_INPUT, body, DEFAULT_PARAMS);
      assert.ok(force.z < -1); // forward (-Z) horizontal component
      assert.ok(force.y > 0 && force.y < body.mass * GRAVITY);
    });

    it('pitch-forward input = nose-down torque (about -X when level)', () => {
      const s = createHeliState();
      const { torque } = computeHeliForces(
        s,
        { ...NO_INPUT, pitch: 1 },
        levelBody(),
        DEFAULT_PARAMS
      );
      assert.ok(torque.x < 0);
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
      const s = createHeliState();
      // Nose-up 20° (positive X rotation raises the nose; see model header).
      const body = levelBody({ rotation: quatX(Math.PI / 9) });
      const { torque } = computeHeliForces(s, NO_INPUT, body, DEFAULT_PARAMS);
      assert.ok(torque.x < 0); // restoring toward level
    });

    it('never tumbles: past the commanded max tilt, full stick torque reverses', () => {
      // Regression for the original raw-torque model, where full cyclic
      // input faded the leveling spring and the helicopter somersaulted.
      // Attitude command means: nose-down 80° with full forward stick
      // still produces a RESTORING (nose-up) torque back toward the
      // ~31° commanded tilt.
      const s = createHeliState();
      const body = levelBody({ rotation: quatX(-(80 * Math.PI) / 180) });
      const { torque } = computeHeliForces(
        s,
        { ...NO_INPUT, pitch: 1 },
        body,
        DEFAULT_PARAMS
      );
      assert.ok(torque.x > 0);
    });

    it('stability: 0 disables the auto-level spring', () => {
      const s = createHeliState();
      const body = levelBody({ rotation: quatX(Math.PI / 9) });
      const { torque } = computeHeliForces(s, NO_INPUT, body, {
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

    it('assist brakes horizontal and vertical drift', () => {
      const s = createHeliState();
      const body = levelBody({ linvel: { x: 5, y: -2, z: -3 } });
      const { force } = computeHeliForces(
        s,
        { ...NO_INPUT, assist: true },
        body,
        DEFAULT_PARAMS
      );
      assert.ok(force.x < 0);
      assert.ok(force.z > 0);
      assert.ok(force.y > 0); // arrests the descent
    });
  });
});
