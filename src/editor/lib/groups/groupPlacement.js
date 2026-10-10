/* global THREE, AFRAME */
// Where an item added to the scene goes while a group is open for editing.
//
// With no group open, every way of adding an item keeps its own rule. With a
// group open, an item that may live in a group goes into the innermost open
// group, at the world pose it would have had at the top level: the preview a
// route shows is where the item lands. An item that may not live in a group
// (a street segment, a shape, the Starting View, the 360° panorama) keeps its
// route's destination, and the user is told it landed outside the group.
// A route that creates its item with a raw `entitycreate` and no ticket keeps
// its own destination too, even for an item that could be grouped (the
// Traffic Replay layer, the Geo panel's flattening box, OSM upgrades, street
// imports); the notice then says the item can be dragged into the group.
//
// The destination is chosen when the operation begins, as a ticket naming the
// group, and checked again when the item is committed: an upload, a clipboard
// read or an asset placement may finish after the group was removed or moved
// somewhere it can no longer take items. Such a placement is refused with an
// explanation; it never falls back to the top level.

import {
  BACKDROP_CLASS,
  canAcceptChild,
  isGroupableItem,
  isStreetContainer,
  userGroupAncestors
} from './groupModel.js';
import { groupMessage } from './groupMessages.js';
import { localPoseFromWorld } from './groupTransformMath.js';
import { getGroupBounds, getGroupCenter } from './groupBounds.js';
import { TRANSFORM_REFUSED, notifyRefusal } from '../transformGuard.js';
import pickPointOnGroundPlane, {
  pickGroundPointOrNull
} from '../pick-point-on-ground-plane.js';

const NOTICE_DEDUP_MS = 1500;
// Where on the screen viewCenterPoint picks the ground: a little below the
// middle of the view.
const VIEW_CENTER_PICK_Y = -0.1;
let lastNotice = null;
let lastNoticeAt = 0;

let scratch = null;
function tmp() {
  if (!scratch) {
    scratch = {
      world: new THREE.Matrix4(),
      offset: new THREE.Matrix4(),
      euler: new THREE.Euler(0, 0, 0, 'YXZ'),
      pose: {
        position: new THREE.Vector3(),
        quaternion: new THREE.Quaternion(),
        scale: new THREE.Vector3()
      }
    };
  }
  return scratch;
}

/** The innermost group open for editing, or null. */
export function innermostOpenGroup() {
  // The inspector takes commands from the start, and installs its group scope
  // only once its viewport is built.
  const stack = globalThis.AFRAME?.INSPECTOR?.groupScope?.openStack;
  if (!stack?.length) return null;
  const el = document.getElementById(stack[stack.length - 1]);
  return el?.isConnected ? el : null;
}

/**
 * Record, when an operation that adds an item begins, which group it places
 * into: the innermost open group, or null when none is open or the item may
 * not go into a group (the route's own rule then applies).
 */
export function beginPlacement({ groupable = true } = {}) {
  if (!groupable) return null;
  const stack = globalThis.AFRAME?.INSPECTOR?.groupScope?.openStack;
  if (!stack?.length) return null;
  return { parentId: stack[stack.length - 1] };
}

/** The ticket's group, if it can still take the item; null otherwise. */
export function resolvePlacement(ticket) {
  const parentEl = document.getElementById(ticket.parentId);
  return canAcceptChild(parentEl) ? parentEl : null;
}

function readVec3(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'string') {
    const parts = value.trim().split(/\s+/).map(Number);
    return {
      x: parts[0] ?? fallback.x,
      y: parts[1] ?? fallback.y,
      z: parts[2] ?? fallback.z
    };
  }
  return { x: value.x, y: value.y, z: value.z };
}

const ORIGIN = { x: 0, y: 0, z: 0 };
const UNIT = { x: 1, y: 1, z: 1 };

/**
 * The world matrix of an item whose position, rotation (degrees) and scale
 * are `components`' values read as world values, which is what they are at
 * the top level of the scene.
 */
export function worldMatrixOf(components, out) {
  const t = tmp();
  const position = readVec3(components?.position, ORIGIN);
  const rotation = readVec3(components?.rotation, ORIGIN);
  const scale = readVec3(components?.scale, UNIT);
  const deg = THREE.MathUtils.degToRad;
  t.euler.set(deg(rotation.x), deg(rotation.y), deg(rotation.z), 'YXZ');
  t.pose.quaternion.setFromEuler(t.euler);
  t.pose.position.set(position.x, position.y, position.z);
  t.pose.scale.set(scale.x, scale.y, scale.z);
  return out.compose(t.pose.position, t.pose.quaternion, t.pose.scale);
}

