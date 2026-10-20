/* global AFRAME */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import * as THREE from 'three';
import { IntlProvider } from 'react-intl';
import Events from '@/editor/lib/Events.js';
import { ActionBar } from '@/editor/components/elements/ActionBar/ActionBar.component.jsx';
import {
  getGroupBounds,
  getGroupCenter
} from '@/editor/lib/groups/groupBounds.js';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import { getShapeStyle } from '@/editor/lib/shapeStyle.js';
import { defineEntityElement, worldOf } from '../lib/groups/_entityElement.js';
import { group, mountEditor, solid } from '../lib/groups/_editorHarness.js';

// Drawing a shape while a group is open: the real toolbar, shape tool,
// commands and scope controller. The shape goes into the group that was open
// when the tool started, where it was drawn, and the group's outline and
// scrim take in the drawing while it is made.

vi.mock('@/editor/lib/cameras', () => ({ copyCameraPosition: vi.fn() }));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/nav-experimental/index.js', async () => {
  const { EventDispatcher, Vector3 } = await import('three');
  return {
    isStreetLevelNav: () => false,
    ExperimentalControls: class extends EventDispatcher {
      center = new Vector3();
      setAspectRatio() {}
      setCamera() {}
      focus() {}
      navigateDoubleClick() {}
      newSceneCameraZoom() {}
    }
  };
});

defineEntityElement();

const WIDTH = 1200;
const HEIGHT = 800;

let editor;
let notify;
// As the inspector does when a tool takes the canvas and gives it back
// (index.jsx): the cursor pauses, and the selection is cleared.
const onHideCursor = () => {
  editor.cursorEl.isPlaying = false;
  editor.inspector.selectEntity(null);
};
const onShowCursor = () => {
  editor.cursorEl.isPlaying = true;
};

beforeEach(() => {
  editor = mountEditor({ gizmo: true });
  // The shape tool works on the scene and its canvas, as A-Frame's scene.
  AFRAME.scenes[0] = editor.sceneEl;
  editor.sceneEl.camera = editor.camera;
  editor.inspector.config.defaultParent = '#street-container';
  editor.camera.position.set(0, 30, 40);
  editor.camera.lookAt(0, 0, 0);
  editor.camera.updateMatrixWorld();
  // As the inspector does when a tool takes the cursor (index.jsx).
  Events.on('hidecursor', onHideCursor);
  Events.on('showcursor', onShowCursor);
  notify = { infoMessage: vi.fn(), warningMessage: vi.fn() };
  vi.stubGlobal('STREET', { notify });
});

afterEach(() => {
  Events.off('hidecursor', onHideCursor);
  Events.off('showcursor', onShowCursor);
  cleanup();
  editor.dispose();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

// A click on the canvas as the browser sends it: pointer then mouse events.
function click(canvas, x, y) {
  const at = { clientX: x, clientY: y, button: 0, detail: 1 };
  fireEvent.pointerDown(canvas, at);
  fireEvent.mouseDown(canvas, at);
  fireEvent.pointerUp(canvas, at);
  fireEvent.mouseUp(canvas, at);
}

function drawingTool() {
  render(
    <IntlProvider locale="en">
      <ActionBar selectedEntity={null} />
    </IntlProvider>
  );
  pickShapeTool();
}

function pickShapeTool() {
  fireEvent.click(screen.getByTitle(/^Shape Tool/));
}

function switchToHandTool() {
  fireEvent.click(screen.getByTitle(/^Hand Tool/));
}

const canvasOf = () => editor.sceneEl.canvas;

function moveTo(x, y) {
  fireEvent.pointerMove(canvasOf(), { clientX: x, clientY: y });
}

function pressKey(key) {
  act(() => {
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true })
    );
  });
}

// The vertices placed so far, as the preview draws them (world positions): the
// preview's last vertex is the cursor's.
function drawnPoints() {
  const preview = document.getElementById('shapeDrawPreview');
  return [...preview.querySelectorAll('[shape-vertex]')]
    .slice(0, -1)
    .map((el) => el.object3D.position.clone());
}

const createdShape = () =>
  document.querySelector('[shape]:not(#shapeDrawPreview)');

function vertexWorldPositions(shapeEl) {
  return [...shapeEl.children].map((child) =>
    new THREE.Vector3().setFromMatrixPosition(worldOf(child))
  );
}

function expectNear(actual, expected, digits = 6) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

function loaded(el) {
  act(() => {
    el.dispatchEvent(new Event('loaded'));
  });
}

// Three clicks away from any member.
const SPOTS = [
  [500, 500],
  [700, 520],
  [600, 420]
];

function clickSpots(spots = SPOTS) {
  for (const [x, y] of spots) click(canvasOf(), x, y);
}

