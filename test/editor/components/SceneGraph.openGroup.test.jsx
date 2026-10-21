import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PropTypes from 'prop-types';
import { useEffect, useState } from 'react';
import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import Events from '@/editor/lib/Events.js';
import useStore from '@/store';
import SceneGraph from '@/editor/components/scenegraph/SceneGraph.jsx';
import {
  ROW_HEIGHT,
  findRow,
  row,
  settle,
  streetUtilsStub
} from './_sceneGraphHarness.jsx';
import {
  group,
  item,
  mountEditor,
  solid
} from '../lib/groups/_editorHarness.js';

// The layer panel while groups are open: the real scope controller,
// viewport, raycaster and shortcuts (see _editorHarness), with the panel
// rendered beside them as the editor renders it.

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

let h;
let focused;
const onFocus = (object) => focused.push(object);
// The editor answers the panel's `entityselect` by selecting without
// announcing it again (index.jsx).
const onEntitySelect = (el) => h.inspector.selectEntity(el, false);

// The editor's select announces the selection with `entityselect` unless
// told not to (index.jsx), which the harness's select does not do.
function announceSelections(inspector) {
  const select = inspector.selectEntity;
  inspector.selectEntity = function (el, emit) {
    select.call(this, el);
    if (emit === undefined) Events.emit('entityselect', el);
  };
}

const realRect = Element.prototype.getBoundingClientRect;
const realScrollIntoView = Element.prototype.scrollIntoView;