/**
 * `worldMatrix` as position, rotation (degrees, A-Frame's YXZ order) and scale
 * under `parentEl`, or null when that pose would need a shear (the parent is
 * scaled differently along its axes).
 */
export function localPoseUnder(parentEl, worldMatrix) {
  const t = tmp();
  parentEl.object3D.updateWorldMatrix(true, false);
  if (!localPoseFromWorld(parentEl.object3D.matrixWorld, worldMatrix, t.pose)) {
    return null;
  }
  const { position, quaternion, scale } = t.pose;
  t.euler.setFromQuaternion(quaternion, 'YXZ');
  const deg = THREE.MathUtils.radToDeg;
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: deg(t.euler.x), y: deg(t.euler.y), z: deg(t.euler.z) },
    scale: { x: scale.x, y: scale.y, z: scale.z }
  };
}

function isVec(value, target) {
  return value.x === target.x && value.y === target.y && value.z === target.z;
}

/**
 * Re-express `components`' pose (read as world values) under `parentEl`.
 * Rotation and scale are written only when the item had them or they differ
 * from the default, so an unrotated group adds nothing to the definition.
 * Returns the new components, or null when the pose cannot be kept.
 */
function componentsUnder(parentEl, components, worldMatrix) {
  const local = localPoseUnder(parentEl, worldMatrix);
  if (!local) return null;
  const placed = { ...components, position: local.position };
  if (components.rotation !== undefined || !isVec(local.rotation, ORIGIN)) {
    placed.rotation = local.rotation;
  }
  if (components.scale !== undefined || !isVec(local.scale, UNIT)) {
    placed.scale = local.scale;
  }
  return placed;
}

/**
 * The `entitycreate` definition for a new item placed under `ticket`: the
 * definition itself when there is no ticket; otherwise the same item in the
 * ticket's group at the same world pose, marked so the command guard refuses
 * it if the group can no longer take it. `{ refusal }` when it cannot be
 * placed there.
 */
export function placeDefinition(definition, ticket) {
  if (!ticket) return { definition };
  const parentEl = resolvePlacement(ticket);
  if (!parentEl) return { refusal: groupMessage('destinationGone') };
  const components = definition.components || {};
  const world = worldMatrixOf(components, tmp().world);
  const placed = componentsUnder(parentEl, components, world);
  if (!placed) return { refusal: groupMessage('placementDistorts') };
  return {
    definition: {
      ...definition,
      parentEl,
      requireParent: true,
      components: placed
    }
  };
}

/**
 * Create a new item with `entitycreate`, in the open group when a group is
 * open (or the one `ticket` names). A placement that cannot be made is
 * explained to the user and creates nothing; the result is then
 * TRANSFORM_REFUSED, as from a refused command.
 */
export function executePlacedCreate(
  definition,
  {
    ticket = beginPlacement({ groupable: isGroupableItem(definition) }),
    callback
  } = {}
) {
  const placed = placeDefinition(definition, ticket);
  if (placed.refusal) {
    notifyRefusal(null, placed.refusal);
    return TRANSFORM_REFUSED;
  }
  return callback
    ? AFRAME.INSPECTOR.execute(
        'entitycreate',
        placed.definition,
        undefined,
        callback
      )
    : AFRAME.INSPECTOR.execute('entitycreate', placed.definition);
}

/**
 * Entity data for a paste that keeps a world pose: `entityData` re-posed so it
 * sits at `worldMatrix` under `parentEl`, or null when that pose would distort
 * it. The pose is written as strings, as the serializer writes it.
 */
export function entityDataUnder(parentEl, entityData, worldMatrix) {
  const placed = componentsUnder(
    parentEl,
    entityData.components || {},
    worldMatrix
  );
  if (!placed) return null;
  const stringify = AFRAME.utils.coordinates.stringify;
  for (const name of ['position', 'rotation', 'scale']) {
    if (placed[name] && typeof placed[name] === 'object') {
      placed[name] = stringify(placed[name]);
    }
  }
  return { ...entityData, components: placed };
}

/**
 * What a copy records about where its item stood: its world matrix, and
 * whether it was inside a user group (whose items paste by world pose).
 */
