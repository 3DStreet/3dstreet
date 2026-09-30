/* global AFRAME, STREET */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import {
  copySelectedEntity,
  pasteFromClipboard
} from '@/editor/lib/clipboard.js';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import { entityIn, mountPlacementScene } from './_placementHarness.js';
import { expectMatrixClose, worldOf } from './_entityElement.js';

// Copy and paste through the real clipboard module, paste command, guard and
// History. The system clipboard is a text store whose reads the test can hold
// open; the serializer is reduced to what a paste carries (id, class and pose,
// written as strings, and children).

let scene;
let clipboardText;
let holdRead;

const coordinates = {
  parse: (value) => {
    const [x, y, z] = String(value).trim().split(/\s+/).map(Number);
    return { x, y, z };
  },
  stringify: (v) => `${v.x} ${v.y} ${v.z}`
};

function elementData(el) {
  const data = { id: el.id };
  if (el.className) data.class = el.className.split(/\s+/);
  const components = {};
  for (const name of ['position', 'rotation', 'scale']) {
    const v = el.getAttribute(name);
    if (v) components[name] = coordinates.stringify(v);
  }
  data.components = components;
  const children = [...el.children].map(elementData);
  if (children.length) data.children = children;
  return data;
}

function entityFromData(data, parent, before) {
  const el = document.createElement('a-entity');
  el.id = data.id;
  if (data.class) el.className = data.class.join(' ');
  parent.insertBefore(el, before ?? null);
  for (const [name, value] of Object.entries(data.components || {})) {
    el.setAttribute(name, value);
  }
  for (const child of data.children || []) entityFromData(child, el);
  return el;
}

beforeEach(() => {
  scene = mountPlacementScene();
  AFRAME.utils = { coordinates };
  STREET.utils = {
    getElementData: elementData,
    createEntityFromObj: entityFromData
  };
  clipboardText = null;
  holdRead = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        clipboardText = text;
      },
      readText: async () => {
        if (holdRead) await holdRead;
        return clipboardText;
      }
    }
  });
});

