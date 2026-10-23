import { beforeEach, describe, expect, it } from 'vitest';
import { restorableScope } from '@/editor/lib/groups/groupScope.js';

// What of the open groups and selection remembered on leaving the editor is
// restored on returning from the viewer. Plain elements: hiding is
// read from an object3D where one is given.

function add(parent, { id, group = false } = {}) {
  const el = document.createElement('a-entity');
  if (id) el.id = id;
  if (group) el.className = 'user-group';
  el.object3D = { visible: true };
  parent.append(el);
  return el;
}

let s;

beforeEach(() => {
  document.body.replaceChildren();
  const scene = document.createElement('a-scene');
  document.body.append(scene);
  const root = add(scene, { id: 'street-container' });
  const A = add(root, { id: 'A', group: true });
  const B = add(A, { id: 'B', group: true });
  // A group written by hand into a scene file may have no id.
  const C = add(B, { group: true });
  const tree = add(C, { id: 'tree' });
  const a1 = add(A, { id: 'a1' });
  const outside = add(root, { id: 'outside' });
  s = { root, A, B, C, tree, a1, outside };
});

describe('restorableScope', () => {
  it.each([
    [
      'a member of the innermost group',
      () => [[s.A, s.B, s.C], s.tree],
      ['A', 'B', 'C'],
      'tree'
    ],
    [
      'open groups with nothing selected',
      () => [[s.A, s.B, s.C], null],
      ['A', 'B', 'C'],
      null
    ],
    [
      'a closed group inside the innermost open one',
      () => [[s.A, s.B], s.C],
      ['A', 'B'],
      'C'
    ],
    ['a closed top-level group, nothing open', () => [[], s.A], [], 'A'],
    ['an ordinary item, nothing open', () => [[], s.outside], [], 'outside'],
    [
      'a member of a group that is not open (illegal)',
      () => [[], s.tree],
      [],
      null
    ],
    [
      'a member of an outer open group, inner ones also open (mismatch)',
      () => [[s.A, s.B], s.a1],
      ['A', 'B'],
      null
    ]
  ])('%s', (_, args, groups, selected) => {
    const result = restorableScope(...args());
    expect(result.groups.map(nameOf)).toEqual(groups);
    expect(result.selected ? nameOf(result.selected) : null).toBe(selected);
  });

  it('stops at a group removed, hidden, no longer a group, or moved out of the one before it', () => {
    s.B.remove();
    expect(restorableScope([s.A, s.B, s.C], s.tree).groups).toEqual([s.A]);
    s.A.append(s.B);

    s.B.object3D.visible = false;
    expect(restorableScope([s.A, s.B, s.C], s.tree)).toEqual({
      groups: [s.A],
      selected: null
    });
    s.B.object3D.visible = true;

    s.B.className = '';
    expect(restorableScope([s.A, s.B, s.C], s.tree).groups).toEqual([s.A]);
    s.B.className = 'user-group';

    s.root.append(s.B);
    expect(restorableScope([s.A, s.B, s.C], s.tree).groups).toEqual([s.A]);
  });

  it('restores nothing when the first remembered group is now inside another', () => {
    const outer = add(s.root, { id: 'outer', group: true });
    outer.append(s.A);
    expect(restorableScope([s.A], s.a1)).toEqual({
      groups: [],
      selected: null
    });
  });

  it('drops a selection that is removed or hidden', () => {
    s.tree.remove();
    expect(restorableScope([s.A, s.B, s.C], s.tree).selected).toBe(null);
    s.outside.object3D.visible = false;
    expect(restorableScope([], s.outside).selected).toBe(null);
  });
});

function nameOf(el) {
  return el === s.C ? 'C' : el.id;
}
