// Keeping a constrained item within its kind's limits at the command layer.
// An item whose kind declares transform limits (tested/transform-kinds.js: a
// user group, a managed street or intersection, a shape) always meets them
// (tested/group-pose.js conforms data being loaded, pasted or created). This
// module handles a live entity BECOMING such a kind, or one whose shown pose a
// mixin or removal would take outside its limits, by rewriting the command
// into a batch: bringing it within its limits is part of the same undo step,
// and every write goes through the ordinary update command. A direct scale or
// tilt write is not rewritten; the guard refuses it.

import {
  ROTATION_DEFAULT,
  SCALE_DEFAULT,
  conforms,
  levelledValue,
  parseVec3LikeAFrame,
  sameFacing
} from '@/tested/group-pose.js';
import { classAfterUpdate } from './groupModel.js';
import {
  KINDS,
  POSE_COMPONENTS,
  isYawOnly,
  kindByComponent,
  kindById,
  kindsOf,
  kindsOfEntity,
  limitedComponents
} from '@/tested/transform-kinds.js';

const DEFAULTS = { rotation: ROTATION_DEFAULT, scale: SCALE_DEFAULT };

function vec3String(v) {
  return `${v.x} ${v.y} ${v.z}`;
}

function copyVec3(v) {
  return { x: v.x, y: v.y, z: v.z };
}

// A copy of the value an entity shows now. A-Frame hands back a live object
// (the object3D's scale, a reused rotation object), so it must be copied
// before anything else writes.
function shownValue(entity, name) {
  return copyVec3(
    parseVec3LikeAFrame(entity.getAttribute(name), DEFAULTS[name])
  );
}

// A copy of the entity's own value, or null when it has none. A-Frame
// recomputes into the same object, so it is cloned.
function ownValue(entity, name) {
  if (!entity.hasAttribute(name)) return null;
  const own = entity.getDOMAttribute
    ? entity.getDOMAttribute(name)
    : entity.getAttribute(name);
  return own === null || own === undefined ? null : structuredClone(own);
}

function isDefault(name, v) {
  return conforms(name, v) && (name === 'scale' || sameFacing(v.y, 0));
}

// What undo writes back: the own value when there is one; otherwise the value
// a mixin supplied, as an own value (A-Frame does not bring a mixin's value
// back after a removal); null — remove the attribute — only when what shows
// is the plain default.
function undoValue(entity, name) {
  const own = ownValue(entity, name);
  if (own !== null) return own;
  const shown = shownValue(entity, name);
  return isDefault(name, shown) ? null : shown;
}

function conformTuple(entity, name, value) {
  return [
    'entityupdate',
    { entity, component: name, value, oldValue: undoValue(entity, name) }
  ];
}

// The value within limits for `name`, as an "x y z" string: level for a
// rotation (keeping its facing), unit for a scale.
function conformedString(name, value) {
  const conformed = levelledValue(
    name,
    parseVec3LikeAFrame(value, DEFAULTS[name])
  );
  return vec3String(conformed);
}

/**
 * What the AI is told was removed: {rotation?, scale?} holding the values
 * before (as {x, y, z}), whether the write made the item that kind
 * (`becameKind`), and the id of the kind whose limits applied. Null when
 * nothing was removed.
 */
function levelledRecord(removed, becameKind, kind) {
  return removed.rotation || removed.scale
    ? { ...removed, becameKind, kind: kind.id }
    : null;
}

// The kinds in `a` or `b`, in table order.
function unionOfKinds(a, b) {
  return KINDS.filter((kind) => a.includes(kind) || b.includes(kind));
}

/**
 * The rotation and scale a `mixin` attribute's mixins supply, read from the
 * <a-mixin> elements in the document (a later mixin wins, as in A-Frame), or
 * null when one of them cannot be found. A component no mixin sets is absent.
 */
export function readMixinPose(mixinAttribute) {
  const pose = {};
  for (const id of String(mixinAttribute ?? '').split(/\s+/)) {
    if (!id) continue;
    const mixin = document.getElementById(id);
    if (mixin?.tagName !== 'A-MIXIN') return null;
    for (const name of POSE_COMPONENTS) {
      const value = mixin.getAttribute(name);
      if (value !== null && value !== undefined && value !== '') {
        pose[name] = copyVec3(parseVec3LikeAFrame(value, DEFAULTS[name]));
      }
    }
  }
  return pose;
}

// The tuples that bring what `entity` shows now within the limits of
// `kinds`, and the values they remove.
function conformingTuples(entity, kinds) {
  const tuples = [];
  const removed = {};
  for (const name of limitedComponents(kinds)) {
    const shown = shownValue(entity, name);
    if (conforms(name, shown)) continue;
    tuples.push(conformTuple(entity, name, conformedString(name, shown)));
    removed[name] = shown;
  }
  return { tuples, removed };
}

