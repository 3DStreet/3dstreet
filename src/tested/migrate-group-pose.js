// A user group always has scale 1 and X/Z rotation 0: it turns about the
// vertical axis only and is never scaled. This module levels entity data that
// breaks that rule — a scene saved before the rule existed, clipboard text from
// another build, a create definition — before any entity is minted from it.
//
// It also holds the one reading of a vec3 value that the command guard shares,
// so the guard, this pass and A-Frame agree on what a value means.
//
// Pure data: no AFRAME, no DOM, no logging, so it can be unit-tested directly.

// A scale within this of 1, or an angle within this many degrees of 0, counts
// as unit or level. It absorbs float noise from string round-trips; it is not a
// tolerance anyone should rely on.
export const POSE_EPS = 1e-3;

// The class a saved scene carries on a user group (groups/groupModel.js names
// the same string; a test keeps the two equal).
export const GROUP_CLASS = 'user-group';

const ROTATION_DEFAULT = { x: 0, y: 0, z: 0 };
const SCALE_DEFAULT = { x: 1, y: 1, z: 1 };
const AXES = ['x', 'y', 'z'];

function parseIfString(value) {
  return typeof value === 'string' ? parseFloat(value) : value;
}

/**
 * Read a vec3 value the way A-Frame's vec3 property type does
 * (utils/coordinates.js `parse`), so a check made on the result is a check on
 * what A-Frame will actually apply.
 *
 * - A string is trimmed and split on whitespace; each present token is read
 *   with parseFloat ("10° 30 0" is 10, 30, 0); a missing token takes the
 *   default. A blank string is all defaults.
 * - An object (an array included) takes each of x, y, z, with parseFloat for a
 *   string; a missing key takes the default. A key that is null leaves A-Frame's
 *   current value as it is, so it comes back undefined: not named.
 * - null or undefined is all defaults.
 * - Any other value (a number, a boolean) makes A-Frame throw and apply
 *   nothing, so nothing is named: every axis comes back undefined.
 *
 * Returns {x, y, z}; an axis may be NaN when its token is not a number.
 */
export function parseVec3LikeAFrame(value, defaults) {
  if (value && value instanceof Object) {
    const out = {};
    for (const axis of AXES) {
      const raw = value[axis] === undefined ? defaults[axis] : value[axis];
      out[axis] = raw === null ? undefined : parseIfString(raw);
    }
    return out;
  }
  if (value === null || value === undefined) return { ...defaults };
  if (typeof value !== 'string') {
    return { x: undefined, y: undefined, z: undefined };
  }
  const tokens = value.trim().split(/\s+/);
  const out = {};
  AXES.forEach((axis, i) => {
    out[axis] = tokens[i] ? parseFloat(tokens[i]) : defaults[axis];
  });
  return out;
}

// Degrees into (-180, 180].
function normaliseAngle(degrees) {
  const n = ((degrees % 360) + 360) % 360 || 0;
  return n > 180 ? n - 360 : n;
}

