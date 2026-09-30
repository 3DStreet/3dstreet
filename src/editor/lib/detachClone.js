import {
  CLONE_INDEX_ATTR,
  CLONE_KEY_ATTR,
  isDetachableGenerator,
  parseHole,
  withSkippedHole
} from '@/tested/clone-slots.js';
import { getEditableEntity } from './commands/llmToolGuards.js';

/**
 * Per-object detach from managed-street generators (#2011).
 *
 * A generated clone (`autocreated`, `data-no-transform`, regenerated on every
 * update) can't be moved on its own. Detaching it means: leave a hole at its
 * straight-space placement in the generator (`skip`) and put a plain entity
 * the user owns where the clone was — same mixin, same pose, under the same segment, with no
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
 * stamped with a slot index and a placement key by one of the slot-aware
 * generators (clones, stencil, pedestrians), whose parent still carries that
 * generator. `key` is the "x z" straight-space placement the hole is keyed
 * by; `index` is the creation-order number used to address the clone.
 * @param {Element} entity
 * @returns {{ segmentEl: Element, componentName: string, index: number, key: string } | null}
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
  const key = entity.getAttribute(CLONE_KEY_ATTR);
  if (!parseHole(key)) return null;
  const segmentEl = entity.parentElement;
  if (!segmentEl?.components?.[componentName]) return null;
  return { segmentEl, componentName, index, key };
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

/**
 * Slot indexes of the clones a generator currently has in the DOM, sorted.
 * Detached (skipped) slots are absent. Used to tell the AI tool caller which
 * slots it can name.
 */
export function listCloneSlots(segmentEl, componentName) {
  const slots = [];
  if (!segmentEl) return slots;
  for (const child of segmentEl.children) {
    if (child.getAttribute?.('data-parent-component') !== componentName) {
      continue;
    }
    const index = Number(child.getAttribute(CLONE_INDEX_ATTR));
    if (Number.isInteger(index) && index >= 0) slots.push(index);
  }
  return slots.sort((a, b) => a - b);
}

/**
 * Resolve the AI tool's arguments (`detachClone` in the LLM registry) to the
 * `{ entity, pose }` payload DetachCloneCommand takes. Generated clones carry
 * no id and are left out of the scene state the model sees (they are
 * `autocreated`), so the tool addresses one by its segment, generator and
 * slot — all three visible in the scene state — or, with none of the three
 * given, takes the currently selected clone. Throws a readable error the
 * model can correct from: the generators the segment has, the live slots of
 * the generator, or that the selection is not a detachable clone.
 */
export function resolveDetachToolArgs(args = {}, { selectedEntity } = {}) {
  const { segmentId, component, slotIndex, position, rotation } = args;
  // Function-calling models emit null for optional fields they mean to omit.
  const addressed = segmentId != null || component != null || slotIndex != null;
  let cloneEl;
  if (addressed) {
    if (!segmentId || !component || slotIndex == null) {
      throw new Error(
        'segmentId, component and slotIndex must be given together (omit all three to detach the selected clone)'
      );
    }
    const segmentEl = getEditableEntity(segmentId, { role: 'segment' });
    if (!segmentEl.components?.[component]) {
      const generators = Object.keys(segmentEl.components || {}).filter(
        isDetachableGenerator
      );
      throw new Error(
        `Entity ${segmentId} has no '${component}' component. Detachable generators on it: ${generators.join(', ') || '(none)'}`
      );
    }
    const index = Number(slotIndex);
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(
        `slotIndex must be a non-negative integer, got ${slotIndex}`
      );
    }
    cloneEl = findCloneAtSlot(segmentEl, component, index);
    if (!cloneEl) {
      const live = listCloneSlots(segmentEl, component);
      throw new Error(
        `No clone at slot ${index} of ${component} on ${segmentId} (already detached, or beyond the last slot). Live slots: ${live.join(', ') || '(none)'}`
      );
    }
  } else {
    cloneEl = selectedEntity;
    if (!cloneEl) {
      throw new Error(
        'Nothing is selected: pass segmentId, component and slotIndex to name the clone'
      );
    }
  }
  if (!isDetachableClone(cloneEl)) {
    throw new Error(
      addressed
        ? `The clone at slot ${slotIndex} of ${component} is not detachable`
        : 'The selected entity is not a generated clone of a slot-aware generator (clones, stencil, pedestrians)'
    );
  }
  const pose = {};
  if (position != null) pose.position = requireVec3Arg('position', position);
  if (rotation != null) pose.rotation = requireVec3Arg('rotation', rotation);
  return { entity: cloneEl, pose };
}

