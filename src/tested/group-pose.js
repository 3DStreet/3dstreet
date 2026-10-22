// An item whose kind declares transform limits (src/tested/transform-kinds.js)
// is kept within them: a group or a shape has scale 1 and no X/Z rotation; a
// managed street or intersection has scale 1 and may tilt. Bringing an item
// within its limits keeps its position and the direction it faces. "Level"
// here always means no X/Z rotation.
//
// This module holds what every route that keeps an item within its limits
// shares: one reading of a vec3 value, so the command guard, the conforming
// and A-Frame agree on what a value means; what counts as level and unit; and
// the conforming of entity data — a scene being loaded, clipboard text, a
// create definition — before any entity is minted from it.
//
// Pure data: no AFRAME, no DOM, no logging, so it can be unit-tested directly.

import { kindById, kindsOfNode, limitedComponents } from './transform-kinds.js';

// A scale within this of 1, or an angle within this many degrees of 0, counts
// as unit or level. It absorbs float noise from string round-trips; it is not a
// tolerance anyone should rely on.
export const POSE_EPS = 1e-3;

export const ROTATION_DEFAULT = Object.freeze({ x: 0, y: 0, z: 0 });
export const SCALE_DEFAULT = Object.freeze({ x: 1, y: 1, z: 1 });
const DEFAULTS = { rotation: ROTATION_DEFAULT, scale: SCALE_DEFAULT };
const AXES = ['x', 'y', 'z'];

// Below this |cos X| the forward vector points straight up or down, and the
// facing is taken from the right vector instead.
const VERTICAL_COS = 1e-6;
// A heading is rounded to this many steps per degree: a facing read back from
// A-Frame's radians (30 comes back as 29.999999999999996) then prints clean.
const HEADING_STEPS_PER_DEGREE = 1e6;

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

// Degrees into (-180, 180]; NaN stays NaN.
function normaliseAngle(degrees) {
  const n = (((degrees % 360) + 360) % 360) + 0;
  return n > 180 ? n - 360 : n;
}

/**
 * Is this angle 0, within POSE_EPS, counting whole turns (360 is 0)? Anything
 * that is not a finite number is not: A-Frame would apply it as NaN.
 */
export function isZeroAngle(degrees) {
  return (
    typeof degrees === 'number' &&
    Number.isFinite(degrees) &&
    Math.abs(normaliseAngle(degrees)) <= POSE_EPS
  );
}

