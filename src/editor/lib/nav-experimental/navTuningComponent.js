/* global AFRAME */

// A thin A-Frame component that surfaces experimental-navigation tuning
// knobs on schema properties so Diarmid can tweak them live during
// feel-testing — via the A-Frame inspector or the console
// (`sceneEl.setAttribute('nav-experimental-tuning','tiltThresholdDegrees',15)`)
// — without a rebuild. Exposed knobs: the tilt threshold T (TH-03, the one
// value governing all four tilt-conditional behaviours — KD-05), the far
// Map-pivot bounds radius (TH-05), the Shift+LB rotation speed, and the
// wheel-zoom lateral-movement cap lower bound (TH-16). The navigation
// controls themselves are not an A-Frame component (`ExperimentalControls`
// is `new`-ed in viewport.js), so this component just relays each schema
// value onto the live controls instance via the matching setter. Exposing
// config through a component schema while the logic stays a plain object is
// the deliberate split in KD-32.
//
// Registration: this module is side-effect-only (it registers the
// component on import). A bare `export {…}` barrel does NOT pull in a
// side-effect-only module, so `ExperimentalControls.js` imports it
// explicitly (`import './navTuningComponent.js';`). Without that the
// `setAttribute` below would silently no-op on an unregistered component.

import {
  TILT_THRESHOLD_DEFAULT_DEGREES,
  MAP_PIVOT_BOUNDS_RADIUS_METRES,
  MAP_PIVOT_FAR_ACCEPT_GAIN,
  ROTATION_SPEED_RAD_PER_PX,
  WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES
} from './constants.js';
import { isStreetLevelNav, isWasdNav } from './flag.js';

if (
  typeof AFRAME !== 'undefined' &&
  !AFRAME.components['nav-experimental-tuning']
) {
  AFRAME.registerComponent('nav-experimental-tuning', {
    // Schema defaults imported from the constants so the component and the
    // constants can't drift.
    schema: {
      tiltThresholdDegrees: {
        type: 'number',
        default: TILT_THRESHOLD_DEFAULT_DEGREES
      },
      mapPivotBoundsRadiusMetres: {
        type: 'number',
        default: MAP_PIVOT_BOUNDS_RADIUS_METRES
      },
      // Street-level-mode-OFF only: far-acceptance budget for a clicked Map
      // rotation pivot — accept within gain × height/sin(max(tilt, T)) of
      // the camera, farther clicks orbit the centre point instead. Larger =
      // accept farther pivots at a given tilt.
      mapPivotFarAcceptGain: {
        type: 'number',
        default: MAP_PIVOT_FAR_ACCEPT_GAIN
      },
      rotationSpeedRadPerPx: {
        type: 'number',
        default: ROTATION_SPEED_RAD_PER_PX
      },
      // The live wheel lateral cap is `max(TH-16, TH-17 × AGL)`; this knob is
      // the lower bound TH-16 (the value that governs near the ground and on
      // the no-AGL Ctrl+wheel path).
      wheelZoomLateralCapLowerBoundMetres: {
        type: 'number',
        default: WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES
      },
      // Street-level mode gate (swoop / street FOV / street button action /
      // lane double-click). Default comes from the ?streetview=on URL flag
      // (off without it); flip live via
      // `sceneEl.setAttribute('nav-experimental-tuning','streetLevelEnabled',true)`.
      streetLevelEnabled: {
        type: 'boolean',
        default: isStreetLevelNav()
      },
      // First-person kit gate (WASD/arrow flight + rotation interplay).
      // Default comes from the ?wasd=on URL flag. NOTE: the runtime toggle
      // moves only the camera bindings — the shortcuts.js w/s/d keymap
      // restore is decided once at load from the URL flag.
      wasdEnabled: {
        type: 'boolean',
        default: isWasdNav()
      }
    },
    update() {
      // `inspector.controls` is assigned in viewport.js before this
      // component is attached, so the guard finds it on the first
      // (synchronous) update() that fires on setAttribute. The first
      // update re-applies the defaults the constructor already set —
      // harmless. Each setter ignores non-finite/out-of-range input.
      const c = AFRAME.INSPECTOR && AFRAME.INSPECTOR.controls;
      if (!c) return;
      if (typeof c.setTiltThreshold === 'function') {
        c.setTiltThreshold(this.data.tiltThresholdDegrees);
      }
      if (typeof c.setMapPivotBoundsRadius === 'function') {
        c.setMapPivotBoundsRadius(this.data.mapPivotBoundsRadiusMetres);
      }
      if (typeof c.setMapPivotFarAcceptGain === 'function') {
        c.setMapPivotFarAcceptGain(this.data.mapPivotFarAcceptGain);
      }
      if (typeof c.setRotationSpeed === 'function') {
        c.setRotationSpeed(this.data.rotationSpeedRadPerPx);
      }
      if (typeof c.setWheelZoomLateralCap === 'function') {
        c.setWheelZoomLateralCap(this.data.wheelZoomLateralCapLowerBoundMetres);
      }
      if (typeof c.setStreetLevelEnabled === 'function') {
        c.setStreetLevelEnabled(this.data.streetLevelEnabled);
      }
      if (typeof c.setWasdEnabled === 'function') {
        c.setWasdEnabled(this.data.wasdEnabled);
      }
    }
  });
}
