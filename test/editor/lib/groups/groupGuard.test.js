import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { History } from '@/editor/lib/history.js';
import { commandsByType } from '@/editor/lib/commands/index.js';
import {
  hasTransformMarker,
  refuseGuardedTransform
} from '@/editor/lib/transformGuard.js';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import { entity, group, scene } from './_groupFixtures.js';

// The editor's execute path without React: the real guard, then the real
// History running the real command. A refusal must leave history untouched.
function makeEditor() {
  const editor = { config: {}, selectedEntity: null, selectEntity: vi.fn() };
  editor.history = new History(editor);
  return editor;
}

function execute(editor, type, payload) {
  const refusal = refuseGuardedTransform(type, payload);
  if (!refusal) {
    const Cmd = commandsByType.get(type);
    editor.history.execute(new Cmd(editor, payload));
  }
  return refusal;
}

let sceneEl;
let root;
let editor;
let ids = 0;

function withId(el) {
  el.id = `guard-${++ids}`;
  return el;
}

beforeEach(() => {
  sceneEl = scene();
  root = entity(sceneEl);
  root.id = 'street-container';
  editor = makeEditor();
  vi.stubGlobal('AFRAME', { components: {}, INSPECTOR: editor });
  vi.stubGlobal('STREET', {
    utils: {
      getElementData: () => ({}),
      // Recreation as the serializer does it: a new element in the parent.
      createEntityFromObj: (data, parent, before) => {
        const el = document.createElement('a-entity');
        el.object3D = new THREE.Group();
        parent.insertBefore(el, before);
        parent.object3D.add(el.object3D);
        return el;
      }
    }
  });
});

afterEach(() => {
  sceneEl.remove();
  vi.unstubAllGlobals();
});

describe('a user group carries its transform limits by its class', () => {
  it('implies yaw-only and uniform scale, and nothing else', () => {
    const g = group(root);
    expect(hasTransformMarker(g, 'data-transform-yaw-only')).toBe(true);
    expect(hasTransformMarker(g, 'data-transform-uniform-scale')).toBe(true);
    expect(hasTransformMarker(g, 'data-transform-no-scale')).toBe(false);
    expect(hasTransformMarker(g, 'data-transform-no-reparent')).toBe(false);
    expect(hasTransformMarker(entity(root), 'data-transform-yaw-only')).toBe(
      false
    );
  });
});

describe('uniform group scale', () => {
  it('refuses a non-uniform scale on a group and accepts a uniform one (fails without the guard)', () => {
    const g = withId(group(root));
    expect(
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'scale',
        value: '1 2 1'
      })
    ).toBe(groupMessage('nonUniformScale'));
    expect(editor.history.undos).toHaveLength(0);

    expect(
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'scale',
        value: '2 2 2'
      })
    ).toBe(null);
    expect(editor.history.undos).toHaveLength(1);
  });

  it('judges a one-axis edit against the other axes, and lets an imported uneven group be reset', () => {
    const g = withId(group(root));
    g.setAttribute('scale', '1 2 1');
    expect(
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'scale',
        property: 'x',
        value: 2
      })
    ).toBe(groupMessage('nonUniformScale'));
    expect(
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'scale',
        value: { x: 1, y: 1, z: 1 }
      })
    ).toBe(null);
  });

  it('judges a one-axis edit against the scale the group has now, not against 1 (fails if the other axes are read as 1)', () => {
    const g = withId(group(root));
    g.setAttribute('scale', '2 2 2');
    const scaleX = (value) =>
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'scale',
        property: 'x',
        value
      });
    // x = 1 would leave 1 2 2.
    expect(scaleX(1)).toBe(groupMessage('nonUniformScale'));
    expect(editor.history.undos).toHaveLength(0);
    expect(scaleX(2)).toBe(null);
  });

  it('leaves other entities free to scale unevenly', () => {
    const plain = withId(entity(root));
    expect(
      execute(editor, 'entityupdate', {
        entity: plain,
        component: 'scale',
        value: '1 2 1'
      })
    ).toBe(null);
  });
});

describe('yaw-only compares with the current tilt', () => {
  it('lets an imported pitched group turn about Y and refuses a change to its pitch (fails with a compare-with-zero guard)', () => {
    const g = withId(group(root));
    g.setAttribute('rotation', '10 30 0');
    expect(
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'rotation',
        value: { x: 10, y: 40, z: 0 }
      })
    ).toBe(null);
    expect(editor.history.undos).toHaveLength(1);

    g.setAttribute('rotation', '10 30 0');
    expect(
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'rotation',
        value: { x: 20, y: 40, z: 0 }
      })
    ).toBe('This element can only be rotated about the vertical axis.');
    expect(
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'rotation',
        property: 'x',
        value: 11
      })
    ).toBeTruthy();
    expect(
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'rotation',
        property: 'y',
        value: 90
      })
    ).toBe(null);
    expect(editor.history.undos).toHaveLength(2);
  });

  it('still refuses pitch on an entity marked yaw-only that has none', () => {
    const shape = withId(entity(root));
    shape.setAttribute('data-transform-yaw-only', '');
    expect(
      execute(editor, 'entityupdate', {
        entity: shape,
        component: 'rotation',
        value: '5 30 0'
      })
    ).toBeTruthy();
    expect(
      execute(editor, 'entityupdate', {
        entity: shape,
        component: 'rotation',
        value: '0 30 0'
      })
    ).toBe(null);
  });
});

