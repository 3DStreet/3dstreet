// Keeping a group level at the command layer. A user group always has scale 1
// and no X/Z rotation; data being loaded, pasted or created is levelled by
// tested/migrate-group-pose.js. This module handles a live entity BECOMING a
// group (a class or mixin write), which it does by rewriting the command into
// a batch, so the levelling is part of the same undo step and every write
// goes through the ordinary update command.

import {
  POSE_EPS,
  isLevel,
  isUnitScale,
  levelledRotation,
  parseVec3LikeAFrame
} from '../../../tested/migrate-group-pose.js';
import { USER_GROUP_CLASS, isUserGroup } from './groupModel.js';

const ROTATION_DEFAULT = { x: 0, y: 0, z: 0 };
const SCALE_DEFAULT = { x: 1, y: 1, z: 1 };
const DEFAULTS = { rotation: ROTATION_DEFAULT, scale: SCALE_DEFAULT };
const LEVEL_VALUE = { rotation: '0 0 0', scale: '1 1 1' };

/**
 * The class list an `entityupdate` of `class` leaves on the entity, as the
 * editor's updateEntity and the DOM apply it: a null value removes the
 * attribute; any other value is stringified (an array becomes "a,b", one
 * token) and split on whitespace. With a `property`, the DOM receives the
 * property as the value.
 */
export function classAfterUpdate(payload) {
  const raw = payload.property ? payload.property : payload.value;
  if (payload.value === null || payload.value === undefined) return [];
  return String(raw).split(/\s+/).filter(Boolean);
}

function vec3String(v) {
  return `${v.x} ${v.y} ${v.z}`;
}

// A copy of the value an entity shows now. A-Frame hands back a live object
// (the object3D's scale, a reused rotation object), so it must be copied
// before anything else writes.
function effectiveValue(entity, name) {
  const v = parseVec3LikeAFrame(entity.getAttribute(name), DEFAULTS[name]);
  return { x: v.x, y: v.y, z: v.z };
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
  return name === 'scale'
    ? isUnitScale(v)
    : isLevel(v) && Math.abs(v.y) <= POSE_EPS;
}

// What undo writes back: the own value when there is one; otherwise the value
// a mixin supplied, as an own value (A-Frame does not bring a mixin's value
// back after a removal); null — remove the attribute — only when what shows
// is the plain default.
function undoValue(entity, name) {
  const own = ownValue(entity, name);
  if (own !== null) return own;
  const effective = effectiveValue(entity, name);
  return isDefault(name, effective) ? null : effective;
}

function hasMixin(entity) {
  return !!String(entity.getAttribute('mixin') || '').trim();
}

function levelTuple(entity, name, value) {
  return [
    'entityupdate',
    { entity, component: name, value, oldValue: undoValue(entity, name) }
  ];
}

// A class write that leaves the entity a group: level what it shows now.
function routeClassWrite(payload) {
  const { entity } = payload;
  if (!classAfterUpdate(payload).includes(USER_GROUP_CLASS)) return null;
  const rotation = effectiveValue(entity, 'rotation');
  const scale = effectiveValue(entity, 'scale');
  const tuples = [['entityupdate', payload]];
  const levelled = { entityId: entity.id };
  if (!isLevel(rotation)) {
    tuples.push(
      levelTuple(entity, 'rotation', vec3String(levelledRotation(rotation)))
    );
    levelled.rotation = rotation;
  }
  if (!isUnitScale(scale)) {
    tuples.push(levelTuple(entity, 'scale', '1 1 1'));
    levelled.scale = scale;
  }
  if (tuples.length === 1) return null;
  return { cmdName: 'multi', payload: tuples, levelled };
}