// The screen position of a world point, in the harness canvas's pixels.
function screenOf(world) {
  const p = world.clone().project(editor.camera);
  return { x: ((p.x + 1) * WIDTH) / 2, y: ((1 - p.y) * HEIGHT) / 2 };
}

const scrim = () => document.querySelector('[data-group-scope-scrim]');

// The part of the canvas the scrim leaves uncovered, as points, or null when
// it covers the whole canvas.
function aperture() {
  const d = scrim().querySelector('path').getAttribute('d');
  const [cover, hole] = d
    .split('M')
    .map((part) => part.trim())
    .filter(Boolean);
  expect(cover).toBe(`0 0 H ${WIDTH} V ${HEIGHT} H 0 Z`);
  if (!hole) return null;
  return hole
    .replace('Z', '')
    .split('L')
    .map((pair) => {
      const [x, y] = pair.trim().split(/\s+/).map(Number);
      return { x, y };
    });
}

const cross = (o, a, b) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

function inside(polygon, p) {
  let sign = 0;
  for (let i = 0; i < polygon.length; i++) {
    const c = cross(polygon[i], polygon[(i + 1) % polygon.length], p);
    if (Math.abs(c) < 1e-9) continue;
    if (sign && Math.sign(c) !== sign) return false;
    sign = Math.sign(c);
  }
  return true;
}

const presentation = () => editor.inspector.groupScope.presentation;

// A point in a group's own frame.
function inFrameOf(groupEl, world) {
  return world
    .clone()
    .applyMatrix4(new THREE.Matrix4().copy(worldOf(groupEl)).invert());
}

function contains(box, point) {
  return box.clone().expandByScalar(1e-6).containsPoint(point);
}

