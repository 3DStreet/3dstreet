// The near-level rotation lock. These are properties that were established by
// driving the control by hand and are pinned here rather than re-driven: the
// rate must be RACK AND PINION — constant cursor speed gives constant rotation
// speed, calibrated so the mouse and the ring's tangent move together — and
// that calibration must not depend on where round the ring the press lands, nor
// on where the object sits in the frame.
//
// Three successive closed-form calibrations were wrong, each plausible, and
// each was caught only by driving. Every one of them would fail a test here.
/* global THREE */ // A-Frame's global, mirrored into the test env by test/setup.js.
import { describe, it, expect, beforeEach } from 'vitest';
import { EasyGizmoControls } from '@/editor/lib/gizmos/EasyGizmoControls.js';
import { ROTATE_LEVER_FLOOR_FRAC } from '@/editor/lib/gizmos/easyGizmoConstants.js';

const VIEWPORT = { width: 1600, height: 900 };
const HEAD_RING_ANGLE_DEG = 41.5; // where an arrowhead sits, from the join
const RING_RADIUS = 2.8;

/**
 * Agreement to within a FRACTION of the value, not to a number of decimal
 * places. These quantities are pixel rates in the tens, so an absolute
 * tolerance either passes everything or pins float noise; the claims being
 * made are all of the form "this does not vary with X", and a fraction is how
 * you say that at any scale.
 */
function expectWithin(actual, expected, fraction) {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(
    fraction
  );
}

function makeDom() {
  const dom = document.createElement('div');
  dom.getBoundingClientRect = () => ({
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    left: 0,
    top: 0,
    right: VIEWPORT.width,
    bottom: VIEWPORT.height
  });
  Object.defineProperty(dom, 'clientHeight', { value: VIEWPORT.height });
  Object.defineProperty(dom, 'clientWidth', { value: VIEWPORT.width });
  return dom;
}

function makeControls() {
  const camera = new THREE.PerspectiveCamera(80, 16 / 9, 0.1, 5000);
  camera.updateMatrixWorld(true);
  const sceneEl = {
    object3D: new THREE.Scene(),
    addEventListener() {},
    removeEventListener() {}
  };
  const c = new EasyGizmoControls(camera, makeDom(), sceneEl);
  c.updateMatrixWorld(true);
  return c;
}

/**
 * Pose the arc as it is drawn in the flattened presentation and put the press
 * on the ring.
 *
 * The camera sits at the origin looking down −Z, so depth runs along −Z and
 * the horizontal offset along +X. The arms meet along the VIEW AXIS, which for
 * this camera is world +Z from the ring's centre — hence a shallow arc yaw of
 * 0, since R_y(0) sends the ring's local +Z there.
 */
function poseRing(
  c,
  { depth = 24, offAxisDeg = 0, radius = 2.8, ringAngleDeg = 0 } = {}
) {
  const centre = new THREE.Vector3(
    depth * Math.tan(THREE.MathUtils.degToRad(offAxisDeg)),
    -1,
    -depth
  );
  c.arcGroup.position.copy(centre);
  c._shallowArcYaw = 0;
  c.updateMatrixWorld(true);

  const a = THREE.MathUtils.degToRad(ringAngleDeg);
  c._pickPoint.set(
    centre.x + radius * Math.sin(a),
    centre.y,
    centre.z + radius * Math.cos(a)
  );
  c._pickHit = true;
  return centre;
}

function lever(opts) {
  const c = makeControls();
  poseRing(c, opts);
  c._measureRotateLever();
  return c._dragRotPxPerRad;
}

