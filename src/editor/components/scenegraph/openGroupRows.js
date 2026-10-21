// How the layer panel shows the open groups (see docs/groups.md, "Opening a
// group"), and what a click on a row does while groups are open.

import { isSelectedClosedGroup } from '../../lib/groups/groupScope.js';

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
 * Decide a click on the row of `el`, given the selection and the open groups
 * as elements, outermost first. Returns one of
 * `{action: 'open', group}` — open the selected closed group;
 * `{action: 'exit'}` — leave the innermost open group, selecting it;
 * `{action: 'select', el}` — select the row's entity.
 *
 * As on the canvas, a click outside a nested open group only leaves one
 * level. With one group open, selecting an outside row closes the group by
 * itself (the scope follows the selection), and selecting the open group's
 * own row leaves it, so both are plain selections.
 */
export function resolveRowClick(el, { selected, openGroups }) {
  if (isSelectedClosedGroup(el, selected, openGroups)) {
    return { action: 'open', group: el };
  }
  const openGroup = openGroups[openGroups.length - 1];
  if (openGroups.length > 1 && openGroupRole(el, openGroup) === 'outside') {
    return { action: 'exit' };
  }
  return { action: 'select', el };
}
