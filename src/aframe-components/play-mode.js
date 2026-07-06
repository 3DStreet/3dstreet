/* global AFRAME */

/**
 * play-mode
 * =========
 *
 * Lightweight lifecycle system for "the user pressed Play."
 *
 * Play mode is intentionally decoupled from any single feature (drive
 * mode, traffic animation, sensor replay, future first-person walk,
 * etc.). This system owns one boolean and three events:
 *
 *   sceneEl.systems['play-mode'].start()  -> emits 'play-mode-start'
 *   sceneEl.systems['play-mode'].stop()   -> emits 'play-mode-stop'
 *   sceneEl.systems['play-mode'].reset()  -> emits 'play-mode-reset'
 *
 * Features that want to do something during play register a listener
 * on the scene for those events and do their own setup/teardown. The
 * Play and Stop buttons in the UI just call start()/stop() — they
 * don't know what features will respond.
 *
 * Playing is presentation-only: it mutates nothing persistent, so it
 * requires no edit permission and simulation state is never saved
 * into the scene.
 *
 * The canonical simulation clock is `scene-timer.simulationTime` — a
 * passive counter that this system advances at wall-clock rate. A
 * future physics feature can take ownership by exposing an active
 * `play-mode-physics` system (it then advances simulationTime by
 * exactly one timestep per completed sub-step, and this tick backs
 * off). Subscribers that position entities as a pure function of
 * simulationTime are deterministic and replayable by construction.
 *
 * The isPlaying/isPlayPaused booleans are mirrored into the zustand
 * store so React components can render off them without listening to
 * scene events directly.
 */
import useStore from '../store.js';

AFRAME.registerSystem('play-mode', {
  init: function () {
    this.isPlaying = false;
    this.isPaused = false;
    // Wall-clock anchor for the current play session, read by UI that
    // wants to show wall-time alongside simulationTime.
    this.playStartedAt = null;
  },

  resetClocks: function () {
    const timer = this.sceneEl.components['scene-timer'];
    if (timer) {
      timer.elapsedTime = 0;
      timer.startTime = null;
      timer.resetSimulation();
    }
  },

  start: function () {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPaused = false;
    this.playStartedAt = performance.now();
    useStore.setState({ isPlaying: true, isPlayPaused: false });
    // Both clocks start at t=0: elapsedTime tracks wall-clock,
    // simulationTime is the passive counter that play features read.
    this.resetClocks();
    this.sceneEl.emit('timer-start');
    this.sceneEl.emit('play-mode-start', {}, false);
  },

  stop: function () {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this.isPaused = false;
    this.playStartedAt = null;
    useStore.setState({ isPlaying: false, isPlayPaused: false });
    this.sceneEl.emit('timer-pause');
    this.sceneEl.emit('play-mode-stop', {}, false);
  },

  pause: function () {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused = true;
    useStore.setState({ isPlayPaused: true });
    this.sceneEl.emit('timer-pause');
  },

  resume: function () {
    if (!this.isPlaying || !this.isPaused) return;
    this.isPaused = false;
    useStore.setState({ isPlayPaused: false });
    this.sceneEl.emit('timer-start');
  },

  togglePause: function () {
    if (this.isPaused) this.resume();
    else this.pause();
  },

  /**
   * Restart the current play session in-place: zero both clocks and
   * tell subscribers to put their actors back at spawn. Lighter than
   * stop()+start() — feature state (loaded WASM, built controllers)
   * stays alive; only positions and the simulation clock reset.
   */
  reset: function () {
    if (!this.isPlaying) return;
    if (this.isPaused) {
      this.isPaused = false;
      useStore.setState({ isPlayPaused: false });
    }
    this.playStartedAt = performance.now();
    this.resetClocks();
    this.sceneEl.emit('timer-start');
    this.sceneEl.emit('play-mode-reset', {}, false);
  },

  tick: function (time, deltaMs) {
    if (!this.isPlaying || this.isPaused) return;
    // simulationTime ownership:
    //   - When a physics feature is active, IT advances simulationTime
    //     by exactly one timestep per completed sub-step (so slow CPUs
    //     get true slow-motion rather than falling behind).
    //   - Otherwise nobody else advances it — do it here at wall-clock
    //     rate so non-physics subscribers still animate.
    const physics = this.sceneEl.systems['play-mode-physics'];
    if (physics && physics.active) return;
    const timer = this.sceneEl.components['scene-timer'];
    if (timer && timer.timerActive) {
      timer.advanceSimulation(Math.min(deltaMs, 100));
    }
  }
});