describe('near-level rotation lever', () => {
  it('does not depend on where round the ring the press lands', () => {
    // The defining property of the rack-and-pinion rule: a ring has one radius,
    // so pressing further along an arm no more changes the ratio than touching
    // a gear elsewhere does. The superseded calibration was pinned to the
    // ARROWHEAD, which is this test's −41.5 and +41.5 cases, and differed from
    // the join by 1.33.
    const at = (ringAngleDeg) => lever({ ringAngleDeg });
    const join = at(0);
    expect(join).toBeGreaterThan(0);
    for (const angle of [-HEAD_RING_ANGLE_DEG, -20, 20, HEAD_RING_ANGLE_DEG]) {
      expectWithin(at(angle), join, 1e-9);
    }
  });

  it('does not depend on where the object sits in the frame', () => {
    // The reported symptom: rotation about right at the centre of the view, too
    // fast at the left and right edges. A yaw moves a ring point partly ALONG
    // the view axis, and that component reaches screen-x through the
    // perspective divide once the object is off centre.
    const centre = lever({ offAxisDeg: 0 });
    for (const off of [-40, -20, 20, 40]) {
      // Not exact, and the residual is the point rather than slack: the probe
      // turns the ring by a finite milliradian, and the ring point's own depth
      // shifts a little as it swings. 0.05% at the frame edge, against the
      // 30% the superseded calibration was out by.
      expectWithin(lever({ offAxisDeg: off }), centre, 0.001);
    }
  });

  it('is the tangent match: a small yaw moves the join by lever × angle', () => {
    // Rack and pinion stated as an equation. This is what "movement matching
    // at the tangent" means, and it is the one assertion that would still hold
    // if every constant in the file changed.
    const c = makeControls();
    const centre = poseRing(c, { offAxisDeg: 25 });
    c._measureRotateLever();

    const swing = (theta) => {
      const before = c._screenX(c._pickPoint);
      const after = c._screenX(
        c._pickPoint
          .clone()
          .sub(centre)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), theta)
          .add(centre)
      );
      return (after - before) / theta;
    };
    // A chord, not the tangent, so it agrees with the lever only in the limit.
    expectWithin(swing(1e-3), c._dragRotPxPerRad, 1e-4);
    // And it is worth knowing how fast that agreement decays, because the
    // decay IS the accepted falling-behind: about half a percent by a degree of
    // turn, and roughly 19% by 60 degrees.
    expectWithin(swing(0.02), c._dragRotPxPerRad, 0.01);
  });

  it('scales with the depth of the RING, not of the object', () => {
    // The one thing the rate should scale with, and the second of the three
    // factors the superseded calibration got wrong: the arc is drawn out in
    // FRONT of the object, so it is nearer the camera than the object is and
    // correspondingly bigger on screen. Taking the object's own depth
    // overstated the rate by about 13% at 24 m.
    //
    // Stated as an invariant rather than as a ratio, because "half at twice
    // the distance" is only true of the object's depth and is exactly the
    // wrong answer: the true relation is inverse in (depth − ring radius).
    const invariant = (depth) =>
      lever({ depth, radius: RING_RADIUS }) * (depth - RING_RADIUS);
    expectWithin(invariant(48), invariant(24), 0.001);
    expectWithin(invariant(120), invariant(24), 0.001);
    // And the naive reading really does differ, so this test can fail. The
    // rate falls off slightly FASTER than inverse-distance, because the ring's
    // forward offset is a larger fraction of a short distance than of a long
    // one: 0.469 rather than 0.5 across this pair.
    expect(lever({ depth: 48 }) / lever({ depth: 24 })).toBeLessThan(0.49);
  });

  it('is signed, so the object turns the way the cursor moves', () => {
    // Taken from the measurement rather than assumed, which is what would let
    // a press on the far side of the ring invert correctly rather than by
    // accident. Rightward cursor travel is a positive yaw.
    expect(lever({})).toBeGreaterThan(0);
  });

  it('reports nothing measurable rather than a wrong number when the press missed', () => {
    // A did-not-run must not collapse into a permissive answer: zero is the
    // sentinel `_useShallowPointerModel` refuses on, sending the gesture to
    // the bounded ground-plane model instead of dividing by a guess.
    const c = makeControls();
    poseRing(c, {});
    c._pickHit = false;
    c._measureRotateLever();
    expect(c._dragRotPxPerRad).toBe(0);
    c.axis = 'rotate';
    c.dragConstrained = true;
    c._dragMpp = 0.02;
    expect(c._useShallowPointerModel()).toBe(false);
  });

  it('accepts a measurable lever, so the refusal above is not unconditional', () => {
    // The case above pins the refusal only NEGATIVELY, and a build that refused
    // every gesture would pass it.
    const c = makeControls();
    poseRing(c, {});
    c._measureRotateLever();
    c.axis = 'rotate';
    c.dragConstrained = true;
    c._dragMpp = 0.02;
    expect(c._dragRotPxPerRad).not.toBe(0);
    expect(c._useShallowPointerModel()).toBe(true);
  });

  it('floors the lever only in poses no camera can reach', () => {
    // The lever falls with the cosine of the object's angle off the view axis.
    // At the frame edge it is nowhere near the floor; the floor exists so a
    // degenerate camera divides by something bounded rather than by nothing.
    const c = makeControls();
    poseRing(c, { offAxisDeg: 40 });
    c._measureRotateLever();
    const floor = c._dragRotPxPerRadCap * ROTATE_LEVER_FLOOR_FRAC;
    expect(Math.abs(c._dragRotPxPerRad)).toBeGreaterThan(floor);
  });

  it('takes the floor exactly in a pose where it does bind', () => {
    // The case above discriminates only because the fraction is what it is —
    // a bound lever yields exactly cap × the fraction, and its strict `>` then
    // fails. Nothing in the rig's own pose space binds it, so the binding pose
    // is named here: turning the grab a quarter round the ring on the view axis
    // puts the lever well under the floor.
    const c = makeControls();
    poseRing(c, {});
    c._shallowArcYaw = Math.PI / 2;
    c._measureRotateLever();
    expect(Math.abs(c._dragRotPxPerRad)).toBeCloseTo(
      c._dragRotPxPerRadCap * ROTATE_LEVER_FLOOR_FRAC,
      6
    );
  });
});