// A class write that leaves the entity a kind made by a class (a group): bring
// what it shows now within the limits of every kind it has after the write.
// Only such a write can take an entity outside limits; a kind made by a
// component is already within its own.
function routeClassWrite(payload) {
  const { entity } = payload;
  const byClass = kindsOf({ classes: classAfterUpdate(payload) });
  if (byClass.length === 0) return null;
  const before = kindsOfEntity(entity);
  const kinds = unionOfKinds(
    byClass,
    before.filter((kind) => kind.component)
  );
  const { tuples, removed } = conformingTuples(entity, kinds);
  if (tuples.length === 0) return null;
  return {
    cmdName: 'multi',
    payload: [['entityupdate', payload], ...tuples],
    levelled: levelledRecord(removed, !before.includes(byClass[0]), byClass[0])
  };
}

// The kind a write gives its entity, or null: adding a kind's component, or
// updating one with a value (an update creates the component it names).
function kindWritten(cmdName, payload) {
  const kind = kindByComponent(payload.component);
  if (!kind) return null;
  if (cmdName === 'componentadd') return kind;
  if (cmdName !== 'entityupdate') return null;
  return payload.value === null || payload.value === undefined ? null : kind;
}

// A write that makes the entity a constrained kind, or updates the component
// of one: bringing it within its limits runs first, so the component starts on
// an entity already within them. The batch keeps the name of the command asked
// for.
function routeKindWrite(cmdName, payload, kind) {
  const { entity } = payload;
  const before = kindsOfEntity(entity);
  const { tuples, removed } = conformingTuples(
    entity,
    unionOfKinds(before, [kind])
  );
  if (tuples.length === 0) return null;
  return {
    cmdName: 'multi',
    payload: [...tuples, [cmdName, payload]],
    levelled: levelledRecord(removed, !before.includes(kind), kind),
    name: cmdName === 'componentadd' ? 'Add Component' : 'Update Entity'
  };
}

// A mixin write on a constrained kind. What the item will show is its own
// value, else the incoming mixins' value, else the default; whatever of that
// does not conform is brought within limits, keeping its facing. When the
// incoming mixins cannot be read, the values are written explicitly, since an
// own value outranks a mixin's.
function routeMixinWrite(payload) {
  const { entity } = payload;
  const kinds = kindsOfEntity(entity);
  if (kinds.length === 0) return null;
  const incoming = payload.property ? null : readMixinPose(payload.value);
  const tuples = [['entityupdate', payload]];
  const removed = {};
  for (const name of limitedComponents(kinds)) {
    const own = ownValue(entity, name);
    const shown =
      own ?? (incoming ? (incoming[name] ?? DEFAULTS[name]) : DEFAULTS[name]);
    const fits = conforms(name, shown);
    if (fits && (incoming || own !== null)) continue;
    tuples.push(conformTuple(entity, name, conformedString(name, shown)));
    if (!fits) {
      removed[name] = copyVec3(parseVec3LikeAFrame(shown, DEFAULTS[name]));
    }
  }
  if (tuples.length === 1) return null;
  return {
    cmdName: 'multi',
    payload: tuples,
    levelled: levelledRecord(removed, false, kinds[0])
  };
}

// Removing a constrained item's scale or rotation while it has a mixin lets
// the mixin's value show. Left alone when its kind does not limit that
// component or the value conforms; otherwise the removal is written as the
// value within limits (or, when the mixins cannot be read, as the explicit
// default).
function routeRemoval(entity, component) {
  if (!limitedComponents(kindsOfEntity(entity)).includes(component)) {
    return null;
  }
  const mixinAttribute = String(entity.getAttribute('mixin') || '').trim();
  if (!mixinAttribute) return null;
  const pose = readMixinPose(mixinAttribute);
  const supplied = pose ? pose[component] : DEFAULTS[component];
  if (pose && (supplied === undefined || conforms(component, supplied))) {
    return null;
  }
  return {
    cmdName: 'entityupdate',
    payload: {
      entity,
      component,
      value: conformedString(component, supplied)
    },
    levelled: null
  };
}

// The kinds a detach's components give the plain entity it creates.
function kindsOfDetach(components) {
  if (!components) return [];
  const cls = components.class;
  return kindsOf({
    classes: cls === undefined ? [] : classAfterUpdate({ value: cls }),
    components
  });
}

// An edit on a generated street clone that makes it a constrained kind (a
// class that makes a group, or a kind's component) has already been routed
// into a detach; bring the plain entity the detach creates within that kind's
// limits, for the components it limits only.
function routeDetach(payload) {
  const kinds = kindsOfDetach(payload.components);
  if (kinds.length === 0) return null;
  const clone = payload.entity;
  const pose = payload.pose || {};
  const removed = {};
  const conformedPose = {};
  for (const name of limitedComponents(kinds)) {
    const shown = copyVec3(
      parseVec3LikeAFrame(
        pose[name] !== undefined ? pose[name] : clone.getAttribute(name),
        DEFAULTS[name]
      )
    );
    if (!conforms(name, shown)) removed[name] = shown;
    // Written even when it conforms: the plain entity keeps the clone's
    // mixin, and an own value outranks the mixin's.
    conformedPose[name] = conformedString(name, shown);
  }
  return {
    cmdName: 'detachclone',
    payload: { ...payload, pose: { ...pose, ...conformedPose } },
    levelled: levelledRecord(removed, true, kinds[0])
  };
}