beforeEach(() => {
  useStore.setState({ isInspectorEnabled: true, panelsVisible: true });
  h = mountEditor();
  announceSelections(h.inspector);
  Events.on('entityselect', onEntitySelect);
  focused = [];
  Events.on('objectfocus', onFocus);
  vi.stubGlobal('STREET', {
    utils: streetUtilsStub(),
    notify: { infoMessage: vi.fn(), warningMessage: vi.fn() }
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // While the editor is still mounted: its store subscribers run.
  useStore.setState({ isInspectorEnabled: true, panelsVisible: true });
  h.dispose();
  Events.removeAllListeners();
  vi.unstubAllGlobals();
  Element.prototype.getBoundingClientRect = realRect;
  Element.prototype.scrollIntoView = realScrollIntoView;
  document.body.replaceChildren();
});

// Main keeps the last `entityselect` and hands it to the panel as its
// selection (Main.jsx).
function Host({ scene }) {
  const [selected, setSelected] = useState(null);
  useEffect(() => {
    Events.on('entityselect', setSelected);
    return () => Events.off('entityselect', setSelected);
  }, []);
  return <SceneGraph scene={scene} selectedEntity={selected} />;
}
Host.propTypes = { scene: PropTypes.object };

async function renderPanel() {
  const view = render(
    <IntlProvider locale="en">
      <Host scene={h.sceneEl} />
    </IntlProvider>
  );
  await settle();
  return view;
}

const named = (el, name) => {
  el.setAttribute('data-layer-name', name);
  return el;
};

// Street, Group B {Tree, Group C {Cone}}, Lamp. Tree and Cone are 1 m boxes
// the canvas can hit. In the list (and their row ids): Street sgnode0, Group B
// 1, Tree 2, Group C 3, Cone 4, Lamp 5.
function buildScene() {
  const sc = h.streetContainer;
  const street = named(item(sc, { id: 'street' }), 'Street');
  const B = named(group(sc, { id: 'B' }), 'Group B');
  const tree = named(solid(B, [0, 0, 0], [1, 1, 1], { id: 'tree' }), 'Tree');
  const C = named(group(B, { id: 'C' }), 'Group C');
  const cone = named(solid(C, [4, 0, 0], [5, 1, 1], { id: 'cone' }), 'Cone');
  const lamp = named(item(sc, { id: 'lamp' }), 'Lamp');
  h.frame();
  return { street, B, tree, C, cone, lamp };
}

const selected = () => h.inspector.selectedEntity;
const has = (name, cls) => findRow(name).classList.contains(cls);
const listed = (name) => screen.queryByText(name) !== null;

async function run(action) {
  act(action);
  await settle();
}

async function click(name, init) {
  fireEvent.click(findRow(name), init);
  await settle();
}

// A double-click on a row as the browser is specified to deliver it (UI
// Events: a press and a click carrying each click count, then dblclick).
// Each event goes to the row shown under the pointer at that moment, as in
// the browser: each top-level block of rows is keyed by its last row's
// index, so the first click remounts the block when it expands a group.
async function doubleClick(name) {
  for (const detail of [1, 2]) {
    fireEvent.mouseDown(findRow(name), { detail });
    fireEvent.click(findRow(name), { detail });
  }
  fireEvent.dblClick(findRow(name), { detail: 2 });
  await settle();
}

// jsdom lays nothing out. For the scroll tests, a row's box is looked up by
// its id (`sgnode` + its place in the list, which stays with its entity) and
// the list's by `layers`; anything else has jsdom's empty box.
let rects;
let scrolled;
const IN_VIEW = { top: 40, bottom: 80 };
const BELOW_VIEW = { top: 500, bottom: 540 };

function stubLayout(boxes) {
  rects = { layers: { top: 0, bottom: 400 }, ...boxes };
  Element.prototype.getBoundingClientRect = function () {
    const key = this.classList?.contains('layers') ? 'layers' : this.id;
    return rects[key] ?? realRect.call(this);
  };
  scrolled = [];
  Element.prototype.scrollIntoView = vi.fn(function () {
    scrolled.push(this.id);
  });
}

// Under fake timers: let the row list rebuild, then run the 100 ms the panel
// waits before it scrolls.
async function flushRows() {
  await act(() => vi.advanceTimersByTimeAsync(0));
}
async function waitForScroll() {
  await act(() => vi.advanceTimersByTimeAsync(100));
}

const dataTransfer = () => ({
  setData() {},
  setDragImage() {},
  effectAllowed: '',
  dropEffect: ''
});

// Returns whether the row advertised a drop there (preventDefault).
function dragOver(target, fraction) {
  const event = createEvent.dragOver(target, { dataTransfer: dataTransfer() });
  Object.defineProperty(event, 'clientY', { value: ROW_HEIGHT * fraction });
  Object.defineProperty(event, 'clientX', { value: 0 });
  return !fireEvent(target, event);
}

describe('the layer panel showing the open group', () => {
  it('marks the group opened on the canvas, fades the rows outside it and lists its own members only (fails if rows fade by selection, the mark is the selection bar, or the group is not expanded or is expanded to its depths)', async () => {
    buildScene();
    await renderPanel();
    // Tree's box: the first click selects Group B, the second opens it.
    h.aimDown(0.5, 0.5);
    await run(() => h.click());
    expect(selected()?.id).toBe('B');
    await run(() => h.click());
    expect(h.openIds()).toEqual(['B']);
    expect(selected()).toBe(null);

    expect(has('Group B', 'open-group')).toBe(true);
    expect(has('Group B', 'outside-open-group')).toBe(false);
    for (const name of ['Street', 'Lamp']) {
      expect(has(name, 'outside-open-group')).toBe(true);
    }
    for (const name of ['Tree', 'Group C']) {
      expect(has(name, 'open-group')).toBe(false);
      expect(has(name, 'outside-open-group')).toBe(false);
    }
    expect(listed('Cone')).toBe(false);
    expect(document.querySelectorAll('.entity.active')).toHaveLength(0);
  });

  it("scrolls the opened group's row into view when it is out of view (fails if opening does not scroll)", async () => {
    const { B } = buildScene();
    stubLayout({ sgnode1: BELOW_VIEW });
    await renderPanel();
    vi.useFakeTimers();
    // Selecting the group scrolls to it already; that scroll is not the one
    // under test.
    act(() => h.inspector.selectEntity(B));
    await flushRows();
    await waitForScroll();
    scrolled.length = 0;

    act(() => h.groupScope.open(B));
    await flushRows();
    await waitForScroll();
    expect(scrolled).toEqual(['sgnode1']);
  });

  it('expands and reveals a group opened again after it was closed and its row collapsed (fails if the group last shown is not forgotten when it closes)', async () => {
    const { B } = buildScene();
    stubLayout({ sgnode1: BELOW_VIEW });
    await renderPanel();
    vi.useFakeTimers();
    act(() => h.groupScope.open(B));
    await flushRows();
    await waitForScroll();
    // Leave it (which selects it), collapse its row, and clear the selection.
    act(() => h.groupScope.escape());
    fireEvent.click(findRow('Group B').querySelector('.collapsespace'));
    act(() => h.inspector.selectEntity(null));
    await flushRows();
    await waitForScroll();
    expect(listed('Tree')).toBe(false);
    scrolled.length = 0;

    act(() => h.groupScope.open(B));
    await flushRows();
    await waitForScroll();
    expect(listed('Tree')).toBe(true);
    expect(scrolled).toEqual(['sgnode1']);
  });

  it("does not scroll when the opened group's row is in view (fails if opening always scrolls)", async () => {
    const { B } = buildScene();
    stubLayout({ sgnode1: IN_VIEW });
    await renderPanel();
    vi.useFakeTimers();
    act(() => h.inspector.selectEntity(B));
    await flushRows();
    await waitForScroll();
    scrolled.length = 0;

    act(() => h.groupScope.open(B));
    await flushRows();
    await waitForScroll();
    expect(scrolled).toEqual([]);
  });

  it("scrolls to the selected row, not the group the selection opened (fails if the group's row scrolls while something is selected)", async () => {
    const { tree } = buildScene();
    stubLayout({ sgnode1: BELOW_VIEW, sgnode2: BELOW_VIEW });
    await renderPanel();
    vi.useFakeTimers();
    act(() => h.inspector.selectEntity(tree));
    await flushRows();
    await waitForScroll();
    expect(h.openIds()).toEqual(['B']);
    expect(scrolled).toEqual(['sgnode2']);
  });

  it('expands the opened group while the list is not shown, and scrolls nothing (fails if the expansion waits for the row to exist)', async () => {
    const { B } = buildScene();
    await renderPanel();
    stubLayout({ sgnode1: BELOW_VIEW });
    vi.useFakeTimers();
    act(() => useStore.setState({ panelsVisible: false }));
    act(() => h.inspector.selectEntity(B));
    act(() => h.groupScope.open(B));
    await flushRows();
    await waitForScroll();
    expect(scrolled).toEqual([]);

    act(() => useStore.setState({ panelsVisible: true }));
    await flushRows();
    expect(listed('Tree')).toBe(true);
  });

  it('expands the groups around a nested open group as far as its row, and marks the innermost one (fails if only the open group is expanded, or the outermost is marked)', async () => {
    const { C } = buildScene();
    await renderPanel();
    expect(listed('Group C')).toBe(false);
    await run(() => h.groupScope.open(C));
    expect(h.openIds()).toEqual(['B', 'C']);
    expect(has('Group C', 'open-group')).toBe(true);
    expect(listed('Tree')).toBe(true);
    expect(listed('Cone')).toBe(true);
    expect(has('Group B', 'outside-open-group')).toBe(true);
    expect(has('Tree', 'outside-open-group')).toBe(true);
    expect(has('Group B', 'open-group')).toBe(false);

    // Leaving a level collapses nothing.
    await run(() => h.groupScope.escape());
    expect(h.openIds()).toEqual(['B']);
    expect(listed('Cone')).toBe(true);
    expect(listed('Tree')).toBe(true);
    expect(has('Group B', 'open-group')).toBe(true);
    expect(has('Group C', 'open-group')).toBe(false);
    expect(has('Group C', 'outside-open-group')).toBe(false);
  });

  it('shows the groups already open when it mounts, and brings the open row into view (fails if the panel only reacts to later changes, or looks the row up before the list is built)', async () => {
    const { B, C } = buildScene();
    act(() => h.groupScope.open(C));
    await renderPanel();
    expect(has('Group C', 'open-group')).toBe(true);
    expect(listed('Tree')).toBe(true);
    expect(listed('Cone')).toBe(true);
    expect(has('Street', 'outside-open-group')).toBe(true);
    expect(has('Lamp', 'outside-open-group')).toBe(true);
    cleanup();

    // One level.
    act(() => h.groupScope.open(B));
    await renderPanel();
    expect(listed('Tree')).toBe(true);
    cleanup();

    // The reveal is scheduled as the panel mounts, so real time passes here.
    stubLayout({ sgnode3: BELOW_VIEW });
    act(() => h.groupScope.open(C));
    expect(selected()).toBe(null);
    await renderPanel();
    await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
    expect(scrolled).toContain('sgnode3');
  });

  it('stops listening for scope changes when it unmounts (fails if the listener is left behind)', async () => {
    buildScene();
    const before = Events.listenerCount('groupscopechanged');
    const view = await renderPanel();
    expect(Events.listenerCount('groupscopechanged')).toBe(before + 1);
    view.unmount();
    expect(Events.listenerCount('groupscopechanged')).toBe(before);
  });
});

describe('a click on a layer row with groups', () => {
  it('opens the selected group, and then selects a member inside it (fails if a click on a selected group selects it again, or a member click leaves the group)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.inspector.selectEntity(B));
    expect(has('Group B', 'active')).toBe(true);

    await click('Group B');
    expect(h.openIds()).toEqual(['B']);
    expect(selected()).toBe(null);
    expect(has('Group B', 'open-group')).toBe(true);

    await click('Tree');
    expect(selected()?.id).toBe('tree');
    expect(h.openIds()).toEqual(['B']);
  });

  it('does not open a hidden group (fails if the hidden check is dropped and the group is opened directly)', async () => {
    const { B } = buildScene();
    B.setAttribute('visible', false);
    await renderPanel();
    await run(() => h.inspector.selectEntity(B));
    await click('Group B');
    expect(h.openIds()).toEqual([]);
    expect(selected()?.id).toBe('B');
  });

  it("selects a member of a closed group, which opens the group around it (fails if a member click selects its group, as the canvas's does)", async () => {
    buildScene();
    await renderPanel();
    fireEvent.click(findRow('Group B').querySelector('.collapsespace'));
    await settle();
    await click('Tree');
    expect(selected()?.id).toBe('tree');
    expect(h.openIds()).toEqual(['B']);
  });

  it('closes a single open group and selects a faded row (fails if one level is left like a nested one)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(B));
    await click('Lamp');
    expect(selected()?.id).toBe('lamp');
    expect(h.openIds()).toEqual([]);
    expect(document.querySelectorAll('.outside-open-group')).toHaveLength(0);
  });

  it('on a faded row of a nested open group leaves one level and selects the group left, then with one level left selects the row (fails if the nested click selects the row, or the rule outlives the nesting)', async () => {
    const { C } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(C));
    await click('Tree');
    expect(selected()?.id).toBe('C');
    expect(h.openIds()).toEqual(['B']);
    for (const name of ['Tree', 'Group C']) {
      expect(has(name, 'outside-open-group')).toBe(false);
    }
    for (const name of ['Street', 'Lamp']) {
      expect(has(name, 'outside-open-group')).toBe(true);
    }

    await click('Lamp');
    expect(selected()?.id).toBe('lamp');
    expect(h.openIds()).toEqual([]);
  });

  it("on the open group's row leaves that level and selects the group (fails if the row does nothing, or opens the group again)", async () => {
    const { B, C } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(B));
    await click('Group B');
    expect(selected()?.id).toBe('B');
    expect(h.openIds()).toEqual([]);

    await run(() => h.groupScope.open(C));
    await click('Group C');
    expect(selected()?.id).toBe('C');
    expect(h.openIds()).toEqual(['B']);
  });
});

