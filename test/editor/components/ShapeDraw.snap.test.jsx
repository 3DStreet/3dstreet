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
import useStore from '@/store';
import { Shortcuts } from '@/editor/lib/shortcuts.js';
import { ActionBar } from '@/editor/components/elements/ActionBar/ActionBar.component.jsx';
import { shapeDrawMessage } from '@/editor/components/elements/ActionBar/ShapeDrawAction.jsx';
import { ShapeToolSection } from '@/editor/components/elements/ShapeToolSection.jsx';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import { SHAPE_TOOL_DEFAULTS } from '@/editor/lib/shapeToolPrefs.js';
import {
  closingAdjustment,
  headingDeg,
  isMultipleOf
} from '@/editor/lib/shapeSnap.js';
import { defineEntityElement } from '../lib/groups/_entityElement.js';
import { group, mountEditor, solid } from '../lib/groups/_editorHarness.js';

// The shape tool with the Shape Tool settings: the real toolbar, draw tool,
// settings section, commands, group scope and editor shortcuts. Drawing is
// done at world points (projected to the harness canvas), so placements and
// the closes they make can be worked by hand.

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
const MIN = 0.05; // the draw tool's minimum vertex spacing
const ARM_PX = 12; // the draw tool's close radius

let editor;
let notify;
let execute;
const onHideCursor = () => {
  editor.cursorEl.isPlaying = false;
  editor.inspector.selectEntity(null);
};
const onShowCursor = () => {
  editor.cursorEl.isPlaying = true;
};

beforeEach(() => {
  localStorage.clear();
  useStore.setState({
    shapeToolSettings: { ...SHAPE_TOOL_DEFAULTS },
    panelsVisible: true,
    rightPanelTab: 'properties'
  });
  editor = mountEditor({ gizmo: true });
  AFRAME.scenes[0] = editor.sceneEl;
  editor.sceneEl.camera = editor.camera;
  editor.inspector.config.defaultParent = '#street-container';
  editor.camera.position.set(0, 30, 40);
  editor.camera.lookAt(0, 0, 0);
  editor.camera.updateMatrixWorld();
  Events.on('hidecursor', onHideCursor);
  Events.on('showcursor', onShowCursor);
  notify = { infoMessage: vi.fn(), warningMessage: vi.fn() };
  vi.stubGlobal('STREET', { notify });
  // The harness inspector has no undo of its own; give it the real one, so
  // a chord that reached the editor's undo would be seen doing it.
  editor.inspector.undo = vi.fn(() => editor.inspector.history.undo());
  editor.inspector.redo = vi.fn();
  // The editor shortcuts are module state: start every test from a clean
  // Escape latch.
  Shortcuts.disable();
  Shortcuts.enable();
  execute = vi.spyOn(editor.inspector, 'execute');
});

afterEach(() => {
  Events.off('hidecursor', onHideCursor);
  Events.off('showcursor', onShowCursor);
  cleanup();
  editor.dispose();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  localStorage.clear();
});

const canvasOf = () => editor.sceneEl.canvas;
const v3 = (x, z) => new THREE.Vector3(x, 0, z);

function screenOf(world) {
  const p = world.clone().project(editor.camera);
  return { x: ((p.x + 1) * WIDTH) / 2, y: ((1 - p.y) * HEIGHT) / 2 };
}

function click(x, y) {
  const at = { clientX: x, clientY: y, button: 0, detail: 1 };
  fireEvent.pointerDown(canvasOf(), at);
  fireEvent.mouseDown(canvasOf(), at);
  fireEvent.pointerUp(canvasOf(), at);
  fireEvent.mouseUp(canvasOf(), at);
}

const clickAt = (x, z) => {
  const s = screenOf(v3(x, z));
  click(s.x, s.y);
};

function moveTo(x, y) {
  fireEvent.pointerMove(canvasOf(), { clientX: x, clientY: y });
}

const moveToWorld = (x, z) => {
  const s = screenOf(v3(x, z));
  moveTo(s.x, s.y);
};

