/**
 * Clone slots and holes (#2011): per-object detach from managed-street
 * generators.
 *
 * The street-generated-clones / -stencil / -pedestrians generators rebuild
 * every clone deterministically (fixed mode from spacing/cycleOffset, random
 * mode from the persisted seed). Each clone is laid out at a STRAIGHT-SPACE
 * placement — an x across the segment and a z along it, computed before any
 * bending onto a curved street path — and that placement is what identifies
 * it. Detaching one object leaves a HOLE at its placement: the "x z" key is
 * appended to the generator's `skip` array and a plain entity takes the
 * clone's place. `skip` saves with the generator config, so on load the
 * generator regenerates minus that placement and the detached entity loads
 * as an ordinary segment child.
 *
 * Keying holes by placement rather than by creation index gives one rule a
 * user can hold in their head: the generator stops placing an object at that
 * spot; if its layout later changes so nothing lands there any more (new
 * spacing, count, mode, seed, or a length change that shifts the row), the
 * hole is simply forgotten — every clone comes back and the detached object
 * stays as the user's own. Nothing ever goes missing somewhere else, which
 * is what an index-keyed hole would do. Curving a street does not touch
 * straight space, so holes survive path changes.
 *
 * Clones are still numbered in creation order (`data-clone-index`) so the
 * editor and the AI tool can address one; the index is not what the hole is
 * keyed by.
 *
 * Pure helpers shared by the generators and the editor (DetachCloneCommand,
 * sidebar Detach, drag-to-detach). No DOM or A-Frame dependency so it
 * unit-tests under mocha.
 */

// Stamped on every clone the generators create, next to data-parent-component.
export const CLONE_INDEX_ATTR = 'data-clone-index';
// The clone's straight-space placement key ("x z"), the value a detach
// appends to `skip`.
export const CLONE_KEY_ATTR = 'data-clone-key';

// Generators whose clones can be detached one at a time. Striping and rail
// planes are surfaces, not objects, and stay whole-street (Convert to Shapes).
export const DETACHABLE_GENERATORS = [
  'street-generated-clones',
  'street-generated-stencil',
  'street-generated-pedestrians'
];

// A placement matches a hole when both axes are within this (meters). Keys
// are written to the millimeter, so this only has to absorb float noise from
// recomputing the same layout.
export const HOLE_TOLERANCE = 0.01;

/**
 * Whether a `data-parent-component` value names a generator that supports
 * per-object detach. Multi-instance names (`street-generated-clones__2`) match
 * on their base name.
 */
export function isDetachableGenerator(componentName) {
  if (typeof componentName !== 'string') return false;
  const baseName = componentName.split('__')[0];
  return DETACHABLE_GENERATORS.includes(baseName);
}

function round3(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  // parseFloat drops trailing zeros; `${-0}` prints "0".
  return parseFloat(v.toFixed(3)) || 0;
}

/** "x z" key for a straight-space placement, to the millimeter. */
export function placementKey(x, z) {
  return `${round3(x)} ${round3(z)}`;
}

/**
 * One hole from a `skip` entry: an "x z" string (what A-Frame parses from
 * the attribute and what the editor writes) or an {x, z} object. Null when
 * the entry is not a placement.
 */
export function parseHole(entry) {
  let x;
  let z;
  if (typeof entry === 'string') {
    const parts = entry.trim().split(/\s+/);
    if (parts.length !== 2) return null;
    x = Number(parts[0]);
    z = Number(parts[1]);
  } else if (entry && typeof entry === 'object') {
    x = Number(entry.x);
    z = Number(entry.z);
  } else {
    return null;
  }
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  return { x, z };
}

/** Whether a straight-space placement falls on a hole. */
export function holeMatches(hole, x, z) {
  return (
    Math.abs(hole.x - x) <= HOLE_TOLERANCE &&
    Math.abs(hole.z - z) <= HOLE_TOLERANCE
  );
}

/**
 * Normalize a generator's `skip` value into a list of holes, ignoring
 * entries that are not placements and collapsing duplicates.
 */
export function parseSkipHoles(skip) {
  const holes = [];
  if (!Array.isArray(skip)) return holes;
  for (const entry of skip) {
    const hole = parseHole(entry);
    if (!hole) continue;
    if (holes.some((h) => holeMatches(h, hole.x, hole.z))) continue;
    holes.push(hole);
  }
  return holes;
}

function serializeHoles(holes) {
  return holes.map((h) => placementKey(h.x, h.z));
}

/** `skip` with the hole at `key` added: "x z" strings, de-duplicated. */
export function withSkippedHole(skip, key) {
  const holes = parseSkipHoles(skip);
  const hole = parseHole(key);
  if (hole && !holes.some((h) => holeMatches(h, hole.x, hole.z))) {
    holes.push(hole);
  }
  return serializeHoles(holes);
}

/** `skip` with the hole at `key` removed: "x z" strings, de-duplicated. */
export function withoutSkippedHole(skip, key) {
  const holes = parseSkipHoles(skip);
  const hole = parseHole(key);
  return serializeHoles(
    hole ? holes.filter((h) => !holeMatches(h, hole.x, hole.z)) : holes
  );
}

/**
 * Per-regeneration slot counter for a generator's createClone loop. Call
 * `next(x, z)` once per clone the generator WOULD create, in creation order,
 * with the clone's straight-space placement, and skip creating the element
 * when it returns a skipped slot:
 *
 *   const slots = createSlotCounter(this.data.skip);
 *   ...
 *   const slot = slots.next(x, z);
 *   if (slot.skipped) return;
 *   clone.setAttribute(CLONE_INDEX_ATTR, slot.index);
 *   clone.setAttribute(CLONE_KEY_ATTR, slot.key);
 *
 * Generators must draw any seeded randomness for a clone BEFORE consulting
 * the counter, so a skipped placement consumes the same RNG calls it would
 * have and the clones after it keep their models, positions and facings.
 */
export function createSlotCounter(skip) {
  const holes = parseSkipHoles(skip);
  let index = 0;
  return {
    next(x, z) {
      const slot = index++;
      return {
        index: slot,
        key: placementKey(x, z),
        skipped: holes.some((h) => holeMatches(h, x, z))
      };
    }
  };
}
