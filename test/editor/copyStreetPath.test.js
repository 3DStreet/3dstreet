import { afterEach, describe, expect, it, vi } from 'vitest';
import { cloneEntityImpl } from '@/editor/lib/entity.jsx';
import { EntityPasteCommand } from '@/editor/lib/commands/EntityPasteCommand.js';

// A copy that holds a street and the shape it follows makes the copied street
// follow the copied shape; a street copied without its shape keeps following
// the original. Both copy routes: duplicate (the layer panel, the shortcut and
// the AI all clone through cloneEntityImpl) and paste (EntityPasteCommand).
// Components do not run here, so a clone keeps its raw attribute strings.

const STREET = 'length: 60; path: #p1; showVehicles: false';
const STREET_OF_P10 = 'length: 60; path: #p10; showVehicles: false';
const OBJECT_STREET = { length: 60, path: '#p1', showVehicles: false };

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function entity(parent, id, attributes = {}) {
  const el = document.createElement('a-entity');
  if (id) el.id = id;
  for (const [name, value] of Object.entries(attributes)) {
    el.setAttribute(name, value);
  }
  parent.append(el);
  return el;
}

// The original group, which cloneEntityImpl asks to flush its components.
function groupIn(parent, id) {
  const el = entity(parent, id);
  el.flushToDOM = () => {};
  return el;
}

const streetOf = (copy) =>
  copy.querySelector('[managed-street]').getAttribute('managed-street');

describe('duplicating a group that holds a street', () => {
  it('points the copied street at the copied path only when the copy holds it, changing nothing else in its value (fails with no retarget, a rewrite that keeps only the path or re-spaces the rest, retargeting every path, or an id match not anchored at its end)', () => {
    // (a) The street and its path are both in the group.
    const group = groupIn(document.body, 'g');
    entity(group, 'street', { 'managed-street': STREET });
    entity(group, 'p1', { shape: '' });
    const copy = cloneEntityImpl(group);
    const copiedShape = copy.querySelector('[shape]');
    expect(copiedShape.id).not.toBe('p1');
    expect(streetOf(copy)).toBe(STREET.replace('#p1', `#${copiedShape.id}`));
    document.body.replaceChildren();

    // (b) The path is outside the group: the copy keeps following it.
    entity(document.body, 'p1', { shape: '' });
    const lone = groupIn(document.body, 'g');
    entity(lone, 'street', { 'managed-street': STREET });
    expect(streetOf(cloneEntityImpl(lone))).toBe(STREET);
    document.body.replaceChildren();

    // (c) The group holds p1, and the street follows p10, which is outside.
    entity(document.body, 'p10', { shape: '' });
    const other = groupIn(document.body, 'g');
    entity(other, 'street', { 'managed-street': STREET_OF_P10 });
    entity(other, 'p1', { shape: '' });
    expect(streetOf(cloneEntityImpl(other))).toBe(STREET_OF_P10);
  });
});

describe('pasting a group that holds a street', () => {
  const tree = (street, extra = []) => ({
    id: 'g',
    children: [
      { id: 'street', components: { 'managed-street': street } },
      ...extra
    ]
  });
  const shape = (id) => ({ id, components: { shape: '' } });
  const paste = (entityData) =>
    new EntityPasteCommand({}, { entityData, parentId: 'street-container' })
      .entityData;
  const streetValue = (data) => data.children[0].components['managed-street'];

  it('points the pasted street at the pasted path only when the paste holds it, as a style string and as an object, changing nothing else (fails with no retarget, a rewrite of only the path, one that reads only strings, retargeting every path, or an id match not anchored at its end)', () => {
    // (a) The street and its path are both in the paste.
    const asString = paste(tree(STREET, [shape('p1')]));
    expect(asString.children[1].id).not.toBe('p1');
    expect(streetValue(asString)).toBe(
      STREET.replace('#p1', `#${asString.children[1].id}`)
    );
    const asObject = paste(tree(OBJECT_STREET, [shape('p1')]));
    expect(streetValue(asObject)).toEqual({
      ...OBJECT_STREET,
      path: `#${asObject.children[1].id}`
    });

    // (b) The path is not in the paste.
    expect(streetValue(paste(tree(STREET)))).toBe(STREET);
    expect(streetValue(paste(tree(OBJECT_STREET)))).toEqual(OBJECT_STREET);

    // (c) The paste holds p1, and the street follows p10.
    expect(streetValue(paste(tree(STREET_OF_P10, [shape('p1')])))).toBe(
      STREET_OF_P10
    );
  });
});
