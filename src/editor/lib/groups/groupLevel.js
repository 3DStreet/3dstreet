// Levelling a group at the command layer. A user group always has scale 1 and
// no X/Z rotation (tested/group-pose.js levels data being loaded, pasted or
// created). This module handles a live entity BECOMING a group, or a group
// whose shown pose a command would change, by rewriting the command into a
// batch: the levelling is part of the same undo step and every write goes
// through the ordinary update command.

import {
  ROTATION_DEFAULT,
  SCALE_DEFAULT,
  conforms,
  levelledValue,
  parseVec3LikeAFrame,
  sameFacing
} from '@/tested/group-pose.js';
import {
  USER_GROUP_CLASS,
  classAfterUpdate,
  isUserGroup
} from './groupModel.js';

const DEFAULTS = { rotation: ROTATION_DEFAULT, scale: SCALE_DEFAULT };
const LEVELLED = ['rotation', 'scale'];

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

function levelTuple(entity, name, value) {
  return [
    'entityupdate',
    { entity, component: name, value, oldValue: undoValue(entity, name) }
  ];
}

function levelledString(name, value) {
  const levelled = levelledValue(
    name,
    parseVec3LikeAFrame(value, DEFAULTS[name])
  );
  return vec3String(levelled);
}

/**
 * What the AI is told was removed: {rotation?, scale?} holding the values
 * before (as {x, y, z}), and whether the write made the item a group. Null
 * when nothing was removed.
 */
function levelledRecord(removed, becameGroup) {
  return removed.rotation || removed.scale ? { ...removed, becameGroup } : null;
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
    for (const name of LEVELLED) {
      const value = mixin.getAttribute(name);
      if (value !== null && value !== undefined && value !== '') {
        pose[name] = copyVec3(parseVec3LikeAFrame(value, DEFAULTS[name]));
      }
    }
  }
  return pose;
}

// A class write that leaves the entity a group: level what it shows now.
function routeClassWrite(payload) {
  const { entity } = payload;
  if (!classAfterUpdate(payload).includes(USER_GROUP_CLASS)) return null;
  const tuples = [['entityupdate', payload]];
  const removed = {};
  for (const name of LEVELLED) {
    const shown = shownValue(entity, name);
    if (conforms(name, shown)) continue;
    tuples.push(levelTuple(entity, name, levelledString(name, shown)));
    removed[name] = shown;
  }
  if (tuples.length === 1) return null;
  return {
    cmdName: 'multi',
    payload: tuples,
    levelled: levelledRecord(removed, !isUserGroup(entity))
  };
}

// A mixin write on a group. What the group will show is its own value, else
// the incoming mixins' value, else the default; whatever of that does not
// conform is levelled, keeping its facing. When the incoming mixins cannot be
// read, both values are written explicitly, since an own value outranks a
// mixin's.
function routeMixinWrite(payload) {
  const { entity } = payload;
  if (!isUserGroup(entity)) return null;
  const incoming = payload.property ? null : readMixinPose(payload.value);
  const tuples = [['entityupdate', payload]];
  const removed = {};
  for (const name of LEVELLED) {
    const own = ownValue(entity, name);
    const shown =
      own ?? (incoming ? (incoming[name] ?? DEFAULTS[name]) : DEFAULTS[name]);
    const fits = conforms(name, shown);
    if (fits && (incoming || own !== null)) continue;
    tuples.push(levelTuple(entity, name, levelledString(name, shown)));
    if (!fits) {
      removed[name] = copyVec3(parseVec3LikeAFrame(shown, DEFAULTS[name]));
    }
  }
  if (tuples.length === 1) return null;
  return {
    cmdName: 'multi',
    payload: tuples,
    levelled: levelledRecord(removed, false)
  };
}

// Removing a group's scale or rotation while it has a mixin lets the mixin's
// value show. Left alone when that value conforms; otherwise the removal is
// written as the levelled value (or, when the mixins cannot be read, as the
// explicit default).
function routeRemoval(entity, component) {
  if (!LEVELLED.includes(component)) return null;
  if (!isUserGroup(entity)) return null;
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
      value: levelledString(component, supplied)
    },
    levelled: null
  };
}

// A class write on a generated street clone has already been routed into a
// detach; level the plain entity the detach creates.
function routeDetach(payload) {
  const cls = payload.components?.class;
  if (cls === undefined) return null;
  if (!classAfterUpdate({ value: cls }).includes(USER_GROUP_CLASS)) {
    return null;
  }
  const clone = payload.entity;
  const pose = payload.pose || {};
  const removed = {};
  const levelledPose = {};
  for (const name of LEVELLED) {
    const shown = copyVec3(
      parseVec3LikeAFrame(
        pose[name] !== undefined ? pose[name] : clone.getAttribute(name),
        DEFAULTS[name]
      )
    );
    if (!conforms(name, shown)) removed[name] = shown;
    // Written even when it conforms: the plain entity keeps the clone's
    // mixin, and an own value outranks the mixin's.
    levelledPose[name] = levelledString(name, shown);
  }
  return {
    cmdName: 'detachclone',
    payload: { ...payload, pose: { ...pose, ...levelledPose } },
    levelled: levelledRecord(removed, true)
  };
}

// A batch is rewritten member by member. Each member is a tuple
// [type, payload, callback]; a member that expands into a batch keeps its
// callback on its own (first) tuple. Only the first levelled member is
// reported: no caller sends a batch that levels more than one group.
function routeMulti(tuples) {
  if (!Array.isArray(tuples)) return null;
  let changed = false;
  let levelled = null;
  const out = [];
  for (const tuple of tuples) {
    const routed = routeGroupLevel(tuple?.[0], tuple?.[1]);
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
 * Rewrite a command that would leave a user group tilted or scaled, the same
 * shape as routeCloneEdit: null leaves the command alone, otherwise
 * {cmdName, payload, levelled}, where `levelled` is what was removed (see
 * levelledRecord), or null.
 *
 * Fires for a class write that leaves the entity a group, a mixin write on a
 * group, a removal of a group's scale or rotation while it has a mixin, a
 * detach whose new class makes a group, and any `multi` holding one of these.
 */
export function routeGroupLevel(cmdName, payload) {
  if (cmdName === 'multi') return routeMulti(payload);
  if (cmdName === 'detachclone') return routeDetach(payload);
  const entity = payload?.entity;
  if (!entity?.hasAttribute) return null;
  if (cmdName === 'componentremove') {
    const routed = routeRemoval(entity, payload.component);
    // Named as the removal it was asked for, not as the update it became.
    return routed && { ...routed, name: 'Remove Component' };
  }
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

const GROUP_RULE =
  'groups turn only about the vertical axis and are never scaled.';

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

function endingFor({ rotation, scale }) {
  const newY = rotation && levelledValue('rotation', rotation).y;
  const facing =
    rotation && !sameFacing(newY, rotation.y)
      ? `It faces the same way and its position is unchanged; its rotation is now 0 ${newY} 0.`
      : 'Its heading and position are unchanged.';
  return scale ? `${facing} The items in it keep their own sizes.` : facing;
}

/**
 * The sentence the AI is told when a command levelled a group, from a
 * levelledRecord. English on purpose, like every tool result: it is read by
 * the model, never shown in the UI.
 */
export function describeLevelledPose(levelled) {
  if (!levelled) return null;
  const subject = levelled.becameGroup
    ? 'The item is now a group, so its'
    : "This group's";
  return `${subject} ${removedParts(levelled)}; ${GROUP_RULE} ${endingFor(levelled)}`;
}
