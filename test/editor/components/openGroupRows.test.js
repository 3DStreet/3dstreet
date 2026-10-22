import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  openBlockParts,
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

  it('selects any row that is not the selected closed group, faded or nested alike (fails if a faded row is a way out rather than a row)', () => {
    const state = { selected: null, openGroups: [groupB, groupC] };
    for (const el of [tree, lamp, groupB, groupC, cone]) {
      expect(resolveRowClick(el, state)).toEqual({ action: 'select', el });
    }
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

describe("the open group's outlined block", () => {
  it('runs from the open row through the rows listed inside it (fails if it stops early or takes in the row after the group)', () => {
    const rows = [street, groupB, tree, groupC, cone, lamp].map((entity) => ({
      entity
    }));
    expect(openBlockParts(rows, groupB)).toEqual([
      null,
      'first',
      'middle',
      'middle',
      'last',
      null
    ]);
    expect(openBlockParts(rows, groupC)).toEqual([
      null,
      null,
      null,
      'first',
      'last',
      null
    ]);
    expect(openBlockParts(rows, null)).toEqual(rows.map(() => null));
  });

  it('is one row when the group lists nothing under it (fails if a lone row gets an open bottom)', () => {
    const rows = [groupB, lamp].map((entity) => ({ entity }));
    expect(openBlockParts(rows, groupB)).toEqual(['only', null]);
  });
});
