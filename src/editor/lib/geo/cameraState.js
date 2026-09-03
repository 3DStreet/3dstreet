/**
 * Camera orientation readout + plan-view action for LLM tools.
 *
 * Both use the *same* predicates and action as the on-screen Compass
 * widget: `cameraTiltDegrees` / `needleScreenAngle` with the shared
 * tolerance constants decide "top-down" and "north-up", and
 * `handleCompassBodyClick` is the exact code path a user's click on the
 * compass body runs (stage 1 tilts to top-down keeping heading, stage 2
 * yaws to north). The view stays a perspective camera — there is no
 * orthographic plan view in the UI, and the compass refuses ortho.
 */
import * as THREE from 'three';
import {
  cameraTiltDegrees,
  needleScreenAngle,
  COMPASS_TOPDOWN_TOLERANCE_DEGREES,
  COMPASS_NORTH_TOLERANCE_DEGREES
} from '../nav-experimental/index.js';
import { GeoFrameError, getGeoFrame, worldToLatLon } from './geoFrame.js';

function round(v, places = 2) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

function inspectorCamera() {
  const camera = AFRAME.INSPECTOR?.camera;
  if (!camera) throw new Error('Editor camera not available');
  return camera;
}

/**
 * Structured camera state. `needleDeg` is the compass needle's screen angle
 * (0 = north is straight up on screen); `headingDeg` is the compass bearing
 * the top of the screen points to. Geographic position is included when the
 * geo layer is live, else `geo: null` with the reason.
 */
export function describeCamera(camera = inspectorCamera()) {
  camera.updateMatrixWorld(true);
  const tiltDeg = cameraTiltDegrees(camera);
  const needleDeg = needleScreenAngle(camera);
  const pos = new THREE.Vector3();
  camera.getWorldPosition(pos);
  const state = {
    projection: camera.type === 'OrthographicCamera' ? 'ortho' : 'perspective',
    worldPosition: { x: round(pos.x), y: round(pos.y), z: round(pos.z) },
    tiltDeg: round(tiltDeg),
    isTopDown: 90 - tiltDeg <= COMPASS_TOPDOWN_TOLERANCE_DEGREES,
    needleDeg: round(needleDeg),
    isNorthUp: Math.abs(needleDeg) <= COMPASS_NORTH_TOLERANCE_DEGREES,
    screenUpBearingDeg: round(((-needleDeg % 360) + 360) % 360),
    geo: null
  };
  try {
    const frame = getGeoFrame();
    state.geo = worldToLatLon(pos, frame);
  } catch (err) {
    if (!(err instanceof GeoFrameError)) throw err;
    state.geoUnavailableReason = err.reason;
  }
  return state;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCompass(controls, timeoutMs) {
  const t0 = Date.now();
  while (controls.isCompassAnimating()) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error('Timed out waiting for the camera to finish moving');
    }
    await wait(50);
  }
  // One extra frame so the camera matrices reflect the tween's final pose.
  await wait(50);
}

/**
 * Drive the camera to a top-down, north-up plan view via the compass body
 * click, repeating until both predicates hold (at most two stages plus a
 * safety margin). Resolves with `describeCamera()` of the final pose.
 */
export async function orientPlanView({ timeoutMs = 6000 } = {}) {
  const controls = AFRAME.INSPECTOR?.controls;
  if (
    !controls ||
    typeof controls.handleCompassBodyClick !== 'function' ||
    typeof controls.isCompassAnimating !== 'function'
  ) {
    throw new Error(
      'Plan view is unavailable: the editor is using the classic navigation scheme (nav=classic) which has no compass.'
    );
  }
  const camera = inspectorCamera();
  if (camera.type !== 'PerspectiveCamera') {
    throw new Error(
      'Plan view is unavailable while the camera is orthographic. Switch to the perspective camera first.'
    );
  }
  await waitForCompass(controls, timeoutMs);
  for (let stage = 0; stage < 3; stage++) {
    const state = describeCamera(camera);
    if (state.isTopDown && state.isNorthUp) return state;
    controls.handleCompassBodyClick();
    await waitForCompass(controls, timeoutMs);
  }
  const final = describeCamera(camera);
  if (!(final.isTopDown && final.isNorthUp)) {
    throw new Error(
      `Plan view did not settle (tilt ${final.tiltDeg}°, needle ${final.needleDeg}°). The editor controls may be disabled (Play mode?).`
    );
  }
  return final;
}
