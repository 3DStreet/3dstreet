// What a canvas click does when user groups are involved.
//
// A group is entered deliberately: a click on a member of a closed group
// selects the group, a click on the selected group's box opens it, and only
// then do clicks reach its members. While a group is open ("the scope"),
// clicks inside its box act on its members only, and a click outside leaves
// one level.
//
// This module only decides. The scope controller applies the decision, and the
// raycaster supplies the hits.

import { resolveClickSelection } from '../cascadingSelection.js';
import { isHiddenInHierarchy, isUserGroup } from './groupModel.js';

/**
 * A pick target along the cursor ray, nearest first:
 * - `entity`: a scene entity the ray hit (batched and placeholder hits already
 *   mapped to their entity);
 * - `marker`: a group's center marker (an empty group, or the selected group);
 * - `proxy`: the selected closed group's box, a solid picking volume;
 * - `scope`: the open scope's own volume (its box, or its marker when it has
 *   none), used only to tell a click inside the scope from one outside it.
 *
 * @typedef {{el: Element, distance: number, kind: 'entity'|'marker'|'proxy'|'scope'}} GroupHit
 */

/** A user group that is selected, visible and not open. */
export function isSelectedClosedGroup(el, selected, openStack) {
  return (
    !!el &&
    el === selected &&
    isUserGroup(el) &&
    !openStack.includes(el) &&
    !isHiddenInHierarchy(el)
  );
}

/**
 * Decide a canvas click.
 *
 * @param {GroupHit[]} hits every pick target along the ray, nearest first
 * @param {{selected: Element|null, openStack: Element[]}} state the selection
 *   and the open groups, outermost first
 * @returns one of
 *   `{action: 'open', group}` — open the selected closed group;
 *   `{action: 'select', el}` — select `el` (null deselects), scope unchanged;
 *   `{action: 'exit'}` — leave the innermost scope for its parent scope;
 *   `{action: 'close', el}` — close every scope, then select `el` or nothing.
 */
export function resolveCanvasClick(hits, { selected, openStack }) {
  const targets = hits.filter((hit) => hit.kind !== 'scope');
  const nearest = targets[0];
  // At any depth, the selected closed group's box or marker opens it.
  if (
    nearest &&
    nearest.kind !== 'entity' &&
    isSelectedClosedGroup(nearest.el, selected, openStack)
  ) {
    return { action: 'open', group: nearest.el };
  }
  // A proxy is only ever an entry target, never a thing to select through.
  const pickable = targets.filter((hit) => hit.kind !== 'proxy');
  const openGroups = new Set(openStack);
  const scope = openStack[openStack.length - 1];

  if (!scope) {
    return {
      action: 'select',
      el: resolveClickSelection(pickable[0]?.el, selected, openGroups)
    };
  }

  const inside = hits.some((hit) => hit.kind === 'scope' && hit.el === scope);
  if (inside) {
    // Outside objects cannot intercept a click inside the scope, even when
    // they are nearer: only the scope's own contents are candidates.
    const member = pickable.find(
      (hit) => hit.el !== scope && scope.contains(hit.el)
    );
    if (!member) return { action: 'select', el: scope };
    return {
      action: 'select',
      el: resolveClickSelection(member.el, selected, openGroups)
    };
  }

  // Outside a nested scope, a click leaves one level and does nothing else.
  if (openStack.length > 1) return { action: 'exit' };
  return {
    action: 'close',
    el: resolveClickSelection(pickable[0]?.el, selected, new Set())
  };
}

/**
 * Does applying `result` enter a group — select a closed group, or open one?
 * Such a click is the first half of a double-click the camera must ignore.
 */
export function isDrill(result, openStack) {
  if (!result) return false;
  if (result.action === 'open') return true;
  if (result.action !== 'select' && result.action !== 'close') return false;
  const el = result.el;
  const stillOpen = result.action === 'select' ? openStack : [];
  return isUserGroup(el) && !stillOpen.includes(el);
}

/**
 * What hovering previews for a click decision: the entity the click would
 * select (the group itself for an open), or null when the click would select
 * nothing or only leave a scope.
 */
export function hoverTargetOf(result) {
  if (!result) return null;
  if (result.action === 'open') return result.group;
  if (result.action === 'exit') return null;
  return result.el || null;
}
