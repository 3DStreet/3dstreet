/* global THREE */
// Capability markers that restrict what may be done to an entity's transform,
// enforced centrally for every command the editor runs. An entity opts in by
// carrying the attribute, or by being a kind that declares it (below).
//
//   data-transform-no-scale       scale must stay unit
//   data-transform-yaw-only       rotation may change about Y alone: the X and
//                                 Z angles must stay as they are, or be
//                                 brought back to 0
//   data-transform-no-reparent    the entity may not change parent (reordering
//                                 WITHIN its current parent is still allowed —
//                                 the layers panel does that through the same
//                                 reparent command)
//
// An item of a kind that declares markers (tested/transform-kinds.js: a user
// group by its class; a managed street, managed intersection or shape by its
// component) carries them by being that kind, whether or not the attributes
// are there (hasTransformMarker): data-* attributes are not saved with the
// scene, and a class or component needs no editor code to have run for an AI
// command to see it. This holds at the command layer only: the stock gizmo
// reads the attributes, which each kind's component sets in its init.
// Removing a marker attribute through a command is refused, and so is
// removing the user-group class from a group that still has members.
//
// Values are judged as A-Frame will apply them (parseVec3LikeAFrame), so a
// string such as "10° 30 0" or "2,2,2" is read the way it would take effect.
//
// Two further refusals keep the hierarchy sound: a move to another parent must
// be legal for the group model (groups/groupModel.js) and must be able to keep
// the item's world pose; and a create or paste that names its parent with
// `requireParent` is refused when that parent can no longer take it, rather
// than falling back to the top level.
//
// The related, much more widely used `data-no-transform` is a different kind of
// thing: it is UI-only. It suppresses the properties panel's transform rows and
// the transform gizmo, and is NOT enforced at the command layer — so an AI-chat
// or scripted command can still transform an entity carrying it. The three
// markers above are the command-layer family.
//
// Every command that goes through Inspector.execute is judged, whether it
// updates a component or adds one. A direct setAttribute is not — from scene
// load, generator code or an animation component — nor is a scene authored
// before the markers existed. Scene load brings every constrained item within
// its kind's limits itself (tested/group-pose.js).

import {
  USER_GROUP_CLASS,
  canAcceptChild,
  canReparent,
  classAfterUpdate,
  isUserGroup
} from './groups/groupModel.js';
import { groupMessage } from './groups/groupMessages.js';
import { localPoseFromWorld } from './groups/groupTransformMath.js';
import {
  POSE_EPS,
  ROTATION_DEFAULT,
  SCALE_DEFAULT,
  isZeroAngle,
  parseVec3LikeAFrame
} from '@/tested/group-pose.js';
import {
  MARKERS,
  NO_REPARENT,
  NO_SCALE,
  YAW_ONLY,
  kindsOfEntity,
  markersOfKinds
} from '@/tested/transform-kinds.js';

// Refuse a repeat notice for the same entity and reason within this window: the
// panel's number fields are drag-scrubbers that fire a command per pointer
// move, so a refused scrub would otherwise stack dozens of toasts.
const NOTIFY_DEDUP_MS = 1500;

let lastRefusalKey = null;
let lastRefusalAt = 0;

const VEC3_DEFAULTS = { rotation: ROTATION_DEFAULT, scale: SCALE_DEFAULT };

// The axis values a transform write will apply, read as A-Frame reads them,
// in whichever form the write arrives: a "x y z" string (the AI chat), a whole
// {x, y, z} object (the properties panel's vec3 rows), or a single axis named
// by `property`, which is merged into the current value. An axis the write
// leaves as it is comes back undefined; one that is not a number, NaN.
function requestedAxes(payload, component) {
  if (payload.property) {
    const axes = parseVec3LikeAFrame({ [payload.property]: payload.value }, {});
    return { [payload.property]: axes[payload.property] };
  }
  return parseVec3LikeAFrame(payload.value, VEC3_DEFAULTS[component]);
}

function departsBy(value, target) {
  return typeof value !== 'number' || !(Math.abs(value - target) <= POSE_EPS);
}

function departsFrom(axes, target, names) {
  return names.some(
    (axis) => axes[axis] !== undefined && departsBy(axes[axis], target)
  );
}

// A named X or Z that changes the current tilt, unless it brings that axis
// back to 0 (a whole turn counts as 0, as it does when a scene loads):
// levelling an entity is always allowed.
function tiltsAwayFromCurrent(entity, axes, names) {
  const current = parseVec3LikeAFrame(
    entity.getAttribute?.('rotation'),
    VEC3_DEFAULTS.rotation
  );
  return names.some(
    (axis) =>
      axes[axis] !== undefined &&
      departsBy(axes[axis], current[axis]) &&
      !isZeroAngle(axes[axis])
  );
}

/** Does `entity` carry `marker`, as an attribute or implied by its kind? */
export function hasTransformMarker(entity, marker) {
  return (
    entity.hasAttribute(marker) ||
    markersOfKinds(kindsOfEntity(entity)).includes(marker)
  );
}

// An update that would remove a marker attribute the entity carries: a null or
// undefined value removes a plain attribute, with or without a property.
function removesMarker(entity, payload) {
  return (
    MARKERS.includes(payload.component) &&
    entity.hasAttribute(payload.component) &&
    (payload.value === null || payload.value === undefined)
  );
}

let poseScratch = null;

