// How the layer panel shows the open groups (see docs/groups.md, "Opening a
// group"), and what a click on a row does while groups are open.

import { isSelectedClosedGroup } from '../../lib/groups/groupScope.js';
import { userGroupAncestors } from '../../lib/groups/groupModel.js';

/**
 * The part a layer row plays while groups are open: 'open' for the innermost
 * open group's own row, 'outside' for every row that is neither that group
 * nor inside it (the groups around it included), null for a row inside it or
 * when no group is open.
 */
export function openGroupRole(el, openGroup) {
  if (!openGroup) return null;
  if (el === openGroup) return 'open';
  if (openGroup.contains(el)) return null;
  return 'outside';
}

/**
 * Where each listed row sits in the open group's outlined block: the open
 * group's row and the rows listed under it inside the group, which follow it
 * without a gap. Returns, per row of `rows` ({entity}), 'first', 'middle' or
 * 'last' of the block, 'only' for a block of one row (the group collapsed or
 * empty), or null outside it or when no group is open.
 */
export function openBlockParts(rows, openGroup) {
  const parts = rows.map(() => null);
  const first = openGroup ? rows.findIndex((r) => r.entity === openGroup) : -1;
  if (first < 0) return parts;
  let last = first;
  while (last + 1 < rows.length && openGroup.contains(rows[last + 1].entity)) {
    last++;
  }
  for (let i = first; i <= last; i++) {
    parts[i] = i === first ? 'first' : i === last ? 'last' : 'middle';
  }
  if (first === last) parts[first] = 'only';
  return parts;
}

/**
 * Decide a click on the row of `el`, given the selection and the open groups
 * as elements, outermost first. Returns one of
 * `{action: 'open', group}` — open the selected closed group;
 * `{action: 'select', el}` — select the row's entity.
 *
 * Every other click is a plain selection, and the open groups follow it: a
 * row outside the open groups closes them and opens any around it, and the
 * open group's own row leaves it. A faded row is faded only; it acts like any
 * other row.
 */
export function resolveRowClick(el, { selected, openGroups }) {
  if (isSelectedClosedGroup(el, selected, openGroups)) {
    return { action: 'open', group: el };
  }
  return { action: 'select', el };
}

/**
 * What to select after the layer panel moves `moved`, so that the move leaves
 * the open groups as they were (the scope follows the selection). Inside the
 * innermost open group `openGroup` (or anywhere, when none is open) that is
 * what a click on the moved item would select: the outermost closed group
 * around it there, else the item itself. Moved out of the open group, nothing
 * is selected.
 */
export function selectionAfterMove(moved, openGroup) {
  if (openGroup && !openGroup.contains(moved)) return null;
  const closedAround = userGroupAncestors(moved).filter(
    (g) => !openGroup || (g !== openGroup && openGroup.contains(g))
  );
  return closedAround[0] ?? moved;
}
