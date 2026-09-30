/* global THREE */
// Capability markers that restrict what may be done to an entity's transform,
// enforced centrally for every command the editor runs. An entity opts in by
// carrying the attribute; the guard is otherwise entity-type-agnostic.
//
//   data-transform-no-scale       scale must stay unit
//   data-transform-yaw-only       rotation may change about Y alone: the X and
//                                 Z angles must stay as they are
//   data-transform-uniform-scale  scale must stay the same on every axis
//   data-transform-no-reparent    the entity may not change parent (reordering
//                                 WITHIN its current parent is still allowed —
//                                 the layers panel does that through the same
//                                 reparent command)
//
// A user group carries yaw-only and uniform-scale by its class rather than as
// attributes (hasTransformMarker): data-* attributes are not saved with the
// scene, and a class needs no editor code to have run for an AI command to see
// it. A group scaled unevenly could only hold a turned member by shearing it.
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
// What this covers is every COMMAND route: the properties panel, the AI chat,
// the transform gizmo and layers-panel reparenting all go through
// Inspector.execute. A direct setAttribute — from scene load, from generator
// code, or from an animation component — bypasses it, as does a scene authored
// before the markers existed.

import {
  canAcceptChild,
  canReparent,
  isUserGroup
} from './groups/groupModel.js';
import { groupMessage } from './groups/groupMessages.js';
import { localPoseFromWorld } from './groups/groupTransformMath.js';

// A scale within this of 1, or a rotation within this many degrees of 0, is
// treated as unchanged. Both guard against float noise in a round-trip through
// the panel's string values rather than expressing a tolerance anyone should
// rely on.
const UNIT_EPS = 1e-3;

// Refuse a repeat notice for the same entity and reason within this window: the
// panel's number fields are drag-scrubbers that fire a command per pointer
// move, so a refused scrub would otherwise stack dozens of toasts.
const NOTIFY_DEDUP_MS = 1500;

let lastRefusalKey = null;
let lastRefusalAt = 0;

// Read the axis values a transform write is asking for, in whichever of the
// three forms it arrives: a "x y z" string (the AI chat), a whole {x, y, z}
// object (the properties panel's vec3 rows), or a single axis named by
// `property`. Axes the write does not mention come back undefined.
function requestedAxes(payload) {
  const value = payload.value;
  if (payload.property) {
    return { [payload.property]: finite(value) };
  }
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s+/);
    return { x: finite(parts[0]), y: finite(parts[1]), z: finite(parts[2]) };
  }
  if (value && typeof value === 'object') {
    return { x: finite(value.x), y: finite(value.y), z: finite(value.z) };
  }
  return {};
}

function finite(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function departsFrom(axes, target, names) {
  return names.some(
    (axis) =>
      axes[axis] !== undefined && Math.abs(axes[axis] - target) > UNIT_EPS
  );
}

// The entity's current value of a vec3 component, with `fallback` for an axis
// it does not set.
function currentAxes(entity, component, fallback) {
  const axes = requestedAxes({ value: entity.getAttribute?.(component) });
  return {
    x: axes.x ?? fallback,
    y: axes.y ?? fallback,
    z: axes.z ?? fallback
  };
}

function departsFromCurrent(entity, component, axes, names) {
  const current = currentAxes(entity, component, 0);
  return names.some(
    (axis) =>
      axes[axis] !== undefined &&
      Math.abs(axes[axis] - current[axis]) > UNIT_EPS
  );
}

function leavesScaleUneven(entity, axes) {
  const current = currentAxes(entity, 'scale', 1);
  const x = axes.x ?? current.x;
  const y = axes.y ?? current.y;
  const z = axes.z ?? current.z;
  const tolerance =
    UNIT_EPS * Math.max(1, Math.abs(x), Math.abs(y), Math.abs(z));
  return Math.abs(x - y) > tolerance || Math.abs(y - z) > tolerance;
}

const IMPLIED_BY_USER_GROUP = new Set([
  'data-transform-yaw-only',
  'data-transform-uniform-scale'
]);

/** Does `entity` carry `marker`, as an attribute or implied by its class? */
export function hasTransformMarker(entity, marker) {
  return (
    entity.hasAttribute(marker) ||
    (IMPLIED_BY_USER_GROUP.has(marker) && isUserGroup(entity))
  );
}

let poseScratch = null;

// Can `entity` keep its world pose as a child of `newParent`?
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

  if (commandType === 'entityupdate') {
    if (payload.component === 'scale') {
      const axes = requestedAxes(payload);
      if (
        hasTransformMarker(entity, 'data-transform-no-scale') &&
        departsFrom(axes, 1, ['x', 'y', 'z'])
      ) {
        return 'Scaling is not available for this element.';
      }
      if (
        hasTransformMarker(entity, 'data-transform-uniform-scale') &&
        leavesScaleUneven(entity, axes)
      ) {
        return groupMessage('nonUniformScale');
      }
    }
    if (
      payload.component === 'rotation' &&
      hasTransformMarker(entity, 'data-transform-yaw-only') &&
      departsFromCurrent(entity, 'rotation', requestedAxes(payload), ['x', 'z'])
    ) {
      return 'This element can only be rotated about the vertical axis.';
    }
    return null;
  }

  if (commandType === 'entityreparent') {
    // payload.parentEl is the target parent's id. A same-parent reorder comes
    // through this command too, and must not be refused.
    if (payload.parentEl === entity.parentNode?.id) return null;
    if (hasTransformMarker(entity, 'data-transform-no-reparent')) {
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
