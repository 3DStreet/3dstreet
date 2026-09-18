/* global THREE */ // A-Frame's global, mirrored into the test env by test/setup.js.
import { describe, it, expect, vi } from 'vitest';
import { EasyGizmoControls } from '@/editor/lib/gizmos/EasyGizmoControls.js';
import {
  LANDING_HIDE_GAP_METRES,
  LANDING_SHOW_GAP_METRES
} from '@/editor/lib/gizmos/easyGizmoConstants.js';

function makeControls() {
  const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 5000);
  camera.updateMatrixWorld(true);
  const dom = document.createElement('div');
  dom.getBoundingClientRect = () => ({
    width: 1600,
    height: 900,
    left: 0,
    top: 0
  });
  Object.defineProperty(dom, 'clientHeight', { value: 900 });
  return new EasyGizmoControls(camera, dom, {
    object3D: new THREE.Scene(),
    addEventListener() {},
    removeEventListener() {}
  });
}

/**
 * The fixture's start pose is deliberately OFF the quantisation the gizmo
 * commits at. A pose already at three and two decimal places formats to the
 * same string rounded and unrounded, so the very build this suite exists to
 * catch — one that snapshots the live, unrounded transform the way the stock
 * gizmo does — would pass on a tidy fixture.
 */
function stubEntity() {
  return {
    _pos: { x: 1.2345678, y: 0, z: 2.7182818 },
    _rot: { x: 0, y: 30.123456, z: 0 },
    getAttribute(name) {
      if (name === 'position') return this._pos;
      if (name === 'rotation') return this._rot;
      return null;
    },
    setAttribute(name, value) {
      if (name === 'position') this._pos = { ...value };
      if (name === 'rotation') this._rot = { ...value };
    },
    addEventListener() {},
    removeEventListener() {}
  };
}

function armGesture(c, axis) {
  const scene = new THREE.Scene();
  const object = new THREE.Object3D();
  scene.add(object);
  const el = stubEntity();
  object.position.set(el._pos.x, el._pos.y, el._pos.z);
  object.updateMatrixWorld(true);

  c.el = el;
  c.object = object;
  c.dragEl = el;
  c.dragObject = object;
  c.axis = axis;
  c.isDragging = true;
  c.dragSnapshot = c._formatPose(el);
  return { el, object };
}

function captureCommit(c) {
  const commits = [];
  c.addEventListener('commitDrag', (evt) => commits.push(evt));
  return commits;
}

describe('a gesture that changes nothing', () => {
  it('reports a change whose value equals its old value, as strings', () => {
    // The unchanged-value filter downstream is a bare identity comparison
    // between the two, so this is only true if BOTH sides came out of the same
    // formatter at the same quantisation — which is what makes "released where
    // it started adds no undo entry" a property of the design rather than
    // something to find in a live test.
    const c = makeControls();
    const { el } = armGesture(c, 'move');
    const commits = captureCommit(c);

    c.setWorldPosition(9, 0, 9);
    c.setWorldPosition(1.2345678, 0, 2.7182818);
    c.endGesture('pointerup');

    expect(commits).toHaveLength(1);
    const changed = commits[0].changes.filter((ch) => ch.value !== ch.oldValue);
    expect(changed).toHaveLength(0);
    commits[0].changes.forEach((ch) => {
      expect(typeof ch.value).toBe('string');
      expect(typeof ch.oldValue).toBe('string');
    });
    // And nothing was left half-written on the entity either.
    expect(el.getAttribute('position').x).toBeCloseTo(1.235, 6);
  });

  it('does report a change when the object really moved', () => {
    // The case above would also pass against a build that never reports
    // anything at all.
    const c = makeControls();
    armGesture(c, 'move');
    const commits = captureCommit(c);

    c.setWorldPosition(4, 0, 4);
    c.endGesture('pointerup');

    const changed = commits[0].changes.filter((ch) => ch.value !== ch.oldValue);
    expect(changed).toHaveLength(1);
    expect(changed[0].component).toBe('position');
  });
});

