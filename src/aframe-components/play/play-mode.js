/* global AFRAME, THREE */

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
import useStore from '../../store.js';
import { courseKey, recordFinish } from './best-times.js';
import { formatSimTime } from './format-sim-time.js';

// Collision penalty added to the final race time, in ms. One second
// per collision matches the trackmania-style "shake-it-off" feel.
const COLLISION_PENALTY_MS = 1000;

AFRAME.registerSystem('play-mode', {
  init: function () {
    this.isPlaying = false;
    this.isPaused = false;
    // Wall-clock anchor for the current play session, read by UI that
    // wants to show wall-time alongside simulationTime.
    this.playStartedAt = null;
    this.onCollision = this.onCollision.bind(this);
    this.onRaceFinish = this.onRaceFinish.bind(this);
    this.sceneEl.addEventListener('play-mode-collision', this.onCollision);
    this.sceneEl.addEventListener('race-finish', this.onRaceFinish);
    // Edge-triggered gamepad button state. Index = button index in the
    // standard Gamepad mapping; value = pressed-last-tick boolean.
    this._padPrev = {};
    // Collision count for the current run, reset on start/reset.
    // Drives the +1s/collision penalty applied at race-finish.
    this._collisions = 0;
  },

  formatSimTime: function (ms) {
    return formatSimTime(ms);
  },

  onCollision: function (e) {
    // v1: arcade-style — record a persistent marker, fire a toast,
    // flash the toolbar pill red. The player keeps driving. A future
    // "strict" mode could auto-pause here instead.
    const { simulationTime, position } = e.detail || {};
    this._collisions += 1;
    this.spawnCollisionMarker(position, simulationTime);
    const label = this.formatSimTime(simulationTime);
    if (window.STREET && STREET.notify) {
      STREET.notify.errorMessage(`Collision at ${label} (+1s)`);
    }
    useStore.setState({
      playOutcome: 'crash',
      playOutcomeTimeMs: simulationTime
    });
    // Auto-clear the red pill after 1.5s so the timer goes back to its
    // running state. The marker stays in the scene.
    if (this._crashFlashTimeout) clearTimeout(this._crashFlashTimeout);
    this._crashFlashTimeout = setTimeout(() => {
      if (useStore.getState().playOutcome === 'crash') {
        useStore.setState({ playOutcome: null });
      }
    }, 1500);
  },

  onRaceFinish: function (e) {
    const { simulationTime } = e.detail || {};
    const simMs = simulationTime || 0;
    const collisions = this._collisions;
    const finalMs = simMs + collisions * COLLISION_PENALTY_MS;
    // sceneTitle is mirrored into the store; sceneId is canonically
    // read from scene metadata.
    const { sceneTitle } = useStore.getState();
    const sceneId =
      window.STREET &&
      STREET.utils &&
      typeof STREET.utils.getCurrentSceneId === 'function'
        ? STREET.utils.getCurrentSceneId()
        : null;
    const key = courseKey(sceneId, sceneTitle);
    const { previousBest, isNewBest, deltaMs } = recordFinish(key, finalMs);
    useStore.setState({
      playOutcome: 'finish',
      playOutcomeTimeMs: finalMs,
      playFinish: {
        finalMs,
        simMs,
        collisions,
        previousBestMs: previousBest,
        isNewBest,
        deltaMs,
        courseKey: key,
        finishedAt: performance.now()
      }
    });
    // Pause so the player can savor the moment + line up a snapshot.
    this.pause();
  },

  spawnCollisionMarker: function (pos, simMs) {
    if (!pos) return;
    const el = document.createElement('a-entity');
    el.setAttribute('collision-marker', `timeMs: ${simMs || 0}`);
    el.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
    el.setAttribute(
      'data-layer-name',
      `Collision (${this.formatSimTime(simMs || 0)})`
    );
    // Lives at scene root, OUTSIDE the persisted containers
    // (#street-container etc.), so markers are never saved. They are
    // session-only: stripped again in stop() and reset().
    this.sceneEl.appendChild(el);
  },

  removeCollisionMarkers: function () {
    this.sceneEl.querySelectorAll('[collision-marker]').forEach((el) => {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  },

  resetClocks: function () {
    const timer = this.sceneEl.components['scene-timer'];
    if (timer) {
      timer.elapsedTime = 0;
      timer.startTime = null;
      timer.resetSimulation();
    }
  },

  /**
   * @param {Object} [opts]
   * @param {'editor'|'viewer'} [opts.origin='viewer'] — where this play
   *   session was entered from. 'editor' = the editor's Start button /
   *   `P` shortcut (an editing session); 'viewer' = the viewer chrome's
   *   Start button or View-entry autoplay. Stop is entry-aware (#1824
   *   Q1): store.stopPlaying() returns 'editor'-origin sessions to the
   *   editor and 'viewer'-origin sessions to View-idle.
   */
  start: function (opts) {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.isPaused = false;
    this.playStartedAt = performance.now();
    this._collisions = 0;
    useStore.setState({
      isPlaying: true,
      isPlayPaused: false,
      playEntryOrigin: opts && opts.origin === 'editor' ? 'editor' : 'viewer',
      playOutcome: null,
      playOutcomeTimeMs: 0,
      playFinish: null
    });
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
    this._collisions = 0;
    this._padPrev = {};
    // Markers live at scene root (unreachable from the SceneGraph and
    // never saved), so leaving them past the play session would strand
    // undeletable floating spheres in the editor viewport.
    this.removeCollisionMarkers();
    useStore.setState({
      isPlaying: false,
      isPlayPaused: false,
      playEntryOrigin: null,
      playOutcome: null,
      playOutcomeTimeMs: 0,
      playFinish: null
    });
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
    // Clear any race-finish outcome: resuming after crossing the gate
    // means "keep driving", so the pinned clock and finish banner must
    // not survive into the live run. ('crash' clears via its own
    // timeout; nulling it here too is harmless.)
    useStore.setState({
      isPlayPaused: false,
      playOutcome: null,
      playOutcomeTimeMs: 0,
      playFinish: null
    });
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
    // Strip collision markers from prior attempts so the scene reads
    // fresh. They re-spawn naturally on the next crash.
    this.removeCollisionMarkers();
    if (this._crashFlashTimeout) {
      clearTimeout(this._crashFlashTimeout);
      this._crashFlashTimeout = null;
    }
    this._collisions = 0;
    useStore.setState({
      playOutcome: null,
      playOutcomeTimeMs: 0,
      playFinish: null
    });
    this.sceneEl.emit('timer-start');
    this.sceneEl.emit('play-mode-reset', {}, false);
  },

  /**
   * Poll connected gamepads for system-level buttons (Start = pause
   * toggle, Back = stop, Y = reset, X = camera cycle) and forward the
   * analog/continuous driving inputs to the active player car. Called
   * each tick while in play mode.
   *
   * Edge-triggered for system buttons so a single press doesn't fire
   * 60× per second. Driving inputs are level-sampled — they need the
   * current value every tick.
   */
  // pausedOnly: while play is paused we still want the controller to be able
  // to unpause (Start) or stop (Back), but must NOT process reset, camera
  // cycling, or analog driving inputs — those are for a live run only.
  pollGamepad: function (pausedOnly) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) return;
    const prev = this._padPrev;
    const edge = (idx) => {
      const cur = !!(pad.buttons[idx] && pad.buttons[idx].pressed);
      const fired = cur && !prev[idx];
      prev[idx] = cur;
      return fired;
    };
    // Standard Gamepad mapping: 8=Back/View, 9=Start/Menu, 3=Y, 2=X.
    if (edge(9)) this.togglePause();
    if (edge(8)) {
      // Back = stop play, matching the Stop button — entry-aware: back
      // to the editor if Play was entered from there, else View-idle.
      useStore.getState().stopPlaying();
      this._padPrev = {};
      return;
    }
    // Paused: pause/stop above are the only live inputs; bail before reset,
    // camera cycling, and driving so a resting trigger/stick can't seed stale
    // input that lands on resume.
    if (pausedOnly) return;
    if (edge(3)) this.reset();
    const car = document.getElementById('play-mode-player-car');
    const pmv = car && car.components && car.components['play-mode-vehicle'];
    if (edge(2) && pmv) pmv.cycleCameraMode();
    if (pmv && pmv.input) {
      // 6=LT, 7=RT (analog, value 0..1). Combined into a signed throttle
      // so the existing keyboard fallback can be left intact when both
      // triggers rest at zero.
      const rt = pad.buttons[7] ? pad.buttons[7].value || 0 : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value || 0 : 0;
      const throttle = rt - lt;
      pmv.input.throttle = Math.abs(throttle) > 0.05 ? throttle : 0;
      // 1 = B (brake). Level-sampled into a dedicated pad-brake slot so
      // releasing the button clears it without fighting the keyboard
      // Space handler (which owns `brake`).
      pmv.input.padBrake = !!(pad.buttons[1] && pad.buttons[1].pressed);
      // Left stick X (axis 0). Standard mapping: -1 = left, +1 = right.
      const sx = pad.axes[0] || 0;
      pmv.input.steerAxis = Math.abs(sx) > 0.1 ? sx : 0;
      // Right stick (axes 2/3) drives chase-cam orbit + zoom while in
      // chase mode. Standard driving-game convention: rx = yaw,
      // ry = zoom (push up = zoom in). Other camera modes ignore it.
      if (pmv.data.cameraMode === 'chase') {
        const rx = pad.axes[2] || 0;
        const ry = pad.axes[3] || 0;
        if (Math.abs(rx) > 0.15) pmv.chaseYaw += rx * 0.04;
        if (Math.abs(ry) > 0.15) {
          const factor = Math.exp(ry * 0.03);
          pmv.chaseZoom = THREE.MathUtils.clamp(pmv.chaseZoom * factor, 0.4, 4);
        }
      }
    }
  },

  tick: function (time, deltaMs) {
    if (!this.isPlaying || this.isPaused) {
      // Still poll for Start/Back so the controller can unpause/stop even
      // while paused, but in pausedOnly mode so reset/camera/driving inputs
      // stay gated off.
      if (this.isPlaying) this.pollGamepad(true);
      return;
    }
    this.pollGamepad(false);
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