describe('drawing a shape with a group open', () => {
  it('puts the shape into the innermost open group at the world position it was drawn, keeps the groups open and raises no notice (fails if the tool still creates at the top level, or converts the points through the wrong frame)', () => {
    const { inspector, streetContainer } = editor;
    streetContainer.object3D.position.set(5, 0, 3);
    const outer = group(streetContainer, { id: 'outer' });
    solid(outer, [0, 0, 0], [2, 2, 2], { id: 'outer-member' });
    const inner = group(outer, {
      id: 'inner',
      position: [12, 1, -7],
      yaw: 40
    });
    solid(inner, [0, 0, 0], [2, 2, 2], { id: 'inner-member' });
    inspector.groupScope.open(inner);
    expect(editor.openIds()).toEqual(['outer', 'inner']);

    drawingTool();
    // Picking the tool clears the selection; the groups stay open.
    expect(inspector.selectedEntity).toBe(null);
    expect(editor.openIds()).toEqual(['outer', 'inner']);

    clickSpots();
    // The clicks are the tool's: nothing selected, the groups still open.
    expect(inspector.selectedEntity).toBe(null);
    expect(editor.openIds()).toEqual(['outer', 'inner']);
    const drawn = drawnPoints();
    expect(drawn).toHaveLength(3);
    pressKey('Enter');

    const shape = createdShape();
    expect(shape).not.toBe(null);
    expect(shape.parentNode).toBe(inner);
    loaded(shape);
    const placed = vertexWorldPositions(shape);
    expect(placed).toHaveLength(3);
    placed.forEach((position, i) => expectNear(position, drawn[i]));
    expect(editor.openIds()).toEqual(['outer', 'inner']);
    expect(inspector.selectedEntity).toBe(shape);
    expect(inspector.history.undos).toHaveLength(1);
    expect(notify.infoMessage).not.toHaveBeenCalled();
    expect(notify.warningMessage).not.toHaveBeenCalled();
  });

  it('creates the shape where it always was when no group is open: container-local points, no parent given (fails if the world points are used unconverted)', () => {
    const { inspector, streetContainer } = editor;
    streetContainer.object3D.position.set(5, 0, 3);
    const execute = vi.spyOn(inspector, 'execute');

    drawingTool();
    clickSpots();
    const drawn = drawnPoints();
    pressKey('Enter');

    const calls = execute.mock.calls.filter(
      ([type]) => type === 'entitycreate'
    );
    expect(calls).toHaveLength(1);
    const payload = calls[0][1];
    expect(payload.parentEl).toBeUndefined();
    expect(payload.requireParent).toBeUndefined();
    const offset = new THREE.Vector3(5, 0, 3);
    const centroid = drawn
      .reduce((sum, p) => sum.add(p), new THREE.Vector3())
      .divideScalar(drawn.length)
      .sub(offset);
    const [cx, cy, cz] = payload.components.position.split(' ').map(Number);
    expectNear({ x: cx, y: cy, z: cz }, centroid);
    payload.children.forEach((child, i) => {
      const [x, y, z] = child.components.position.split(' ').map(Number);
      const expected = drawn[i].clone().sub(offset).sub(centroid);
      expectNear({ x, y, z }, expected);
    });
    const style = getShapeStyle();
    expect(payload.components.shape).toMatchObject({
      lineColor: style.lineColor,
      lineWidth: style.lineWidth,
      fillColor: style.fillColor,
      fillOpacity: style.fillOpacity
    });
    expect(payload.components['data-layer-name']).toMatch(
      /^Shape • Polyline \d+$/
    );
  });

  it('uses the group that was open when the tool started, even if it is closed while drawing, and the new shape reopens it (fails if the destination is taken at the commit)', () => {
    const { inspector, streetContainer } = editor;
    const g = group(streetContainer, { id: 'g' });
    solid(g, [0, 0, 0], [2, 2, 2], { id: 'member' });
    const elsewhere = solid(streetContainer, [30, 0, 30], [32, 2, 32], {
      id: 'elsewhere'
    });
    inspector.groupScope.open(g);

    drawingTool();
    click(canvasOf(), SPOTS[0][0], SPOTS[0][1]);
    click(canvasOf(), SPOTS[1][0], SPOTS[1][1]);
    // As a layer-panel selection of a top-level item would: closes the group,
    // and the tool stays active.
    inspector.selectEntity(elsewhere);
    expect(editor.openIds()).toEqual([]);
    click(canvasOf(), SPOTS[2][0], SPOTS[2][1]);
    pressKey('Enter');

    const shape = createdShape();
    expect(shape.parentNode).toBe(g);
    loaded(shape);
    expect(editor.openIds()).toEqual(['g']);
  });

  describe('when the group can no longer take the shape', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => vi.useRealTimers());

    function expectAddedAtTopLevel(drawn) {
      const shape = createdShape();
      expect(shape).not.toBe(null);
      expect(shape.parentNode).toBe(editor.streetContainer);
      loaded(shape);
      const placed = vertexWorldPositions(shape);
      expect(placed).toHaveLength(drawn.length);
      placed.forEach((position, i) => expectNear(position, drawn[i]));
      expect(notify.infoMessage).toHaveBeenCalledTimes(1);
      expect(notify.infoMessage).toHaveBeenCalledWith(
        groupMessage('drawnShapeAtTopLevel')
      );
      expect(notify.warningMessage).not.toHaveBeenCalled();
    }

    it('adds the shape at the top level, where it was drawn, and says so, when the group is deleted mid-draw (fails if the drawing is dropped, or the points are not re-posed under the container)', () => {
      const { inspector, streetContainer } = editor;
      streetContainer.object3D.position.set(5, 0, 3);
      const g = group(streetContainer, { id: 'g' });
      solid(g, [0, 0, 0], [2, 2, 2], { id: 'member' });
      inspector.groupScope.open(g);

      drawingTool();
      click(canvasOf(), SPOTS[0][0], SPOTS[0][1]);
      click(canvasOf(), SPOTS[1][0], SPOTS[1][1]);
      const drawn = drawnPoints();
      act(() => {
        inspector.execute('entityremove', g);
      });
      expect(editor.openIds()).toEqual([]);
      pressKey('Enter');

      expectAddedAtTopLevel(drawn);
    });

    it('does the same when an outer group is still open, and the new shape then closes it (fails if the generic notice is added too, or the shape goes into the outer group)', () => {
      const { inspector, streetContainer } = editor;
      streetContainer.object3D.position.set(5, 0, 3);
      const outer = group(streetContainer, { id: 'outer' });
      solid(outer, [0, 0, 0], [2, 2, 2], { id: 'outer-member' });
      const inner = group(outer, { id: 'inner', position: [12, 1, -7] });
      inspector.groupScope.open(inner);
      expect(editor.openIds()).toEqual(['outer', 'inner']);

      drawingTool();
      click(canvasOf(), SPOTS[0][0], SPOTS[0][1]);
      click(canvasOf(), SPOTS[1][0], SPOTS[1][1]);
      const drawn = drawnPoints();
      act(() => {
        inspector.execute('entityremove', inner);
      });
      expect(editor.openIds()).toEqual(['outer']);
      pressKey('Enter');

      expectAddedAtTopLevel(drawn);
      expect(editor.openIds()).toEqual([]);
    });
  });
});

