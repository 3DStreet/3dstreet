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

describe('pasting a drawn shape', () => {
  it('into an open group keeps its world pose, plus the offset along world X (fails if a shape is still kept at the top level)', async () => {
    const shape = entityIn(scene.root, {
      id: 'shape',
      position: '2 0 2',
      rotation: '0 20 0'
    });
    for (const position of ['0 0 0', '3 0 1', '1 0 4']) {
      entityIn(shape, { position });
    }
    STREET.utils.getElementData = (el) => {
      const data = elementData(el);
      if (el === shape) data.components.shape = '';
      return data;
    };
    entityIn(scene.root, {
      id: 'open',
      cls: 'user-group',
      position: '12 0 -4',
      rotation: '0 90 0'
    });
    await copy(shape);
    scene.openGroups('open');
    await pasteFromClipboard();

    const [, payload] = pastes()[0];
    expect(payload.parentId).toBe('open');
    expect(payload.requireParent).toBe(true);
    const pasted = pastedElement();
    expect(pasted.children).toHaveLength(3);
    expectMatrixClose(expect, worldOf(pasted), besideSource(shape));
    expect(scene.notify.infoMessage).not.toHaveBeenCalled();
  });
});

describe('pasting an item copied from inside a group', () => {
  it('keeps its world pose, plus the offset along world X, at the top level and inside an open group turned the other way (fails with a local-position paste or a local-X offset)', async () => {
    const { member } = groupWithMember();
    const openGroup = entityIn(scene.root, {
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
    expect(pasted.parentNode).toBe(openGroup);
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

  it('lands exactly at the copied world pose once its source is gone, as a paste from another scene does (fails if the beside-the-source offset is applied anyway)', async () => {
    const { member } = groupWithMember();
    await copy(member);
    const copiedAt = worldOf(member);
    member.remove();
    await pasteFromClipboard();
    expectMatrixClose(expect, worldOf(pastedElement()), copiedAt);
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

describe('pasting with no group open', () => {
  it('pastes an item from under a moved, turned parent at the top level with its saved local pose, 5 along X (fails if world-pose pasting reaches an item outside any group)', async () => {
    const street = entityIn(scene.root, {
      id: 'street',
      position: '20 0 0',
      rotation: '0 30 0'
    });
    const prop = entityIn(street, {
      id: 'prop',
      position: '1 0 2',
      rotation: '0 90 0'
    });
    await copy(prop);
    await pasteFromClipboard();
    expect(pastes()).toHaveLength(1);
    expect(pastes()[0][1].requireParent).toBeUndefined();
    const pasted = pastedElement();
    expect(pasted.parentNode).toBe(scene.root);
    expect(pasted.getAttribute('position')).toEqual({ x: 6, y: 0, z: 2 });
    expect(pasted.getAttribute('rotation')).toEqual({ x: 0, y: 90, z: 0 });
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
    const start = entityIn(scene.root, { id: 'start', position: '2 0 2' });
    STREET.utils.getElementData = (el) => ({
      ...elementData(el),
      components: { ...elementData(el).components, 'viewer-start': '' }
    });
    groupWithMember();
    await copy(start);
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

  it('pastes a 360° panorama at the top level with a group open, not into the group, and gives its own reason (fails if paste lets the backdrop become a member)', async () => {
    const panorama = entityIn(scene.root, {
      id: 'pano',
      cls: 'scene-backdrop',
      scale: '-1 1 1'
    });
    const { group } = groupWithMember();
    await copy(panorama);
    scene.openGroups('g');
    await pasteFromClipboard();
    const [, payload] = pastes()[0];
    expect(payload.parentId).toBe('street-container');
    expect(payload.requireParent).toBeUndefined();
    expect(pastedElement().classList.contains('scene-backdrop')).toBe(true);
    expect(group.querySelector('.scene-backdrop')).toBe(null);
    expect(scene.notify.infoMessage).toHaveBeenCalledWith(
      groupMessage('backdropAtTopLevel')
    );
  });
});

describe('a group arriving by paste', () => {
  // Clipboard text from another tab or build: a foreign document, so no
  // beside-the-source offset applies.
  function putOnClipboard(data, placement = {}) {
    clipboardText = JSON.stringify({
      format: '3dstreet/entity',
      version: 1,
      kind: 'entity',
      documentToken: 'another-document',
      sourceEntityId: null,
      data,
      worldMatrix: null,
      inUserGroup: false,
      ...placement
    });
  }

  const tiltedScaledGroup = () => ({
    id: 'pg',
    class: ['user-group'],
    components: { position: '4 0 2', rotation: '10 40 5', scale: '2 2 2' },
    children: [{ id: 'pm', components: { rotation: '0 25 0', scale: '3 3 3' } }]
  });

  it('loses its tilt and scale and keeps its position and heading, while its member keeps its own (fails if the paste does not level groups)', async () => {
    putOnClipboard(tiltedScaledGroup());
    await pasteFromClipboard();
    const pasted = pastedElement();
    expect(pasted.parentNode).toBe(scene.root);
    expect(pasted.getAttribute('position')).toEqual({ x: 4, y: 0, z: 2 });
    expect(pasted.getAttribute('rotation')).toEqual({ x: 0, y: 40, z: 0 });
    expect(pasted.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
    const member = pasted.firstElementChild;
    expect(member.getAttribute('rotation')).toEqual({ x: 0, y: 25, z: 0 });
    expect(member.getAttribute('scale')).toEqual({ x: 3, y: 3, z: 3 });
  });

  it('keeps its world position and facing when pasted by world pose into a turned open group', async () => {
    const open = entityIn(scene.root, {
      id: 's',
      cls: 'user-group',
      position: '10 0 0',
      rotation: '0 -30 0'
    });
    const deg = THREE.MathUtils.degToRad;
    const sourceRotation = new THREE.Euler(deg(10), deg(40), deg(5), 'YXZ');
    const world = new THREE.Matrix4().compose(
      new THREE.Vector3(4, 0, 2),
      new THREE.Quaternion().setFromEuler(sourceRotation),
      new THREE.Vector3(2, 2, 2)
    );
    putOnClipboard(tiltedScaledGroup(), {
      inUserGroup: true,
      worldMatrix: Array.from(world.elements)
    });
    scene.openGroups('s');
    await pasteFromClipboard();

    const pasted = pastedElement();
    expect(pasted.parentNode).toBe(open);
    const local = new THREE.Vector3(4, 0, 2).applyMatrix4(
      worldOf(open).invert()
    );
    const position = pasted.getAttribute('position');
    expect(position.x).toBeCloseTo(local.x, 6);
    expect(position.y).toBeCloseTo(local.y, 6);
    expect(position.z).toBeCloseTo(local.z, 6);
    const rotation = pasted.getAttribute('rotation');
    expect(rotation.x).toBe(0);
    expect(rotation.z).toBe(0);
    expect(rotation.y).toBeCloseTo(
      THREE.MathUtils.radToDeg(sourceRotation.y) + 30,
      6
    );
    expect(pasted.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('levels a group nested inside the pasted one (fails if only the pasted root is levelled)', async () => {
    putOnClipboard({
      id: 'po',
      class: ['user-group'],
      components: { scale: '2 2 2' },
      children: [
        {
          id: 'pi',
          class: ['user-group'],
          components: { rotation: '10 45 0' }
        }
      ]
    });
    await pasteFromClipboard();
    const outer = pastedElement();
    expect(outer.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
    expect(outer.firstElementChild.getAttribute('rotation')).toEqual({
      x: 0,
      y: 45,
      z: 0
    });
  });

  it('is removed by undo and comes back level, with the same id, on redo (fails if only the first paste is levelled)', async () => {
    putOnClipboard(tiltedScaledGroup());
    await pasteFromClipboard();
    const id = pastedElement().id;
    scene.inspector.history.undo();
    expect(document.getElementById(id)).toBe(null);
    scene.inspector.history.redo();
    const again = document.getElementById(id);
    expect(again.getAttribute('rotation')).toEqual({ x: 0, y: 40, z: 0 });
    expect(again.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('is pasted as copied when its mixin supplies a conforming heading (fails if paste does not read mixins)', async () => {
    const mixin = document.createElement('a-mixin');
    mixin.id = 'turned-mixin';
    mixin.setAttribute('rotation', '0 90 0');
    document.body.append(mixin);
    putOnClipboard({
      id: 'mg',
      class: ['user-group'],
      mixin: 'turned-mixin',
      components: { position: '1 0 1' }
    });
    await pasteFromClipboard();
    const pasted = pastedElement();
    expect(pasted.hasAttribute('rotation')).toBe(false);
    expect(pasted.hasAttribute('scale')).toBe(false);
  });

  it('leaves a tilted, scaled item that is not a group as copied (fails if items that are not groups are levelled)', async () => {
    putOnClipboard({
      id: 'box',
      components: { position: '1 0 1', rotation: '20 30 10', scale: '2 1 1' }
    });
    await pasteFromClipboard();
    const pasted = pastedElement();
    expect(pasted.getAttribute('rotation')).toEqual({ x: 20, y: 30, z: 10 });
    expect(pasted.getAttribute('scale')).toEqual({ x: 2, y: 1, z: 1 });
  });
});