/** Do two Y angles face the same way, within POSE_EPS, counting whole turns? */
export function sameFacing(a, b) {
  return isZeroAngle(a - b);
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

/** Are X and Z both 0 (within POSE_EPS, counting whole turns)? */
export function isLevel(rotation) {
  const r = parseVec3LikeAFrame(rotation, ROTATION_DEFAULT);
  return isZeroAngle(r.x) && isZeroAngle(r.z);
}

/** Is every axis 1 (within POSE_EPS)? */
export function isUnitScale(scale) {
  const s = parseVec3LikeAFrame(scale, SCALE_DEFAULT);
  return AXES.every((axis) => Math.abs(s[axis] - 1) <= POSE_EPS);
}

/** Does `value` already conform for `component` (rotation: level; scale: unit)? */
export function conforms(component, value) {
  return component === 'scale' ? isUnitScale(value) : isLevel(value);
}

const toRad = (degrees) => (degrees * Math.PI) / 180;
const toDeg = (radians) => (radians * 180) / Math.PI;

// Wrapped into (-180, 180] first and rounded last: wrapping adds a whole turn,
// which is not exact for a fractional angle.
function roundHeading(degrees) {
  const steps = HEADING_STEPS_PER_DEGREE;
  const rounded = Math.round(normaliseAngle(degrees) * steps) / steps;
  return rounded === -180 ? 180 : rounded;
}

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
  if (cosX > VERTICAL_COS) return roundHeading(y);
  if (cosX < -VERTICAL_COS) return roundHeading(y + 180);
  const yr = toRad(y);
  const rightX =
    Math.cos(yr) * Math.cos(z) + Math.sin(yr) * Math.sin(z) * Math.sin(x);
  const rightZ =
    -Math.sin(yr) * Math.cos(z) + Math.cos(yr) * Math.sin(z) * Math.sin(x);
  // An unturned item's right vector points along +X, an azimuth of 90°, so the
  // facing is the right vector's azimuth less 90°.
  return roundHeading(toDeg(Math.atan2(rightX, rightZ)) - 90);
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

/**
 * The value that levels `value` for `component`, in the same form: the level
 * rotation facing the same way, or unit scale.
 */
export function levelledValue(component, value) {
  if (component === 'rotation') return levelledRotation(value);
  return value && typeof value === 'object' ? { x: 1, y: 1, z: 1 } : '1 1 1';
}

// Bring one constrained item's own data within its kinds' limits, for the
// components they limit. Returns its change record, or null when nothing it
// shows had to change.
function conformNode(node, kinds, mixinPose) {
  const components = node.components ?? {};
  const change = {
    id: node.id,
    name: node['data-layer-name'],
    kind: kinds[0].id
  };
  let changed = false;
  const hasMixin = typeof node.mixin === 'string' && node.mixin.trim() !== '';
  // A mixin's scale or rotation shows on an entity with no value of its own.
  // When the mixins can be read, what they supply is judged like an own value;
  // when they cannot, both are written explicitly (an own value outranks a
  // mixin's), level or unit, unreported since the old value is unknown.
  const fromMixin = hasMixin && mixinPose ? mixinPose(node.mixin) : undefined;

  for (const component of limitedComponents(kinds)) {
    let shown = components[component];
    if (shown === undefined && hasMixin) {
      if (!fromMixin) {
        components[component] = levelledValue(component, null);
        node.components = components;
        continue;
      }
      shown = fromMixin[component];
    }
    if (shown === undefined || conforms(component, shown)) continue;
    const levelled = levelledValue(component, shown);
    components[component] = levelled;
    node.components = components;
    change[component] = shown;
    changed = true;
    if (component === 'rotation') {
      const savedY = parseVec3LikeAFrame(shown, ROTATION_DEFAULT).y;
      const newY = parseVec3LikeAFrame(levelled, ROTATION_DEFAULT).y;
      if (!sameFacing(finiteOr(savedY, 0), newY)) change.newY = newY;
    }
  }

  return changed ? change : null;
}

/**
 * Bring every constrained item in an entity-data tree within its kind's limits,
 * in place: a scene's `data` array, a getElementData result or an entitycreate
 * definition. An item is constrained when its class or a component makes it a
 * kind that declares limits. It loses any scale, and a heading-only kind (a
 * group, a shape) also loses any X/Z rotation, keeping its facing; a managed
 * street or intersection keeps its rotation as saved. Other components and
 * other items are never touched, and a nested item is handled in its own
 * frame.
 *
 * `mixinPose(mixinAttribute)`, when given, returns the {rotation?, scale?} an
 * item's mixins supply, or null when they cannot be read; see conformNode.
 *
 * Returns one record per item whose shown values changed, in document order
 * (parent before child): {id, name, kind, rotation?, newY?, scale?}, holding
 * the values as they were, the id of the item's kind, and the new Y rotation
 * when the facing had to be rewritten to a different Y.
 */
export function conformToKindLimits(nodes, { mixinPose } = {}) {
  const changes = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    const kinds = kindsOfNode(node);
    if (kinds.length > 0) {
      const change = conformNode(node, kinds, mixinPose);
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
    const r = parseVec3LikeAFrame(change.rotation, DEFAULTS.rotation);
    let part = `rotation x ${r.x}, z ${r.z}`;
    if (change.newY !== undefined) part += `, now facing y ${change.newY}`;
    parts.push(part);
  }
  if (change.scale !== undefined) {
    const s = parseVec3LikeAFrame(change.scale, DEFAULTS.scale);
    parts.push(`scale ${s.x} ${s.y} ${s.z}`);
  }
  const name = change.name || change.id;
  const who = name ? `"${name}"` : '(unnamed)';
  const kind = kindById(change.kind).label;
  return `${kind} ${who} (removed ${parts.join(', ')})`;
}

/**
 * The load warning for `changes` (from conformToKindLimits), or null for none.
 * Each item names what was removed; everything else it had is kept.
 */
export function describeConformedItems(changes) {
  if (!changes?.length) return null;
  const items =
    changes.length === 1
      ? "1 item within its kind's limits"
      : `${changes.length} items within their kinds' limits`;
  return (
    `[scene-load] Brought ${items}; position and heading kept: ` +
    `${changes.map(describeChange).join(', ')}.`
  );
}