describe("the open group's row", () => {
  it('leaves the group and selects it on a right-click, then shows its menu (fails if the row is made inert like a faded one)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(B));
    expect(findRow('Group B').hasAttribute('data-disabled')).toBe(false);
    fireEvent.contextMenu(findRow('Group B'));
    await settle();
    expect(selected()?.id).toBe('B');
    expect(h.openIds()).toEqual([]);
    expect(screen.getByRole('menu')).not.toBe(null);
  });

  it('hides the group with its eye, which closes it (fails if the eye of the open row is made inert)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(B));
    fireEvent.click(
      findRow('Group B').querySelector('.entityVisibilityToggle')
    );
    await settle();
    expect(B.object3D.visible).toBe(false);
    expect(h.openIds()).toEqual([]);
  });

  it('cannot be dragged, nor can a faded row, while a row inside the group can (fails if dragging ignores the open group)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(B));
    expect(findRow('Group B').getAttribute('draggable')).toBe('false');
    expect(findRow('Lamp').getAttribute('draggable')).toBe('false');
    expect(findRow('Tree').getAttribute('draggable')).toBe('true');
  });
});

describe('a faded row', () => {
  it("has no menu and keeps the browser's own from showing, and a right-click changes nothing (fails if the menu is not disabled, or the default is not prevented)", async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(B));
    for (const name of ['Lamp', 'Street']) {
      expect(findRow(name).hasAttribute('data-disabled')).toBe(true);
    }
    for (const name of ['Group B', 'Tree', 'Group C']) {
      expect(findRow(name).hasAttribute('data-disabled')).toBe(false);
    }
    expect(fireEvent.contextMenu(findRow('Lamp'))).toBe(false);
    await settle();
    expect(screen.queryByRole('menu')).toBe(null);
    expect(selected()).toBe(null);
    expect(h.openIds()).toEqual(['B']);
  });

  it('treats a click on its eye or badge as a click on the row (fails if they keep their own actions)', async () => {
    const { B, lamp } = buildScene();
    lamp.setAttribute('focus-hotspot', '');
    lamp.setAttribute('visible', false);
    await renderPanel();
    await run(() => h.groupScope.open(B));
    fireEvent.click(findRow('Lamp').querySelector('.entityVisibilityToggle'));
    await settle();
    expect(lamp.object3D.visible).toBe(false);
    expect(selected()?.id).toBe('lamp');
    expect(h.openIds()).toEqual([]);

    await run(() => h.inspector.selectEntity(B));
    await run(() => h.groupScope.open(B));
    fireEvent.click(findRow('Lamp').querySelector('.entityBadge'));
    await settle();
    expect(focused).toEqual([]);
    expect(selected()?.id).toBe('lamp');
    expect(h.openIds()).toEqual([]);
  });

  it('leaves its eye and badges out of the tab order (fails if they stay focusable, or every row loses them)', async () => {
    const { B, lamp } = buildScene();
    lamp.setAttribute('focus-hotspot', '');
    lamp.setAttribute('visible', false);
    await renderPanel();
    await run(() => h.groupScope.open(B));
    const lampRow = findRow('Lamp');
    expect(lampRow.querySelector('.entityVisibilityToggle').tabIndex).toBe(-1);
    expect(lampRow.querySelector('.entityBadge').tabIndex).toBe(-1);
    expect(
      findRow('Tree').querySelector('.entityVisibilityToggle').tabIndex
    ).not.toBe(-1);
  });

  it('can still be dropped onto (fails if faded rows ignore drags)', async () => {
    const { C } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(C));
    fireEvent.dragStart(row('Cone'), { dataTransfer: dataTransfer() });
    expect(dragOver(row('Lamp'), 0.1)).toBe(true);
    expect(document.querySelector('.drop-line')).not.toBe(null);
  });
});

