import {
  CLONE_INDEX_ATTR,
  isDetachableGenerator,
  withSkippedSlot
} from '@/tested/clone-slots.js';

/**
 * Per-object detach from managed-street generators (#2011).
 *
 * A generated clone (`autocreated`, `data-no-transform`, regenerated on every
 * update) can't be moved on its own. Detaching it means: leave its slot empty
 * in the generator (`skip`) and put a plain entity the user owns where the
 * clone was — same mixin, same pose, under the same segment, with no
 * `autocreated` marker so it saves, moves, duplicates and deletes like any
 * hand-placed object. This module holds the pure/DOM-only pieces that
 * DetachCloneCommand, the sidebar Detach button and the viewport's
 * drag-to-detach share. Entry point: docs/per-object-detach.md.
 */

export const DETACHED_LAYER_PREFIX = 'Detached Model • ';

// Transform components the detached entity gets from the (optionally
// overridden) pose rather than copied from the clone.
const POSE_COMPONENTS = ['position', 'rotation', 'scale'];

// Copied from the clone onto the detached entity when the clone carries them
// as its own DOM attributes: a stencil's height override (geometry), its
// z-fighting offset (polygon-offset) and its batching lifecycle hook
// (batch-member). Anything mixin-provided is inherited via the mixin itself.
const COPIED_COMPONENTS = ['geometry', 'polygon-offset', 'batch-member'];

/**
 * Which generator slot a clone came from, or null when the entity is not a
 * detachable generated clone. Detachable means: an `autocreated` entity
 * stamped with a slot index by one of the slot-aware generators (clones,
 * stencil, pedestrians), whose parent still carries that generator.
 * @param {Element} entity
 * @returns {{ segmentEl: Element, componentName: string, index: number } | null}
 */
export function getCloneSlot(entity) {
  if (!entity?.classList?.contains('autocreated')) return null;
  const componentName = entity.getAttribute('data-parent-component');
  if (!isDetachableGenerator(componentName)) return null;
  const rawIndex = entity.getAttribute(CLONE_INDEX_ATTR);
  if (rawIndex === null || rawIndex === undefined || rawIndex === '') {
    return null;
  }
  const index = Number(rawIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  const segmentEl = entity.parentElement;
  if (!segmentEl?.components?.[componentName]) return null;
  return { segmentEl, componentName, index };
}

/** Whether the viewport gizmo / sidebar may offer to detach this entity. */
export function isDetachableClone(entity) {
  return getCloneSlot(entity) !== null;
}

/**
 * Find the live clone a generator created for a slot (after an undo has
 * restored the slot, for instance), or null.
 */
export function findCloneAtSlot(segmentEl, componentName, index) {
  if (!segmentEl) return null;
  for (const child of segmentEl.children) {
    if (
      child.getAttribute?.('data-parent-component') === componentName &&
      String(child.getAttribute(CLONE_INDEX_ATTR)) === String(index)
    ) {
      return child;
    }
  }
  return null;
}

// "x y z" from either A-Frame's parsed vec3 object or an already-stringified
// value (a caller may pass either; jsdom getAttribute also returns strings).
function vec3String(value) {
  if (value && typeof value === 'object') {
    const x = Number(value.x) || 0;
    const y = Number(value.y) || 0;
    const z = Number(value.z) || 0;
    return `${x} ${y} ${z}`;
  }
  if (typeof value === 'string') return value.trim();
  return null;
}

/**
 * Entity definition (the `entitycreate` command's payload shape, see
 * createEntity/objectToElement in entity.js) for the plain entity that
 * replaces `cloneEl`. `pose` may override any of position/rotation/scale as
 * "x y z" strings or {x, y, z} objects — the viewport passes the pose the
 * user dragged the clone to — and defaults to the clone's current pose.
 * `id` is left for the command to assign.
 */
export function buildDetachedDefinition(cloneEl, pose = {}) {
  const mixin = cloneEl.getAttribute('mixin') || '';
  const components = {};
  for (const name of POSE_COMPONENTS) {
    const value = vec3String(
      pose[name] !== undefined ? pose[name] : cloneEl.getAttribute(name)
    );
    // Scale is only worth writing when it is set: a clone never carries one,
    // and a unit scale is the default anyway.
    if (value === null) continue;
    if (name === 'scale' && pose.scale === undefined) continue;
    components[name] = value;
  }
  for (const name of COPIED_COMPONENTS) {
    if (!cloneEl.hasAttribute(name)) continue;
    const value = cloneEl.getDOMAttribute
      ? cloneEl.getDOMAttribute(name)
      : cloneEl.getAttribute(name);
    components[name] = value === null || value === undefined ? '' : value;
  }
  const definition = {
    parentEl: cloneEl.parentElement,
    'data-layer-name': DETACHED_LAYER_PREFIX + mixin,
    components
  };
  if (mixin) definition.mixin = mixin;
  return definition;
}

/**
 * The two undoable steps a detach is made of, as `[type, payload]` tuples for
 * MultiCommand: append the clone's slot to its generator's `skip` (the
 * generator regenerates minus that slot, removing the clone), then create the
 * plain entity in its place. Undo runs them in reverse: the plain entity is
 * removed and the slot restored, so the generator puts the clone back exactly
 * where it was. Throws when the entity is not a detachable clone.
 */
export function buildDetachCommands(cloneEl, pose = {}) {
  const slot = getCloneSlot(cloneEl);
  if (!slot) {
    throw new Error('Entity is not a detachable generated clone');
  }
  const { segmentEl, componentName, index } = slot;
  const currentSkip =
    segmentEl.getAttribute(componentName)?.skip ??
    segmentEl.components[componentName]?.data?.skip ??
    [];
  return {
    slot,
    commands: [
      [
        'entityupdate',
        {
          entity: segmentEl,
          component: componentName,
          property: 'skip',
          value: withSkippedSlot(currentSkip, index),
          // The generator's segment is not what the user is editing: the
          // create step below selects the detached entity.
          noSelectEntity: true
        }
      ],
      ['entitycreate', buildDetachedDefinition(cloneEl, pose)]
    ]
  };
}

/**
 * Pose of a live entity as the "x y z" strings the transform commands use —
 * read from object3D so it reflects a gizmo drag in progress (getAttribute
 * returns the same live values, but this makes the source explicit).
 */
export function poseFromObject3D(object3D) {
  const deg = (rad) => (rad * 180) / Math.PI;
  const round = (n) => parseFloat(n.toFixed(3));
  const p = object3D.position;
  const r = object3D.rotation;
  const s = object3D.scale;
  return {
    position: `${round(p.x)} ${round(p.y)} ${round(p.z)}`,
    rotation: `${round(deg(r.x))} ${round(deg(r.y))} ${round(deg(r.z))}`,
    scale: `${round(s.x)} ${round(s.y)} ${round(s.z)}`
  };
}
