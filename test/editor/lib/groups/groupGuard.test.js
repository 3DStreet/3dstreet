import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { History } from '@/editor/lib/history.js';
import { resolveCommand } from '@/editor/lib/resolveCommand.js';
import {
  hasTransformMarker,
  refuseGuardedTransform
} from '@/editor/lib/transformGuard.js';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';
import { entity, group, scene, vec3Components } from './_groupFixtures.js';

// The editor's execute path without React: the real guard, then the real
// History running the real command. A refusal must leave history untouched.
function makeEditor() {
  const editor = { config: {}, selectedEntity: null, selectEntity: vi.fn() };
  editor.history = new History(editor);
  return editor;
}

function execute(editor, type, payload) {
  const r = resolveCommand(type, payload);
  if (!r.refusal) editor.history.execute(new r.Cmd(editor, r.payload));
  return r.refusal;
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
  vi.stubGlobal('AFRAME', { components: vec3Components(), INSPECTOR: editor });
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
  it('implies yaw-only and no-scale, and nothing else (fails if uniform scale is still implied)', () => {
    const g = group(root);
    expect(hasTransformMarker(g, 'data-transform-yaw-only')).toBe(true);
    expect(hasTransformMarker(g, 'data-transform-no-scale')).toBe(true);
    expect(hasTransformMarker(g, 'data-transform-uniform-scale')).toBe(false);
    expect(hasTransformMarker(g, 'data-transform-no-reparent')).toBe(false);
    const plain = entity(root);
    expect(hasTransformMarker(plain, 'data-transform-yaw-only')).toBe(false);
    expect(hasTransformMarker(plain, 'data-transform-no-scale')).toBe(false);
  });
});

const NO_SCALE = 'Scaling is not available for this element.';
const YAW_ONLY = 'This element can only be rotated about the vertical axis.';

describe('a group cannot be scaled', () => {
  it('refuses a group scale in every form a write takes, without touching history (fails if no-scale is not implied by the class, or a batch is not judged member by member)', () => {
    const g = withId(group(root));
    const writes = [
      { value: '2 2 2' },
      { value: { x: 2, y: 2, z: 2 } },
      { property: 'x', value: 2 }
    ];
    for (const write of writes) {
      expect(
        execute(editor, 'entityupdate', {
          entity: g,
          component: 'scale',
          ...write
        })
      ).toBe(NO_SCALE);
    }
    expect(
      execute(editor, 'multi', [
        ['entityupdate', { entity: g, component: 'position', value: '1 0 0' }],
        ['entityupdate', { entity: g, component: 'scale', value: '2 2 2' }]
      ])
    ).toBe(NO_SCALE);
    expect(editor.history.undos).toHaveLength(0);

    const model = withId(entity(root));
    expect(
      execute(editor, 'entityupdate', {
        entity: model,
        component: 'scale',
        value: '2 2 2'
      })
    ).toBe(null);
  });

  it('lets a write of 1 through, within the tolerance and no further (fails if every write is refused, or with a looser tolerance)', () => {
    const g = withId(group(root));
    const scale = (write) =>
      refuseGuardedTransform('entityupdate', {
        entity: g,
        component: 'scale',
        ...write
      });
    expect(scale({ value: '1 1 1' })).toBe(null);
    expect(scale({ property: 'y', value: 1 })).toBe(null);
    expect(scale({ value: '1.0009 1 1' })).toBe(null);
    expect(scale({ value: '1.002 1 1' })).toBe(NO_SCALE);
  });
});

describe('adding a scale or rotation component', () => {
  it('is judged like an update on a group that has neither (fails without the component-add check, or if a blank value is read as 0)', () => {
    const g = withId(group(root));
    const add = (component, value) =>
      execute(editor, 'componentadd', { entity: g, component, value });
    expect(add('scale', '2 2 2')).toBe(NO_SCALE);
    expect(add('rotation', '10 30 0')).toBe(YAW_ONLY);
    expect(editor.history.undos).toHaveLength(0);
    for (const [component, value] of [
      ['rotation', '0 30 0'],
      ['scale', ''],
      ['scale', '  '],
      ['rotation', '']
    ]) {
      expect(
        refuseGuardedTransform('componentadd', { entity: g, component, value })
      ).toBe(null);
    }
    const plain = withId(entity(root));
    expect(
      refuseGuardedTransform('componentadd', {
        entity: plain,
        component: 'scale',
        value: '2 2 2'
      })
    ).toBe(null);
  });

  it('is refused for any entity carrying the no-scale attribute, not only groups (fails with a group-only check)', () => {
    const street = withId(entity(root));
    street.setAttribute('data-transform-no-scale', '');
    expect(
      refuseGuardedTransform('componentadd', {
        entity: street,
        component: 'scale',
        value: '2 2 2'
      })
    ).toBe(NO_SCALE);
  });
});