describe('the open mark during a drag', () => {
  it('gives way to the highlight of a drop into the open group (fails if both show)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(B));
    fireEvent.click(findRow('Group C').querySelector('.collapsespace'));
    await settle();
    fireEvent.dragStart(row('Cone'), { dataTransfer: dataTransfer() });
    expect(dragOver(row('Group B'), 0.5)).toBe(true);
    expect(has('Group B', 'drop-child')).toBe(true);
    expect(has('Group B', 'open-group')).toBe(false);
  });
});

describe('a double-click on a layer row', () => {
  it('on an unselected group selects it and moves the camera to it (fails if the second click opens it)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await doubleClick('Group B');
    expect(selected()?.id).toBe('B');
    expect(h.openIds()).toEqual([]);
    expect(focused).toEqual([B.object3D]);
  });

  it('on the selected group opens it and moves the camera to it (fails if the second click leaves it again)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.inspector.selectEntity(B));
    await doubleClick('Group B');
    expect(h.openIds()).toEqual(['B']);
    expect(selected()).toBe(null);
    expect(focused).toEqual([B.object3D]);
  });

  it("on the open group's row leaves it, selecting it, and moves the camera to it (fails if the second click reopens it)", async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(B));
    await doubleClick('Group B');
    expect(selected()?.id).toBe('B');
    expect(h.openIds()).toEqual([]);
    expect(focused).toEqual([B.object3D]);
  });

  it('on a faded row with one group open selects the row and moves the camera to it (fails if every faded-row click skips the camera move)', async () => {
    const { B, lamp } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(B));
    await doubleClick('Lamp');
    expect(selected()?.id).toBe('lamp');
    expect(h.openIds()).toEqual([]);
    expect(focused).toEqual([lamp.object3D]);
  });

  it('on a faded row of a nested open group only leaves one level, with no camera move, and a later double-click on the row works as usual (fails if the camera moves, the second click selects the row, or the skip outlives the next click)', async () => {
    const { C, tree } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(C));
    await doubleClick('Tree');
    expect(selected()?.id).toBe('C');
    expect(h.openIds()).toEqual(['B']);
    expect(focused).toEqual([]);

    // A single click that leaves a level, then a double-click on the row,
    // now inside the open group.
    await run(() => h.groupScope.open(C));
    await click('Tree');
    expect(selected()?.id).toBe('C');
    expect(h.openIds()).toEqual(['B']);
    await doubleClick('Tree');
    expect(selected()?.id).toBe('tree');
    expect(focused).toEqual([tree.object3D]);
  });

  it("on a row's expand arrow after that row's click left a level still moves the camera (fails if the skip outlives the click that set it)", async () => {
    const { B, C } = buildScene();
    await renderPanel();
    await run(() => h.groupScope.open(C));
    // Group B's row is faded: its click leaves Group C, and Group B's row is
    // then the open group's.
    await click('Group B');
    expect(h.openIds()).toEqual(['B']);

    // The arrow's clicks toggle the row and stop there; its dblclick reaches
    // the row.
    for (const detail of [1, 2]) {
      const arrow = findRow('Group B').querySelector('.collapsespace');
      fireEvent.mouseDown(arrow, { detail });
      fireEvent.click(arrow, { detail });
    }
    fireEvent.dblClick(findRow('Group B').querySelector('.collapsespace'), {
      detail: 2
    });
    await settle();
    expect(focused).toEqual([B.object3D]);
  });
});

