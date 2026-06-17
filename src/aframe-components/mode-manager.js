/* global AFRAME */

/**
 * mode-manager
 * ============
 *
 * Owns transitions between top-level scene modes. Each mode is
 * registered with `enter(prevMode)` / `exit(nextMode)` hooks that
 * attach/detach the components a mode needs on the cameraRig, camera,
 * and (eventually) hand entities. The point is: when a mode isn't
 * selected, its components shouldn't be on the entity at all — same
 * pattern as `street-geo` swapping map providers.
 *
 * Current modes:
 *   - `editor`   — inspector open, no scene-side input controls.
 *   - `drive`    — play-mode-vehicle owns the camera. Wired up by
 *                  play-mode.start/stop calling setMode.
 *
 * Adding a new mode is just: registerMode('name', { enter, exit }).
 * Callers don't need to know what other modes exist or what they
 * attached — exit() of the outgoing mode is responsible for cleaning
 * up after itself.
 */

AFRAME.registerSystem('mode-manager', {
  init: function () {
    this.modes = {};
    this.currentMode = null;
    // Editor is the default. Other subsystems register their own
    // modes at init time — e.g. drive-mode in play-mode-vehicle.js
    // registers the `drive` mode there so its setup logic stays with
    // the rest of the drive-mode code.
    this.registerMode('editor', {
      enter: () => {},
      exit: () => {}
    });
    this.currentMode = 'editor';
  },

  registerMode: function (name, hooks) {
    this.modes[name] = hooks;
  },

  setMode: function (next) {
    if (next === this.currentMode) return;
    const prev = this.currentMode;
    const prevMode = this.modes[prev];
    const nextMode = this.modes[next];
    if (!nextMode) {
      console.warn(`[mode-manager] unknown mode "${next}"`);
      return;
    }
    if (prevMode && prevMode.exit) prevMode.exit(next);
    this.currentMode = next;
    if (nextMode.enter) nextMode.enter(prev);
    this.sceneEl.emit('mode-changed', { from: prev, to: next }, false);
  },

  getMode: function () {
    return this.currentMode;
  }
});