describe('the outline and scrim while drawing in an open group', () => {
  // A group turned and moved off the origin, with a member box at the origin
  // of its own frame.
  function populatedGroup() {
    const g = group(editor.streetContainer, {
      id: 'g',
      position: [12, 1, -7],
      yaw: 40
    });
    solid(g, [0, 0, 0], [2, 2, 2], { id: 'member' });
    editor.inspector.groupScope.open(g);
    editor.frame();
    return g;
  }

  it('takes in each point as it is placed and the cursor after it, lets go of the cursor when it leaves the canvas or the point is removed, and never moves the group center or bounds (fails if the world points are unioned without the group frame, are fed into the stored bounds, or the cursor is left out)', () => {
    const g = populatedGroup();
    const storedBox = getGroupBounds(g).clone();
    const storedCenter = getGroupCenter(g, new THREE.Vector3()).clone();
    const expectStoredUnchanged = () => {
      expect(getGroupBounds(g).equals(storedBox)).toBe(true);
      expectNear(getGroupCenter(g, new THREE.Vector3()), storedCenter);
    };

    drawingTool();
    click(canvasOf(), SPOTS[0][0], SPOTS[0][1]);
    const [p] = drawnPoints();
    const pLocal = inFrameOf(g, p);
    // A precondition of the row: the point is outside the group's box.
    expect(storedBox.containsPoint(pLocal)).toBe(false);
    editor.frame();
    expect(contains(presentation().outlineBox, pLocal)).toBe(true);
    expect(inside(aperture(), screenOf(p))).toBe(true);
    expectStoredUnchanged();

    // The cursor, further away.
    moveTo(900, 260);
    const preview = document.getElementById('shapeDrawPreview');
    const cursor = preview.lastElementChild.object3D.position.clone();
    const cursorLocal = inFrameOf(g, cursor);
    // A precondition of the row: the cursor is beyond the padded box.
    const padded = storedBox
      .clone()
      .expandByPoint(pLocal)
      .expandByScalar(getShapeStyle().lineWidth * 2);
    expect(padded.containsPoint(cursorLocal)).toBe(false);
    editor.frame();
    expect(contains(presentation().outlineBox, pLocal)).toBe(true);
    expect(contains(presentation().outlineBox, cursorLocal)).toBe(true);
    expect(inside(aperture(), screenOf(cursor))).toBe(true);
    expectStoredUnchanged();
    expect(preview.parentNode).toBe(editor.sceneEl);

    // The cursor leaves the canvas: it is parked on the placed point.
    fireEvent.pointerLeave(canvasOf());
    editor.frame();
    expect(contains(presentation().outlineBox, cursorLocal)).toBe(false);
    expect(contains(presentation().outlineBox, pLocal)).toBe(true);

    // The only point is removed.
    pressKey('Backspace');
    editor.frame();
    expect(drawnPoints()).toHaveLength(0);
    expect(presentation().outlineBox.equals(storedBox)).toBe(true);
    expectStoredUnchanged();
  });

  it('lets go of the drawing when the tool ends without a shape, after a shape is made, and when the tool is switched away (fails if the extent is only cleared on some of those paths)', () => {
    const g = populatedGroup();
    const storedBox = getGroupBounds(g).clone();

    // (a) One point is not a shape.
    drawingTool();
    click(canvasOf(), SPOTS[0][0], SPOTS[0][1]);
    expect(presentation().drawingExtent).not.toBe(null);
    pressKey('Enter');
    expect(createdShape()).toBe(null);
    expect(presentation().drawingExtent).toBe(null);
    editor.frame();
    expect(presentation().outlineBox.equals(storedBox)).toBe(true);

    // (b) A shape is made. Its meshes do not exist in this harness, so the
    // group's bounds have not grown.
    pickShapeTool();
    clickSpots();
    pressKey('Enter');
    const shape = createdShape();
    expect(shape).not.toBe(null);
    loaded(shape);
    expect(presentation().drawingExtent).toBe(null);
    editor.frame();
    expect(presentation().outlineBox.equals(storedBox)).toBe(true);

    // (c) The tool is switched away from, which ends it without finishing.
    pickShapeTool();
    click(canvasOf(), SPOTS[0][0], SPOTS[0][1]);
    expect(presentation().drawingExtent).not.toBe(null);
    switchToHandTool();
    expect(presentation().drawingExtent).toBe(null);
    editor.frame();
    expect(presentation().outlineBox.equals(storedBox)).toBe(true);
  });

  it('opens the scrim around a drawing in an empty group from its first point, and takes in every point after it (fails with no room around a point or a segment, which have no area to leave open)', () => {
    const g = group(editor.streetContainer, {
      id: 'empty',
      position: [12, 1, -7],
      yaw: 40
    });
    editor.inspector.groupScope.open(g);
    editor.frame();

    drawingTool();
    for (const [x, y] of SPOTS) {
      click(canvasOf(), x, y);
      const placed = drawnPoints();
      editor.frame();
      const hole = aperture();
      expect(hole).not.toBe(null);
      expect(hole.length).toBeGreaterThanOrEqual(3);
      for (const point of placed) {
        expect(inside(hole, screenOf(point))).toBe(true);
        expect(contains(presentation().outlineBox, inFrameOf(g, point))).toBe(
          true
        );
      }
    }
  });
});