describe('the arrow keys with groups open', () => {
  it('select the next listed row, faded or open, as they always have (fails if they skip the open group)', async () => {
    const { cone } = buildScene();
    await renderPanel();
    await run(() => h.inspector.selectEntity(cone));
    expect(h.openIds()).toEqual(['B', 'C']);
    fireEvent.keyUp(document.querySelector('.scenegraph-panel'), {
      keyCode: 38
    });
    await settle();
    expect(selected()?.id).toBe('C');
    expect(h.openIds()).toEqual(['B']);
  });
});

describe('renaming a group from its menu', () => {
  it('ends with a press elsewhere on the row, which does not then open the group; the next click does (fails if the press that ends the rename also opens the group, or the guard outlasts it)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.inspector.selectEntity(B));
    fireEvent.contextMenu(findRow('Group B'));
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await settle();
    const input = findRowInput();
    fireEvent.change(input, { target: { value: 'Planters' } });

    // A press on the row outside the field: the field loses focus (jsdom
    // moves no focus on a press, so the blur is sent here), then the click.
    const groupRow = input.closest('.entity');
    fireEvent.mouseDown(groupRow);
    fireEvent.blur(input);
    fireEvent.click(groupRow);
    await settle();
    expect(B.getAttribute('data-layer-name')).toBe('Planters');
    expect(h.openIds()).toEqual([]);
    expect(selected()?.id).toBe('B');

    // A click with no press first, so a guard left set would swallow it.
    await click('Planters');
    expect(h.openIds()).toEqual(['B']);
  });

  it('ends with a press on another row, whose click then selects that row (fails if the guard swallows a press on any row while something is renamed)', async () => {
    const { B } = buildScene();
    await renderPanel();
    await run(() => h.inspector.selectEntity(B));
    fireEvent.contextMenu(findRow('Group B'));
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    await settle();
    const input = findRowInput();
    fireEvent.change(input, { target: { value: 'Planters' } });

    fireEvent.mouseDown(findRow('Lamp'));
    fireEvent.blur(input);
    fireEvent.click(findRow('Lamp'));
    await settle();
    expect(B.getAttribute('data-layer-name')).toBe('Planters');
    expect(selected()?.id).toBe('lamp');
  });
});

function findRowInput() {
  return document.querySelector('.entity .entityNameInput');
}