export function copiedPlacement(entity) {
  const object3D = entity.object3D;
  if (!object3D) return { worldMatrix: null, inUserGroup: false };
  object3D.updateWorldMatrix(true, false);
  return {
    worldMatrix: Array.from(object3D.matrixWorld.elements),
    inUserGroup: userGroupAncestors(entity).length > 0
  };
}

/**
 * The world matrix a pasted item should have: the copied item's, or for data
 * copied without one, its own pose read as world values; moved `offsetX`
 * metres along world X so a copy beside its source is visibly separate.
 */
export function pastedWorldMatrix(worldMatrix, entityData, offsetX, out) {
  if (worldMatrix) out.fromArray(worldMatrix);
  else worldMatrixOf(entityData.components, out);
  if (offsetX) out.premultiply(tmp().offset.makeTranslation(offsetX, 0, 0));
  return out;
}

// Where a group's handles stand: below its center, on the bottom of its
// members (its center for a group with no member geometry), in world space.
function groupStandPoint(groupEl) {
  const point = getGroupCenter(groupEl, new THREE.Vector3());
  const box = getGroupBounds(groupEl);
  if (box) point.y = box.min.y;
  groupEl.object3D.updateWorldMatrix(true, false);
  return point.applyMatrix4(groupEl.object3D.matrixWorld);
}

/**
 * Where an item added with no position of its own goes (an upload from the
 * Assets panel, a File menu import): with `ticket` naming a group that can
 * still take it, that group's stand point, read now, so a group moved while
 * the file was read is followed; otherwise null, and the route keeps its own
 * default. Never the group's origin, which can be far from its members.
 */
export function defaultPlacementPoint(ticket) {
  if (!ticket) return null;
  const groupEl = resolvePlacement(ticket);
  if (!groupEl) return null;
  const { x, y, z } = groupStandPoint(groupEl);
  return { x, y, z };
}

/**
 * Where an item placed "in view" goes (a card click, or placing an asset from
 * the library): the ground at the middle of the view. With a
 * group open and a view that does not meet the ground, the group's stand
 * point instead: never the group's origin, which can be far from its members.
 */
export function viewCenterPoint(camera) {
  const pick = { normalizedX: 0, normalizedY: VIEW_CENTER_PICK_Y, camera };
  const groupEl = innermostOpenGroup();
  if (!groupEl) return pickPointOnGroundPlane(pick);
  const point = pickGroundPointOrNull(pick);
  return point ? point.clone() : groupStandPoint(groupEl);
}

/**
 * Where a new group made with the layer panel's button goes with a group open:
 * inside the innermost open group, with its origin at that group's center.
 * Null with no group open.
 */
export function nestedGroupPlacement() {
  const groupEl = innermostOpenGroup();
  if (!groupEl) return null;
  const center = getGroupCenter(groupEl, new THREE.Vector3());
  return {
    parentEl: groupEl,
    requireParent: true,
    position: { x: center.x, y: center.y, z: center.z }
  };
}

// Which notice an item added outside the open group gets. One that may go
// into a group was put elsewhere by its route, and the user can drag it in;
// one that may not is told so, and is not invited to try.
function outsideGroupNotice(entity, groupable) {
  const topLevel = isStreetContainer(entity.parentNode);
  if (groupable) {
    return topLevel ? 'routePlacedAtTopLevel' : 'routePlacedOutsideGroup';
  }
  if (topLevel && entity.classList.contains(BACKDROP_CLASS)) {
    return 'backdropAtTopLevel';
  }
  return topLevel ? 'placedAtTopLevel' : 'placedOutsideGroup';
}

/**
 * Tell the user when a command added an item outside the open group, and why.
 * Called by the create and paste commands on their first run, with
 * `groupable` and `system` from the item's data (isGroupableItem,
 * isSystemItem): the entity itself is not initialised yet. `requireParent`
 * placements were put where they belong, and items the editor made for the
 * user were never theirs to place, so neither is reported.
 */
export function notePlacedOutsideOpenGroup(
  entity,
  { requireParent, groupable, system } = {}
) {
  if (requireParent || system || !entity?.isConnected) return;
  const groupEl = innermostOpenGroup();
  if (!groupEl || groupEl.contains(entity)) return;
  const text = groupMessage(outsideGroupNotice(entity, groupable));
  const now = Date.now();
  // A route adding several items at once (an import) gets one notice.
  if (text !== lastNotice || now - lastNoticeAt > NOTICE_DEDUP_MS) {
    globalThis.STREET?.notify?.infoMessage?.(text);
  }
  lastNotice = text;
  lastNoticeAt = now;
}
