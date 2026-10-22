// The kinds of item that declare transform limits, and the limits each one
// declares. One table, read by the command guard, by the conforming of entity
// data (scene load, paste, create) and by the command rewrite that brings an
// item within its limits as it becomes one of these kinds — so a kind added
// here is covered by all three, at the command layer and in the data.
//
// The table does not set anything on a live entity. The stock gizmo and the
// properties panel's raw reads still look at the marker attributes, which each
// kind's component sets in its init; a test checks that the two agree.
//
// A kind is recognised by the class or component that makes an item that kind,
// never by the marker attributes alone: markers are not saved with a scene, and
// a visitor-build object carries them on a model whose mixin scale is the
// model's own size.
//
// Pure data: no AFRAME, no DOM globals, no logging.

export const NO_SCALE = 'data-transform-no-scale';
export const YAW_ONLY = 'data-transform-yaw-only';
export const NO_REPARENT = 'data-transform-no-reparent';

/** Every transform marker. */
export const MARKERS = Object.freeze([NO_SCALE, YAW_ONLY, NO_REPARENT]);

// The class a saved scene carries on a user group; groups/groupModel.js
// re-exports it.
export const USER_GROUP_CLASS = 'user-group';

// In this order: the first kind an item has names it. `id` identifies a kind
// in code; `label` and `plural` are the English words used in messages.
export const KINDS = Object.freeze([
  // A user group turns about the vertical axis only and is never scaled. Its
  // members keep their own scale.
  Object.freeze({
    id: 'group',
    label: 'group',
    plural: 'groups',
    className: USER_GROUP_CLASS,
    markers: Object.freeze([YAW_ONLY, NO_SCALE]),
    holdsMembers: true
  }),
  // A managed street is never scaled; it may tilt.
  Object.freeze({
    id: 'managed-street',
    label: 'managed street',
    plural: 'managed streets',
    component: 'managed-street',
    markers: Object.freeze([NO_SCALE])
  }),
  // A managed intersection is never scaled; it may tilt.
  Object.freeze({
    id: 'managed-intersection',
    label: 'managed intersection',
    plural: 'managed intersections',
    component: 'managed-intersection',
    markers: Object.freeze([NO_SCALE])
  }),
  // A drawn shape is never scaled, turns about the vertical axis only and
  // keeps its parent.
  Object.freeze({
    id: 'shape',
    label: 'shape',
    plural: 'shapes',
    component: 'shape',
    markers: Object.freeze([NO_SCALE, YAW_ONLY, NO_REPARENT])
  })
]);

// The pose component each marker keeps within its limit. NO_REPARENT is about
// placement, so it limits no pose component.
export const LIMITED_BY_MARKER = Object.freeze({
  [NO_SCALE]: 'scale',
  [YAW_ONLY]: 'rotation'
});

/** The pose components a kind can limit, in the order they are written. */
export const POSE_COMPONENTS = Object.freeze(['rotation', 'scale']);

/** The kind with this id, or undefined. */
export function kindById(id) {
  return KINDS.find((kind) => kind.id === id);
}

/** The kind whose component is `component`, or undefined. */
export function kindByComponent(component) {
  return KINDS.find((kind) => kind.component && kind.component === component);
}

/** Does this kind turn about the vertical axis only? */
export function isYawOnly(kind) {
  return kind.markers.includes(YAW_ONLY);
}

/**
 * The kinds that a class list and a components object make, in table order. A
 * component counts when it has a value, whatever it is: a migrated ruler
 * carries `shape: ''`. A null or undefined value is no component.
 */
export function kindsOf({ classes = [], components = {} } = {}) {
  return KINDS.filter((kind) =>
    kind.className
      ? classes.includes(kind.className)
      : components[kind.component] !== undefined &&
        components[kind.component] !== null
  );
}

// The class list as a saved node can carry it: a top-level `class` attribute
// or a `class` component, each a string or an array.
function classListOf(node) {
  const list = [];
  for (const value of [node.class, node.components?.class]) {
    if (Array.isArray(value)) list.push(...value.map(String));
    else if (typeof value === 'string') list.push(...value.split(/\s+/));
  }
  return list;
}

/**
 * The kinds of an entity-data node (a saved scene's entry, a getElementData
 * result, a create definition), in table order.
 */
export function kindsOfNode(node) {
  if (!node || typeof node !== 'object') return [];
  return kindsOf({
    classes: classListOf(node),
    components: node.components ?? {}
  });
}

/** The kinds of a live element, in table order. */
export function kindsOfEntity(el) {
  if (!el) return [];
  return KINDS.filter((kind) =>
    kind.className
      ? !!el.classList?.contains(kind.className)
      : !!el.hasAttribute?.(kind.component)
  );
}

/** Every marker the given kinds declare, without repeats. */
export function markersOfKinds(kinds) {
  const markers = [];
  for (const kind of kinds) {
    for (const marker of kind.markers) {
      if (!markers.includes(marker)) markers.push(marker);
    }
  }
  return markers;
}

/**
 * The pose components the given kinds limit, in the order rotation, scale:
 * rotation for a yaw-only kind, scale for a no-scale kind.
 */
export function limitedComponents(kinds) {
  const limited = markersOfKinds(kinds)
    .map((marker) => LIMITED_BY_MARKER[marker])
    .filter(Boolean);
  return POSE_COMPONENTS.filter((component) => limited.includes(component));
}