describe('moving an item into a group', () => {
  it('refuses a move that would need a shear under an unevenly scaled group, and allows one that keeps its pose (fails without the guard, or with a blanket refusal of uneven parents)', () => {
    const stretched = withId(group(root, { scale: [2, 1, 1] }));
    const turned = withId(entity(root, { yaw: 30 }));
    const straight = withId(entity(root, { position: [4, 0, 0] }));

    expect(
      execute(editor, 'entityreparent', {
        entity: turned,
        parentEl: stretched.id,
        indexInParent: 0
      })
    ).toBe(groupMessage('unrepresentablePose'));
    expect(editor.history.undos).toHaveLength(0);
    expect(turned.parentNode).toBe(root);

    expect(
      execute(editor, 'entityreparent', {
        entity: straight,
        parentEl: stretched.id,
        indexInParent: 0
      })
    ).toBe(null);
    expect(editor.history.undos).toHaveLength(1);
  });

  it('allows a turned item under a group stretched only vertically, since a turn about Y keeps that axis', () => {
    const tall = withId(group(root, { scale: [1, 2, 1] }));
    const turned = withId(entity(root, { yaw: 30 }));
    expect(
      execute(editor, 'entityreparent', {
        entity: turned,
        parentEl: tall.id,
        indexInParent: 0
      })
    ).toBe(null);
  });

  it('refuses a move the group model forbids, before anything is recorded', () => {
    const outer = withId(group(root));
    const inner = withId(group(outer));
    const intersection = withId(entity(root));
    intersection.setAttribute('intersection', '');
    const model = withId(entity(root));

    expect(
      execute(editor, 'entityreparent', {
        entity: outer,
        parentEl: inner.id,
        indexInParent: 0
      })
    ).toBe(groupMessage('illegalParent'));
    expect(
      execute(editor, 'entityreparent', {
        entity: model,
        parentEl: intersection.id,
        indexInParent: 0
      })
    ).toBe(groupMessage('illegalParent'));
    expect(editor.history.undos).toHaveLength(0);
  });

  it('keeps the existing no-reparent refusal and still allows a same-parent reorder', () => {
    const g = withId(group(root));
    const shape = withId(entity(root));
    shape.setAttribute('data-transform-no-reparent', '');
    expect(
      execute(editor, 'entityreparent', {
        entity: shape,
        parentEl: g.id,
        indexInParent: 0
      })
    ).toBe('This element cannot be moved to a different parent.');
    expect(
      refuseGuardedTransform('entityreparent', {
        entity: shape,
        parentEl: root.id,
        indexInParent: 0
      })
    ).toBe(null);
  });
});

describe('placement that requires its parent', () => {
  it('creates in a group that still takes children, and refuses once it is gone rather than falling back to the top level', () => {
    const g = withId(group(root));
    expect(
      execute(editor, 'entitycreate', {
        parentEl: g,
        requireParent: true,
        components: { position: '0 0 0' }
      })
    ).toBe(null);
    expect(editor.history.undos).toHaveLength(1);
    expect(g.children).toHaveLength(1);

    const gone = withId(group(root));
    gone.remove();
    for (const parentEl of [gone, gone.id, 'no-such-group']) {
      expect(
        execute(editor, 'entitycreate', {
          parentEl,
          requireParent: true,
          components: { position: '0 0 0' }
        })
      ).toBe(groupMessage('destinationGone'));
    }
    const notAGroup = withId(entity(root));
    expect(
      execute(editor, 'entitycreate', {
        parentEl: notAGroup,
        requireParent: true
      })
    ).toBe(groupMessage('destinationGone'));
    expect(
      execute(editor, 'entitypaste', {
        parentId: gone.id,
        requireParent: true,
        entityData: { element: 'a-entity' }
      })
    ).toBe(groupMessage('destinationGone'));
    expect(editor.history.undos).toHaveLength(1);
  });

  it('leaves creates and pastes that do not ask for it unchanged', () => {
    expect(
      refuseGuardedTransform('entitycreate', { parentEl: 'no-such-group' })
    ).toBe(null);
    expect(
      refuseGuardedTransform('entitypaste', {
        parentId: 'no-such-group',
        entityData: {}
      })
    ).toBe(null);
  });
});
