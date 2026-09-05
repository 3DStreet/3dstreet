/**
 * heli-sound
 * ==========
 *
 * Fully procedural helicopter audio — no downloaded samples, in the
 * same spirit as the basic-geometry mesh. Everything is synthesized
 * with stock Web Audio nodes from three layers:
 *
 *   1. Blade slap ("chop"): looped white noise through a low-pass,
 *      amplitude-modulated by an LFO running at the blade-pass
 *      frequency (rotor rad/s -> rev/s x 4 blades). At idle it's a
 *      slow whump-whump; at full collective it's the classic 13 Hz
 *      helicopter thrum.
 *   2. Turbine whine: a quiet sawtooth through a resonant band-pass,
 *      pitch rising with rotor speed and collective.
 *   3. Wind wash: the same noise buffer through a high-pass, gain
 *      tied to airspeed so diving and fast cruises roar.
 *
 * Plus a one-shot low thump for collisions (`impact()`).
 *
 * The parameter mapping lives in the pure `heliSoundParams()` so the
 * numbers are unit-testable in Node; the `HeliSound` class is the thin
 * Web Audio wrapper `play-mode-helicopter` drives each frame.
 *
 * Autoplay policy: the AudioContext is created when the player rig is
 * built, which happens after the async Rapier load — OUTSIDE the
 * Start-click gesture — so the context usually starts 'suspended'.
 * `resume()` is called from the rig's (trusted) keydown handler and
 * retried from update(), so audio starts with the player's first
 * control input at the latest.
 */

// Rotor speed (rad/s) at which the sound layers reach full intensity.
// Matches ROTOR_VISUAL_MAX in play-mode-helicopter.
const ROTOR_FULL = 40;
const MASTER_VOLUME = 0.5;

/**
 * Map flight state to synth parameters. Pure — unit-tested.
 *
 * @param {Object} s — { rotorSpeed (rad/s), collective (0..1 rotor
 *   work fraction), speed (m/s, magnitude of velocity), paused (bool) }
 */
function heliSoundParams(s) {
  const rotorAmount = Math.max(
    0,
    Math.min(1, (s.rotorSpeed || 0) / ROTOR_FULL)
  );
  const work = Math.abs(s.collective || 0); // down-thrust works too
  return {
    // rad/s -> rev/s, four blades per rev (MH-65-class rotor).
    bladePassHz: Math.max(0.1, ((s.rotorSpeed || 0) / (2 * Math.PI)) * 4),
    chopBase: 0.55 * rotorAmount,
    chopDepth: 0.5 * rotorAmount,
    chopFilterHz: 240 + 260 * rotorAmount,
    turbineHz: 70 + 300 * rotorAmount + 120 * work,
    turbineGain: 0.05 + 0.07 * rotorAmount * (0.4 + 0.6 * work),
    windGain: Math.min(0.1, (s.speed || 0) * 0.0025),
    master: s.paused ? 0 : rotorAmount > 0.005 ? MASTER_VOLUME : 0
  };
}

class HeliSound {
  constructor() {
    const Ctx =
      typeof window !== 'undefined' &&
      (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) {
      this.ctx = null;
      return;
    }
    const ctx = (this.ctx = new Ctx());
    this._lastResumeTry = 0;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // Shared 2s looped white-noise buffer.
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const noiseSource = () => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      return src;
    };

    // --- Layer 1: blade slap ---
    this.chopNoise = noiseSource();
    this.chopFilter = ctx.createBiquadFilter();
    this.chopFilter.type = 'lowpass';
    this.chopFilter.frequency.value = 300;
    this.chopFilter.Q.value = 0.8;
    this.chopGain = ctx.createGain();
    this.chopGain.gain.value = 0;
    this.chopNoise.connect(this.chopFilter);
    this.chopFilter.connect(this.chopGain);
    this.chopGain.connect(this.master);
    // LFO modulating chopGain.gain around its base value.
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfo.frequency.value = 2;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth);
    this.lfoDepth.connect(this.chopGain.gain);

    // --- Layer 2: turbine whine ---
    this.turbine = ctx.createOscillator();
    this.turbine.type = 'sawtooth';
    this.turbine.frequency.value = 70;
    this.turbineFilter = ctx.createBiquadFilter();
    this.turbineFilter.type = 'bandpass';
    this.turbineFilter.frequency.value = 900;
    this.turbineFilter.Q.value = 1.6;
    this.turbineGain = ctx.createGain();
    this.turbineGain.gain.value = 0;
    this.turbine.connect(this.turbineFilter);
    this.turbineFilter.connect(this.turbineGain);
    this.turbineGain.connect(this.master);

    // --- Layer 3: wind wash ---
    this.windNoise = noiseSource();
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'highpass';
    this.windFilter.frequency.value = 1200;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.master);

    // --- Impact thump path (silent until impact()) ---
    this.impactNoise = noiseSource();
    this.impactFilter = ctx.createBiquadFilter();
    this.impactFilter.type = 'lowpass';
    this.impactFilter.frequency.value = 180;
    this.impactGain = ctx.createGain();
    this.impactGain.gain.value = 0;
    this.impactNoise.connect(this.impactFilter);
    this.impactFilter.connect(this.impactGain);
    this.impactGain.connect(this.master);

    this.chopNoise.start();
    this.windNoise.start();
    this.impactNoise.start();
    this.lfo.start();
    this.turbine.start();
  }

  /** Trusted-gesture hook (keydown/pointerdown) + periodic retry. */
  resume() {
    if (!this.ctx || this.ctx.state !== 'suspended') return;
    this.ctx.resume().catch(() => {});
  }

  /** Drive the synth from flight state. Call once per frame. */
  update(state) {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      // Retry at most once a second — a queued Start-click gesture can
      // land late, and some browsers allow resume() without one.
      const now = performance.now();
      if (now - this._lastResumeTry > 1000) {
        this._lastResumeTry = now;
        this.resume();
      }
      return;
    }
    const p = heliSoundParams(state);
    const t = ctx.currentTime;
    const TC = 0.08; // smoothing time-constant, seconds
    this.lfo.frequency.setTargetAtTime(p.bladePassHz, t, TC);
    this.chopGain.gain.setTargetAtTime(p.chopBase, t, TC);
    this.lfoDepth.gain.setTargetAtTime(p.chopDepth, t, TC);
    this.chopFilter.frequency.setTargetAtTime(p.chopFilterHz, t, TC);
    this.turbine.frequency.setTargetAtTime(p.turbineHz, t, TC);
    this.turbineGain.gain.setTargetAtTime(p.turbineGain, t, TC);
    this.windGain.gain.setTargetAtTime(p.windGain, t, TC);
    this.master.gain.setTargetAtTime(p.master, t, 0.15);
  }

  /** One-shot collision thump. */
  impact(strength) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const s = Math.min(1, strength || 1);
    const t = ctx.currentTime;
    const g = this.impactGain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.9 * s, t);
    g.exponentialRampToValueAtTime(0.001, t + 0.3);
    g.setValueAtTime(0, t + 0.31);
  }

  dispose() {
    if (!this.ctx) return;
    try {
      this.master.gain.value = 0;
      this.ctx.close();
    } catch (_) {}
    this.ctx = null;
  }
}

module.exports = { HeliSound, heliSoundParams, ROTOR_FULL, MASTER_VOLUME };
