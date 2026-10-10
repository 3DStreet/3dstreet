// What a canvas click does when user groups are involved.
//
// A group is entered deliberately: a click on a member of a closed group
// selects the group, a click on the selected group's box opens it (and
// deselects it), and only then do clicks reach its members. While groups are
// open (the scope: the stack of open groups), clicks inside the innermost
// one's box act on its members only, and a click outside it leaves one level,
// selecting the group left.
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
 * - `scope`: the innermost open group's own volume (its box, or its marker
 *   when it has none, then marked `viaMarker`), used only to tell a click
 *   inside that group from one outside it.
 *
 * @typedef {{el: Element, distance: number, kind: 'entity'|'marker'|'proxy'|'scope', viaMarker?: boolean}} GroupHit
 */

/**
 * A user group that is selected, visible and not open. `openGroups` are the
 * open groups as elements.
 */
export function isSelectedClosedGroup(el, selected, openGroups) {
  return (
    !!el &&
    el === selected &&
    isUserGroup(el) &&
    !openGroups.includes(el) &&
    !isHiddenInHierarchy(el)
  );
}

/**
 * Decide a canvas click.
 *
 * @param {GroupHit[]} hits every pick target along the ray, nearest first
 * @param {{selected: Element|null, openGroups: Element[]}} state the
 *   selection, and the open groups as elements, outermost first
 * @returns one of
 *   `{action: 'open', group}` — open the selected closed group;
 *   `{action: 'select', el}` — select `el` (null deselects), scope unchanged;
 *   `{action: 'exit'}` — close the innermost open group and select it,
 *   leaving the one around it open (`group` and `viaMarker: true` when the
 *   click was on that group's own marker);
 *   `{action: 'close', el}` — close every open group, then select `el`.
 */
export function resolveCanvasClick(hits, { selected, openGroups }) {
  const targets = hits.filter((hit) => hit.kind !== 'scope');
  const nearest = targets[0];
  // At any depth, the selected closed group's box or marker opens it.
  if (
    nearest &&
    nearest.kind !== 'entity' &&
    isSelectedClosedGroup(nearest.el, selected, openGroups)
  ) {
    return { action: 'open', group: nearest.el };
  }
  // A proxy is only ever an entry target, never a thing to select through.
  const pickable = targets.filter((hit) => hit.kind !== 'proxy');
  const openSet = new Set(openGroups);
  const innermost = openGroups[openGroups.length - 1];

  if (!innermost) {
    return {
      action: 'select',
      el: resolveClickSelection(pickable[0]?.el, selected, openSet)
    };
  }

  const scopeHit = hits.find(
    (hit) => hit.kind === 'scope' && hit.el === innermost
  );
  if (scopeHit) {
    // Outside objects cannot intercept a click inside the innermost open
    // group, even when they are nearer: only its own contents are candidates.
    const member = pickable.find(
      (hit) => hit.el !== innermost && innermost.contains(hit.el)
    );
    if (member) {
      return {
        action: 'select',
        el: resolveClickSelection(member.el, selected, openSet)
      };
    }
    // A group with no member geometry is inside only at its marker, which
    // steps out of it and selects it.
    if (scopeHit.viaMarker) {
      return { action: 'exit', group: innermost, viaMarker: true };
    }
    return { action: 'select', el: null };
  }

  // Outside a nested open group, a click leaves one level and does nothing
  // else.
  if (openGroups.length > 1) return { action: 'exit' };
  // Outside the outermost one, an item is selected as usual; empty space
  // leaves the group.
  const outside = resolveClickSelection(pickable[0]?.el, selected, new Set());
  if (!outside) return { action: 'exit' };
  return { action: 'close', el: outside };
}

/**
 * Does applying `result` enter a group — select a closed group, or open one?
 * Such a click is the first half of a double-click the camera must ignore.
 */
export function isDrill(result, openGroups) {
  if (!result) return false;
  if (result.action === 'open') return true;
  if (result.action !== 'select' && result.action !== 'close') return false;
  const el = result.el;
  const stillOpen = result.action === 'select' ? openGroups : [];
  return isUserGroup(el) && !stillOpen.includes(el);
}

/**
 * What hovering previews for a click decision: the entity the click would
 * select (the group itself for an open), or null when the click would select
 * nothing or leave an open group. A click that leaves a group selects it, but
 * hovering there shows nothing: the group's outline already marks it, and the
 * whole outside lit as its hover would be noise.
 */
export function hoverTargetOf(result) {
  if (!result) return null;
  if (result.action === 'open') return result.group;
  if (result.action === 'exit') return null;
  return result.el || null;
}
