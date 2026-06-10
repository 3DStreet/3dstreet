/* global AFRAME */

// TASK-010 (D2, D-LT-3): a thin A-Frame component that surfaces
// experimental-navigation tuning knobs on schema properties so Diarmid
// can tweak them live during feel-testing — via the A-Frame inspector or
// the console
// (`sceneEl.setAttribute('nav-experimental-tuning','tiltThresholdDegrees',15)`)
// — without a rebuild. Exposed knobs: the tilt threshold T, the far-pivot
// fallback distance (D-LT-3), the Shift+LB rotation speed, and the
// wheel-zoom lateral movement cap (TASK-014d). The
// navigation controls themselves are not an A-Frame component
// (`ExperimentalControls` is `new`-ed in viewport.js), so this component
// just relays each schema value onto the live controls instance via the
// matching setter.
//
// Registration: this module is side-effect-only (it registers the
// component on import). A bare `export {…}` barrel does NOT pull in a
// side-effect-only module, so `ExperimentalControls.js` imports it
// explicitly (`import './navTuningComponent.js';`). Without that the
// `setAttribute` below would silently no-op on an unregistered component.

import {
  TILT_THRESHOLD_DEFAULT_DEGREES,
  MAP_PIVOT_BOUNDS_RADIUS_METRES,
  ROTATION_SPEED_RAD_PER_PX,
  WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES
} from './constants.js';
import { isStreetLevelNav } from './flag.js';

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
      rotationSpeedRadPerPx: {
        type: 'number',
        default: ROTATION_SPEED_RAD_PER_PX
      },
      // TASK-027 Part F: the wheel lateral cap is now `max(lowerBound,
      // 0.1×AGL)`; this knob is the lower bound (the value that governs near
      // the ground and on the no-AGL Ctrl+wheel path).
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
      if (typeof c.setRotationSpeed === 'function') {
        c.setRotationSpeed(this.data.rotationSpeedRadPerPx);
      }
      if (typeof c.setWheelZoomLateralCap === 'function') {
        c.setWheelZoomLateralCap(this.data.wheelZoomLateralCapLowerBoundMetres);
      }
      if (typeof c.setStreetLevelEnabled === 'function') {
        c.setStreetLevelEnabled(this.data.streetLevelEnabled);
      }
    }
  });
}