// A mixin write on a group: the incoming mixin's scale or tilt cannot be read
// before it is applied, and an own value outranks it, so the group always
// gets explicit level values.
function routeMixinWrite(payload) {
  const { entity } = payload;
  if (!isUserGroup(entity)) return null;
  const ownRotation = ownValue(entity, 'rotation');
  const ownScale = ownValue(entity, 'scale');
  const levelled = { entityId: entity.id };
  if (ownRotation !== null && !isLevel(ownRotation)) {
    levelled.rotation = effectiveValue(entity, 'rotation');
  }
  if (ownScale !== null && !isUnitScale(ownScale)) {
    levelled.scale = effectiveValue(entity, 'scale');
  }
  const rotation =
    ownRotation === null
      ? LEVEL_VALUE.rotation
      : vec3String(
          levelledRotation(parseVec3LikeAFrame(ownRotation, ROTATION_DEFAULT))
        );
  return {
    cmdName: 'multi',
    payload: [
      ['entityupdate', payload],
      levelTuple(entity, 'rotation', rotation),
      levelTuple(entity, 'scale', LEVEL_VALUE.scale)
    ],
    levelled: levelled.rotation || levelled.scale ? levelled : null
  };
}

// Removing a group's scale or rotation while it has a mixin would let the
// mixin's value show; make the reset explicit instead.
function routeRemoval(entity, component) {
  if (!(component in LEVEL_VALUE)) return null;
  if (!isUserGroup(entity) || !hasMixin(entity)) return null;
  return {
    cmdName: 'entityupdate',
    payload: { entity, component, value: LEVEL_VALUE[component] },
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
  const rotation = parseVec3LikeAFrame(
    pose.rotation !== undefined
      ? pose.rotation
      : clone.getAttribute('rotation'),
    ROTATION_DEFAULT
  );
  const scale = parseVec3LikeAFrame(
    pose.scale !== undefined ? pose.scale : clone.getAttribute('scale'),
    SCALE_DEFAULT
  );
  const levelled = {};
  if (!isLevel(rotation)) levelled.rotation = { ...rotation };
  if (!isUnitScale(scale)) levelled.scale = { ...scale };
  return {
    cmdName: 'detachclone',
    payload: {
      ...payload,
      pose: {
        ...pose,
        rotation: vec3String(levelledRotation(rotation)),
        scale: LEVEL_VALUE.scale
      }
    },
    levelled: levelled.rotation || levelled.scale ? levelled : null
  };
}

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
    if (routed.cmdName === 'multi') out.push(...routed.payload);
    else out.push([routed.cmdName, routed.payload, tuple[2]]);
  }
  return changed ? { cmdName: 'multi', payload: out, levelled } : null;
}

/**
 * Rewrite a command that would leave a user group tilted or scaled, the same
 * shape as routeCloneEdit: null leaves the command alone, otherwise
 * {cmdName, payload, levelled}. `levelled` — {entityId, rotation?, scale?},
 * the values that were removed, or null — is what the AI is told.
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
    return routeRemoval(entity, payload.component);
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

/** The sentence the AI is told when a command levelled what became a group. */
export function describeDroppedPose(levelled) {
  if (!levelled || (!levelled.rotation && !levelled.scale)) return null;
  const { rotation, scale } = levelled;
  const tilt = rotation && `tilt (rotation x ${rotation.x}, z ${rotation.z})`;
  const scalePart = scale && `scale (${scale.x} ${scale.y} ${scale.z})`;
  const removed =
    tilt && scalePart
      ? `${tilt} and ${scalePart} were removed`
      : `${tilt || scalePart} was removed`;
  let ending = 'Its heading and position are unchanged.';
  if (rotation) {
    const newY = levelledRotation(rotation).y;
    if (!sameFacing(newY, rotation.y)) {
      ending = `It faces the same way and its position is unchanged; its rotation is now 0 ${newY} 0.`;
    }
  }
  return `The item is now a group, so its ${removed}; ${GROUP_RULE} ${ending}`;
}

function sameFacing(a, b) {
  const d = (((a - b) % 360) + 360) % 360;
  return d <= POSE_EPS || 360 - d <= POSE_EPS;
}