function nearlyZeroAngle(degrees) {
  return Math.abs(normaliseAngle(degrees)) <= POSE_EPS;
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** Are X and Z both 0 (within POSE_EPS)? */
export function isLevel(rotation) {
  const r = parseVec3LikeAFrame(rotation, ROTATION_DEFAULT);
  return nearlyZeroAngle(r.x) && nearlyZeroAngle(r.z);
}

/** Is every axis 1 (within POSE_EPS)? */
export function isUnitScale(scale) {
  const s = parseVec3LikeAFrame(scale, SCALE_DEFAULT);
  return AXES.every((axis) => Math.abs(s[axis] - 1) <= POSE_EPS);
}

const toRad = (degrees) => (degrees * Math.PI) / 180;
const toDeg = (radians) => (radians * 180) / Math.PI;

// The direction a rotation faces, as a rotation about Y alone. A-Frame applies
// rotation in YXZ order, so the rotated forward vector is
// (cos X sin Y, -sin X, cos X cos Y): while cos X is positive the facing is Y
// itself, and once X is past 90° the item faces the other way round. When the
// forward vector points straight up or down it has no facing, and the rotated
// right vector gives it instead.
function headingOf(r) {
  const x = toRad(finiteOr(r.x, 0));
  const y = finiteOr(r.y, 0);
  const z = toRad(finiteOr(r.z, 0));
  const cosX = Math.cos(x);
  if (cosX > 1e-6) return normaliseAngle(y);
  if (cosX < -1e-6) return normaliseAngle(y + 180);
  const yr = toRad(y);
  const rightX =
    Math.cos(yr) * Math.cos(z) + Math.sin(yr) * Math.sin(z) * Math.sin(x);
  const rightZ =
    -Math.sin(yr) * Math.cos(z) + Math.cos(yr) * Math.sin(z) * Math.sin(x);
  const heading = toDeg(Math.atan2(rightX, rightZ)) - 90;
  return normaliseAngle(Math.round(heading * 1e6) / 1e6);
}

/**
 * The level rotation that faces the same way as `rotation`: "0 <heading> 0",
 * or {x: 0, y: heading, z: 0} for an object.
 */
export function levelledRotation(rotation) {
  const heading = headingOf(parseVec3LikeAFrame(rotation, ROTATION_DEFAULT));
  return rotation && typeof rotation === 'object'
    ? { x: 0, y: heading, z: 0 }
    : `0 ${heading} 0`;
}

function unitScaleLike(scale) {
  return scale && typeof scale === 'object' ? { x: 1, y: 1, z: 1 } : '1 1 1';
}

function classListOf(node) {
  const list = [];
  for (const value of [node.class, node.components?.class]) {
    if (Array.isArray(value)) list.push(...value.map(String));
    else if (typeof value === 'string') list.push(...value.split(/\s+/));
  }
  return list;
}

function isGroupNode(node) {
  return classListOf(node).includes(GROUP_CLASS);
}

function sameFacing(a, b) {
  return Math.abs(normaliseAngle(a - b)) <= POSE_EPS;
}

// Level one group's own data. Returns its change record, or null when its own
// values already conformed.
function levelNode(node) {
  const components = node.components ?? {};
  const change = { id: node.id, name: node['data-layer-name'] };
  let changed = false;

  const rotation = components.rotation;
  if (rotation !== undefined && !isLevel(rotation)) {
    const levelled = levelledRotation(rotation);
    components.rotation = levelled;
    change.rotation = rotation;
    const savedY = parseVec3LikeAFrame(rotation, ROTATION_DEFAULT).y;
    const newY = parseVec3LikeAFrame(levelled, ROTATION_DEFAULT).y;
    if (!sameFacing(finiteOr(savedY, 0), newY)) change.newY = newY;
    changed = true;
  }

  const scale = components.scale;
  if (scale !== undefined && !isUnitScale(scale)) {
    components.scale = unitScaleLike(scale);
    change.scale = scale;
    changed = true;
  }

  // A mixin's scale or tilt applies to an entity with no value of its own, and
  // an own value outranks it, so a group with a mixin always carries explicit
  // ones. Not reported: whether the mixin had anything to override is unknown
  // here, so a report could name a value nobody set.
  if (typeof node.mixin === 'string' && node.mixin.trim()) {
    if (components.scale === undefined) components.scale = '1 1 1';
    if (components.rotation === undefined) components.rotation = '0 0 0';
    node.components = components;
  }

  return changed ? change : null;
}

/**
 * Level every user group in an entity-data tree, in place: a scene's `data`
 * array, a getElementData result or an entitycreate definition. Groups lose
 * any scale and any X/Z rotation and keep their facing; members' values are
 * never touched, and a nested group is levelled in its own frame.
 *
 * Returns one record per group whose own saved values changed, in document
 * order (parent before child): {id, name, rotation?, newY?, scale?}, holding
 * the values as they were, plus the new Y rotation when the facing had to be
 * rewritten to a different Y.
 */
export function levelGroupPoses(nodes) {
  const changes = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (isGroupNode(node)) {
      const change = levelNode(node);
      if (change) changes.push(change);
    }
    if (Array.isArray(node.children)) node.children.forEach(walk);
  };
  if (Array.isArray(nodes)) nodes.forEach(walk);
  else walk(nodes);
  return changes;
}

function describeChange(change) {
  const parts = [];
  if (change.rotation !== undefined) {
    const r = parseVec3LikeAFrame(change.rotation, ROTATION_DEFAULT);
    let part = `rotation x ${r.x}, z ${r.z}`;
    if (change.newY !== undefined) part += `, now facing y ${change.newY}`;
    parts.push(part);
  }
  if (change.scale !== undefined) {
    const s = parseVec3LikeAFrame(change.scale, SCALE_DEFAULT);
    parts.push(`scale ${s.x} ${s.y} ${s.z}`);
  }
  const label = change.name || change.id;
  const who = label ? `"${label}"` : '(unnamed)';
  return `${who} (${parts.join(', ')})`;
}

/** The load warning for `changes` (from levelGroupPoses), or null for none. */
export function describeLevelledGroups(changes) {
  if (!changes?.length) return null;
  const noun = changes.length === 1 ? 'group' : 'groups';
  return (
    `[groups] Removed tilt or scale from ${changes.length} ${noun} on load; ` +
    `heading and position kept: ${changes.map(describeChange).join(', ')}.`
  );
}
