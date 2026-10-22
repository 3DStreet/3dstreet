/* global AFRAME, STREET */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCommand } from '@/editor/lib/resolveCommand.js';
import { dispatchToolCall } from '@/editor/lib/commands/registry.js';
import { entityIn, mountPlacementScene } from './groups/_placementHarness.js';
import { setFixtureMixin } from './groups/_entityElement.js';

// An item becoming a managed street, managed intersection or shape, or a
// command on one that would leave it outside its kind's limits, through the
// editor's real routing, guard, commands and History, and through the AI tool
// dispatcher.

let scene;

// The three kind components as A-Frame registers them: multi-property, so the
// commands take their component paths rather than the plain-attribute one.
function registerKindComponents() {
  for (const name of ['managed-street', 'managed-intersection', 'shape']) {
    AFRAME.components[name] = { isSingleProperty: false, schema: {} };
  }
}

// An item of a kind as it is in the editor: its component plus the markers the
// component's init sets.
const MARKERS_SET_BY = {
  'managed-street': ['data-transform-no-scale'],
  'managed-intersection': ['data-transform-no-scale'],
  shape: [
    'data-transform-no-scale',
    'data-transform-yaw-only',
    'data-transform-no-reparent'
  ]
};

function kindIn(parent, component, options = {}) {
  const el = entityIn(parent, options);
  el.setAttribute(component, options.value ?? '');
  for (const marker of MARKERS_SET_BY[component]) el.setAttribute(marker, '');
  return el;
}

const vec = (x, y, z) => ({ x, y, z });

const STRIP_REFUSED =
  "entityupdate refused: This element's scale limit cannot be removed.";
const own = (el, name) => {
  const v = el.getDOMAttribute(name);
  return v && vec(v.x, v.y, v.z);
};

