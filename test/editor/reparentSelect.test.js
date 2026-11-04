import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { History } from '@/editor/lib/history.js';
import { commandsByType } from '@/editor/lib/commands/index.js';
import { entity, group, scene } from './lib/groups/_groupFixtures.js';

// A move's choice of selection, through the real History and command. The
// moved element is built as the serializer builds it, into the element the
// command made, and announces that it has loaded.
let sceneEl, root, groupA, item, editor;

beforeEach(() => {
  sceneEl = scene();
  root = entity(sceneEl);
  root.id = 'street-container';
  groupA = group(root);
  groupA.id = 'group-a';
  item = entity(root);
  item.id = 'item';
  editor = { config: {}, selectedEntity: null, selectEntity: vi.fn() };
  editor.history = new History(editor);
  vi.stubGlobal('AFRAME', { components: {}, INSPECTOR: editor });
  vi.stubGlobal('STREET', {
    utils: {
      getElementData: () => ({}),
      createEntityFromObj: (data, parent, before) => {
        const el = data.entityElement;
        el.id = 'item';
        el.object3D = new THREE.Group();
        el.pause = () => {};
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

const moved = () => document.getElementById('item');
const loaded = () => moved().dispatchEvent(new Event('loaded'));

describe('a move with a choice of selection', () => {
  it('selects what the choice names on execute and redo, and the moved entity on undo (fails if the choice is ignored, or reaches undo)', () => {
    const select = vi.fn(() => null);
    const Cmd = commandsByType.get('entityreparent');
    editor.history.execute(
      new Cmd(editor, {
        entity: item,
        parentEl: 'group-a',
        indexInParent: 0,
        select
      })
    );
    loaded();
    expect(moved().parentNode).toBe(groupA);
    expect(select).toHaveBeenCalledWith(moved());
    expect(editor.selectEntity).toHaveBeenLastCalledWith(null);

    editor.history.undo();
    loaded();
    expect(moved().parentNode).toBe(root);
    expect(editor.selectEntity).toHaveBeenLastCalledWith(moved());

    editor.history.redo();
    loaded();
    expect(select).toHaveBeenCalledTimes(2);
    expect(editor.selectEntity).toHaveBeenLastCalledWith(null);
  });

  it('selects the moved entity when no choice is given (fails if the default changes)', () => {
    const Cmd = commandsByType.get('entityreparent');
    editor.history.execute(
      new Cmd(editor, { entity: item, parentEl: 'group-a', indexInParent: 0 })
    );
    loaded();
    expect(editor.selectEntity).toHaveBeenLastCalledWith(moved());
  });
});
