/* global describe, it */

/**
 * heli-sound — the pure state->synth-parameter mapping behind the
 * procedural rotor audio. The Web Audio graph itself needs a browser
 * (covered by the verify flow); these tests pin the mapping the
 * audible behavior depends on.
 */

const assert = require('assert');
const {
  heliSoundParams,
  ROTOR_FULL,
  MASTER_VOLUME
} = require('../../src/aframe-components/play/heli-sound.js');

describe('heliSoundParams', () => {
  it('is silent with the rotor stopped, full volume once spinning', () => {
    const stopped = heliSoundParams({ rotorSpeed: 0, collective: 0, speed: 0 });
    assert.strictEqual(stopped.master, 0);
    const spinning = heliSoundParams({
      rotorSpeed: 20,
      collective: 0.5,
      speed: 0
    });
    assert.strictEqual(spinning.master, MASTER_VOLUME);
  });

  it('mutes while paused regardless of rotor state', () => {
    const p = heliSoundParams({
      rotorSpeed: ROTOR_FULL,
      collective: 1,
      speed: 10,
      paused: true
    });
    assert.strictEqual(p.master, 0);
  });

  it('blade-pass frequency = rev/s x 2 blades', () => {
    // 40 rad/s = 6.37 rev/s -> 12.7 Hz chop.
    const p = heliSoundParams({ rotorSpeed: ROTOR_FULL, collective: 1 });
    assert.ok(
      Math.abs(p.bladePassHz - (ROTOR_FULL / (2 * Math.PI)) * 2) < 1e-9
    );
  });

  it('chop and turbine intensify with rotor speed', () => {
    const idle = heliSoundParams({ rotorSpeed: 6, collective: 0 });
    const full = heliSoundParams({ rotorSpeed: ROTOR_FULL, collective: 1 });
    assert.ok(full.chopBase > idle.chopBase);
    assert.ok(full.chopDepth > idle.chopDepth);
    assert.ok(full.turbineHz > idle.turbineHz);
    assert.ok(full.turbineGain > idle.turbineGain);
  });

  it('negative collective (powered dive) still counts as rotor work', () => {
    const dive = heliSoundParams({ rotorSpeed: ROTOR_FULL, collective: -0.4 });
    const slack = heliSoundParams({ rotorSpeed: ROTOR_FULL, collective: 0 });
    assert.ok(dive.turbineGain > slack.turbineGain);
  });

  it('wind wash scales with airspeed and is capped', () => {
    const still = heliSoundParams({ rotorSpeed: 20, speed: 0 });
    const fast = heliSoundParams({ rotorSpeed: 20, speed: 25 });
    const insane = heliSoundParams({ rotorSpeed: 20, speed: 500 });
    assert.strictEqual(still.windGain, 0);
    assert.ok(fast.windGain > 0.04);
    assert.ok(insane.windGain <= 0.1);
  });
});
