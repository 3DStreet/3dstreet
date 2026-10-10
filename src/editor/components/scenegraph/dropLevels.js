// Layer-panel drop levels. Where groups end, one gap between two rows means
// several places ("after this member", "after its group", ...); the pointer's
// x picks one, each level owning the band from its own indent. Gaps that
// involve no user group keep the hovered row's own zone.

import { isUserGroup } from '../../lib/groups/groupModel.js';

// Width of one level of indent in the list (the spacer in each row).
export const LEVEL_INDENT_PX = 30;
// From a row's border-box left edge to its depth-1 content: the 2 px border
// plus the 4 px left padding of `.entity.option`.
const ROW_CONTENT_INSET_PX = 6;

/** The level whose horizontal band `clientX` is in (1 = top level). */
export function levelAtX(clientX, hostLeft) {
  return (
    Math.floor((clientX - hostLeft - ROW_CONTENT_INSET_PX) / LEVEL_INDENT_PX) +
    1
  );
}

/**
 * Left offset of the drop line for `level` from the list's left edge, which
 * is every row's border-box left edge: the level's content indent.
 */
export function lineIndentPx(level) {
  return ROW_CONTENT_INSET_PX + LEVEL_INDENT_PX * (level - 1);
}

function ancestorAtDepth(row, depth) {
  let el = row.entity;
  for (let d = row.depth; d > depth && el; d--) el = el.parentNode;
  return el;
}

/**
 * The insertions a drop at the gap between the listed rows `above` and
 * `below` ({entity, depth}; either may be null) could mean, shallowest first,
 * each `{ref, position, level, parent}` with `position` 'before', 'after' or
 * 'end' (the end of the top level, `ref` null). Returns null where no user
 * group is involved, so the caller keeps the hovered row's own zone.
 */
export function groupGapLevels(above, below) {
  const candidates = [];
  const before = (row) => ({
    ref: row.entity,
    position: 'before',
    level: row.depth,
    parent: row.entity.parentNode
  });

  if (!above) {
    if (below) candidates.push(before(below));
  } else if (below && below.entity.parentNode === above.entity) {
    // Under an expanded row, above its first child. For a group that is the
    // group's first place; "after the whole group" is offered at the gap
    // after its last row instead. Another container (a street, say) keeps
    // "after it" too, which inside a group is a group level.
    if (!isUserGroup(above.entity)) {
      candidates.push({
        ref: above.entity,
        position: 'after',
        level: above.depth,
        parent: above.entity.parentNode
      });
    }
    candidates.push(before(below));
  } else {
    const shallowest = below ? below.depth : 1;
    for (let level = shallowest; level <= above.depth; level++) {
      if (below && level === below.depth) {
        candidates.push(before(below));
        continue;
      }
      const ref = ancestorAtDepth(above, level);
      if (!ref) continue;
      candidates.push(
        !below && level === 1
          ? { ref: null, position: 'end', level, parent: ref.parentNode }
          : { ref, position: 'after', level, parent: ref.parentNode }
      );
    }
  }

  // Under an expanded group the candidate's parent is that group, so this
  // also covers the group header's lower zone.
  return candidates.some((c) => isUserGroup(c.parent)) ? candidates : null;
}

/** Would the drop leave `dragged` where it already is? */
export function isNoOpDrop(dragged, { ref, position }) {
  if (position === 'end') return false;
  return (
    dragged === ref ||
    (position === 'before' && dragged === ref.previousElementSibling) ||
    (position === 'after' && dragged === ref.nextElementSibling)
  );
}

/**
 * The candidate nearest `level`; a pointer between two levels' bands, or past
 * either end, takes the nearer one, and an exact tie the shallower.
 */
export function pickLevel(candidates, level) {
  let best = null;
  for (const candidate of candidates) {
    if (
      !best ||
      Math.abs(candidate.level - level) < Math.abs(best.level - level) ||
      (Math.abs(candidate.level - level) === Math.abs(best.level - level) &&
        candidate.level < best.level)
    ) {
      best = candidate;
    }
  }
  return best;
}