describe('removing the group class', () => {
  it('is refused while the group has members, in every form a class write takes (fails without the check, if only the value is read, or if an array is joined with a space)', () => {
    const g = withId(group(root));
    entity(g);
    for (const write of [
      { value: '' },
      { value: null },
      { value: 'foo' },
      { value: ['user-group', 'foo'] },
      { property: 'foo', value: 'bar' }
    ]) {
      expect(
        execute(editor, 'entityupdate', {
          entity: g,
          component: 'class',
          ...write
        })
      ).toBe(groupMessage('ungroupWithMembers'));
    }
    expect(editor.history.undos).toHaveLength(0);
    expect(g.className).toBe('user-group');
  });

  it('is allowed when the class is kept, when the group is empty, and on an entity that is not a group (fails with a blanket refusal of class writes)', () => {
    const g = withId(group(root));
    entity(g);
    expect(
      execute(editor, 'entityupdate', {
        entity: g,
        component: 'class',
        value: 'user-group foo'
      })
    ).toBe(null);

    const empty = withId(group(root));
    expect(
      execute(editor, 'entityupdate', {
        entity: empty,
        component: 'class',
        value: ''
      })
    ).toBe(null);

    const parent = withId(entity(root));
    entity(parent);
    expect(
      execute(editor, 'entityupdate', {
        entity: parent,
        component: 'class',
        value: 'foo'
      })
    ).toBe(null);
    expect(editor.history.undos).toHaveLength(3);
  });
});

describe('values are judged as A-Frame applies them', () => {
  const write = (el, component, rest) =>
    refuseGuardedTransform('entityupdate', { entity: el, component, ...rest });

  it('refuses a group write whose units, commas or bad numbers hid a tilt or scale, and passes the forms that work today (fails if values are read with Number, or non-numeric strings are refused wholesale)', () => {
    const g = withId(group(root));
    expect(write(g, 'rotation', { value: '10° 30 0' })).toBe(YAW_ONLY);
    expect(write(g, 'rotation', { value: '10deg 30 0' })).toBe(YAW_ONLY);
    expect(write(g, 'rotation', { property: 'x', value: '10°' })).toBe(
      YAW_ONLY
    );
    expect(write(g, 'scale', { value: '2,2,2' })).toBe(NO_SCALE);
    expect(write(g, 'scale', { value: '2m 2m 2m' })).toBe(NO_SCALE);
    expect(write(g, 'rotation', { value: 'abc 30 0' })).toBe(YAW_ONLY);

    expect(write(g, 'rotation', { value: '0 40' })).toBe(null);
    expect(write(g, 'rotation', { value: '0 30 0' })).toBe(null);
    expect(write(g, 'rotation', { value: { x: 0, y: 30, z: 0 } })).toBe(null);
    expect(write(g, 'rotation', { value: { y: '30' } })).toBe(null);
    expect(write(g, 'rotation', { property: 'y', value: '45' })).toBe(null);

    const plain = withId(entity(root));
    expect(write(plain, 'scale', { value: '2,2,2' })).toBe(null);
  });

  it('lets through the forms that cannot tilt or scale anything: a null key, an array, a bare number or boolean', () => {
    const g = withId(group(root));
    expect(write(g, 'rotation', { value: { x: null, y: 40, z: 0 } })).toBe(
      null
    );
    expect(write(g, 'scale', { value: [] })).toBe(null);
    expect(write(g, 'scale', { value: 2 })).toBe(null);
    expect(write(g, 'rotation', { value: true })).toBe(null);
  });
});

describe('levelling a tilted group is always allowed', () => {
  it('accepts a write that brings X or Z to 0, and still refuses one that keeps or changes a tilt (fails if the yaw-only check only compares with the current value, or allows any X/Z write)', () => {
    const g = withId(group(root));
    g.setAttribute('rotation', '10 30 0');
    const rotate = (rest) =>
      refuseGuardedTransform('entityupdate', {
        entity: g,
        component: 'rotation',
        ...rest
      });
    expect(rotate({ value: '0 40 0' })).toBe(null);
    expect(rotate({ property: 'x', value: 0 })).toBe(null);
    expect(rotate({ property: 'x', value: 0.0009 })).toBe(null);
    expect(rotate({ value: '5 30 0' })).toBe(YAW_ONLY);
    expect(rotate({ property: 'x', value: 20 })).toBe(YAW_ONLY);

    const shape = withId(entity(root));
    shape.setAttribute('data-transform-yaw-only', '');
    shape.setAttribute('rotation', '0 30 0');
    expect(
      refuseGuardedTransform('entityupdate', {
        entity: shape,
        component: 'rotation',
        value: '5 30 0'
      })
    ).toBe(YAW_ONLY);
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
  it('refuses a move that would need a shear under a parent scaled unevenly, and allows one that keeps its pose (fails without the guard, or with a blanket refusal of uneven parents)', () => {
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

  it('allows a turned item under a parent stretched only vertically, since a turn about Y keeps that axis', () => {
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
