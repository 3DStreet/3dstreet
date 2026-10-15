// Focus with a frame: what a user group passes, because its origin can be far
// from its members. The camera aims at the frame's center and is placed from
// it, sized by the frame's radius; with no radius, the empty-box standoff.
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as H from './_harness.js';

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

function focusable() {
  const scene = H.groundPlaneScene({ y: 0 });
  const cam = H.makePerspectiveCam({ pos: [0, 50, 80], lookAt: [0, 0, 0] });
  const c = H.makeControls({ camera: cam, scene });
  c._focusAnimation = {
    transitionCamPosStart: new H.THREE.Vector3(),
    transitionCamQuaternionStart: new H.THREE.Quaternion(),
    transitionCamPosEnd: new H.THREE.Vector3(),
    transitionCamQuaternionEnd: new H.THREE.Quaternion(),
    transitionProgress: 0,
    transitioning: false
  };
  return c;
}

describe('focus on a frame', () => {
  it('aims at the frame center and stands off by its radius, not at or from the target origin', () => {
    const c = focusable();
    // The target's origin is 40 m from what it frames, and it has geometry of
    // its own at the origin that a box-of-the-target focus would frame.
    const target = new H.THREE.Group();
    target.add(
      new H.THREE.Mesh(
        new H.THREE.BoxGeometry(1, 1, 1),
        new H.THREE.MeshBasicMaterial()
      )
    );
    target.updateMatrixWorld(true);
    const center = new H.THREE.Vector3(40, 1, 0);
    c.focus(target, { center, radius: 4 });

    expect(c.center.distanceTo(center)).toBeLessThan(1e-9);
    const end = c._focusAnimation.transitionCamPosEnd;
    // The standard framing offset (0, r/2, 2.5 r) from the center.
    expect(end.x).toBeCloseTo(40, 6);
    expect(end.y).toBeCloseTo(1 + 2, 6);
    expect(end.z).toBeCloseTo(10, 6);
  });

  it('uses the empty-box standoff from the center when the frame has no radius', () => {
    const c = focusable();
    const target = new H.THREE.Group();
    target.position.set(-7, 1, 2);
    target.updateMatrixWorld(true);
    c.focus(target, {
      center: new H.THREE.Vector3(-7, 1, 2),
      radius: null
    });
    const end = c._focusAnimation.transitionCamPosEnd;
    expect(end.x).toBeCloseTo(-7, 6);
    expect(end.y).toBeCloseTo(1 + 5, 6);
    expect(end.z).toBeCloseTo(2 + 25, 6);
    expect(c.center.toArray()).toEqual([-7, 1, 2]);
  });
});
