import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Events from '@/editor/lib/Events.js';
import { TRANSFORM_REFUSED } from '@/editor/lib/transformGuard.js';
import { routeGroupLevel } from '@/editor/lib/groups/groupLevel.js';
import { entityIn, mountPlacementScene } from './_placementHarness.js';
import { setFixtureMixin } from './_entityElement.js';

// Making something a group, through the editor's real execute: routing, guard,
// History and the update command, over entities whose vec3 reads behave as
// A-Frame's do (one live object per entity and name).

let scene;
let inspector;
let root;

beforeEach(() => {
  scene = mountPlacementScene();
  inspector = scene.inspector;
  root = scene.root;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const makeGroup = (entity) => ({
  entity,
  component: 'class',
  value: 'user-group'
});

const attributeNames = (el) =>
  [...el.attributes].map((attribute) => attribute.name).sort();

describe('an item made into a group by a class write', () => {
  it('loses its tilt and scale in one undo step, keeping its heading, and its members keep theirs (fails if the command is not rewritten)', () => {
    const item = entityIn(root, {
      id: 'item',
      rotation: '10 30 5',
      scale: '2 2 2'
    });
    const child = entityIn(item, {
      id: 'child',
      rotation: '0 15 0',
      scale: '1 2 1'
    });

    expect(inspector.execute('entityupdate', makeGroup(item))).not.toBe(
      TRANSFORM_REFUSED
    );

    expect(item.classList.contains('user-group')).toBe(true);
    expect(item.getAttribute('rotation')).toEqual({ x: 0, y: 30, z: 0 });
    expect(item.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
    expect(child.getAttribute('rotation')).toEqual({ x: 0, y: 15, z: 0 });
    expect(child.getAttribute('scale')).toEqual({ x: 1, y: 2, z: 1 });
    expect(inspector.history.undos).toHaveLength(1);
    expect(inspector.history.undos[0].type).toBe('multi');
  });

  it('is undone to its own tilt and scale and redone level again (fails if its own values are recorded without a copy)', () => {
    const item = entityIn(root, {
      id: 'item',
      rotation: '10 30 5',
      scale: '2 2 2'
    });
    inspector.execute('entityupdate', makeGroup(item));

    inspector.history.undo();
    expect(item.hasAttribute('class')).toBe(false);
    expect(item.getDOMAttribute('rotation')).toEqual({ x: 10, y: 30, z: 5 });
    expect(item.getDOMAttribute('scale')).toEqual({ x: 2, y: 2, z: 2 });

    inspector.history.redo();
    expect(item.classList.contains('user-group')).toBe(true);
    expect(item.getAttribute('rotation')).toEqual({ x: 0, y: 30, z: 0 });
    expect(item.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
  });

  it('writes no scale to a tilted item that has none, and undo leaves its attributes as they were (fails if both values are always written)', () => {
    const item = entityIn(root, { id: 'item', rotation: '10 30 5' });
    const before = attributeNames(item);

    inspector.execute('entityupdate', makeGroup(item));
    expect(inspector.history.undos[0].commands).toHaveLength(2);
    expect(item.hasAttribute('scale')).toBe(false);

    inspector.history.undo();
    expect(attributeNames(item)).toEqual(before);
    expect(item.hasAttribute('scale')).toBe(false);
    expect(item.getAttribute('rotation')).toEqual({ x: 10, y: 30, z: 5 });
  });

  it('gives back a scale its mixin supplied, as its own value, on undo (fails if a mixin-supplied value is recorded as null, or the plain default as a value)', () => {
    const palm = entityIn(root, { id: 'palm' });
    setFixtureMixin(palm, { scale: '1 1.5 1' });
    expect(palm.getAttribute('scale')).toEqual({ x: 1, y: 1.5, z: 1 });

    inspector.execute('entityupdate', makeGroup(palm));
    expect(palm.getDOMAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });

    inspector.history.undo();
    expect(palm.getDOMAttribute('scale')).toEqual({ x: 1, y: 1.5, z: 1 });
    expect(palm.getAttribute('scale')).toEqual({ x: 1, y: 1.5, z: 1 });

    const tilted = entityIn(root, { id: 'tilted', rotation: '10 30 5' });
    inspector.execute('entityupdate', makeGroup(tilted));
    inspector.history.undo();
    expect(tilted.hasAttribute('scale')).toBe(false);

    // A write that always levels both values (a mixin on a group) over a
    // group showing the plain defaults: undo removes them again.
    const bare = entityIn(root, { id: 'bare', cls: 'user-group' });
    inspector.execute('entityupdate', {
      entity: bare,
      component: 'mixin',
      value: 'bar'
    });
    expect(bare.hasAttribute('scale')).toBe(true);
    inspector.history.undo();
    expect(bare.hasAttribute('scale')).toBe(false);
    expect(bare.hasAttribute('rotation')).toBe(false);
  });

  it('levels a group that is already tilted when a class write keeps it a group (fails if only a newly gained class triggers the rewrite)', () => {
    const g = entityIn(root, {
      id: 'g',
      cls: 'user-group',
      rotation: '10 30 0'
    });
    expect(
      inspector.execute('entityupdate', {
        entity: g,
        component: 'class',
        value: 'user-group foo'
      })
    ).not.toBe(TRANSFORM_REFUSED);
    expect(g.getAttribute('rotation')).toEqual({ x: 0, y: 30, z: 0 });
    expect(inspector.history.undos).toHaveLength(1);
  });

  it('announces each levelling write, on execute and on undo, so the selection box follows (fails if the levelling bypasses the update command)', () => {
    const item = entityIn(root, {
      id: 'item',
      rotation: '10 30 5',
      scale: '2 2 2'
    });
    inspector.selectedEntity = item;
    const emit = vi.spyOn(Events, 'emit');
    const updated = () =>
      emit.mock.calls
        .filter(([name]) => name === 'entityupdate')
        .map(([, detail]) => detail.component);

    inspector.execute('entityupdate', makeGroup(item));
    expect(updated()).toEqual(
      expect.arrayContaining(['class', 'rotation', 'scale'])
    );

    emit.mockClear();
    inspector.history.undo();
    expect(updated()).toEqual(
      expect.arrayContaining(['class', 'rotation', 'scale'])
    );
  });
});

describe('a mixin given to a group', () => {
  it('gives the group explicit unit scale and its own level rotation, reporting nothing when they already conformed (fails if only class writes are rewritten)', () => {
    const g = entityIn(root, {
      id: 'g',
      cls: 'user-group',
      rotation: '0 40 0'
    });
    const payload = { entity: g, component: 'mixin', value: 'bar' };
    expect(routeGroupLevel('entityupdate', payload).levelled).toBe(null);

    inspector.execute('entityupdate', payload);
    expect(g.getAttribute('mixin')).toBe('bar');
    expect(g.getDOMAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
    expect(g.getDOMAttribute('rotation')).toEqual({ x: 0, y: 40, z: 0 });
  });
});

describe('writes that do not make a group', () => {
  it('run as plain updates and change no pose (fails if the group condition is dropped)', () => {
    const tilted = entityIn(root, {
      id: 'tilted',
      rotation: '10 30 5',
      scale: '2 2 2'
    });
    const palm = entityIn(root, { id: 'palm' });
    setFixtureMixin(palm, { scale: '1 1.5 1' });

    for (const entity of [tilted, palm]) {
      for (const [component, value] of [
        ['class', 'foo'],
        ['mixin', 'bar']
      ]) {
        const payload = { entity, component, value };
        expect(routeGroupLevel('entityupdate', payload)).toBe(null);
        inspector.execute('entityupdate', payload);
      }
    }
    expect(inspector.history.undos.map((c) => c.type)).toEqual([
      'entityupdate',
      'entityupdate',
      'entityupdate',
      'entityupdate'
    ]);
    expect(tilted.getAttribute('rotation')).toEqual({ x: 10, y: 30, z: 5 });
    expect(tilted.getAttribute('scale')).toEqual({ x: 2, y: 2, z: 2 });
    expect(palm.getAttribute('scale')).toEqual({ x: 1, y: 1.5, z: 1 });
    expect(palm.hasAttribute('scale')).toBe(false);
  });
});

describe('removing the scale or rotation of a group with a mixin', () => {
  it('writes the reset explicitly, so the mixin never shows through, through undo and redo (fails without the removal rewrite)', () => {
    const g = entityIn(root, {
      id: 'g',
      cls: 'user-group',
      rotation: '0 30 0',
      scale: '1 1 1'
    });
    setFixtureMixin(g, { scale: '1 1.5 1', rotation: '-90 0 0' });
    const conforms = () => {
      expect(g.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
      const r = g.getAttribute('rotation');
      expect(r.x).toBe(0);
      expect(r.z).toBe(0);
    };

    inspector.execute('entityupdate', {
      entity: g,
      component: 'scale',
      value: null
    });
    expect(g.hasAttribute('scale')).toBe(true);
    conforms();

    inspector.execute('componentremove', { entity: g, component: 'rotation' });
    expect(g.hasAttribute('rotation')).toBe(true);
    expect(g.getAttribute('rotation')).toEqual({ x: 0, y: 0, z: 0 });

    inspector.execute('entityupdate', {
      entity: g,
      component: 'mixin',
      value: 'tree3'
    });
    conforms();
    inspector.history.undo();
    conforms();
    inspector.history.undo();
    conforms();
    inspector.history.redo();
    conforms();

    const plain = entityIn(root, {
      id: 'plain-group',
      cls: 'user-group',
      scale: '1 1 1'
    });
    inspector.execute('entityupdate', {
      entity: plain,
      component: 'scale',
      value: null
    });
    expect(plain.hasAttribute('scale')).toBe(false);
  });
});

describe('a group created by a create command', () => {
  it('is created level, and stays level through undo and redo (fails if the create command does not level its definition)', () => {
    inspector.execute('entitycreate', {
      class: 'user-group',
      parentEl: root,
      components: { rotation: '10 30 0', scale: '2 2 2' }
    });
    const created = root.lastElementChild;
    expect(created.classList.contains('user-group')).toBe(true);
    expect(created.getAttribute('rotation')).toEqual({ x: 0, y: 30, z: 0 });
    expect(created.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
    const id = created.id;

    inspector.history.undo();
    expect(document.getElementById(id)).toBe(null);
    inspector.history.redo();
    const again = document.getElementById(id);
    expect(again.getAttribute('rotation')).toEqual({ x: 0, y: 30, z: 0 });
    expect(again.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
  });
});