// An "x y z" string of three finite numbers, or a readable tool error: a
// malformed pose would otherwise land as NaN on the detached entity while
// the tool still reports success.
function requireVec3Arg(name, value) {
  const parts = String(value).trim().split(/\s+/);
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(Number(p)))) {
    throw new Error(
      `${name} must be "x y z" numbers, got ${JSON.stringify(value)}`
    );
  }
  return parts.map(Number).join(' ');
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
 * createEntity/objectToElement in entity.jsx) for the plain entity that
 * replaces `cloneEl`. `pose` may override any of position/rotation/scale as
 * "x y z" strings or {x, y, z} objects — the viewport passes the pose the
 * user dragged the clone to — and defaults to the clone's current pose.
 * `id` is left for the command to assign.
 */
export function buildDetachedDefinition(cloneEl, pose = {}, extra = {}) {
  const mixin =
    extra.mixin !== undefined
      ? extra.mixin
      : cloneEl.getAttribute('mixin') || '';
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
  // Any other edit that triggered the detach (a component the panel set)
  // lands on the plain entity as part of the same create.
  Object.assign(components, extra.components || {});
  const definition = {
    parentEl: cloneEl.parentElement,
    'data-layer-name': DETACHED_LAYER_PREFIX + mixin,
    components
  };
  if (mixin) definition.mixin = mixin;
  return definition;
}

// The plain entity each detached clone element became, so an edit that keeps
// targeting the (now removed) clone — the properties panel's number fields
// scrub with a command per pointer move, and the first one detached the
// clone — lands on its replacement instead of no-oping.
const detachedFor = new WeakMap();

export function rememberDetached(cloneEl, detachedEl) {
  if (cloneEl && detachedEl) detachedFor.set(cloneEl, detachedEl);
}

export function forgetDetached(cloneEl) {
  if (cloneEl) detachedFor.delete(cloneEl);
}

const POSE_COMPONENT_SET = new Set(POSE_COMPONENTS);

// A vec3 in either of the shapes a pose value takes: the {x, y, z} object
// A-Frame hands back (or the panel sends) or the "x y z" string a plain DOM
// element / the AI chat carries.
function toVec3(raw) {
  if (raw && typeof raw === 'object') {
    return { x: raw.x, y: raw.y, z: raw.z };
  }
  if (typeof raw === 'string') {
    const [x, y, z] = raw.trim().split(/\s+/).map(Number);
    return { x: x || 0, y: y || 0, z: z || 0 };
  }
  return { x: 0, y: 0, z: 0 };
}

// One axis of a vec3 edit merged into the clone's current value.
function mergeAxis(cloneEl, component, property, value) {
  return {
    ...toVec3(cloneEl.getAttribute(component)),
    [property]: Number(value)
  };
}

/**
 * The command-layer rule that makes a generated clone an editable object
 * whose first edit detaches it (#2011). Inspector.execute calls this before
 * building a command; a non-null result replaces the command name and
 * payload. Every door goes through here — properties panel, model dropdown,
 * keyboard, layers panel, AI tools, the easy gizmo's one-shot commit — so
 * none of them needs to know about clones. The stock TransformControls gizmo
 * is the one exception: it defers its commit to mouseUp and calls detachclone
 * itself, because it would otherwise record a command per drag frame and
 * re-attaching the gizmo to a new object mid-drag would break the drag.
 *
 *   entityupdate  → detachclone carrying the edit (pose, mixin or any
 *                   other component) so it is one undo step
 *   entityremove  → detachclone { remove: true }: the spot stays empty
 *   entityclone   → entitycreate of a plain copy; the clone stays generated
 *   multi         → each member routed as above; every member aimed at the
 *                   same clone folds into ONE detachclone (a position and a
 *                   rotation tuple from one gizmo release are one detach at
 *                   the merged pose, not two). A batch that folds to a
 *                   single command is returned as that command, so it keeps
 *                   its own name and toast. MultiCommand builds its members
 *                   directly, not through Inspector.execute, so a batch not
 *                   unwrapped here would bypass the rule entirely — which is
 *                   how the easy gizmo's drag silently moved a clone in place.
 *
 * An update aimed at a clone element that was already detached (removed
 * from the DOM by its generator) is re-aimed at the plain entity it became.
 */
export function routeCloneEdit(cmdName, payload) {
  if (cmdName === 'multi') return routeMultiCloneEdit(payload);

  // entityremove / entityclone take the entity itself as the payload.
  const entity = payload?.nodeType === 1 ? payload : payload?.entity;
  if (!entity) return null;

  // The generator removed the clone element (it was detached): re-aim.
  const replacement = detachedFor.get(entity);
  if (replacement && !entity.parentElement) {
    if (!replacement.isConnected) return null;
    if (cmdName === 'entityupdate') {
      return { cmdName, payload: { ...payload, entity: replacement } };
    }
    if (cmdName === 'entityremove' || cmdName === 'entityclone') {
      return { cmdName, payload: replacement };
    }
    return null;
  }

  if (!isDetachableClone(entity)) return null;

  if (cmdName === 'entityupdate') {
    const { component, property, value } = payload;
    const pose = {};
    const extra = {};
    if (POSE_COMPONENT_SET.has(component)) {
      pose[component] = property
        ? mergeAxis(entity, component, property, value)
        : value;
    } else if (component === 'mixin') {
      extra.mixin = property ? undefined : String(value ?? '');
      if (extra.mixin === undefined) return null;
    } else if (component) {
      extra.components = {
        [component]: property ? { [property]: value } : value
      };
    } else {
      return null;
    }
    return { cmdName: 'detachclone', payload: { entity, pose, ...extra } };
  }
  if (cmdName === 'entityremove') {
    return { cmdName: 'detachclone', payload: { entity, remove: true } };
  }
  if (cmdName === 'entityclone') {
    return {
      cmdName: 'entitycreate',
      payload: buildDetachedDefinition(entity)
    };
  }
  return null;
}