// Can `entity` keep its world pose as a child of `newParent`? Only a parent
// scaled unevenly can make this fail, and a group is never scaled through a
// command; the check stays for the routes the guard does not see (a direct
// setAttribute, an animation).
function poseRepresentableUnder(entity, newParent) {
  const child = entity.object3D;
  const parent = newParent.object3D;
  if (!child || !parent) return true;
  poseScratch ??= {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3()
  };
  child.updateWorldMatrix(true, false);
  parent.updateWorldMatrix(true, false);
  return localPoseFromWorld(parent.matrixWorld, child.matrixWorld, poseScratch);
}

// A create or paste that must land in a particular parent (placement into an
// open group) names it; that parent may have gone while the operation was
// under way.
function requiredParentGone(commandType, payload) {
  if (!payload?.requireParent) return false;
  if (commandType !== 'entitycreate' && commandType !== 'entitypaste') {
    return false;
  }
  const ref =
    commandType === 'entitycreate' ? payload.parentEl : payload.parentId;
  const parent = typeof ref === 'string' ? document.getElementById(ref) : ref;
  return !canAcceptChild(parent);
}

// A scale or rotation write, whether it updates the component or adds it.
function refuseVec3Write(entity, component, payload) {
  if (
    component === 'scale' &&
    hasTransformMarker(entity, NO_SCALE) &&
    departsFrom(requestedAxes(payload, 'scale'), 1, ['x', 'y', 'z'])
  ) {
    return 'Scaling is not available for this element.';
  }
  if (
    component === 'rotation' &&
    hasTransformMarker(entity, YAW_ONLY) &&
    tiltsAwayFromCurrent(entity, requestedAxes(payload, 'rotation'), ['x', 'z'])
  ) {
    return 'This element can only be rotated about the vertical axis.';
  }
  return null;
}

// A group's members cannot be left in something that is no longer a group.
function wouldUngroupWithMembers(entity, payload) {
  return (
    isUserGroup(entity) &&
    entity.children.length > 0 &&
    !classAfterUpdate(payload).includes(USER_GROUP_CLASS)
  );
}

/**
 * Would this command violate one of the transform markers on its target?
 * Returns the reason to show the user, or null to let the command through.
 *
 * Ordered so the cheap discriminators run first: this runs for EVERY command
 * the editor executes, including the one a gizmo drag emits per frame.
 */
export function refuseGuardedTransform(commandType, payload) {
  // A multi command's payload is the list of [type, payload] tuples it will
  // run; refuse the whole batch if any member would be refused on its own,
  // since History pushes the batch as one entry.
  if (commandType === 'multi') {
    if (!Array.isArray(payload)) return null;
    for (const tuple of payload) {
      const reason = refuseGuardedTransform(tuple?.[0], tuple?.[1]);
      if (reason) return reason;
    }
    return null;
  }

  if (requiredParentGone(commandType, payload)) {
    return groupMessage('destinationGone');
  }

  const entity = payload?.entity;
  if (!entity || !entity.hasAttribute) return null;

  if (commandType === 'componentadd') {
    return refuseVec3Write(entity, payload.component, payload);
  }

  if (commandType === 'entityupdate') {
    if (removesMarker(entity, payload)) {
      return "This element's scale, rotation and parent limits cannot be removed.";
    }
    const reason = refuseVec3Write(entity, payload.component, payload);
    if (reason) return reason;
    if (
      payload.component === 'class' &&
      wouldUngroupWithMembers(entity, payload)
    ) {
      return groupMessage('ungroupWithMembers');
    }
    return null;
  }

  if (commandType === 'entityreparent') {
    // payload.parentEl is the target parent's id. A same-parent reorder comes
    // through this command too, and must not be refused.
    if (payload.parentEl === entity.parentNode?.id) return null;
    if (hasTransformMarker(entity, NO_REPARENT)) {
      return 'This element cannot be moved to a different parent.';
    }
    const newParent = document.getElementById(payload.parentEl);
    // An unknown parent is left to the command.
    if (!newParent) return null;
    if (!canReparent(entity, newParent)) return groupMessage('illegalParent');
    if (!poseRepresentableUnder(entity, newParent)) {
      return groupMessage('unrepresentablePose');
    }
  }

  return null;
}

/**
 * Tell the user a command was refused, at most once per entity+reason per
 * NOTIFY_DEDUP_MS. The dedup state lives here rather than in the shared notify
 * layer, which other callers may legitimately want to repeat.
 *
 * Keying on the reason as well as the entity means a genuinely different
 * refusal still speaks. Two DIFFERENT refused actions that happen to share a
 * reason within the window produce one toast; that is accepted, because the
 * case the visibility requirement exists for — an AI turn reporting success for
 * an edit that did not happen — is covered unconditionally by the tool
 * dispatcher throwing, whether or not a toast was shown.
 */
export function notifyRefusal(entity, reason) {
  const now = Date.now();
  const key = `${entity?.id ?? ''}|${reason}`;
  if (key !== lastRefusalKey || now - lastRefusalAt > NOTIFY_DEDUP_MS) {
    // Reached through the global rather than an import: notify is an A-Frame
    // component that publishes itself there once the scene has it, and this can
    // run before that.
    globalThis.STREET?.notify?.warningMessage(reason);
    lastRefusalKey = key;
  }
  // Unconditional, so a continuing scrub keeps the window open and produces one
  // toast for the whole gesture rather than one per NOTIFY_DEDUP_MS.
  lastRefusalAt = now;
}

// Returned by Inspector.execute instead of running a refused command. Callers
// that need to react — the AI tool dispatcher, which must not report success —
// test for this rather than for a falsy return, since the method returns
// undefined on the success path.
export const TRANSFORM_REFUSED = Symbol('transform refused');