beforeEach(() => {
  scene = mountPlacementScene();
  registerKindComponents();
  // Moving a street reports it to analytics with the current scene's id.
  STREET.utils = { getCurrentSceneId: () => null };
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('a command that makes an item a constrained kind', () => {
  it('becomes one batch: level, then unit, then the component, under the name of the command asked for (fails if the write is not rewritten, levels after the write, or loses its name)', () => {
    const box = entityIn(scene.root, {
      id: 'box',
      rotation: '10 30 5',
      scale: '2 2 2'
    });
    const r = resolveCommand('componentadd', {
      entity: box,
      component: 'shape',
      value: ''
    });
    expect(r.cmdName).toBe('multi');
    expect(r.payload.map(([type, p]) => [type, p.component, p.value])).toEqual([
      ['entityupdate', 'rotation', '0 30 0'],
      ['entityupdate', 'scale', '1 1 1'],
      ['componentadd', 'shape', '']
    ]);
    expect(r.optionalName).toBe('Add Component');
    expect(r.refusal).toBeNull();
  });

  it('brings it within its limits in one undo step named for the command, and undo restores the values exactly (fails without the rewrite, if undo values are live objects, or if the step is named as a batch)', () => {
    const box = entityIn(scene.root, {
      id: 'box',
      rotation: '10 30 5',
      scale: '2 2 2'
    });
    scene.inspector.execute('componentadd', {
      entity: box,
      component: 'shape',
      value: ''
    });
    const history = scene.inspector.history;
    expect(own(box, 'rotation')).toEqual(vec(0, 30, 0));
    expect(own(box, 'scale')).toEqual(vec(1, 1, 1));
    expect(box.hasAttribute('shape')).toBe(true);
    expect(history.undos).toHaveLength(1);
    expect(history.undos[0].name).toBe('Add Component');

    history.undo();
    expect(own(box, 'rotation')).toEqual(vec(10, 30, 5));
    expect(own(box, 'scale')).toEqual(vec(2, 2, 2));
    expect(box.hasAttribute('shape')).toBe(false);

    history.redo();
    expect(own(box, 'rotation')).toEqual(vec(0, 30, 0));
    expect(own(box, 'scale')).toEqual(vec(1, 1, 1));
    expect(box.hasAttribute('shape')).toBe(true);
  });

  it.each([
    ['adding the component', 'componentadd', '', 'Add Component'],
    ['updating the component', 'entityupdate', 'length: 40', 'Update Entity']
  ])(
    'makes an item a managed street at unit scale, keeping its tilt, by %s (fails if streets are treated as heading-only, or the update form is not routed)',
    (_, type, value, name) => {
      const box = entityIn(scene.root, {
        id: 'box',
        rotation: '10 30 0',
        scale: '2 2 2'
      });
      scene.inspector.execute(type, {
        entity: box,
        component: 'managed-street',
        value
      });
      expect(own(box, 'scale')).toEqual(vec(1, 1, 1));
      expect(own(box, 'rotation')).toEqual(vec(10, 30, 0));
      expect(box.hasAttribute('managed-street')).toBe(true);
      expect(scene.inspector.history.undos).toHaveLength(1);
      expect(scene.inspector.history.undos[0].name).toBe(name);
    }
  );

  it.each([
    [
      'adding a shape to a box that is already level and unit',
      () => entityIn(scene.root, { id: 'box', rotation: '0 30 0' }),
      'componentadd',
      'shape',
      ''
    ],
    [
      'removing a managed street component',
      () => kindIn(scene.root, 'managed-street', { id: 'box' }),
      'entityupdate',
      'managed-street',
      null
    ],
    [
      'adding an unrelated component to a scaled box',
      () => entityIn(scene.root, { id: 'box', scale: '2 2 2' }),
      'componentadd',
      'animation',
      'property: rotation'
    ],
    [
      'updating a conforming street',
      () => kindIn(scene.root, 'managed-street', { id: 'box' }),
      'entityupdate',
      'managed-street',
      'length: 50'
    ]
  ])(
    'leaves alone %s (fails if every component write is rewritten)',
    (_, make, type, component, value) => {
      const entity = make();
      const payload = { entity, component, value };
      const r = resolveCommand(type, payload);
      expect(r.cmdName).toBe(type);
      expect(r.payload).toBe(payload);
      expect(r.levelled).toBeNull();
    }
  );
});

describe('a command on an existing constrained kind', () => {
  it('drops the scale a new mixin gives a managed street, and not its rotation; an item with only the marker is not rewritten (fails if the mixin route is group-only, judges a street rotation, or reads bare markers as a kind)', () => {
    const mixin = document.createElement('a-mixin');
    mixin.id = 'tall';
    mixin.setAttribute('scale', '1 1.5 1');
    mixin.setAttribute('rotation', '5 0 0');
    document.body.append(mixin);

    const street = kindIn(scene.root, 'managed-street', { id: 'street' });
    const r = resolveCommand('entityupdate', {
      entity: street,
      component: 'mixin',
      value: 'tall'
    });
    expect(r.cmdName).toBe('multi');
    expect(r.payload.map(([, p]) => [p.component, p.value])).toEqual([
      ['mixin', 'tall'],
      ['scale', '1 1 1']
    ]);

    const marked = entityIn(scene.root, { id: 'marked' });
    marked.setAttribute('data-transform-no-scale', '');
    expect(
      resolveCommand('entityupdate', {
        entity: marked,
        component: 'mixin',
        value: 'tall'
      }).cmdName
    ).toBe('entityupdate');
  });

  it('writes a unit scale when removing a managed street scale would show its mixin scale, but lets a rotation removal through (fails if the removal route is group-only, or levels a street rotation)', () => {
    const street = kindIn(scene.root, 'managed-street', { id: 'street' });
    setFixtureMixin(street, { scale: '1 1.5 1' }, 'tall');
    const tall = document.createElement('a-mixin');
    tall.id = 'tall';
    tall.setAttribute('scale', '1 1.5 1');
    document.body.append(tall);
    const r = resolveCommand('componentremove', {
      entity: street,
      component: 'scale'
    });
    expect(r.cmdName).toBe('entityupdate');
    expect(r.payload).toMatchObject({ component: 'scale', value: '1 1 1' });
    expect(r.optionalName).toBe('Remove Component');

    const turned = kindIn(scene.root, 'managed-street', {
      id: 'turned',
      rotation: '0 30 0'
    });
    const tilt = document.createElement('a-mixin');
    tilt.id = 'tilt';
    tilt.setAttribute('rotation', '5 0 0');
    document.body.append(tilt);
    turned.setAttribute('mixin', 'tilt');
    const payload = { entity: turned, component: 'rotation' };
    const removal = resolveCommand('componentremove', payload);
    expect(removal.cmdName).toBe('componentremove');
    expect(removal.payload).toBe(payload);
  });
});

describe('what the AI assistant is told about a constrained kind', () => {
  it('is told the scale was dropped when a box it scaled becomes a shape (fails without the note, or with a note naming a group)', async () => {
    await dispatchToolCall('entityCreate', { scale: '3 3 3' });
    const id = scene.inspector.history.undos.at(-1).entityId;
    const box = document.getElementById(id);
    expect(own(box, 'scale')).toEqual(vec(3, 3, 3));
    await expect(
      dispatchToolCall('componentAdd', { entityId: id, component: 'shape' })
    ).resolves.toBe(
      'componentadd executed. The item is now a shape, so its scale (3 3 3) was removed; shapes turn only about the vertical axis and are never scaled. Its heading and position are unchanged.'
    );
    expect(own(box, 'scale')).toEqual(vec(1, 1, 1));
  });

  it('is told a managed street keeps its rotation when its scale is dropped (fails if the heading-only rule or ending is used for a street)', async () => {
    const box = entityIn(scene.root, {
      id: 'box',
      rotation: '10 30 0',
      scale: '2 2 2'
    });
    await expect(
      dispatchToolCall('componentAdd', {
        entityId: 'box',
        component: 'managed-street'
      })
    ).resolves.toBe(
      'componentadd executed. The item is now a managed street, so its scale (2 2 2) was removed; managed streets are never scaled. Its rotation and position are unchanged.'
    );
    expect(own(box, 'rotation')).toEqual(vec(10, 30, 0));
  });

  it('is told when an update makes an item a managed intersection (fails if the update form is not routed or not reported)', async () => {
    entityIn(scene.root, { id: 'box', scale: '2 2 2' });
    await expect(
      dispatchToolCall('entityUpdate', {
        entityId: 'box',
        component: 'managed-intersection',
        value: ''
      })
    ).resolves.toBe(
      'entityupdate executed. The item is now a managed intersection, so its scale (2 2 2) was removed; managed intersections are never scaled. Its rotation and position are unchanged.'
    );
  });

  it('adds no note to an ordinary edit of a managed street (fails if every edit of a kind gets a note)', async () => {
    kindIn(scene.root, 'managed-street', { id: 'street' });
    await expect(
      dispatchToolCall('entityUpdate', {
        entityId: 'street',
        component: 'position',
        value: '1 0 2'
      })
    ).resolves.toBe('entityupdate executed');
  });

  it('is refused removing a transform marker, by chat and by MCP alike (fails if the strip is let through)', async () => {
    const street = kindIn(scene.root, 'managed-street', { id: 'street' });
    const strip = {
      entityId: 'street',
      component: 'data-transform-no-scale',
      value: null
    };
    await expect(dispatchToolCall('entityUpdate', strip)).rejects.toMatchObject(
      { message: STRIP_REFUSED }
    );
    const { callToolAsMCPContent } =
      await import('@/editor/lib/mcp/dispatch.js');
    await expect(
      callToolAsMCPContent('entityUpdate', strip)
    ).rejects.toMatchObject({ message: STRIP_REFUSED });
    expect(street.hasAttribute('data-transform-no-scale')).toBe(true);
    expect(scene.inspector.history.undos).toHaveLength(0);
  });

  it('still cannot scale a managed street whose marker attribute was removed outside the editor, as from the console (fails if the kind does not imply its marker)', async () => {
    const street = kindIn(scene.root, 'managed-street', { id: 'street' });
    street.removeAttribute('data-transform-no-scale');
    await expect(
      dispatchToolCall('entityUpdate', {
        entityId: 'street',
        component: 'scale',
        value: '2 2 2'
      })
    ).rejects.toMatchObject({
      message:
        'entityupdate refused: Scaling is not available for this element.'
    });
    expect(street.object3D.scale.toArray()).toEqual([1, 1, 1]);
  });
});

describe('creating a constrained kind', () => {
  it('creates a managed street defined with a scale at unit scale, keeping its tilt, through undo and redo (fails if create does not apply the limits of every kind)', () => {
    scene.inspector.execute('entitycreate', {
      components: {
        'managed-street': '',
        rotation: '5 0 0',
        scale: '2 2 2'
      }
    });
    const history = scene.inspector.history;
    const id = history.undos.at(-1).entityId;
    const check = () => {
      const el = document.getElementById(id);
      expect(own(el, 'scale')).toEqual(vec(1, 1, 1));
      expect(own(el, 'rotation')).toEqual(vec(5, 0, 0));
    };
    check();
    history.undo();
    expect(document.getElementById(id)).toBeNull();
    history.redo();
    check();
  });
});