/**
 * The `multi` branch of routeCloneEdit: `tuples` is MultiCommand's list of
 * `[type, payload, callback?]`. Returns null when no member needed routing
 * (the batch runs untouched), otherwise the routed batch — or, when it
 * folds to one command, that command on its own.
 */
function routeMultiCloneEdit(tuples) {
  if (!Array.isArray(tuples)) return null;
  const out = [];
  // clone element → index in `out` of the detachclone tuple it folded into
  const detachAt = new Map();
  let routedAny = false;
  for (const tuple of tuples) {
    if (!Array.isArray(tuple)) {
      out.push(tuple);
      continue;
    }
    const [type, payload, ...rest] = tuple;
    const routed = routeCloneEdit(type, payload);
    if (!routed) {
      out.push(tuple);
      continue;
    }
    routedAny = true;
    if (routed.cmdName !== 'detachclone') {
      out.push([routed.cmdName, routed.payload, ...rest]);
      continue;
    }
    const cloneEl = routed.payload.entity;
    const at = detachAt.get(cloneEl);
    if (at === undefined) {
      detachAt.set(cloneEl, out.length);
      out.push(['detachclone', routed.payload, ...rest]);
    } else {
      out[at][1] = mergeDetachPayload(
        out[at][1],
        routed.payload,
        POSE_COMPONENT_SET.has(payload?.component) ? payload.property : null
      );
    }
  }
  if (!routedAny) return null;
  if (out.length === 1 && Array.isArray(out[0])) {
    const [cmdName, payload, callback] = out[0];
    return callback ? { cmdName, payload, callback } : { cmdName, payload };
  }
  return { cmdName: 'multi', payload: out };
}

/**
 * Two detachclone payloads for the same clone, later edits winning. `axis`
 * names the one axis the later member edited, when it was a per-axis edit:
 * such a member builds its vector from the clone's CURRENT attribute
 * (mergeAxis), which knows nothing of the members before it, so only that
 * axis is taken from it and the rest keeps what earlier members set.
 */
function mergeDetachPayload(a, b, axis = null) {
  const merged = { ...a, ...b };
  if (a.pose || b.pose) {
    merged.pose = { ...a.pose };
    for (const [component, value] of Object.entries(b.pose ?? {})) {
      const prev = merged.pose[component];
      merged.pose[component] =
        axis && prev !== undefined
          ? { ...toVec3(prev), [axis]: value[axis] }
          : value;
    }
  }
  if (a.components || b.components) {
    merged.components = { ...a.components };
    for (const [name, value] of Object.entries(b.components ?? {})) {
      const prev = merged.components[name];
      merged.components[name] =
        prev && typeof prev === 'object' && value && typeof value === 'object'
          ? { ...prev, ...value }
          : value;
    }
  }
  if (a.remove || b.remove) merged.remove = true;
  return merged;
}

/**
 * The two undoable steps a detach is made of, as `[type, payload]` tuples for
 * MultiCommand: append the clone's placement key to its generator's `skip`
 * (the generator regenerates minus that placement, removing the clone), then
 * create the plain entity in its place. Undo runs them in reverse: the plain
 * entity is removed and the hole restored, so the generator puts the clone
 * back exactly where it was. Throws when the entity is not a detachable
 * clone.
 */
export function buildDetachCommands(cloneEl, pose = {}, extra = {}) {
  const slot = getCloneSlot(cloneEl);
  if (!slot) {
    throw new Error('Entity is not a detachable generated clone');
  }
  const { segmentEl, componentName, key } = slot;
  const currentSkip =
    segmentEl.getAttribute(componentName)?.skip ??
    segmentEl.components[componentName]?.data?.skip ??
    [];
  const commands = [
    [
      'entityupdate',
      {
        entity: segmentEl,
        component: componentName,
        property: 'skip',
        value: withSkippedHole(currentSkip, key),
        // The generator's segment is not what the user is editing: the
        // create step below selects the detached entity.
        noSelectEntity: true
      }
    ]
  ];
  // remove: the hole alone — "delete this one object" leaves its spot empty.
  if (!extra.remove) {
    commands.push([
      'entitycreate',
      buildDetachedDefinition(cloneEl, pose, extra)
    ]);
  }
  return { slot, commands };
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
