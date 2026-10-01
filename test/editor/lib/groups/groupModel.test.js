import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  canAcceptChild,
  canReparent,
  isGroupableItem,
  isHiddenInHierarchy,
  isSystemItem,
  isUserGroup,
  userGroupAncestors
} from '@/editor/lib/groups/groupModel.js';

function add(parent, { tag = 'a-entity', id, cls, attrs = [] } = {}) {
  const el = document.createElement(tag);
  if (id) el.id = id;
  if (cls) el.className = cls;
  for (const attr of attrs) el.setAttribute(attr, '');
  parent.append(el);
  return el;
}

let scene;
let s;

beforeEach(() => {
  scene = add(document.body, { tag: 'a-scene' });
  const root = add(scene, { id: 'street-container' });
  s = {
    root,
    referenceLayers: add(scene, { id: 'reference-layers' }),
    cameraRig: add(scene, { id: 'cameraRig' }),
    model: add(root, { attrs: ['mixin'] }),
    managedStreet: add(root, { attrs: ['managed-street'] }),
    legacyStreet: add(root, { attrs: ['street'] }),
    intersection: add(root, { attrs: ['intersection'] }),
    splat: add(root, { attrs: ['splat'] }),
    shape: add(root, { attrs: ['shape', 'data-transform-no-reparent'] }),
    viewerStart: add(root, { attrs: ['viewer-start'] }),
    autocreated: add(root, { cls: 'autocreated' }),
    groupA: add(root, { cls: 'user-group' }),
    groupX: add(root, { cls: 'user-group' })
  };
  s.segment = add(s.managedStreet, { attrs: ['street-segment'] });
  s.customGroup = add(s.segment, { cls: 'custom-group' });
  s.customChild = add(s.customGroup);
  s.streetParent = add(s.legacyStreet, { cls: 'street-parent' });
  s.streetInternal = add(s.streetParent);
  s.intersectionChild = add(s.intersection);
  s.memberOfA = add(s.groupA);
  s.groupB = add(s.groupA, { cls: 'user-group' });
  s.groupC = add(s.groupB, { cls: 'user-group' });
  s.memberOfC = add(s.groupC);
});

afterEach(() => scene.remove());

describe('group identity', () => {
  it('recognises a user group by its class, and not an Add Layer custom-group', () => {
    expect(isUserGroup(s.groupA)).toBe(true);
    expect(isUserGroup(s.customGroup)).toBe(false);
    expect(isUserGroup(null)).toBe(false);
  });

  it('lists enclosing user groups outermost first, skipping other parents', () => {
    expect(userGroupAncestors(s.memberOfC)).toEqual([
      s.groupA,
      s.groupB,
      s.groupC
    ]);
    expect(userGroupAncestors(s.groupC)).toEqual([s.groupA, s.groupB]);
    expect(userGroupAncestors(s.model)).toEqual([]);
  });

  it('only the top level and user groups accept moved children, and only while connected', () => {
    expect(canAcceptChild(s.root)).toBe(true);
    expect(canAcceptChild(s.groupB)).toBe(true);
    expect(canAcceptChild(s.intersection)).toBe(false);
    expect(canAcceptChild(s.customGroup)).toBe(false);
    expect(canAcceptChild(s.model)).toBe(false);
    const detached = document.createElement('a-entity');
    detached.className = 'user-group';
    expect(canAcceptChild(detached)).toBe(false);
  });
});

