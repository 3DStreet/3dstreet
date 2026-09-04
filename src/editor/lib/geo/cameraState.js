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
/**
 * Ground footprint the camera sees when looking straight down from its
 * current altitude: width/height in metres across the viewport. Lets an
 * agent reason about scale ("the street is 140 m, the view is 300 m wide").
 */
export function planViewGroundExtent(camera = inspectorCamera()) {
  const pos = new THREE.Vector3();
  camera.getWorldPosition(pos);
  const halfV = ((camera.fov || 60) * Math.PI) / 360;
  const height = 2 * pos.y * Math.tan(halfV);
  return {
    widthMeters: round(height * (camera.aspect || 1), 1),
    heightMeters: round(height, 1)
  };
}

async function waitForAltitude(camera, targetY, timeoutMs) {
  const t0 = Date.now();
  while (Math.abs(camera.position.y - targetY) > 0.05) {
    if (Date.now() - t0 > timeoutMs) {
      throw new Error('Timed out waiting for the plan view to zoom out');
    }
    await wait(50);
  }
  await wait(50);
}

/**
 * Raise a settled top-down camera straight up by `factor` (2 = twice the
 * altitude, so roughly twice the ground extent on each axis). Goes through
 * the controls' own committed-motion glide (`focusCameraState`) so the
 * pose is legit to the navigation sensor and nothing eases it back.
 */
async function zoomOutPlanView(controls, camera, factor, timeoutMs) {
  const targetY = camera.position.y * factor;
  if (typeof controls.focusCameraState === 'function') {
    controls.focusCameraState({
      position: { x: camera.position.x, y: targetY, z: camera.position.z },
      rotation: {
        x: camera.rotation.x,
        y: camera.rotation.y,
        z: camera.rotation.z
      },
      zoom: camera.fov
    });
    await waitForAltitude(camera, targetY, timeoutMs);
  } else {
    camera.position.y = targetY;
    camera.updateMatrixWorld(true);
    await wait(50);
  }
}

export async function orientPlanView({ timeoutMs = 6000, zoomOut = 1 } = {}) {
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

/**
 * Plan view plus an optional altitude multiplier. The compass plan view
 * frames the scene bounds with a 30% margin, which fills the frame with the
 * street and crops the real roads around it — useless for judging
 * alignment against the map. `zoomOut: 2` shows roughly twice the extent.
 */
export async function orientPlanViewZoomed({
  timeoutMs = 6000,
  zoomOut = 1
} = {}) {
  await orientPlanView({ timeoutMs });
  const factor = Number(zoomOut);
  if (Number.isFinite(factor) && factor > 1.01) {
    const controls = AFRAME.INSPECTOR?.controls;
    await zoomOutPlanView(controls, inspectorCamera(), factor, timeoutMs);
  }
  const state = describeCamera();
  state.groundExtent = planViewGroundExtent();
  return state;
}