describe('the routes out of a gesture', () => {
  it('commits on release', () => {
    const c = makeControls();
    armGesture(c, 'move');
    const commits = captureCommit(c);
    c.setWorldPosition(4, 0, 4);
    c.endGesture('pointerup');
    expect(commits).toHaveLength(1);
  });

  for (const reason of [
    'pointercancel',
    'blur',
    'escape',
    'detach',
    'editorclosed'
  ]) {
    it(`reverts to the mouse-down pose and commits nothing on ${reason}`, () => {
      // The commit lives on the release path alone. Every other exit puts the
      // object back where the press found it and executes no history command.
      const c = makeControls();
      const { el } = armGesture(c, 'move');
      const commits = captureCommit(c);
      c.setWorldPosition(4, 0, 4);
      c.endGesture(reason);
      expect(commits).toHaveLength(0);
      expect(el.getAttribute('position').x).toBeCloseTo(1.235, 6);
      expect(el.getAttribute('position').z).toBeCloseTo(2.718, 6);
    });
  }
});

describe('a landing square is a button', () => {
  it('commits only if the pointer is still over the target that was pressed', () => {
    const c = makeControls();
    armGesture(c, 'landingDown');
    const commits = captureCommit(c);
    c._landingPress = { axis: 'landingDown', y: -3, armed: false };
    c.endGesture('pointerup');
    expect(commits).toHaveLength(0);
  });

  it('places the object on the pressed target when it is still armed', () => {
    const c = makeControls();
    const { el } = armGesture(c, 'landingDown');
    const commits = captureCommit(c);
    c._landingPress = { axis: 'landingDown', y: -3, armed: true };
    c.endGesture('pointerup');
    expect(commits).toHaveLength(1);
    // X, Z and yaw are unchanged; the base comes to rest on the surface.
    expect(el.getAttribute('position').y).toBeCloseTo(-3, 3);
    expect(el.getAttribute('position').x).toBeCloseTo(1.235, 6);
  });

  it('labels the three gesture kinds separately', () => {
    // With only two labels a rotate-only gesture is listed as a move, which is
    // a wrong entry in the undo list rather than a vague one.
    const kinds = { move: 'move', rotate: 'rotate', landingUp: 'place' };
    Object.entries(kinds).forEach(([axis, name]) => {
      const c = makeControls();
      armGesture(c, axis);
      const commits = captureCommit(c);
      if (axis === 'landingUp') {
        c._landingPress = { axis, y: 5, armed: true };
      } else {
        c.setWorldPosition(4, 0, 4);
      }
      c.endGesture('pointerup');
      expect(commits[0].name).toBe(name);
    });
  });
});

describe('the landing gate', () => {
  it('shows a target past the show figure and hides it below the hide one', () => {
    const c = makeControls();
    expect(
      c._gateLanding(-LANDING_SHOW_GAP_METRES * 2, 0, false)
    ).not.toBeNull();
    // Between the two it holds, which is what stops it flickering.
    const between = (LANDING_SHOW_GAP_METRES + LANDING_HIDE_GAP_METRES) / 2;
    expect(c._gateLanding(-between, 0, false)).not.toBeNull();
    expect(c._gateLanding(-LANDING_HIDE_GAP_METRES / 2, 0, false)).toBeNull();
    expect(c._gateLanding(-between, 0, false)).toBeNull();
  });

  it('offers nothing where there is no surface', () => {
    const c = makeControls();
    expect(c._gateLanding(null, 0, true)).toBeNull();
  });
});

describe('disposal', () => {
  it('registers every drawn resource, and drains the registry', () => {
    // The first half is the half that can fail. Asserting only that every
    // registered resource was disposed compares the registry against itself, so
    // a factory line that creates a material and forgets to register it is
    // invisible to it — which is precisely the leak this guards.
    const c = makeControls();
    const drawn = [];
    c.traverse((node) => {
      if (!node.isMesh) return;
      drawn.push(node.geometry);
      const material = node.material;
      if (Array.isArray(material)) drawn.push(...material);
      else drawn.push(material);
    });
    expect(drawn.length).toBeGreaterThan(0);
    drawn.forEach((resource) => {
      expect(c.registry.has(resource)).toBe(true);
    });

    const entries = c.registry.entries.slice();
    const spies = entries.map((entry) => vi.spyOn(entry, 'dispose'));
    c.dispose();
    spies.forEach((spy) => expect(spy).toHaveBeenCalled());
    expect(c.registry.entries).toHaveLength(0);
  });
});
