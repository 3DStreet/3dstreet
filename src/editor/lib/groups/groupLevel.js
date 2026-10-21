// Levelling a constrained item at the command layer. An item whose kind
// forbids scale or tilt (tested/transform-kinds.js: a user group, a managed
// street or intersection, a shape) always meets its kind's limits
// (tested/group-pose.js levels data being loaded, pasted or created). This
// module handles a live entity BECOMING such a kind, or one whose shown pose a
// command would take outside its limits, by rewriting the command into a
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
import {
  YAW_ONLY,
  kindByComponent,
  kindByLabel,
  kindsOfEntity,
  levelledComponents
} from '@/tested/transform-kinds.js';

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
 * before (as {x, y, z}), whether the write made the item that kind (`became`),
 * and the label of the kind it is levelled for. Null when nothing was removed.
 */
function levelledRecord(removed, became, kind) {
  return removed.rotation || removed.scale
    ? { ...removed, became, kind: kind.label }
    : null;
}

// The kinds an entity has once `extra` is added, in table order.
function withKind(kinds, extra) {
  return kinds.includes(extra) ? kinds : [...kinds, extra];
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

// The tuples that level what `entity` shows now, for `kinds`, and the values
// they remove.
function levellingTuples(entity, kinds) {
  const tuples = [];
  const removed = {};
  for (const name of levelledComponents(kinds)) {
    const shown = shownValue(entity, name);
    if (conforms(name, shown)) continue;
    tuples.push(levelTuple(entity, name, levelledString(name, shown)));
    removed[name] = shown;
  }
  return { tuples, removed };
}

// A class write: level what the entity shows now for the kinds it has after
// the write — its kinds by component, and a group when the class leaves it one.
function routeClassWrite(payload) {
  const { entity } = payload;
  const byComponent = kindsOfEntity(entity).filter((kind) => kind.component);
  const group = kindByLabel('group');
  const makesGroup = classAfterUpdate(payload).includes(USER_GROUP_CLASS);
  const kinds = makesGroup ? [group, ...byComponent] : byComponent;
  if (kinds.length === 0) return null;
  const { tuples, removed } = levellingTuples(entity, kinds);
  if (tuples.length === 0) return null;
  const became = makesGroup && !isUserGroup(entity);
  return {
    cmdName: 'multi',
    payload: [['entityupdate', payload], ...tuples],
    levelled: levelledRecord(removed, became, kinds[0])
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
// of one: the levelling runs first, so the component starts on an entity
// already within its limits. The batch keeps the name of the command asked
// for.
function routeKindWrite(cmdName, payload, kind) {
  const { entity } = payload;
  const before = kindsOfEntity(entity);
  const { tuples, removed } = levellingTuples(entity, withKind(before, kind));
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
// does not conform is levelled, keeping its facing. When the incoming mixins
// cannot be read, the values are written explicitly, since an own value
// outranks a mixin's.
function routeMixinWrite(payload) {
  const { entity } = payload;
  const kinds = kindsOfEntity(entity);
  if (kinds.length === 0) return null;
  const incoming = payload.property ? null : readMixinPose(payload.value);
  const tuples = [['entityupdate', payload]];
  const removed = {};
  for (const name of levelledComponents(kinds)) {
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
    levelled: levelledRecord(removed, false, kinds[0])
  };
}

// Removing a constrained item's scale or rotation while it has a mixin lets
// the mixin's value show. Left alone when its kind does not level that
// component or the value conforms; otherwise the removal is written as the
// levelled value (or, when the mixins cannot be read, as the explicit
// default).
function routeRemoval(entity, component) {
  if (!levelledComponents(kindsOfEntity(entity)).includes(component)) {
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
      value: levelledString(component, supplied)
    },
    levelled: null
  };
}

// The kinds a detach's components give the plain entity it creates: a group by
// the class, the others by their component.
function kindsOfDetach(components) {
  if (!components) return [];
  const kinds = [];
  const cls = components.class;
  if (
    cls !== undefined &&
    classAfterUpdate({ value: cls }).includes(USER_GROUP_CLASS)
  ) {
    kinds.push(kindByLabel('group'));
  }
  for (const [name, value] of Object.entries(components)) {
    const kind = kindByComponent(name);
    if (kind && value !== null && value !== undefined) kinds.push(kind);
  }
  return kinds;
}

// An edit on a generated street clone that makes it a constrained kind (a
// class that makes a group, or a kind's component) has already been routed
// into a detach; level the plain entity the detach creates, for that kind's
// components only.
function routeDetach(payload) {
  const kinds = kindsOfDetach(payload.components);
  if (kinds.length === 0) return null;
  const clone = payload.entity;
  const pose = payload.pose || {};
  const removed = {};
  const levelledPose = {};
  for (const name of levelledComponents(kinds)) {
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
    levelled: levelledRecord(removed, true, kinds[0])
  };
}

// A batch is rewritten member by member. Each member is a tuple
// [type, payload, callback]; a member that expands into a batch keeps its
// callback on its own (first) tuple. Only the first levelled member is
// reported: no caller sends a batch that levels more than one item.
function routeMulti(tuples) {
  if (!Array.isArray(tuples)) return null;
  let changed = false;
  let levelled = null;
  const out = [];
  for (const tuple of tuples) {
    const routed = routeTransformLevel(tuple?.[0], tuple?.[1]);
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
 * Fires for a class write on an entity that is a constrained kind after it, a
 * write that adds or updates a kind's component, a mixin write on a kind, a
 * removal of the scale or rotation a kind levels while it has a mixin, a
 * detach that makes a kind, and any `multi` holding one of these.
 */
export function routeTransformLevel(cmdName, payload) {
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

function ruleFor(kind, yawOnly) {
  return yawOnly
    ? `${kind.plural} turn only about the vertical axis and are never scaled.`
    : `${kind.plural} are never scaled.`;
}

function endingFor({ rotation, scale }, kind, yawOnly) {
  const newY = rotation && levelledValue('rotation', rotation).y;
  const unchanged = yawOnly
    ? 'Its heading and position are unchanged.'
    : 'Its rotation and position are unchanged.';
  const facing =
    rotation && !sameFacing(newY, rotation.y)
      ? `It faces the same way and its position is unchanged; its rotation is now 0 ${tidy(newY)} 0.`
      : unchanged;
  return scale && kind.className === USER_GROUP_CLASS
    ? `${facing} The items in it keep their own sizes.`
    : facing;
}

/**
 * The sentence the AI is told when a command levelled a constrained item, from
 * a levelledRecord. English on purpose, like every tool result: it is read by
 * the model, never shown in the UI.
 */
export function describeLevelledPose(levelled) {
  if (!levelled) return null;
  const kind = kindByLabel(levelled.kind);
  const yawOnly = kind.markers.includes(YAW_ONLY);
  const subject = levelled.became
    ? `The item is now a ${kind.label}, so its`
    : `This ${kind.label}'s`;
  return `${subject} ${removedParts(levelled)}; ${ruleFor(kind, yawOnly)} ${endingFor(levelled, kind, yawOnly)}`;
}
