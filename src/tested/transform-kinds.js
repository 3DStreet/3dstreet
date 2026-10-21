// The kinds of item that declare transform limits, and the limits each one
// declares. One table, read by the command guard, by the levelling of entity
// data (scene load, paste, create) and by the command rewrite that levels an
// item as it becomes one of these kinds — so a kind added here is covered by
// all three.
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

// The class a saved scene carries on a user group. The same constant as
// groups/groupModel.js's; declared again because this module imports nothing
// from the editor, and a test keeps the two equal.
export const USER_GROUP_CLASS = 'user-group';

// In this order: the first kind an item has names it.
export const KINDS = Object.freeze([
  // A user group turns about the vertical axis only and is never scaled.
  Object.freeze({
    label: 'group',
    plural: 'groups',
    className: USER_GROUP_CLASS,
    markers: Object.freeze([YAW_ONLY, NO_SCALE])
  }),
  // A managed street is never scaled; it may tilt.
  Object.freeze({
    label: 'managed street',
    plural: 'managed streets',
    component: 'managed-street',
    markers: Object.freeze([NO_SCALE])
  }),
  // A managed intersection is never scaled; it may tilt.
  Object.freeze({
    label: 'managed intersection',
    plural: 'managed intersections',
    component: 'managed-intersection',
    markers: Object.freeze([NO_SCALE])
  }),
  // A drawn shape is never scaled, turns about the vertical axis only and
  // keeps its parent.
  Object.freeze({
    label: 'shape',
    plural: 'shapes',
    component: 'shape',
    markers: Object.freeze([NO_SCALE, YAW_ONLY, NO_REPARENT])
  })
]);

// The pose component each marker keeps within its limit. NO_REPARENT is about
// placement, so it levels nothing.
export const LEVELLED_BY_MARKER = Object.freeze({
  [NO_SCALE]: 'scale',
  [YAW_ONLY]: 'rotation'
});

const LEVELLED_ORDER = ['rotation', 'scale'];

/** The kind whose component is `component`, or undefined. */
export function kindByComponent(component) {
  return KINDS.find((kind) => kind.component && kind.component === component);
}

/** The kind with this label, or undefined. */
export function kindByLabel(label) {
  return KINDS.find((kind) => kind.label === label);
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
 * result, a create definition), in table order. A component counts when its
 * key is present, whatever its value: a migrated ruler carries `shape: ''`.
 */
export function kindsOfNode(node) {
  if (!node || typeof node !== 'object') return [];
  const classes = classListOf(node);
  const components = node.components ?? {};
  return KINDS.filter((kind) =>
    kind.className
      ? classes.includes(kind.className)
      : Object.hasOwn(components, kind.component)
  );
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
 * The pose components the given kinds keep within limits, in the order
 * rotation, scale: rotation for a yaw-only kind, scale for a no-scale kind.
 */
export function levelledComponents(kinds) {
  const levelled = markersOfKinds(kinds)
    .map((marker) => LEVELLED_BY_MARKER[marker])
    .filter(Boolean);
  return LEVELLED_ORDER.filter((component) => levelled.includes(component));
}