// A batch is rewritten member by member. Each member is a tuple
// [type, payload, callback]; a member that expands into a batch keeps its
// callback on its own (first) tuple. Only the first member's removal is
// reported: the record is for an AI tool result, and no tool sends a batch
// that changes more than one item. The one batch that can (the managed
// intersection's settle pass, one length update per joined street) runs from
// a timer, outside any tool call.
function routeMulti(tuples) {
  if (!Array.isArray(tuples)) return null;
  let changed = false;
  let levelled = null;
  const out = [];
  for (const tuple of tuples) {
    const routed = routeKindLimits(tuple?.[0], tuple?.[1]);
    if (!routed) {
      out.push(tuple);
      continue;
    }
    changed = true;
    levelled ??= routed.levelled;
    if (routed.cmdName === 'multi') {
      const [first, ...rest] = routed.payload;
      out.push([first[0], first[1], tuple[2]], ...rest);
    } else {
      out.push([routed.cmdName, routed.payload, tuple[2]]);
    }
  }
  return changed ? { cmdName: 'multi', payload: out, levelled } : null;
}

/**
 * Rewrite a command that would leave a constrained item outside its kind's
 * limits, the same shape as routeCloneEdit: null leaves the command alone,
 * otherwise {cmdName, payload, levelled, name?}, where `levelled` is what was
 * removed (see levelledRecord), or null, and `name` the history label when the
 * rewrite should keep the name of the command asked for.
 *
 * Fires for a class write that leaves the entity a group, a write that adds or
 * updates a kind's component, a mixin write on a kind, a removal of the scale
 * or rotation a kind limits while it has a mixin, a detach that makes a kind,
 * and any `multi` holding one of these.
 */
export function routeKindLimits(cmdName, payload) {
  if (cmdName === 'multi') return routeMulti(payload);
  if (cmdName === 'detachclone') return routeDetach(payload);
  const entity = payload?.entity;
  if (!entity?.hasAttribute) return null;
  if (cmdName === 'componentremove') {
    const routed = routeRemoval(entity, payload.component);
    // Named as the removal it was asked for, not as the update it became.
    return routed && { ...routed, name: 'Remove Component' };
  }
  const kind = kindWritten(cmdName, payload);
  if (kind) return routeKindWrite(cmdName, payload, kind);
  if (cmdName !== 'entityupdate') return null;
  if (payload.component === 'class') return routeClassWrite(payload);
  if (payload.component === 'mixin') return routeMixinWrite(payload);
  if (
    !payload.property &&
    (payload.value === null || payload.value === undefined)
  ) {
    return routeRemoval(entity, payload.component);
  }
  return null;
}

// A value read back from A-Frame carries float noise (10 comes back as
// 10.000000000000002); the sentence shows it to six decimals.
const tidy = (n) => Math.round(n * 1e6) / 1e6;

function removedParts({ rotation, scale }) {
  const tilt =
    rotation && `tilt (rotation x ${tidy(rotation.x)}, z ${tidy(rotation.z)})`;
  const scalePart =
    scale && `scale (${tidy(scale.x)} ${tidy(scale.y)} ${tidy(scale.z)})`;
  return tilt && scalePart
    ? `${tilt} and ${scalePart} were removed`
    : `${tilt || scalePart} was removed`;
}

function ruleFor(kind) {
  return isYawOnly(kind)
    ? `${kind.plural} turn only about the vertical axis and are never scaled.`
    : `${kind.plural} are never scaled.`;
}

function endingFor({ rotation, scale }, kind) {
  const newY = rotation && levelledValue('rotation', rotation).y;
  const unchanged = isYawOnly(kind)
    ? 'Its heading and position are unchanged.'
    : 'Its rotation and position are unchanged.';
  const facing =
    rotation && !sameFacing(newY, rotation.y)
      ? `It faces the same way and its position is unchanged; its rotation is now 0 ${tidy(newY)} 0.`
      : unchanged;
  // A group's members keep their own scale; a street's generated children
  // are drawn in its frame and follow it.
  return scale && kind.holdsMembers
    ? `${facing} The items in it keep their own sizes.`
    : facing;
}

/**
 * The sentence the AI is told when a command brought a constrained item within
 * its kind's limits, from a levelledRecord. English on purpose, like every
 * tool result: it is read by the model, never shown in the UI.
 */
export function describeLevelledPose(levelled) {
  if (!levelled) return null;
  const kind = kindById(levelled.kind);
  const subject = levelled.becameKind
    ? `The item is now a ${kind.label}, so its`
    : `This ${kind.label}'s`;
  return (
    `${subject} ${removedParts(levelled)}; ` +
    `${ruleFor(kind)} ${endingFor(levelled, kind)}`
  );
}