describe('where the arms meet', () => {
  // The rig above SETS `_shallowArcYaw`, so nothing there would notice the arc
  // going back to pointing at the camera — and that is the change the reported
  // symptom actually came from. Pin it separately.
  //
  // With the arms meeting along the view axis the join always sits where the
  // ring's tangent runs across the view, which is why the rate comes out free
  // of any frame-position term. Aiming at the camera instead puts the join a
  // further `off-axis` round the ring, and the rate then varies as 1/cos of
  // that — 1.0 dead centre, about 1.3 at the edge of a wide frame.

  const arcYawFor = (cameraYawDeg) => {
    const c = makeControls();
    c.camera.rotation.set(0, THREE.MathUtils.degToRad(cameraYawDeg), 0);
    c.camera.updateMatrixWorld(true);
    c._shallowAmount = 1;
    c._refreshShallowFrame(0);
    return THREE.MathUtils.radToDeg(c._shallowArcYaw);
  };

  it('aims the join along the camera axis, so it tracks camera yaw exactly', () => {
    for (const yaw of [0, 30, -45, 90]) {
      expect(arcYawFor(yaw)).toBeCloseTo(yaw, 6);
    }
  });

  it('cannot depend on the object, because it is never given one', () => {
    // Structural, not behavioural, and deliberately so: the frame takes the
    // object's heading and nothing else. A future change that reintroduced a
    // position argument would break this line, which is the point of it.
    expect(EasyGizmoControls.prototype._refreshShallowFrame.length).toBe(1);
  });

  it('is frozen while a gesture is running', () => {
    // Latched at the press so a camera move mid-drag cannot reshape the
    // control under the grip.
    const c = makeControls();
    c._shallowAmount = 1;
    c._refreshShallowFrame(0);
    const before = c._shallowArcYaw;
    c.isDragging = true;
    c.camera.rotation.set(0, Math.PI / 3, 0);
    c.camera.updateMatrixWorld(true);
    c._refreshShallowFrame(0);
    expect(c._shallowArcYaw).toBe(before);
  });
});

describe('near-level rotation gesture', () => {
  let c;

  beforeEach(() => {
    c = makeControls();
    poseRing(c, { offAxisDeg: 15 });
    c._measureRotateLever();
    // The latches startDrag takes for a flattened rotate.
    c.axis = 'rotate';
    c.dragConstrained = true;
    c._dragMpp = 0.02;
    c._dragStartMouseX = 0;
    c.rotateStartYawDeg = 30;
    c.el = {
      _rot: { x: 0, y: 30, z: 0 },
      getAttribute(name) {
        return name === 'rotation' ? this._rot : null;
      },
      setAttribute(name, value) {
        if (name === 'rotation') this._rot = { ...value };
      }
    };
    c.object = new THREE.Object3D();
  });

  const dragTo = (px) => {
    c.mouse.x = px / (VIEWPORT.width / 2);
    c.moveRotate();
    return c.el.getAttribute('rotation').y - 30;
  };

  it('constant cursor travel gives constant rotation', () => {
    // Rack and pinion, and the reason the arcsin alternative was rejected:
    // the rate is what is held constant, not the tracking of the grabbed
    // point.
    const first = dragTo(60);
    const second = dragTo(120) - first;
    const third = dragTo(180) - first - second;
    expect(second).toBeCloseTo(first, 1);
    expect(third).toBeCloseTo(first, 1);
  });

  it('is absolute from the press, so a long gesture cannot drift', () => {
    dragTo(200);
    dragTo(-350);
    dragTo(40);
    expect(dragTo(120)).toBeCloseTo(dragTo(120), 6);
    // And returning the cursor to the press returns the object to its start.
    expect(dragTo(0)).toBeCloseTo(0, 6);
  });

  it('turns the object the way the cursor moves', () => {
    expect(dragTo(100)).toBeGreaterThan(0);
    expect(dragTo(-100)).toBeLessThan(0);
  });

  it('ignores vertical cursor movement entirely', () => {
    const yaw = dragTo(90);
    c.mouse.y = 0.8;
    c.moveRotate();
    expect(c.el.getAttribute('rotation').y - 30).toBeCloseTo(yaw, 6);
  });

  it('leaves pitch and roll alone', () => {
    c.el._rot = { x: 7, y: 30, z: -3 };
    dragTo(150);
    expect(c.el.getAttribute('rotation').x).toBe(7);
    expect(c.el.getAttribute('rotation').z).toBe(-3);
  });
});
