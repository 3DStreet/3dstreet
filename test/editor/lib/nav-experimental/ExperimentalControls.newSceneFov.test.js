// Scene-load fly-in lens (#2037). The editor and viewer share one camera, so
// the fov the previous scene left behind is still on it when the next scene
// loads. newSceneCameraZoom must land the lens where the new scene says:
// the saved `zoom` when there is one, else DEFAULT_FOV_DEGREES — never the
// previous scene's fov. File > New > Blank Scene used to keep it (and the
// next save then wrote it into the blank scene's memory.cameraState).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';
import { DEFAULT_FOV_DEGREES } from '../../../../src/editor/lib/nav-experimental/constants.js';

let Controls;
beforeAll(async () => {
  Controls = await H.loadControls();
  H.useControlsClass(Controls);
});
beforeEach(() => {
  H.stubClock();
  H.clearSceneGlobals();
});
afterEach(() => H.teardownAll());

// A camera left at a lens no scene default would produce.
const PREVIOUS_SCENE_FOV = 27;
const FLY_IN_MS = 3000;

function rig() {
  const scene = H.groundPlaneScene({ y: 0 });
  const cam = H.makePerspectiveCam({
    pos: [12, 40, 90],
    lookAt: [0, 0, 0],
    fov: PREVIOUS_SCENE_FOV
  });
  const c = H.makeControls({ camera: cam, scene });
  return { cam, c };
}

// Drive the whole 3 s tween plus a settle frame.
function flyIn(c, state) {
  c.newSceneCameraZoom(state);
  H.tickAll(c, 16, Math.ceil(FLY_IN_MS / 16) + 2);
}

describe('newSceneCameraZoom lens', () => {
  it('a blank scene (no saved pose) lands at the default overview AND the default fov', () => {
    const { cam, c } = rig();
    expect(cam.fov).toBe(PREVIOUS_SCENE_FOV);
    flyIn(c, null);
    expect(cam.fov).toBe(DEFAULT_FOV_DEGREES);
    expect(cam.position.x).toBeCloseTo(0, 5);
    expect(cam.position.y).toBeCloseTo(15, 5);
    expect(cam.position.z).toBeCloseTo(30, 5);
  });

  it('a saved pose with a fov lands at that fov', () => {
    const { cam, c } = rig();
    flyIn(c, {
      position: { x: 5, y: 20, z: 40 },
      rotation: { x: -0.4, y: 0.1, z: 0 },
      zoom: 72
    });
    expect(cam.fov).toBe(72);
    expect(cam.position.x).toBeCloseTo(5, 5);
    expect(cam.position.y).toBeCloseTo(20, 5);
    expect(cam.position.z).toBeCloseTo(40, 5);
  });

  it('a saved pose without a fov lands at the default fov, not the previous scene’s', () => {
    const { cam, c } = rig();
    flyIn(c, {
      position: { x: 5, y: 20, z: 40 },
      rotation: { x: -0.4, y: 0.1, z: 0 }
    });
    expect(cam.fov).toBe(DEFAULT_FOV_DEGREES);
  });

  it('the fov change is applied through the projection matrix by the end of the glide', () => {
    const { cam, c } = rig();
    const before = cam.projectionMatrix.clone();
    flyIn(c, null);
    expect(cam.projectionMatrix.equals(before)).toBe(false);
    const fresh = cam.clone();
    fresh.fov = DEFAULT_FOV_DEGREES;
    fresh.updateProjectionMatrix();
    expect(cam.projectionMatrix.equals(fresh.projectionMatrix)).toBe(true);
  });
});

// New › Blank Scene does not fly in: it snaps to the pose a bare editor boot
// constructs (cameras.js), so the save the New modal fires on the newScene
// event already sees the default view, not the previous scene's.
describe('snapToDefaultView', () => {
  it('puts the camera at the default overview and default fov at once', () => {
    const { cam, c } = rig();
    expect(cam.fov).toBe(PREVIOUS_SCENE_FOV);
    c.snapToDefaultView();
    expect(cam.fov).toBe(DEFAULT_FOV_DEGREES);
    expect(cam.position.x).toBeCloseTo(0, 6);
    expect(cam.position.y).toBeCloseTo(15, 6);
    expect(cam.position.z).toBeCloseTo(30, 6);
    const fresh = cam.clone();
    fresh.fov = DEFAULT_FOV_DEGREES;
    fresh.updateProjectionMatrix();
    expect(cam.projectionMatrix.equals(fresh.projectionMatrix)).toBe(true);
  });

  it('cancels a load fly-in still in flight', () => {
    const { cam, c } = rig();
    c.newSceneCameraZoom({ position: { x: 5, y: 20, z: 40 }, zoom: 72 });
    H.tickAll(c, 16, 10);
    c.snapToDefaultView();
    H.tickAll(c, 16, Math.ceil(FLY_IN_MS / 16));
    expect(cam.fov).toBe(DEFAULT_FOV_DEGREES);
    expect(cam.position.y).toBeCloseTo(15, 6);
  });
});

// Reset Camera View (action bar + View menu). A Starting View with a
// non-default fov applies that lens to the shared camera; deleting the
// Starting View leaves the lens behind with nothing left to edit it, so the
// reset is the way back to the default (#2043).
describe('resetZoom', () => {
  it('resets the lens to the default fov along with the pose', () => {
    const { cam, c } = rig();
    expect(cam.fov).toBe(PREVIOUS_SCENE_FOV);
    c.resetZoom();
    expect(cam.fov).toBe(DEFAULT_FOV_DEGREES);
    expect(cam.position.x).toBeCloseTo(0, 6);
    expect(cam.position.y).toBeCloseTo(15, 6);
    expect(cam.position.z).toBeCloseTo(30, 6);
    const fresh = cam.clone();
    fresh.fov = DEFAULT_FOV_DEGREES;
    fresh.updateProjectionMatrix();
    expect(cam.projectionMatrix.equals(fresh.projectionMatrix)).toBe(true);
  });
});