// A key event as a browser builds one: the editor's shortcuts read keyCode,
// the draw tool reads key.
const KEY_CODES = { Escape: 27, z: 90, Z: 90, y: 89, Backspace: 8, Enter: 13 };
function keyEvent(type, key, init = {}) {
  const event = new KeyboardEvent(type, {
    key,
    bubbles: true,
    cancelable: true,
    ...init
  });
  Object.defineProperty(event, 'keyCode', { value: KEY_CODES[key] ?? 0 });
  return event;
}
function pressKeyOn(target, key, init) {
  const event = keyEvent('keydown', key, init);
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
function releaseKeyOn(target, key, init) {
  const event = keyEvent('keyup', key, init);
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
const pressKey = (key, init) => pressKeyOn(document.body, key, init);
const escapeOn = (target = document.body) => {
  pressKeyOn(target, 'Escape');
  releaseKeyOn(target, 'Escape');
};

function loaded(el) {
  act(() => {
    el.dispatchEvent(new Event('loaded'));
  });
}

const previewEl = () => document.getElementById('shapeDrawPreview');

// Pick the tool and give its preview a shape component to signal on.
let invalid;
function pickShapeTool() {
  fireEvent.click(screen.getByTitle(/^Shape Tool/));
  const preview = previewEl();
  invalid = vi.fn();
  preview.components.shape = { setInvalidSignal: invalid };
  loaded(preview);
}

function drawingTool() {
  render(
    <IntlProvider locale="en">
      <ActionBar selectedEntity={null} />
      <ShapeToolSection />
    </IntlProvider>
  );
  pickShapeTool();
}

const switchToHandTool = () => fireEvent.click(screen.getByTitle(/^Hand Tool/));

// The committed points as the preview draws them (world positions), and the
// trailing cursor point.
function previewVertexEls() {
  return [...previewEl().querySelectorAll('[shape-vertex]')];
}
const drawnPoints = () =>
  previewVertexEls()
    .slice(0, -1)
    .map((el) => el.object3D.position.clone());
const trailing = () => previewVertexEls().at(-1).object3D.position.clone();

function readoutEls() {
  const g = previewEl()?.object3D.getObjectByName('shapeReadouts');
  return g ? g.children.map((o) => o.element) : [];
}
const angleLabels = () =>
  readoutEls().filter((e) => e.classList.contains('shape-readout--angle'));
const noticeLabels = () =>
  readoutEls().filter((e) => e.classList.contains('shape-readout--notice'));
const lengthLabels = () =>
  readoutEls().filter(
    (e) =>
      !e.classList.contains('shape-readout--angle') &&
      !e.classList.contains('shape-readout--notice') &&
      !e.classList.contains('shape-readout--plus-only')
  );

const setPref = (key, value) =>
  act(() => useStore.getState().setShapeToolSetting(key, value));

const lastInvalid = () => invalid.mock.calls.at(-1)?.[0];

const createdShapes = () =>
  [...document.querySelectorAll('[shape]')].filter(
    (el) => el.id !== 'shapeDrawPreview'
  );

// The last create's shape payload and its vertices in world positions.
function lastCreate() {
  const calls = execute.mock.calls.filter(([type]) => type === 'entitycreate');
  const payload = calls.at(-1)?.[1];
  if (!payload) return null;
  const [cx, cy, cz] = String(payload.components.position)
    .split(' ')
    .map(Number);
  const position =
    typeof payload.components.position === 'object'
      ? payload.components.position
      : { x: cx, y: cy, z: cz };
  const vertices = payload.children.map((child) => {
    const [x, y, z] = child.components.position.split(' ').map(Number);
    return new THREE.Vector3(position.x + x, position.y + y, position.z + z);
  });
  return { payload, shape: payload.components.shape, vertices };
}

function expectNear(actual, expected, digits = 6) {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.z).toBeCloseTo(expected.z, digits);
}

const plain = (p) => ({ x: p.x, y: p.y, z: p.z });

// The drawn points as plain objects, for the pure functions.
const plainPoints = () => drawnPoints().map(plain);

// Four rough points of a rectangle: snapped at 90° (alignment off, so the
// first side is free) they land at (0,0) (10,0) (10,8) (−3,8), and the close
// slides the last to (0,8).
function roughRectangle(z = 8, x3 = -3) {
  clickAt(0, 0);
  clickAt(10, 0);
  clickAt(10, z);
  clickAt(x3, z);
  expect(drawnPoints()).toHaveLength(4);
}

function armOverFirst() {
  moveToWorld(0, 0);
}

const oracleOf = (points, step = 90) =>
  closingAdjustment({ vertices: points, step, minSpacing: MIN }).point;

describe('Shape Tool settings while drawing', () => {
  it('leaves drawing as it was at the defaults: one live length when armed, no red for a too-close point', () => {
    drawingTool();
    clickAt(0, 0);
    clickAt(10, 0);
    // On top of the last point: too close to place, refused silently.
    moveToWorld(10, 0);
    expect(invalid).not.toHaveBeenCalledWith(true);
    clickAt(10, 10);
    armOverFirst();
    expect(lengthLabels()).toHaveLength(1);
    expect(angleLabels()).toHaveLength(0);
    expect(noticeLabels()).toHaveLength(0);
  });

  it('applies the display preferences to the shape being drawn, as they change (fails if the preview ignores them)', () => {
    setPref('showMeasurements', false);
    drawingTool();
    clickAt(0, 0);
    clickAt(10, 0);
    moveToWorld(10, 6);
    expect(lengthLabels()).toHaveLength(0);
    setPref('showMeasurements', true);
    moveToWorld(10, 7);
    expect(lengthLabels()).toHaveLength(1);
    setPref('showAngles', true);
    clickAt(10, 7);
    moveToWorld(4, 9);
    const angles = angleLabels();
    expect(angles).toHaveLength(1);
    const anchor = readoutsObjectFor(angles[0]).position;
    expectNear(anchor, drawnPoints()[2]);
  });

  it('shows a too-close snapped point as refused, and only with snap on (fails if it stays silent, or turns red with snap off)', () => {
    setPref('snapStep', 90);
    drawingTool();
    clickAt(0, 0);
    clickAt(10, 0);
    // One metre straight back along the last side: the reverse is not a
    // snapped direction, and the nearest ones are square to it, so the
    // pointer's foot falls on the last point itself.
    moveToWorld(9, 0);
    expect(lastInvalid()).toBe(true);
    clickAt(9, 0);
    expect(drawnPoints()).toHaveLength(2);

    setPref('snapStep', 0);
    invalid.mockClear();
    moveToWorld(9, 0);
    expect(invalid).not.toHaveBeenCalledWith(true);
  });

  it('arms on the pointer and previews the slid close, which a click then commits, across an edit (fails if it arms from the snapped point, or the preview or commit uses a stale plan)', () => {
    setPref('snapStep', 90);
    setPref('alignToAxes', false);
    drawingTool();
    roughRectangle();
    const before = plainPoints();
    const oracle = oracleOf(before);
    expect(
      Math.hypot(oracle.x - before[3].x, oracle.z - before[3].z)
    ).toBeGreaterThan(0.1);
    // The pointer over the first point snaps, from the last, to a point well
    // away from it: arming from the snapped point would not arm.
    const snapped = v3(before[3].x, 0); // the foot on the ray square to the last side
    const a = screenOf(v3(0, 0));
    const b = screenOf(snapped);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(ARM_PX);
    armOverFirst();
    expectNear(drawnPoints()[3], oracle);
    moveToWorld(-5, 4);
    expectNear(drawnPoints()[3], before[3]);

    // Re-draw the last two sides elsewhere; the close follows the new ones.
    pressKey('Backspace');
    pressKey('Backspace');
    clickAt(10, 5);
    clickAt(-2, 5);
    const before2 = plainPoints();
    const oracle2 = oracleOf(before2);
    expect(
      Math.hypot(oracle2.x - oracle.x, oracle2.z - oracle.z)
    ).toBeGreaterThan(0.1);
    armOverFirst();
    expectNear(drawnPoints()[3], oracle2);
    const ring = drawnPoints();
    const s = screenOf(v3(0, 0));
    click(s.x, s.y);
    const created = lastCreate();
    expect(created.shape.closed).toBe(true);
    expect(Object.keys(created.shape).sort()).toEqual(
      ['closed', 'fillColor', 'fillOpacity', 'lineColor', 'lineWidth'].sort()
    );
    created.vertices.forEach((v, i) => expectNear(v, ring[i]));
  });

  it('draws the snapped direction, with angles off or on, and only while it applies (fails if the guide follows the raw pointer)', () => {
    setPref('snapStep', 90);
    drawingTool();
    clickAt(0, 0);
    const first = drawnPoints()[0];
    const target = v3(10, 3);
    const raw = headingDeg(first, target);
    // At least 5° off every snapped direction.
    expect(Math.abs(raw - 90 * Math.round(raw / 90))).toBeGreaterThanOrEqual(5);

    const guide = () =>
      editor.inspector.sceneHelpers.getObjectByName('shapeDrawSnapGuide');
    const hidden = () => !guide() || guide().visible === false;
    const guideHeading = () => {
      const geometry = guide().geometry;
      const start = geometry.attributes.instanceStart;
      const end = geometry.attributes.instanceEnd;
      return headingDeg(
        { x: start.getX(0), z: start.getZ(0) },
        { x: end.getX(0), z: end.getZ(0) }
      );
    };

    for (const angles of [false, true]) {
      setPref('showAngles', angles);
      moveToWorld(target.x, target.z);
      expect(hidden()).toBe(false);
      expect(isMultipleOf(guideHeading(), 90)).toBe(true);
    }

    setPref('snapStep', 0);
    moveToWorld(target.x, target.z);
    expect(hidden()).toBe(true);

    setPref('snapStep', 90);
    clickAt(10, 0);
    clickAt(10, 10);
    moveToWorld(5, 12);
    expect(hidden()).toBe(false);
    armOverFirst();
    expect(hidden()).toBe(true);
  });

  it('applies a step changed mid-shape to the next point only (fails if settings are read at activation)', () => {
    setPref('snapStep', 90);
    drawingTool();
    clickAt(0, 0);
    clickAt(10, 0);
    const placed = drawnPoints();
    setPref('snapStep', 45);
    const rad = (40 * Math.PI) / 180;
    moveToWorld(10 + 10 * Math.cos(rad), 10 * Math.sin(rad));
    expect(headingDeg(placed[1], trailing())).toBeCloseTo(45, 6);
    const now = drawnPoints();
    now.forEach((p, i) => expectNear(p, placed[i]));
  });

  it('opens the panels on the properties tab at every activation, unless turned off', () => {
    useStore.setState({ panelsVisible: false, rightPanelTab: 'console' });
    drawingTool();
    expect(useStore.getState().panelsVisible).toBe(true);
    expect(useStore.getState().rightPanelTab).toBe('properties');
    pressKey('Enter');
    useStore.setState({ panelsVisible: false, rightPanelTab: 'console' });
    pickShapeTool();
    expect(useStore.getState().panelsVisible).toBe(true);
    expect(useStore.getState().rightPanelTab).toBe('properties');
    pressKey('Enter');

    setPref('openPanelOnSelect', false);
    useStore.setState({ panelsVisible: false, rightPanelTab: 'console' });
    pickShapeTool();
    expect(useStore.getState().panelsVisible).toBe(false);
    expect(useStore.getState().rightPanelTab).toBe('console');
  });

  it('puts no setting on the undo stack', () => {
    drawingTool();
    clickAt(0, 0);
    clickAt(10, 0);
    pressKey('Enter');
    expect(editor.inspector.history.undos).toHaveLength(1);
    setPref('snapStep', 45);
    setPref('showAngles', true);
    setPref('alignToAxes', false);
    expect(editor.inspector.history.undos).toHaveLength(1);
  });

  it('commits on every way of finishing what the armed preview showed: open when the close is refused, the slid ring when it is not (fails if any exit disagrees with the preview)', () => {
    const threeSquare = () => {
      clickAt(0, 0);
      clickAt(10, 0);
      clickAt(10, 10);
      expect(drawnPoints()).toHaveLength(3);
    };
    const exits = {
      click: () => {
        const s = screenOf(v3(0, 0));
        click(s.x, s.y);
      },
      Enter: () => pressKey('Enter'),
      Escape: () => escapeOn(),
      'tool switch': () => switchToHandTool()
    };
    const creates = () =>
      execute.mock.calls.filter(([type]) => type === 'entitycreate');
    setPref('snapStep', 90);
    setPref('alignToAxes', false);
    drawingTool();

    // Refused: no square close exists for three points at 90°.
    threeSquare();
    const clicked = plainPoints();
    armOverFirst();
    const notices = noticeLabels();
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent).toBe(shapeDrawMessage('snapCloseRefused'));
    expect(lastInvalid()).toBe(true);
    exits.click();
    expect(createdShapes()).toHaveLength(0);
    expect(drawnPoints()).toHaveLength(3);
    pressKey('Enter');
    for (const name of ['Escape', 'tool switch']) {
      pickShapeTool();
      threeSquare();
      armOverFirst();
      exits[name]();
    }
    expect(creates()).toHaveLength(3);
    for (const [, payload] of creates()) {
      expect(payload.components.shape.closed).toBeUndefined();
      expect(payload.children).toHaveLength(3);
    }
    lastCreate().vertices.forEach((v, i) => expectNear(v, clicked[i]));

    // Adjustable: every exit commits the slid ring.
    for (const name of Object.keys(exits)) {
      pickShapeTool();
      roughRectangle();
      const before = plainPoints();
      const oracle = oracleOf(before);
      expect(
        Math.hypot(oracle.x - before[3].x, oracle.z - before[3].z)
      ).toBeGreaterThan(0.1);
      armOverFirst();
      exits[name]();
      const created = lastCreate();
      expect(created.shape.closed, name).toBe(true);
      expectNear(created.vertices[3], oracle);
    }
  });

  it('snaps the first side to the axes of the group the shape will land in, the world’s otherwise (fails on world axes, a sign slip, or a frame the shape does not land in)', () => {
    setPref('snapStep', 90);
    setPref('alignToAxes', true);
    // A group turned 20°: its +x axis runs at −20° (340°) in the world.
    const rotatedGroup = (id) => {
      const g = group(editor.streetContainer, { id, yaw: 20 });
      solid(g, [30, 0, 30], [32, 2, 32], { id: `${id}-member` });
      act(() => editor.inspector.groupScope.open(g));
      return g;
    };
    // From the first point, a pointer 10° off the group's +x axis.
    const placeSecond = () => {
      clickAt(0, 0);
      const rad = (-30 * Math.PI) / 180;
      clickAt(10 * Math.cos(rad), 10 * Math.sin(rad));
      const [a, b] = drawnPoints();
      return headingDeg(a, b);
    };
    const nearZero = (heading) => Math.min(heading, 360 - heading);

    // Open: the group's axes.
    rotatedGroup('g1');
    drawingTool();
    const open = placeSecond();
    expect(open).toBeCloseTo(340, 6);
    expect(open).not.toBeCloseTo(20, 1);
    pressKey('Enter');

    // Closed mid-draw: the shape still lands in it, so still its axes.
    rotatedGroup('g2');
    const elsewhere = solid(editor.streetContainer, [40, 0, 40], [42, 2, 42], {
      id: 'elsewhere'
    });
    pickShapeTool();
    clickAt(0, 0);
    act(() => editor.inspector.selectEntity(elsewhere));
    expect(editor.openIds()).toEqual([]);
    const rad = (-30 * Math.PI) / 180;
    clickAt(10 * Math.cos(rad), 10 * Math.sin(rad));
    const [a, b] = drawnPoints();
    expect(headingDeg(a, b)).toBeCloseTo(340, 6);
    pressKey('Enter');

    // Deleted mid-draw: the shape lands at the top level, on world axes —
    // even though the pointer was shown the group's axes before.
    const g3 = rotatedGroup('g3');
    pickShapeTool();
    clickAt(0, 0);
    moveToWorld(10 * Math.cos(rad), 10 * Math.sin(rad));
    expect(headingDeg(drawnPoints()[0], trailing())).toBeCloseTo(340, 6);
    act(() => {
      editor.inspector.execute('entityremove', g3);
    });
    clickAt(10 * Math.cos(rad), 10 * Math.sin(rad));
    const [c, d] = drawnPoints();
    expect(nearZero(headingDeg(c, d))).toBeCloseTo(0, 6);
    pressKey('Enter');

    // Scaled unevenly (a route the command guard does not see): the group
    // would distort the shape, so it lands at the top level — said first, to
    // prove the fixture refuses — and so the first side uses world axes.
    const g4 = rotatedGroup('g4');
    g4.setAttribute('scale', { x: 2, y: 1, z: 1 });
    notify.infoMessage.mockClear();
    pickShapeTool();
    const scaled = placeSecond();
    pressKey('Enter');
    expect(notify.infoMessage).toHaveBeenCalledWith(
      groupMessage('drawnShapeAtTopLevel')
    );
    expect(nearZero(scaled)).toBeCloseTo(0, 6);
  });

  describe('the drawing keys after the snap dropdown', () => {
    let g;
    function entryState({ finishWith = 'Enter' } = {}) {
      g = group(editor.streetContainer, { id: 'g' });
      solid(g, [30, 0, 30], [32, 2, 32], { id: 'member' });
      editor.inspector.groupScope.open(g);
      setPref('snapStep', 90);
      drawingTool();
      redrawThree();
      if (finishWith === 'Enter') pressKey('Enter');
      else escapeOn();
      expect(createdShapes()).toHaveLength(1);
      expect(editor.inspector.history.undos).toHaveLength(1);
    }

    function redrawThree() {
      if (!previewEl()) pickShapeTool();
      clickAt(0, 0);
      clickAt(10, 0);
      clickAt(10, 10);
      expect(drawnPoints()).toHaveLength(3);
    }

    function focusDropdown() {
      const select = screen.getByRole('combobox');
      act(() => select.focus());
      expect(document.activeElement).toBe(select);
      return select;
    }

    it('hands the keys back on a canvas press (fails without the blur on press)', () => {
      entryState();
      redrawThree();
      const select = focusDropdown();
      clickAt(0, 10);
      expect(document.activeElement).not.toBe(select);
      expect(drawnPoints()).toHaveLength(4);
      pressKey('Backspace');
      expect(drawnPoints()).toHaveLength(3);
    });

    it('keeps Ctrl+Z on a focused dropdown off the editor’s undo, and swallows redo (fails if the chord reaches global undo or redo)', () => {
      entryState();
      redrawThree();
      const select = focusDropdown();
      pressKeyOn(select, 'z', { ctrlKey: true });
      expect(drawnPoints()).toHaveLength(2);
      expect(editor.inspector.undo).not.toHaveBeenCalled();
      expect(editor.inspector.history.undos).toHaveLength(1);
      expect(createdShapes()).toHaveLength(1);

      focusDropdown();
      pressKeyOn(select, 'Z', { ctrlKey: true, shiftKey: true });
      pressKeyOn(select, 'y', { ctrlKey: true });
      expect(editor.inspector.redo).not.toHaveBeenCalled();
      expect(drawnPoints()).toHaveLength(2);
    });

    it('does not let a stopped Escape leave the editor’s Escape armed for a later lone key-up (fails if the latch is cleared only in the bubble phase)', () => {
      entryState({ finishWith: 'Escape' });
      expect(Shortcuts.escapeDown).toBe(false);
      redrawThree();
      const select = focusDropdown();
      // The key-down was taken by the open dropdown list.
      releaseKeyOn(select, 'Escape');
      expect(drawnPoints()).toHaveLength(3);
      expect(editor.openIds()).toEqual(['g']);
    });

    it('lets an Escape typed in a field through to the page, and leaves text undo alone (fails if every Escape key-up is consumed, or the chord exception covers fields)', () => {
      entryState();
      redrawThree();
      const input = document.createElement('input');
      document.body.append(input);
      act(() => input.focus());
      const docSpy = vi.fn();
      const upSpy = vi.fn();
      document.addEventListener('keyup', docSpy);
      window.addEventListener('keyup', upSpy);
      try {
        escapeOn(input);
        expect(docSpy).toHaveBeenCalledWith(
          expect.objectContaining({ key: 'Escape' })
        );
        expect(upSpy).toHaveBeenCalledWith(
          expect.objectContaining({ key: 'Escape' })
        );
        expect(drawnPoints()).toHaveLength(3);
        const undo = pressKeyOn(input, 'z', { ctrlKey: true });
        expect(drawnPoints()).toHaveLength(3);
        expect(undo.defaultPrevented).toBe(false);
      } finally {
        document.removeEventListener('keyup', docSpy);
        window.removeEventListener('keyup', upSpy);
      }
    });
  });

  it('commits the snapped point the preview showed, not the pointer (fails if the click places the raw point)', () => {
    setPref('snapStep', 90);
    drawingTool();
    clickAt(0, 0);
    clickAt(10, 0);
    const raw = v3(13, 6);
    moveToWorld(raw.x, raw.z);
    const shown = trailing();
    expect(Math.hypot(shown.x - raw.x, shown.z - raw.z)).toBeGreaterThan(0.1);
    clickAt(raw.x, raw.z);
    expectNear(drawnPoints()[2], shown);
  });

  it('keeps a shown direction near a boundary, and drops it for the next side (fails if the held direction carries over)', () => {
    setPref('snapStep', 90);
    drawingTool();
    clickAt(0, 0);
    const first = drawnPoints()[0];
    const at = (from, deg, len = 10) => {
      const rad = (deg * Math.PI) / 180;
      return v3(from.x + len * Math.cos(rad), from.z + len * Math.sin(rad));
    };
    let p = at(first, 46);
    moveToWorld(p.x, p.z);
    expect(headingDeg(first, trailing())).toBeCloseTo(90, 6);
    p = at(first, 44);
    moveToWorld(p.x, p.z);
    expect(headingDeg(first, trailing())).toBeCloseTo(90, 6);
    clickAt(p.x, p.z);
    const second = drawnPoints()[1];
    expect(headingDeg(first, second)).toBeCloseTo(90, 6);
    p = at(second, 44);
    moveToWorld(p.x, p.z);
    const heading = headingDeg(second, trailing());
    expect(Math.min(heading, 360 - heading)).toBeCloseTo(0, 6);
  });

  it('keeps the guide out of camera-less scene probes (fails if the guide raycasts)', () => {
    setPref('snapStep', 90);
    drawingTool();
    clickAt(0, 0);
    moveToWorld(10, 3);
    const guide =
      editor.inspector.sceneHelpers.getObjectByName('shapeDrawSnapGuide');
    expect(guide).toBeTruthy();
    expect(guide.visible).toBe(true);
    let ancestor = guide.parent;
    while (ancestor && ancestor !== editor.inspector.sceneHelpers) {
      ancestor = ancestor.parent;
    }
    expect(ancestor).toBe(editor.inspector.sceneHelpers);
    editor.sceneEl.object3D.updateMatrixWorld(true);
    const probe = new THREE.Raycaster(v3(5, 0).setY(50), v3(0, 0).setY(-1));
    expect(() =>
      probe.intersectObject(editor.sceneEl.object3D, true)
    ).not.toThrow();
    expect(() =>
      probe.intersectObject(editor.inspector.sceneHelpers, true)
    ).not.toThrow();
  });

  it('follows a step changed while armed, in the preview at once and in the commit (fails without the repaint, or with a plan that ignores the step)', () => {
    setPref('snapStep', 90);
    setPref('alignToAxes', false);
    drawingTool();
    // (a) Snap turned off while armed.
    roughRectangle();
    const before = plainPoints();
    const oracle = oracleOf(before);
    expect(
      Math.hypot(oracle.x - before[3].x, oracle.z - before[3].z)
    ).toBeGreaterThan(0.1);
    armOverFirst();
    expectNear(drawnPoints()[3], oracle);
    setPref('snapStep', 0);
    expectNear(drawnPoints()[3], before[3]);
    pressKey('Enter');
    let created = lastCreate();
    expect(created.shape.closed).toBe(true);
    expectNear(created.vertices[3], before[3]);

    // (b) 90° to 45° while armed: (−7,10) closes to (0,10) at 90° and to
    // (−10,10) at 45°, the least move there.
    setPref('snapStep', 90);
    pickShapeTool();
    roughRectangle(10, -7);
    const b = plainPoints();
    const at90 = oracleOf(b, 90);
    const at45 = oracleOf(b, 45);
    expectNear(at90, { x: 0, z: 10 });
    expectNear(at45, { x: -10, z: 10 });
    expectNear(b[3], { x: -7, z: 10 });
    armOverFirst();
    expectNear(drawnPoints()[3], at90);
    setPref('snapStep', 45);
    expectNear(drawnPoints()[3], at45);
    pressKey('Enter');
    created = lastCreate();
    expectNear(created.vertices[3], at45);

    // (c) A second shape at the same revision and step gets its own plan.
    setPref('snapStep', 90);
    pickShapeTool();
    roughRectangle();
    armOverFirst();
    pressKey('Backspace');
    pressKey('Enter');
    pickShapeTool();
    roughRectangle(5, -2);
    const c = plainPoints();
    const ownOracle = oracleOf(c);
    armOverFirst();
    expectNear(drawnPoints()[3], ownOracle);
    expectNear(ownOracle, { x: 0, z: 5 });
  });
});

// The CSS2D object a readout element belongs to (its anchor is the object's
// position, local to the preview at the scene root, i.e. world).
function readoutsObjectFor(element) {
  const g = previewEl().object3D.getObjectByName('shapeReadouts');
  return g.children.find((o) => o.element === element);
}
