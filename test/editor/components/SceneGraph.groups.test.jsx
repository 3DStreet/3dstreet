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

// What the serializer and loader do, reduced to what a move needs: the data
// names the element, and recreation builds on the element the command made
// and announces it to its parent as A-Frame does.
const serializerStub = {
  // Read by the panel header's menu.
  getCurrentSceneId: () => null,
  getElementData: (el) => ({
    id: el.id,
    class: el.className ? el.className.split(' ') : undefined,
    'data-layer-name': el.getAttribute('data-layer-name') ?? undefined
  }),
  createEntityFromObj: (data, parent, before) => {
    const el = data.entityElement;
    el.id = data.id;
    if (data.class) el.className = data.class.join(' ');
    if (data['data-layer-name']) {
      el.setAttribute('data-layer-name', data['data-layer-name']);
    }
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

function row(name) {
  const el = screen.getByText(name).closest('.entity');
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
// has no DragEvent, so the pointer height is set on the event directly.
function dragOver(target, fraction) {
  const event = createEvent.dragOver(target, { dataTransfer: dataTransfer() });
  Object.defineProperty(event, 'clientY', { value: ROW_HEIGHT * fraction });
  return !fireEvent(target, event);
}

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
    expect(row('Bravo').classList.contains('drop-before')).toBe(true);
    expect(dragOver(row('Bravo'), 0.6)).toBe(true);
    expect(row('Bravo').classList.contains('drop-after')).toBe(true);
    drop(row('Bravo'));

    expect(reparents()).toEqual([
      { entity: a, parentEl: 'street-container', indexInParent: 3 }
    ]);
  });

  it('drops a member after the whole group from its expanded group header', async () => {
    const group = makeEntity(root, {
      id: 'g',
      name: 'Group A',
      cls: 'user-group'
    });
    const member = makeEntity(group, { id: 'm', name: 'Member' });
    makeEntity(group, { id: 'm2', name: 'Member Two' });
    makeEntity(root, { id: 'after', name: 'Later' });
    await renderPanel();
    await expand('Group A');

    startDrag('Member');
    expect(dragOver(row('Group A'), 0.9)).toBe(true);
    drop(row('Group A'));

    expect(reparents()).toEqual([
      { entity: member, parentEl: 'street-container', indexInParent: 1 }
    ]);
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
