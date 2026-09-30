import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  copySelectedEntity,
  pasteFromClipboard
} from '@/editor/lib/clipboard.js';
import { defineEntityElement } from './groups/_entityElement.js';

// A paste with no group involved: the payload the paste command receives is
// fixed, whatever else the clipboard learns to do. Entities have object3Ds
// posed by their attributes (see _entityElement.js), so the copy records a
// real world pose that a paste must not use. The serializer returns the copied
// item's data as saved, where a street prop's position is local to its
// segment.

defineEntityElement();

function entityIn(parent, { id, className, position, rotation } = {}) {
  const el = document.createElement('a-entity');
  if (id) el.id = id;
  if (className) el.className = className;
  parent.append(el);
  if (position) el.setAttribute('position', position);
  if (rotation) el.setAttribute('rotation', rotation);
  return el;
}

let executed;
let clipboardText;

beforeEach(() => {
  executed = [];
  clipboardText = null;
  const root = document.createElement('a-entity');
  root.id = 'street-container';
  document.body.append(root);
  // A street at x = 20, turned, with a prop in its segment's prop holder.
  const street = entityIn(root, {
    id: 'street',
    position: '20 0 0',
    rotation: '0 30 0'
  });
  const segment = entityIn(street, {
    id: 'segment',
    className: 'segment-parent-0',
    position: '4 0 0'
  });
  const holder = entityIn(segment, { className: 'custom-group' });
  entityIn(holder, { id: 'prop', position: '1 0 2', rotation: '0 90 0' });
  vi.stubGlobal('AFRAME', {
    INSPECTOR: {
      config: { defaultParent: '#street-container' },
      selectedEntity: document.getElementById('prop'),
      execute: (type, payload) => executed.push([type, payload])
    },
    utils: {
      coordinates: {
        parse: (value) => {
          const [x, y, z] = String(value).trim().split(/\s+/).map(Number);
          return { x, y, z };
        },
        stringify: (v) => `${v.x} ${v.y} ${v.z}`
      }
    }
  });
  vi.stubGlobal('STREET', {
    notify: { warningMessage: vi.fn() },
    utils: {
      getElementData: (el) => ({
        id: el.id,
        mixin: 'fire-hydrant',
        components: { position: '1 0 2', rotation: '0 90 0' }
      })
    }
  });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (text) => {
        clipboardText = text;
      },
      readText: async () => clipboardText
    }
  });
});

afterEach(() => {
  delete navigator.clipboard;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('pasting an item copied from a street segment', () => {
  it('pastes its saved pose into the top level, 5 along its own X (fails if world-pose pasting reaches an item outside any group)', async () => {
    await copySelectedEntity();
    await pasteFromClipboard();
    expect(executed).toEqual([
      [
        'entitypaste',
        {
          entityData: {
            id: 'prop',
            mixin: 'fire-hydrant',
            components: { position: '6 0 2', rotation: '0 90 0' }
          },
          parentId: 'street-container',
          name: 'Paste'
        }
      ]
    ]);
  });
});