describe('cross-parent moves', () => {
  it('lets top-level items of every groupable kind enter a group (fails if a groupable kind is refused)', () => {
    for (const item of [
      s.model,
      s.managedStreet,
      s.legacyStreet,
      s.intersection,
      s.splat,
      s.groupX
    ]) {
      expect(canReparent(item, s.groupA)).toBe(true);
    }
  });

  it('lets a member move from one group to another and back out to the top level', () => {
    expect(canReparent(s.memberOfA, s.groupX)).toBe(true);
    expect(canReparent(s.memberOfC, s.groupA)).toBe(true);
    expect(canReparent(s.memberOfA, s.root)).toBe(true);
  });

  it('refuses generated and structural items (fails if generated internals may cross)', () => {
    for (const item of [
      s.segment,
      s.autocreated,
      s.viewerStart,
      s.shape,
      s.referenceLayers,
      s.cameraRig,
      s.streetParent,
      s.streetInternal,
      s.customChild,
      s.intersectionChild
    ]) {
      expect(canReparent(item, s.groupA)).toBe(false);
    }
  });

  it('refuses a group into itself, its child or its grandchild (fails if the cycle check is direct-child only)', () => {
    expect(canReparent(s.groupA, s.groupA)).toBe(false);
    expect(canReparent(s.groupA, s.groupB)).toBe(false);
    expect(canReparent(s.groupA, s.groupC)).toBe(false);
  });

  it('refuses a destination that is not the top level or a user group', () => {
    expect(canReparent(s.model, s.intersection)).toBe(false);
    expect(canReparent(s.model, s.customGroup)).toBe(false);
    expect(canReparent(s.model, s.managedStreet)).toBe(false);
    expect(canReparent(s.model, s.referenceLayers)).toBe(false);
  });
});

describe('an item and its data', () => {
  it('are refused and accepted alike, whether the item exists or is about to be created (fails if the layer panel and placement keep separate lists)', () => {
    const keepsItsParent = [
      { attrs: ['street-segment'] },
      { attrs: ['shape'] },
      { attrs: ['viewer-start'] },
      { attrs: ['data-transform-no-reparent'] },
      { cls: 'autocreated' },
      { cls: 'scene-backdrop' }
    ];
    for (const { attrs = [], cls } of keepsItsParent) {
      const el = add(s.root, { attrs, cls });
      const data = {
        components: Object.fromEntries(attrs.map((name) => [name, ''])),
        ...(cls ? { class: [cls] } : {})
      };
      expect([canReparent(el, s.groupA), isGroupableItem(data)]).toEqual([
        false,
        false
      ]);
    }
    expect([
      canReparent(s.model, s.groupA),
      isGroupableItem({ mixin: 'tree3', components: {} })
    ]).toEqual([true, true]);
  });

  it('keeps a 360° panorama out of every group by its saved class, in the string form a create definition gives (fails if only the card route knows)', () => {
    expect(
      isGroupableItem({
        class: 'scene-backdrop',
        components: { scale: '-1 1 1' }
      })
    ).toBe(false);
    expect(isGroupableItem({ class: 'other scene-backdrop' })).toBe(false);
    expect(isGroupableItem({ class: 'other' })).toBe(true);
  });
});

describe('items the editor makes for the user', () => {
  it('are the Starting View only, by what the item is: not a user-placed item, a drawn shape or a street the user imports (fails on a broader or name-based rule)', () => {
    expect(
      isSystemItem({
        components: {
          position: '0 1.6 0',
          'viewer-start': { fov: 80 },
          'data-layer-name': 'Starting View'
        }
      })
    ).toBe(true);
    expect(
      isSystemItem({ mixin: 'tree3', components: { position: '1 0 2' } })
    ).toBe(false);
    // Kept out of groups like the Starting View, but drawn by the user.
    expect(isSystemItem({ components: { shape: '' } })).toBe(false);
    expect(
      isSystemItem({
        components: {
          'streetmix-loader': 'streetmixStreetURL: https://example.com/s/1',
          'data-layer-name': 'Starting View'
        }
      })
    ).toBe(false);
  });
});

describe('same-parent reorders', () => {
  it('are always legal to the group model (fails if legality gates reorders)', () => {
    expect(canReparent(s.shape, s.root)).toBe(true);
    expect(canReparent(s.customChild, s.customGroup)).toBe(true);
    expect(canReparent(s.intersectionChild, s.intersection)).toBe(true);
  });
});

describe('visibility in hierarchy', () => {
  it('is hidden when the item or any ancestor has its object hidden', () => {
    for (const el of [s.root, s.groupA, s.groupB, s.groupC, s.memberOfC]) {
      el.object3D = { visible: true };
    }
    expect(isHiddenInHierarchy(s.memberOfC)).toBe(false);
    s.groupB.object3D.visible = false;
    expect(isHiddenInHierarchy(s.memberOfC)).toBe(true);
    expect(isHiddenInHierarchy(s.groupA)).toBe(false);
  });
});
