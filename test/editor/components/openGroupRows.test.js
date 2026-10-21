import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openGroupRole,
  resolveRowClick
} from '@/editor/components/scenegraph/openGroupRows.js';
import { entity, group, scene } from '../lib/groups/_groupFixtures.js';

// Street, Group B {Tree, Group C {Cone}}, Lamp, all at the top level of the
// street container.
let sceneEl, street, groupB, tree, groupC, cone, lamp;

beforeEach(() => {
  sceneEl = scene();
  const root = entity(sceneEl);
  street = entity(root);
  groupB = group(root);
  tree = entity(groupB);
  groupC = group(groupB);
  cone = entity(groupC);
  lamp = entity(root);
});

afterEach(() => {
  sceneEl.remove();
});

describe('the part a layer row plays while groups are open', () => {
  it("is 'open' for the innermost open group, nothing inside it, and 'outside' for the rest, the groups around it included (fails if the open group counts as inside, or a group around it does)", () => {
    expect(openGroupRole(groupC, groupC)).toBe('open');
    expect(openGroupRole(cone, groupC)).toBe(null);
    for (const el of [tree, groupB, street, lamp]) {
      expect(openGroupRole(el, groupC)).toBe('outside');
    }
  });

  it('is nothing for every row while no group is open (fails if rows are faded with nothing open)', () => {
    for (const el of [street, groupB, tree, groupC, cone, lamp]) {
      expect(openGroupRole(el, null)).toBe(null);
      expect(openGroupRole(el, undefined)).toBe(null);
    }
  });
});

describe('a click on a layer row', () => {
  it('opens the selected group, unless it is hidden (fails if a hidden group can be opened)', () => {
    expect(
      resolveRowClick(groupB, { selected: groupB, openGroups: [] })
    ).toEqual({ action: 'open', group: groupB });

    groupB.setAttribute('visible', false);
    expect(
      resolveRowClick(groupB, { selected: groupB, openGroups: [] })
    ).toEqual({ action: 'select', el: groupB });
  });

  it('outside a nested open group leaves one level, and inside it or on its own row selects the row (fails if the nested rule reaches the open row or an inside row)', () => {
    const state = { selected: null, openGroups: [groupB, groupC] };
    for (const el of [tree, lamp, groupB]) {
      expect(resolveRowClick(el, state)).toEqual({ action: 'exit' });
    }
    expect(resolveRowClick(cone, state)).toEqual({
      action: 'select',
      el: cone
    });
    expect(resolveRowClick(groupC, state)).toEqual({
      action: 'select',
      el: groupC
    });
  });

  it('outside a single open group, or on its own row, selects the row (fails if one open level is left like a nested one)', () => {
    const state = { selected: null, openGroups: [groupB] };
    expect(resolveRowClick(lamp, state)).toEqual({
      action: 'select',
      el: lamp
    });
    expect(resolveRowClick(groupB, state)).toEqual({
      action: 'select',
      el: groupB
    });
  });
});
