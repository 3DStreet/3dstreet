import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  createEvent,
  fireEvent,
  render,
  screen
} from '@testing-library/react';
import { IntlProvider } from 'react-intl';
import * as THREE from 'three';
import { History } from '@/editor/lib/history.js';
import { commandsByType } from '@/editor/lib/commands/index.js';
import { refuseGuardedTransform } from '@/editor/lib/transformGuard.js';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import SceneGraph from '@/editor/components/scenegraph/SceneGraph.jsx';
import { boxMesh } from '../lib/groups/_groupFixtures.js';

// The layer panel as the editor renders it (real entity.jsx, real commands and
// guard), over entities built without A-Frame. Drags are driven with the DOM
// drag events the rows listen to; a row is 40 px tall.

const ROW_HEIGHT = 40;

let sceneEl;
let root;
let editor;
let executed;

function makeEntity(parent, { id, name, cls, attrs = {} } = {}) {
  const el = document.createElement('a-entity');
  if (id) el.id = id;
  if (cls) el.className = cls;
  if (name) el.setAttribute('data-layer-name', name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.isEntity = true;
  el.object3D = new THREE.Group();
  el.object3D.el = el;
  el.components = {};
  el.pause = () => {};
  parent.appendChild(el);
  parent.object3D.add(el.object3D);
  return el;
}

// The editor's execute: the real guard, then the real History running the
// real command. Every call is recorded, refused or not.
function composedExecute(type, payload) {
  executed.push([type, payload]);
  const refusal = refuseGuardedTransform(type, payload);
  if (refusal) return refusal;
  const Cmd = commandsByType.get(type);
  editor.history.execute(new Cmd(editor, payload));
  return undefined;
}

// Marker attributes a moved element keeps (a street segment stays one after
// an undo).
const KEPT_ATTRIBUTES = [
  'street-segment',
  'managed-street',
  'data-transform-no-reparent'
];

// What the serializer and loader do, reduced to what a move needs: the data
// names the element, and recreation builds on the element the command made
// and announces it to its parent as A-Frame does.
const serializerStub = {
  // Read by the panel header's menu.
  getCurrentSceneId: () => null,
  getElementData: (el) => ({
    id: el.id,
    class: el.className ? el.className.split(' ') : undefined,
    'data-layer-name': el.getAttribute('data-layer-name') ?? undefined,
    attributes: KEPT_ATTRIBUTES.filter((name) => el.hasAttribute(name))
  }),
  createEntityFromObj: (data, parent, before) => {
    const el = data.entityElement;
    el.id = data.id;
    if (data.class) el.className = data.class.join(' ');
    if (data['data-layer-name']) {
      el.setAttribute('data-layer-name', data['data-layer-name']);
    }
    for (const name of data.attributes ?? []) el.setAttribute(name, '');
    el.isEntity = true;
    el.object3D = new THREE.Group();
    el.object3D.el = el;
    el.components = {};
    el.pause = () => {};
    parent.insertBefore(el, before);
    parent.object3D.add(el.object3D);
    parent.dispatchEvent(
      new CustomEvent('child-attached', { detail: { el }, bubbles: true })
    );
    return el;
  }
};

beforeEach(() => {
  sceneEl = document.createElement('a-scene');
  sceneEl.object3D = new THREE.Scene();
  document.body.append(sceneEl);
  root = makeEntity(sceneEl, { id: 'street-container' });
  executed = [];
  editor = {
    config: { defaultParent: '#street-container' },
    selectedEntity: null,
    selectEntity: vi.fn(),
    execute: composedExecute
  };
  editor.history = new History(editor);
  vi.stubGlobal('AFRAME', { INSPECTOR: editor, components: {} });
  vi.stubGlobal('STREET', { utils: serializerStub });
});

afterEach(() => {
  // Let every move this test started finish, as A-Frame would once the new
  // element loads, so none is left in progress for the next test.
  for (const [type, payload] of executed) {
    if (type !== 'entityreparent') continue;
    act(() => {
      document
        .getElementById(payload.entity.id)
        ?.dispatchEvent(new Event('loaded'));
    });
  }
  sceneEl.remove();
  vi.unstubAllGlobals();
});

async function renderPanel(messages) {
  const view = render(
    <IntlProvider locale="en" messages={messages}>
      <SceneGraph scene={sceneEl} selectedEntity={null} />
    </IntlProvider>
  );
  await settle();
  return view;
}

// The panel rebuilds its row list on a zero-delay debounce.
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

// jsdom lays nothing out: give a row, or the strip after the last row, the
// place it has in the list (rows 40 px tall, flush, in document order).
function placeInList(el) {
  const hosts = [...document.querySelectorAll('.entity, .layers-drop-end')];
  const top = hosts.indexOf(el) * ROW_HEIGHT;
  Object.defineProperty(el, 'offsetTop', { configurable: true, value: top });
  Object.defineProperty(el, 'offsetHeight', {
    configurable: true,
    value: ROW_HEIGHT
  });
  return el;
}

function row(name) {
  const el = placeInList(screen.getByText(name).closest('.entity'));
  el.getBoundingClientRect = () => ({
    top: 0,
    bottom: ROW_HEIGHT,
    left: 0,
    right: 200,
    height: ROW_HEIGHT,
    width: 200
  });
  return el;
}

const dataTransfer = () => ({
  setData() {},
  setDragImage() {},
  effectAllowed: '',
  dropEffect: ''
});

async function expand(name) {
  fireEvent.click(row(name).querySelector('.collapsespace'));
  await settle();
}

function startDrag(name) {
  fireEvent.dragStart(row(name), { dataTransfer: dataTransfer() });
}

// Returns whether the row advertised a drop there (preventDefault). jsdom
// has no DragEvent, so the pointer position is set on the event directly;
// every row's left edge is at 0.
function dragOver(target, fraction, clientX = 0) {
  const event = createEvent.dragOver(target, { dataTransfer: dataTransfer() });
  Object.defineProperty(event, 'clientY', { value: ROW_HEIGHT * fraction });
  Object.defineProperty(event, 'clientX', { value: clientX });
  return !fireEvent(target, event);
}

// A pointer 5 px into a level's band: a row's depth-1 content starts 6 px in
// (2 px border, 4 px padding) and each level is indented 30 px.
const atLevel = (level) => 6 + 30 * (level - 1) + 5;

function drop(target) {
  fireEvent.drop(target, { dataTransfer: dataTransfer() });
}

const reparents = () =>
  executed
    .filter(([type]) => type === 'entityreparent')
    .map(([, p]) => ({
      entity: p.entity,
      parentEl: p.parentEl,
      indexInParent: p.indexInParent
    }));

async function finishMove(id) {
  act(() => {
    document.getElementById(id).dispatchEvent(new Event('loaded'));
  });
  await settle();
}

// Drops on `target` and returns where the move went ({parentEl,
// indexInParent}, or null for no move), then undoes it, so the next drop
// starts from the same tree.
async function dropAndUndo(target) {
  const count = reparents().length;
  drop(target);
  fireEvent.dragEnd(target);
  const move = reparents()[count];
  if (!move) return null;
  await finishMove(move.entity.id);
  act(() => {
    editor.history.undo();
  });
  await finishMove(move.entity.id);
  return { parentEl: move.parentEl, indexInParent: move.indexInParent };
}

// The drop line the list shows between rows, if any: its top, its indent and
// whether it has the "inside" chevron. There is never more than one.
function dropLine() {
  const lines = document.querySelectorAll('.drop-line');
  expect(lines.length).toBeLessThanOrEqual(1);
  const line = lines[0];
  return (
    line && {
      top: line.style.top,
      left: line.style.left,
      chevron: !!line.querySelector('svg.fa-chevron-right')
    }
  );
}

// The line's top for the gap above or below a placed row: 2 px straddling
// the boundary, kept inside the list above the first row.
const lineAbove = (el) => `${Math.max(0, el.offsetTop - 1)}px`;
const lineBelow = (el) => `${el.offsetTop + el.offsetHeight - 1}px`;

describe('layer panel drop zones', () => {
  it('drops a model into a group through the group row middle band, and offers no middle band for a street segment', async () => {
    const group = makeEntity(root, {
      id: 'g',
      name: 'Group A',
      cls: 'user-group'
    });
    makeEntity(group, { id: 'g-member', name: 'Member' });
    const model = makeEntity(root, { id: 'tree', name: 'Tree' });
    const street = makeEntity(root, {
      id: 'street',
      name: 'Street',
      attrs: { 'managed-street': '' }
    });
    makeEntity(street, {
      id: 'segment',
      name: 'Segment',
      attrs: { 'street-segment': '' }
    });
    await renderPanel();
    await expand('Street');

    startDrag('Segment');
    expect(dragOver(row('Group A'), 0.5)).toBe(false);
    fireEvent.dragEnd(row('Segment'));

    startDrag('Tree');
    expect(dragOver(row('Group A'), 0.5)).toBe(true);
    expect(row('Group A').classList.contains('drop-child')).toBe(true);
    drop(row('Group A'));

    expect(reparents()).toEqual([
      { entity: model, parentEl: 'g', indexInParent: 1 }
    ]);
    expect(document.getElementById('tree').parentNode).toBe(group);
  });

  it('keeps same-parent before/after reorders for a top-level shape, a street-prop holder child and an intersection child, with the payload the reorder helper builds', async () => {
    const shapeA = makeEntity(root, {
      id: 'shape-a',
      name: 'Shape A',
      attrs: { 'data-transform-no-reparent': '' }
    });
    makeEntity(root, { id: 'shape-b', name: 'Shape B' });
    const holderParent = makeEntity(root, { id: 'segment-host', name: 'Host' });
    const holder = makeEntity(holderParent, {
      name: 'Props',
      cls: 'custom-group'
    });
    const propA = makeEntity(holder, { id: 'prop-a', name: 'Prop A' });
    makeEntity(holder, { id: 'prop-b', name: 'Prop B' });
    const intersection = makeEntity(root, {
      id: 'crossing',
      name: 'Crossing',
      attrs: { intersection: '' }
    });
    const cornerA = makeEntity(intersection, {
      id: 'corner-a',
      name: 'Corner A'
    });
    makeEntity(intersection, { id: 'corner-b', name: 'Corner B' });
    await renderPanel();
    await expand('Host');
    await expand('Props');
    await expand('Crossing');

    startDrag('Shape A');
    expect(dragOver(row('Shape B'), 0.9)).toBe(true);
    drop(row('Shape B'));
    fireEvent.dragEnd(row('Shape B'));

    startDrag('Prop A');
    expect(dragOver(row('Prop B'), 0.9)).toBe(true);
    drop(row('Prop B'));
    fireEvent.dragEnd(row('Prop B'));

    startDrag('Corner A');
    expect(dragOver(row('Corner B'), 0.9)).toBe(true);
    drop(row('Corner B'));

    // The holder had no id; the reorder helper gives it one.
    expect(holder.id).toBeTruthy();
    expect(reparents()).toEqual([
      { entity: shapeA, parentEl: 'street-container', indexInParent: 2 },
      { entity: propA, parentEl: holder.id, indexInParent: 2 },
      { entity: cornerA, parentEl: 'crossing', indexInParent: 2 }
    ]);
  });

  it('splits an ordinary row at its midpoint (40% is before, 60% is after) rather than leaving a dead middle', async () => {
    const a = makeEntity(root, { id: 'a', name: 'Alpha' });
    makeEntity(root, { id: 'spacer', name: 'Spacer' });
    makeEntity(root, { id: 'b', name: 'Bravo' });
    await renderPanel();

    startDrag('Alpha');
    expect(dragOver(row('Bravo'), 0.4)).toBe(true);
    expect(dropLine().top).toBe(lineAbove(row('Bravo')));
    expect(dragOver(row('Bravo'), 0.6)).toBe(true);
    expect(dropLine().top).toBe(lineBelow(row('Bravo')));
    drop(row('Bravo'));

    expect(reparents()).toEqual([
      { entity: a, parentEl: 'street-container', indexInParent: 3 }
    ]);
  });

  it("drops into a group's first place from its expanded header's lower zone and from its first member's upper zone, at any pointer x (fails if the header's lower zone still means after the whole group)", async () => {
    makeEntity(root, { id: 'x', name: 'Loose' });
    const a = makeEntity(root, { id: 'a', name: 'Group A', cls: 'user-group' });
    const b = makeEntity(a, { id: 'b', name: 'Group B', cls: 'user-group' });
    makeEntity(b, { id: 'tree', name: 'Tree' });
    await renderPanel();
    await expand('Group A');

    for (const [name, fraction] of [
      ['Group A', 0.9],
      ['Group B', 0.1]
    ]) {
      for (const x of [0, atLevel(1), atLevel(3), 200]) {
        startDrag('Loose');
        expect(dragOver(row(name), fraction, x)).toBe(true);
        expect(dropLine()).toEqual({
          top: lineAbove(row('Group B')),
          left: '36px',
          chevron: true
        });
      }
      expect(await dropAndUndo(row(name))).toEqual({
        parentEl: 'a',
        indexInParent: 0
      });
    }
  });

  it('refuses the middle band of a group for a shape that may not change parent, and the guard refuses a forced move', async () => {
    makeEntity(root, { id: 'g', name: 'Group A', cls: 'user-group' });
    const shape = makeEntity(root, {
      id: 'shape',
      name: 'Shape',
      attrs: { 'data-transform-no-reparent': '' }
    });
    await renderPanel();

    startDrag('Shape');
    expect(dragOver(row('Group A'), 0.5)).toBe(false);
    expect(row('Group A').classList.contains('drop-child')).toBe(false);
    drop(row('Group A'));
    expect(reparents()).toEqual([]);

    expect(
      composedExecute('entityreparent', {
        entity: shape,
        parentEl: 'g',
        indexInParent: 0
      })
    ).toBe('This element cannot be moved to a different parent.');
    expect(editor.history.undos).toHaveLength(0);
    expect(shape.parentNode).toBe(root);
  });
});

describe('drop levels at a gap where groups end', () => {
  // x, then A ⊃ B ⊃ (tree, bench), then Later, all expanded. The gap between
  // bench and Later is the end of B, the end of A and the top level at once.
  async function nestedScene() {
    makeEntity(root, { id: 'x', name: 'Loose' });
    const a = makeEntity(root, { id: 'a', name: 'Group A', cls: 'user-group' });
    const b = makeEntity(a, { id: 'b', name: 'Group B', cls: 'user-group' });
    makeEntity(b, { id: 'tree', name: 'Tree' });
    makeEntity(b, { id: 'bench', name: 'Bench' });
    makeEntity(root, { id: 'later', name: 'Later' });
    await renderPanel();
    await expand('Group A');
    await expand('Group B');
  }

  it("lets the pointer's x choose the end of the inner group, the outer group or the top level, from either row at the gap, drawing a group level's line from its indent (fails if x is ignored, a group level's line is full width, or the two rows disagree)", async () => {
    await nestedScene();

    const expected = {
      3: { parentEl: 'b', indexInParent: 2 },
      2: { parentEl: 'a', indexInParent: 1 },
      1: { parentEl: 'street-container', indexInParent: 2 }
    };
    for (const [name, fraction] of [
      ['Bench', 0.85],
      ['Later', 0.15]
    ]) {
      for (const level of [3, 2, 1]) {
        startDrag('Loose');
        expect(dragOver(row(name), fraction, atLevel(level))).toBe(true);
        // The top level keeps a full-width line without a chevron.
        expect(dropLine()).toEqual({
          top: lineAbove(row('Later')),
          left: { 3: '66px', 2: '36px', 1: '0px' }[level],
          chevron: level > 1
        });
        expect(await dropAndUndo(row(name))).toEqual(expected[level]);
      }
    }
  });

  it('never offers a level that would leave the dragged row where it is, and takes the nearest level that moves it (fails if a no-op drop is offered at a group gap)', async () => {
    await nestedScene();
    // Bench over its own lower zone at the inner level: "after itself" is
    // no move, so the nearest level that is one, the end of A.
    startDrag('Bench');
    expect(dragOver(row('Bench'), 0.85, atLevel(3))).toBe(true);
    expect(await dropAndUndo(row('Bench'))).toEqual({
      parentEl: 'a',
      indexInParent: 1
    });
    // Tree over Bench's upper zone: "before Bench" is where Tree already is,
    // and the gap has no other level.
    startDrag('Tree');
    expect(dragOver(row('Bench'), 0.15, atLevel(3))).toBe(false);
    fireEvent.dragEnd(row('Tree'));
  });

  it('offers nothing under an expanded street header to the row right after the street in a group (fails if "after the street" is offered to the row already there)', async () => {
    const a = makeEntity(root, { id: 'a', name: 'Group A', cls: 'user-group' });
    const street = makeEntity(a, {
      id: 'st',
      name: 'Main Street',
      attrs: { 'managed-street': '' }
    });
    makeEntity(street, {
      id: 's1',
      name: 'Lane 1',
      attrs: { 'street-segment': '' }
    });
    makeEntity(a, { id: 'm', name: 'Model' });
    await renderPanel();
    await expand('Group A');
    await expand('Main Street');

    startDrag('Model');
    expect(dragOver(row('Main Street'), 0.6, atLevel(2))).toBe(false);
    expect(dragOver(row('Lane 1'), 0.4, atLevel(2))).toBe(false);
    fireEvent.dragEnd(row('Model'));
  });

  it('offers a shape that may not change parent only its own top level at the end of a group, drawn full width, wherever the pointer is (fails if illegal levels are offered or drawn)', async () => {
    makeEntity(root, {
      id: 'shape',
      name: 'Shape',
      attrs: { 'data-transform-no-reparent': '' }
    });
    const a = makeEntity(root, { id: 'a', name: 'Group A', cls: 'user-group' });
    const b = makeEntity(a, { id: 'b', name: 'Group B', cls: 'user-group' });
    makeEntity(b, { id: 'tree', name: 'Tree' });
    makeEntity(b, { id: 'bench', name: 'Bench' });
    makeEntity(root, { id: 'later', name: 'Later' });
    await renderPanel();
    await expand('Group A');
    await expand('Group B');

    startDrag('Shape');
    expect(dragOver(row('Bench'), 0.85, atLevel(3))).toBe(true);
    expect(dropLine()).toEqual({
      top: lineAbove(row('Later')),
      left: '0px',
      chevron: false
    });
    expect(await dropAndUndo(row('Bench'))).toEqual({
      parentEl: 'street-container',
      indexInParent: 2
    });
  });

  it("offers each group level on the strip after the last row when that row is inside groups, drawn from the level's indent (fails if the strip offers only the top level)", async () => {
    makeEntity(root, { id: 'x', name: 'Loose' });
    const a = makeEntity(root, { id: 'a', name: 'Group A', cls: 'user-group' });
    const b = makeEntity(a, { id: 'b', name: 'Group B', cls: 'user-group' });
    makeEntity(b, { id: 'tree', name: 'Tree' });
    makeEntity(b, { id: 'bench', name: 'Bench' });
    await renderPanel();
    await expand('Group A');
    await expand('Group B');
    const strip = () => placeInList(document.querySelector('.layers-drop-end'));

    const expected = {
      3: { parentEl: 'b', indexInParent: 2 },
      2: { parentEl: 'a', indexInParent: 1 },
      1: { parentEl: 'street-container', indexInParent: 2 }
    };
    for (const level of [3, 2, 1]) {
      startDrag('Loose');
      expect(dragOver(strip(), 0.5, atLevel(level))).toBe(true);
      expect(dropLine()).toEqual({
        top: lineAbove(strip()),
        left: { 3: '66px', 2: '36px', 1: '0px' }[level],
        chevron: level > 1
      });
      expect(await dropAndUndo(strip())).toEqual(expected[level]);
    }
  });

  it('under an expanded street inside a group, offers a model the group level after the street and a segment its own street, never the other (fails on an empty candidate list for an upward range, or on illegal levels offered)', async () => {
    const a = makeEntity(root, { id: 'a', name: 'Group A', cls: 'user-group' });
    const street = makeEntity(a, {
      id: 'st',
      name: 'Main Street',
      attrs: { 'managed-street': '' }
    });
    makeEntity(street, {
      id: 's1',
      name: 'Lane 1',
      attrs: { 'street-segment': '' }
    });
    makeEntity(street, {
      id: 's2',
      name: 'Lane 2',
      attrs: { 'street-segment': '' }
    });
    makeEntity(root, { id: 'x', name: 'Loose' });
    await renderPanel();
    await expand('Group A');
    await expand('Main Street');

    for (const [name, fraction] of [
      ['Main Street', 0.6],
      ['Lane 1', 0.4]
    ]) {
      for (const level of [2, 3]) {
        startDrag('Loose');
        expect(dragOver(row(name), fraction, atLevel(level))).toBe(true);
        expect(dropLine()).toEqual({
          top: lineAbove(row('Lane 1')),
          left: '36px',
          chevron: true
        });
        expect(await dropAndUndo(row(name))).toEqual({
          parentEl: 'a',
          indexInParent: 1
        });

        startDrag('Lane 2');
        expect(dragOver(row(name), fraction, atLevel(level))).toBe(true);
        // A street is not a group: a full-width line.
        expect(dropLine()).toEqual({
          top: lineAbove(row('Lane 1')),
          left: '0px',
          chevron: false
        });
        expect(await dropAndUndo(row(name))).toEqual({
          parentEl: 'st',
          indexInParent: 0
        });
      }
    }
  });
});

describe('drop gaps in a scene without groups', () => {
  it('resolve from the hovered row alone, as before: after an expanded street from its header, nothing for a model above its first segment, one place between two segments whatever the x, and the midpoint split between models (fails if a first-child rule or the pointer x applies outside groups)', async () => {
    makeEntity(root, { id: 'model', name: 'Model' });
    const street = makeEntity(root, {
      id: 'st',
      name: 'Main Street',
      attrs: { 'managed-street': '' }
    });
    for (const n of [1, 2, 3]) {
      makeEntity(street, {
        id: `s${n}`,
        name: `Lane ${n}`,
        attrs: { 'street-segment': '' }
      });
    }
    makeEntity(root, { id: 'shape', name: 'Shape' });
    await renderPanel();
    await expand('Main Street');

    // A full-width line without a chevron.
    const noLevels = () =>
      expect(dropLine()).toMatchObject({ left: '0px', chevron: false });

    // (a) The header's lower zone is "after the street"; above the first
    // segment nothing but a segment may go.
    startDrag('Model');
    expect(dragOver(row('Main Street'), 0.6, atLevel(2))).toBe(true);
    expect(dropLine().top).toBe(lineBelow(row('Main Street')));
    noLevels();
    expect(await dropAndUndo(row('Main Street'))).toEqual({
      parentEl: 'street-container',
      indexInParent: 2
    });
    startDrag('Model');
    expect(dragOver(row('Lane 1'), 0.4, atLevel(1))).toBe(false);
    fireEvent.dragEnd(row('Lane 1'));

    // (b) Between two segments, wherever the pointer is.
    for (const x of [10, 200]) {
      startDrag('Lane 3');
      expect(dragOver(row('Lane 2'), 0.4, x)).toBe(true);
      expect(dropLine().top).toBe(lineAbove(row('Lane 2')));
      noLevels();
      expect(await dropAndUndo(row('Lane 2'))).toEqual({
        parentEl: 'st',
        indexInParent: 1
      });
    }

    // (c) Between top-level models, the row's own midpoint split.
    for (const [fraction, lineAt, indexInParent] of [
      [0.4, lineAbove, 0],
      [0.6, lineBelow, 1]
    ]) {
      startDrag('Shape');
      expect(dragOver(row('Model'), fraction, atLevel(3))).toBe(true);
      expect(dropLine().top).toBe(lineAt(row('Model')));
      noLevels();
      expect(await dropAndUndo(row('Model'))).toEqual({
        parentEl: 'street-container',
        indexInParent
      });
    }
  });
});

describe('a 360° panorama', () => {
  it('is offered no group row to drop into, and the guard refuses a forced move (fails if only the Add Layer card keeps it out)', async () => {
    const g = makeEntity(root, { id: 'g', name: 'Group A', cls: 'user-group' });
    const panorama = makeEntity(root, {
      id: 'pano',
      name: 'Sphere Geometry • 360° Panorama',
      cls: 'scene-backdrop'
    });
    await renderPanel();

    startDrag('Sphere Geometry • 360° Panorama');
    expect(dragOver(row('Group A'), 0.5)).toBe(false);
    drop(row('Group A'));
    expect(reparents()).toEqual([]);

    expect(
      composedExecute('entityreparent', {
        entity: panorama,
        parentEl: 'g',
        indexInParent: 0
      })
    ).toBe(groupMessage('illegalParent'));
    expect(editor.history.undos).toHaveLength(0);
    expect(panorama.parentNode).toBe(root);
    expect(g.children).toHaveLength(0);
  });
});

describe('before and after a row in another parent', () => {
  it('offers the line only to an item that may move to that parent (fails if the zones are offered for any parent)', async () => {
    const group = makeEntity(root, {
      id: 'g',
      name: 'Group A',
      cls: 'user-group'
    });
    makeEntity(group, { id: 'm', name: 'Member' });
    makeEntity(root, {
      id: 'shape',
      name: 'Shape',
      attrs: { 'data-transform-no-reparent': '' }
    });
    makeEntity(root, { id: 'tree', name: 'Tree' });
    await renderPanel();
    await expand('Group A');

    for (const fraction of [0.1, 0.9]) {
      startDrag('Shape');
      expect(dragOver(row('Member'), fraction)).toBe(false);
      startDrag('Tree');
      expect(dragOver(row('Member'), fraction)).toBe(true);
    }
  });
});

describe('the drop strip after the last row', () => {
  it('moves a child out of an expanded group that is the last row, to the end of the top level', async () => {
    makeEntity(root, { id: 'first', name: 'First' });
    const group = makeEntity(root, {
      id: 'g',
      name: 'Group A',
      cls: 'user-group'
    });
    const member = makeEntity(group, { id: 'm', name: 'Member' });
    await renderPanel();
    await expand('Group A');

    const strip = document.querySelector('.layers-drop-end');
    expect(strip).not.toBe(null);
    startDrag('Member');
    expect(dragOver(strip, 0.5)).toBe(true);
    drop(strip);

    expect(reparents()).toEqual([
      { entity: member, parentEl: 'street-container', indexInParent: 2 }
    ]);
    expect(root.lastElementChild).toBe(document.getElementById('m'));
  });

  it('offers nothing for the last row, even with an unlisted child after it, and still takes a row from higher up (fails if a no-op drop rebuilds the item)', async () => {
    makeEntity(root, { id: 'first', name: 'First' });
    makeEntity(root, { id: 'last', name: 'Last' });
    // Batching's own root, which the list leaves out.
    makeEntity(root, { id: 'batch-models-root' });
    await renderPanel();
    const strip = document.querySelector('.layers-drop-end');

    startDrag('Last');
    expect(dragOver(strip, 0.5)).toBe(false);
    drop(strip);
    expect(reparents()).toEqual([]);
    expect(editor.history.undos).toHaveLength(0);

    startDrag('First');
    expect(dragOver(strip, 0.5)).toBe(true);
  });
});

describe('a move in progress', () => {
  it('keeps the moved row from being dragged until its new element has loaded (fails if the command never registers the move)', async () => {
    const group = makeEntity(root, {
      id: 'g',
      name: 'Group A',
      cls: 'user-group'
    });
    makeEntity(root, { id: 'tree', name: 'Tree' });
    await renderPanel();

    startDrag('Tree');
    dragOver(row('Group A'), 0.5);
    drop(row('Group A'));
    fireEvent.dragEnd(row('Group A'));
    await settle();

    const recreated = document.getElementById('tree');
    expect(recreated.parentNode).toBe(group);
    expect(row('Tree').getAttribute('draggable')).toBe('false');
    expect(row('Tree').querySelector('.entityLoadSheen.is-pending')).not.toBe(
      null
    );

    act(() => {
      recreated.dispatchEvent(new Event('loaded'));
    });
    await settle();
    expect(row('Tree').getAttribute('draggable')).toBe('true');
    expect(row('Tree').querySelector('.entityLoadSheen.is-pending')).toBe(null);
  });

  it('keeps a moved group expanded when its element is replaced, and leaves an id-less row as it was', async () => {
    const group = makeEntity(root, {
      id: 'g',
      name: 'Group A',
      cls: 'user-group'
    });
    makeEntity(group, { id: 'm', name: 'Member' });
    const idless = makeEntity(root, { name: 'Loose Group', cls: 'user-group' });
    makeEntity(idless, { id: 'loose-member', name: 'Loose Member' });
    makeEntity(root, { id: 'tail', name: 'Tail' });
    await renderPanel();
    await expand('Group A');
    await expand('Loose Group');

    startDrag('Group A');
    dragOver(row('Tail'), 0.9);
    drop(row('Tail'));
    fireEvent.dragEnd(row('Tail'));

    const recreated = document.getElementById('g');
    expect(recreated).not.toBe(group);
    // A-Frame's loader rebuilds the members inside the new group element,
    // and each announces itself to its parent.
    const member = makeEntity(recreated, { id: 'm', name: 'Member' });
    recreated.dispatchEvent(
      new CustomEvent('child-attached', {
        detail: { el: member },
        bubbles: true
      })
    );
    act(() => {
      recreated.dispatchEvent(new Event('loaded'));
    });
    await settle();

    expect(member.parentNode).toBe(recreated);
    expect(screen.getByText('Member')).toBeTruthy();
    expect(screen.getByText('Loose Member')).toBeTruthy();
  });
});

describe('the new-group button', () => {
  it('creates one user group (not a street-prop holder) at the top level, shows "G+" (not an icon) and is named from its message id', async () => {
    await renderPanel({ 'sceneGraph.newGroup': 'Nieuwe groep' });

    const button = screen.getByRole('button', { name: 'Nieuwe groep' });
    expect(button.getAttribute('title')).toBe('Nieuwe groep');
    expect(button.textContent).toBe('G+');
    expect(button.querySelector('svg')).toBe(null);
    fireEvent.click(button);

    const creates = executed.filter(([type]) => type === 'entitycreate');
    expect(creates).toHaveLength(1);
    expect(editor.history.undos).toHaveLength(1);
    const created = root.querySelector('.user-group');
    expect(created.parentNode).toBe(root);
    expect([...created.classList]).toEqual(['user-group']);
    expect(created.getAttribute('data-layer-name')).toBe('Group');
    expect(created.getAttribute('position')).toBe('0 0 0');
  });

  it('with a group open, creates the new group inside it with its origin at the open group center, not at its origin or at the top level', async () => {
    const open = makeEntity(root, { id: 'open-group', cls: 'user-group' });
    open.object3D.position.set(40, 0, -10);
    open.object3D.rotation.set(0, THREE.MathUtils.degToRad(50), 0);
    const member = makeEntity(open, { id: 'open-member', name: 'Member' });
    // The member's geometry is well away from the group origin.
    boxMesh(member, [6, 0, 8], [10, 2, 12]);
    editor.groupScope = { openStack: Object.freeze(['open-group']) };
    await renderPanel({ 'sceneGraph.newGroup': 'New group' });

    fireEvent.click(screen.getByRole('button', { name: 'New group' }));

    const [[, definition]] = executed.filter(
      ([type]) => type === 'entitycreate'
    );
    expect(definition.class).toBe('user-group');
    expect(definition.parentEl).toBe(open);
    expect(definition.requireParent).toBe(true);
    expect(definition.components.position).toEqual({
      x: expect.closeTo(8, 9),
      y: expect.closeTo(1, 9),
      z: expect.closeTo(10, 9)
    });
    const created = open.querySelector(':scope > .user-group');
    expect(created).not.toBe(null);
    expect(root.querySelectorAll(':scope > .user-group')).toHaveLength(1);
  });
});

describe('one drop line per gap', () => {
  const strip = () => placeInList(document.querySelector('.layers-drop-end'));

  // Everything drawn for a drop between rows: each element that shows a
  // line (a row's border or a line element), who owns it and where it is.
  function drawn() {
    return [
      ...document.querySelectorAll('.drop-before, .drop-after, .drop-line')
    ].map((el) => {
      const host = el.closest('.entity, .layers-drop-end');
      return {
        owner: host ? host.textContent || host.className : 'list',
        className: el.className,
        top: el.style.top,
        left: el.style.left,
        chevron: !!el.querySelector('svg.fa-chevron-right')
      };
    });
  }

  // Drags `dragged` over the lower half of the row above a gap, then over
  // the upper half of the one below it (or the strip), and returns what each
  // drew.
  function bothSides(dragged, [above, below], x) {
    return [
      [above, 0.85],
      [below, 0.15]
    ].map(([target, fraction]) => {
      startDrag(dragged);
      expect(dragOver(target(), fraction, x)).toBe(true);
      const lines = drawn();
      fireEvent.dragEnd(target());
      return lines;
    });
  }

  const line = (top, level) => [
    {
      owner: 'list',
      className: level > 1 ? 'drop-line at-level' : 'drop-line',
      top: `${top - 1}px`,
      left: level > 1 ? `${6 + 30 * (level - 1)}px` : '0px',
      chevron: level > 1
    }
  ];

  it('draws a drop between two sibling rows once, straddling their boundary, from either row (fails if each row draws its own border)', async () => {
    makeEntity(root, { id: 'a', name: 'Alpha' });
    makeEntity(root, { id: 'b', name: 'Bravo' });
    makeEntity(root, { id: 'c', name: 'Charlie' });
    await renderPanel();

    const [fromAbove, fromBelow] = bothSides('Charlie', [
      () => row('Alpha'),
      () => row('Bravo')
    ]);
    expect(fromAbove).toEqual(fromBelow);
    expect(fromBelow).toEqual(line(row('Bravo').offsetTop, 1));
  });

  async function nestedScene({ later }) {
    makeEntity(root, { id: 'x', name: 'Loose' });
    const a = makeEntity(root, { id: 'a', name: 'Group A', cls: 'user-group' });
    const b = makeEntity(a, { id: 'b', name: 'Group B', cls: 'user-group' });
    makeEntity(b, { id: 'tree', name: 'Tree' });
    makeEntity(b, { id: 'bench', name: 'Bench' });
    if (later) makeEntity(root, { id: 'later', name: 'Later' });
    await renderPanel();
    await expand('Group A');
    await expand('Group B');
  }

  it("draws each level's line and chevron at one place from either row at a gap where groups end and at a group's first place (fails if the hovered row owns the line, or the line or chevron moves between the rows)", async () => {
    await nestedScene({ later: true });

    for (const level of [3, 2, 1]) {
      const [fromAbove, fromBelow] = bothSides(
        'Loose',
        [() => row('Bench'), () => row('Later')],
        atLevel(level)
      );
      expect(fromAbove).toEqual(fromBelow);
      expect(fromBelow).toEqual(line(row('Later').offsetTop, level));
    }

    const [fromHeader, fromMember] = bothSides('Loose', [
      () => row('Group A'),
      () => row('Group B')
    ]);
    expect(fromHeader).toEqual(fromMember);
    expect(fromMember).toEqual(line(row('Group B').offsetTop, 2));
  });

  it('draws each level at the strip after the last row at one place from the last row or the strip (fails if the strip and the row draw different lines)', async () => {
    await nestedScene({ later: false });

    for (const level of [3, 2, 1]) {
      const [fromRow, fromStrip] = bothSides(
        'Loose',
        [() => row('Bench'), strip],
        atLevel(level)
      );
      expect(fromRow).toEqual(fromStrip);
      expect(fromStrip).toEqual(line(strip().offsetTop, level));
    }
  });
});

describe('the drop line goes away', () => {
  const strip = () => placeInList(document.querySelector('.layers-drop-end'));

  // The pointer leaving `target` for somewhere outside it (rows are 200 px
  // wide and 40 px tall).
  function dragLeaveOut(target) {
    const event = createEvent.dragLeave(target, {
      dataTransfer: dataTransfer()
    });
    Object.defineProperty(event, 'clientY', { value: ROW_HEIGHT + 20 });
    Object.defineProperty(event, 'clientX', { value: 0 });
    fireEvent(target, event);
  }

  async function threeRows() {
    makeEntity(root, { id: 'a', name: 'Alpha' });
    makeEntity(root, { id: 'b', name: 'Bravo' });
    makeEntity(root, { id: 'c', name: 'Charlie' });
    await renderPanel();
  }

  // Each way a line is shown: over the lower half of a row, and over the
  // strip after the last row.
  const shows = {
    row: () => {
      expect(dragOver(row('Bravo'), 0.85)).toBe(true);
      return row('Bravo');
    },
    strip: () => {
      expect(dragOver(strip(), 0.5)).toBe(true);
      return strip();
    }
  };

  it.each(['row', 'strip'])(
    'removes the line when the pointer leaves the %s (fails if leaving keeps the line)',
    async (host) => {
      await threeRows();
      startDrag('Alpha');
      const target = shows[host]();
      expect(dropLine()).toBeTruthy();

      dragLeaveOut(target);
      expect(dropLine()).toBeUndefined();
    }
  );

  it.each(['row', 'strip'])(
    'removes the line when the drop lands on the %s (fails if a drop keeps the line)',
    async (host) => {
      await threeRows();
      startDrag('Alpha');
      const target = shows[host]();
      expect(dropLine()).toBeTruthy();

      drop(target);
      expect(reparents()).toHaveLength(1);
      expect(dropLine()).toBeUndefined();
      // Nor does it return when the next drag starts, before the pointer
      // has been over anything.
      await finishMove('a');
      startDrag('Charlie');
      expect(dropLine()).toBeUndefined();
    }
  );

  it.each(['row', 'strip'])(
    'removes the line when the drag ends without a drop, over the %s (Escape, or a release outside the panel; fails if the end of a drag keeps the line)',
    async (host) => {
      await threeRows();
      startDrag('Alpha');
      shows[host]();
      expect(dropLine()).toBeTruthy();

      fireEvent.dragEnd(row('Alpha'));
      expect(dropLine()).toBeUndefined();
      expect(reparents()).toHaveLength(0);
    }
  );

  it('removes the line when the pointer moves within a row into a zone that is not offered (fails if an illegal zone keeps the previous line)', async () => {
    await threeRows();
    startDrag('Alpha');
    // Below Bravo is a move; above Bravo is where Alpha already is.
    expect(dragOver(row('Bravo'), 0.85)).toBe(true);
    expect(dropLine()).toBeTruthy();

    expect(dragOver(row('Bravo'), 0.15)).toBe(false);
    expect(dropLine()).toBeUndefined();
  });

  it('removes the line when the strip stops being a legal drop (fails if an illegal strip keeps the previous line)', async () => {
    await threeRows();
    startDrag('Alpha');
    expect(dragOver(strip(), 0.5)).toBe(true);
    expect(dropLine()).toBeTruthy();

    // Alpha becomes the last row, so a drop at the end would move nothing.
    sceneEl.querySelector('#b').remove();
    sceneEl.querySelector('#c').remove();
    expect(dragOver(strip(), 0.5)).toBe(false);
    expect(dropLine()).toBeUndefined();
  });
});

describe('when the line is drawn', () => {
  async function threeRows() {
    makeEntity(root, { id: 'a', name: 'Alpha' });
    makeEntity(root, { id: 'b', name: 'Bravo' });
    makeEntity(root, { id: 'c', name: 'Charlie' });
    await renderPanel();
  }

  it('draws no line between rows for a drop into a group, which highlights the group row (fails if a child drop is given a line)', async () => {
    makeEntity(root, { id: 'x', name: 'Loose' });
    makeEntity(root, { id: 'g', name: 'Group A', cls: 'user-group' });
    await renderPanel();

    startDrag('Loose');
    expect(dragOver(row('Group A'), 0.5)).toBe(true);
    expect(dropLine()).toBeUndefined();
    expect(row('Group A').classList.contains('drop-child')).toBe(true);
  });

  it('removes a line whose drop stops being legal while the drag is held (fails if the line is drawn without checking the drop is still allowed)', async () => {
    await threeRows();
    startDrag('Charlie');
    expect(dragOver(row('Bravo'), 0.15)).toBe(true);
    expect(dropLine()).toBeTruthy();

    // The target row becomes one nothing may be dropped beside, and the list
    // rebuilds, as when the scene changes under a held drag.
    const bravo = sceneEl.querySelector('#b');
    bravo.id = 'cameraRig';
    act(() => {
      document.dispatchEvent(
        new CustomEvent('child-attached', { detail: { el: bravo } })
      );
    });
    await settle();
    expect(dropLine()).toBeUndefined();
  });
});
