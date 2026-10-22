import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import * as THREE from 'three';
import Events from '@/editor/lib/Events.js';
import {
  findRow,
  renderPanel,
  settle,
  streetUtilsStub
} from './_sceneGraphHarness.jsx';

// How a layer row is laid out, over entities built without A-Frame. Where the
// names land on screen is layout jsdom does not do; these tests check the row
// structure that decides it.

let sceneEl;
let root;
let selected;
const onSelect = (el) => selected.push(el);

function makeEntity(parent, { name, cls } = {}) {
  const el = document.createElement('a-entity');
  if (cls) el.className = cls;
  if (name) el.setAttribute('data-layer-name', name);
  el.isEntity = true;
  el.object3D = new THREE.Group();
  el.object3D.el = el;
  el.components = {};
  parent.appendChild(el);
  parent.object3D.add(el.object3D);
  return el;
}

beforeEach(() => {
  sceneEl = document.createElement('a-scene');
  sceneEl.object3D = new THREE.Scene();
  document.body.append(sceneEl);
  root = makeEntity(sceneEl);
  root.id = 'street-container';
  // Group A is empty; Group B holds Tree and Bench.
  makeEntity(root, { name: 'Group A', cls: 'user-group' });
  const groupB = makeEntity(root, { name: 'Group B', cls: 'user-group' });
  makeEntity(groupB, { name: 'Tree' });
  makeEntity(groupB, { name: 'Bench' });
  // No group scope: the panel must render as it always has without one.
  vi.stubGlobal('AFRAME', { INSPECTOR: { selectedEntity: null } });
  vi.stubGlobal('STREET', { utils: streetUtilsStub() });
  selected = [];
  Events.on('entityselect', onSelect);
});

afterEach(() => {
  Events.off('entityselect', onSelect);
  cleanup();
  sceneEl.remove();
  vi.unstubAllGlobals();
});

async function expand(name) {
  fireEvent.click(findRow(name).querySelector('.collapsespace'));
  await settle();
}

// The element children of a row's content, in order: the indent spacer, the
// drag handle, the arrow slot, the label and the badge bar.
const rowParts = (name) => [
  ...findRow(name).querySelector(':scope > span:not(.entityLoadSheen)').children
];

describe('layer rows', () => {
  it('give every row one expand-arrow slot, between the drag handle and the name (fails if only rows with children have the slot)', async () => {
    await renderPanel(sceneEl);
    await expand('Group B');
    for (const name of ['Group A', 'Group B', 'Tree', 'Bench']) {
      const row = findRow(name);
      expect(row.querySelectorAll('.collapsespace')).toHaveLength(1);
      const parts = rowParts(name);
      const slot = parts.findIndex((el) =>
        el.classList.contains('collapsespace')
      );
      expect(parts[slot - 1].classList.contains('drag-handle')).toBe(true);
      expect(parts[slot + 1].classList.contains('entityPrint')).toBe(true);
    }
  });

  it('draw the arrow only in the slot of a row with children (fails if every slot holds an arrow)', async () => {
    await renderPanel(sceneEl);
    await expand('Group B');
    expect(findRow('Group B').querySelector('.collapsespace svg')).not.toBe(
      null
    );
    for (const name of ['Group A', 'Tree', 'Bench']) {
      expect(findRow(name).querySelector('.collapsespace svg')).toBe(null);
    }
  });

  it('treat a click on an empty slot as a click on the row, and a click on an arrow as expanding the row (fails if the empty slot takes the arrow handler)', async () => {
    await renderPanel(sceneEl);
    expect(screen.queryByText('Tree')).toBe(null);

    fireEvent.click(findRow('Group A').querySelector('.collapsespace'));
    expect(selected.map((el) => el.getAttribute('data-layer-name'))).toEqual([
      'Group A'
    ]);

    selected.length = 0;
    await expand('Group B');
    expect(screen.queryByText('Tree')).not.toBe(null);
    expect(screen.queryByText('Bench')).not.toBe(null);
    expect(selected).toEqual([]);
  });
});
