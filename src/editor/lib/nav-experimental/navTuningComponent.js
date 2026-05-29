/* global AFRAME */

// TASK-010 (D2): a thin A-Frame component that surfaces the experimental
// navigation tilt threshold T on a schema property so Diarmid can tweak
// it live during feel-testing — via the A-Frame inspector or the console
// (`sceneEl.setAttribute('nav-experimental-tuning','tiltThresholdDegrees',15)`)
// — without a rebuild. The navigation controls themselves are not an
// A-Frame component (`ExperimentalControls` is `new`-ed in viewport.js),
// so this component just relays the schema value onto the live controls
// instance via `setTiltThreshold`.
//
// Registration: this module is side-effect-only (it registers the
// component on import). A bare `export {…}` barrel does NOT pull in a
// side-effect-only module, so `ExperimentalControls.js` imports it
// explicitly (`import './navTuningComponent.js';`). Without that the
// `setAttribute` below would silently no-op on an unregistered component.

import { TILT_THRESHOLD_DEFAULT_DEGREES } from './constants.js';

if (typeof AFRAME !== 'undefined' && !AFRAME.components['nav-experimental-tuning']) {
  AFRAME.registerComponent('nav-experimental-tuning', {
    // Schema default imported from the constant so the component and the
    // constant can't drift.
    schema: {
      tiltThresholdDegrees: {
        type: 'number',
        default: TILT_THRESHOLD_DEFAULT_DEGREES
      }
    },
    update() {
      // `inspector.controls` is assigned in viewport.js before this
      // component is attached, so the guard finds it on the first
      // (synchronous) update() that fires on setAttribute. The first
      // update re-applies the default the constructor already set —
      // harmless.
      const c = AFRAME.INSPECTOR && AFRAME.INSPECTOR.controls;
      if (c && typeof c.setTiltThreshold === 'function') {
        c.setTiltThreshold(this.data.tiltThresholdDegrees);
      }
    }
  });
}
