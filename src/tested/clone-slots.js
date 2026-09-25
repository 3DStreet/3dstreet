/**
 * Clone slots (#2011): per-object detach from managed-street generators.
 *
 * The street-generated-clones / -stencil / -pedestrians generators rebuild
 * every clone deterministically (fixed mode from spacing/cycleOffset, random
 * mode from the persisted seed), so the order in which they create clones is
 * stable across regenerations and reloads. That order is the clone's SLOT
 * index. Detaching one object leaves its slot empty — the slot is appended to
 * the generator's `skip` array — and a plain entity takes its place. `skip`
 * saves with the generator config, so on load the generator regenerates
 * minus that slot and the detached entity loads as an ordinary segment child.
 *
 * Pure helpers shared by the generators (skip bookkeeping while creating
 * clones) and the editor (DetachCloneCommand, sidebar Detach, drag-to-detach).
 * No DOM or A-Frame dependency so it unit-tests under mocha.
 */

// Stamped on every clone the generators create, next to data-parent-component.
export const CLONE_INDEX_ATTR = 'data-clone-index';

// Generators whose clones can be detached one at a time. Striping and rail
// planes are surfaces, not objects, and stay whole-street (Convert to Shapes).
export const DETACHABLE_GENERATORS = [
  'street-generated-clones',
  'street-generated-stencil',
  'street-generated-pedestrians'
];

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

/**
 * Normalize a generator's `skip` value into a Set of slot indexes. A-Frame's
 * array type yields strings when parsed from an attribute ("1, 3" → ['1',
 * '3']) and whatever was passed when set programmatically, so both number
 * and string entries are accepted; anything that is not a non-negative
 * integer is ignored.
 */
export function parseSkipSlots(skip) {
  const slots = new Set();
  if (!Array.isArray(skip)) return slots;
  for (const entry of skip) {
    const index = toSlotIndex(entry);
    if (index !== null) slots.add(index);
  }
  return slots;
}

function toSlotIndex(value) {
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function sortedSlots(slots) {
  return Array.from(slots).sort((a, b) => a - b);
}

/** `skip` with `index` added: sorted, de-duplicated, numbers only. */
export function withSkippedSlot(skip, index) {
  const slots = parseSkipSlots(skip);
  const slot = toSlotIndex(index);
  if (slot !== null) slots.add(slot);
  return sortedSlots(slots);
}

/** `skip` with `index` removed: sorted, de-duplicated, numbers only. */
export function withoutSkippedSlot(skip, index) {
  const slots = parseSkipSlots(skip);
  const slot = toSlotIndex(index);
  if (slot !== null) slots.delete(slot);
  return sortedSlots(slots);
}

/**
 * Per-regeneration slot counter for a generator's createClone loop. Call
 * `next()` once per clone the generator WOULD create, in creation order, and
 * skip creating the element when it returns a skipped slot:
 *
 *   const slots = createSlotCounter(this.data.skip);
 *   ...
 *   const slot = slots.next();
 *   if (slot.skipped) return;
 *   clone.setAttribute(CLONE_INDEX_ATTR, slot.index);
 *
 * Generators must draw any seeded randomness for a clone BEFORE consulting
 * the counter, so a skipped slot consumes the same RNG calls it would have
 * and the clones after it keep their models, positions and facings.
 */
export function createSlotCounter(skip) {
  const skipped = parseSkipSlots(skip);
  let index = 0;
  return {
    next() {
      const slot = index++;
      return { index: slot, skipped: skipped.has(slot) };
    }
  };
}