afterEach(() => {
  delete navigator.clipboard;
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function copy(el) {
  scene.inspector.selectEntity(el);
  await copySelectedEntity();
}

function pastes() {
  return scene.executed.filter(([type]) => type === 'entitypaste');
}

function pastedElement() {
  const [, payload] = pastes().at(-1);
  // The command gave the copy new ids; it is the parent's newest child.
  return document.getElementById(payload.parentId).lastElementChild;
}

// Where a copy made beside its source should be: the source, 5 m along world X.
function besideSource(source) {
  return worldOf(source).premultiply(
    new THREE.Matrix4().makeTranslation(5, 0, 0)
  );
}

function groupWithMember() {
  const group = entityIn(scene.root, {
    id: 'g',
    cls: 'user-group',
    position: '12 0 -4',
    rotation: '0 90 0',
    scale: '2 2 2'
  });
  const member = entityIn(group, {
    id: 'm',
    position: '1 0 3',
    rotation: '0 25 0'
  });
  return { group, member };
}

describe('pasting an item copied from inside a group', () => {
  it('keeps its world pose, plus the offset along world X, at the top level and inside an open group turned the other way (fails with a local-position paste or a local-X offset)', async () => {
    const { member } = groupWithMember();
    const scope = entityIn(scene.root, {
      id: 's',
      cls: 'user-group',
      position: '-30 0 10',
      rotation: '0 -30 0'
    });
    await copy(member);

    await pasteFromClipboard();
    let pasted = pastedElement();
    expect(pasted.parentNode).toBe(scene.root);
    expectMatrixClose(expect, worldOf(pasted), besideSource(member));

    scene.openGroups('s');
    await pasteFromClipboard();
    pasted = pastedElement();
    expect(pasted.parentNode).toBe(scope);
    expect(pastes().at(-1)[1].requireParent).toBe(true);
    expectMatrixClose(expect, worldOf(pasted), besideSource(member));
  });

  it('pastes an item from the top level into an open group at the world pose it had, beside its source', async () => {
    const tree = entityIn(scene.root, {
      id: 'tree',
      position: '3 0 -7',
      rotation: '0 35 0'
    });
    const { group } = groupWithMember();
    await copy(tree);
    scene.openGroups('g');
    await pasteFromClipboard();
    const pasted = pastedElement();
    expect(pasted.parentNode).toBe(group);
    expectMatrixClose(expect, worldOf(pasted), besideSource(tree));
  });

  it('is one undo step, and redo brings back the same item (fails if a paste records two entries or makes new ids on redo)', async () => {
    const { member } = groupWithMember();
    await copy(member);
    scene.openGroups('g');
    await pasteFromClipboard();
    expect(scene.inspector.history.undos).toHaveLength(1);
    const id = pastedElement().id;
    scene.inspector.history.undo();
    expect(document.getElementById(id)).toBe(null);
    scene.inspector.history.redo();
    expect(document.getElementById(id)?.parentNode.id).toBe('g');
    expect(scene.inspector.history.undos).toHaveLength(1);
  });
});

describe('copying', () => {
  it('records the item and adds nothing: no command, no history entry, no change to the scene (fails if copy creates anything)', async () => {
    const { member } = groupWithMember();
    scene.openGroups('g');
    const before = document.body.innerHTML;
    await copy(member);
    expect(clipboardText).toContain('"format":"3dstreet/entity"');
    expect(scene.executed).toHaveLength(0);
    expect(scene.inspector.history.undos).toHaveLength(0);
    expect(document.body.innerHTML).toBe(before);
  });
});

describe('a paste that cannot land where it began', () => {
  it('goes into the group open when the paste began, even if another is open by the time the clipboard is read', async () => {
    const tree = entityIn(scene.root, { id: 'tree', position: '3 0 -7' });
    const { group } = groupWithMember();
    entityIn(scene.root, { id: 'other', cls: 'user-group' });
    await copy(tree);
    scene.openGroups('g');
    let release;
    holdRead = new Promise((resolve) => {
      release = resolve;
    });
    const pasting = pasteFromClipboard();
    scene.openGroups('other');
    release();
    await pasting;
    expect(pastedElement().parentNode).toBe(group);
  });

  it('is refused with an explanation when that group was removed meanwhile, and nothing lands at the top level (fails with a fall back to the scene level)', async () => {
    const tree = entityIn(scene.root, { id: 'tree', position: '3 0 -7' });
    const { group } = groupWithMember();
    await copy(tree);
    scene.openGroups('g');
    let release;
    holdRead = new Promise((resolve) => {
      release = resolve;
    });
    const pasting = pasteFromClipboard();
    group.remove();
    release();
    expect(await pasting).toBe(false);
    expect(pastes()).toHaveLength(0);
    expect(scene.root.children).toHaveLength(1);
    expect(scene.notify.warningMessage).toHaveBeenCalledWith(
      groupMessage('destinationGone')
    );
  });

  it('is refused into a group scaled unevenly when the turned item would be distorted, leaving scene and history unchanged', async () => {
    const tree = entityIn(scene.root, {
      id: 'tree',
      position: '3 0 -7',
      rotation: '0 35 0'
    });
    const imported = entityIn(scene.root, {
      id: 'imported',
      cls: 'user-group',
      scale: '2 1 1'
    });
    await copy(tree);
    scene.openGroups('imported');
    const before = document.body.innerHTML;
    expect(await pasteFromClipboard()).toBe(false);
    expect(pastes()).toHaveLength(0);
    expect(scene.inspector.history.undos).toHaveLength(0);
    expect(document.body.innerHTML).toBe(before);
    expect(imported.children).toHaveLength(0);
    expect(scene.notify.warningMessage).toHaveBeenCalledWith(
      groupMessage('placementDistorts')
    );
  });

  it('pastes an item that may not go into a group at the top level with its copied pose, and says it landed there', async () => {
    const shape = entityIn(scene.root, { id: 'shape', position: '2 0 2' });
    STREET.utils.getElementData = (el) => ({
      ...elementData(el),
      components: { ...elementData(el).components, shape: '' }
    });
    groupWithMember();
    await copy(shape);
    scene.openGroups('g');
    await pasteFromClipboard();
    const [, payload] = pastes()[0];
    expect(payload.parentId).toBe('street-container');
    expect(payload.requireParent).toBeUndefined();
    expect(payload.entityData.components.position).toBe('7 0 2');
    expect(scene.notify.infoMessage).toHaveBeenCalledWith(
      groupMessage('placedAtTopLevel')
    );
  });
});
