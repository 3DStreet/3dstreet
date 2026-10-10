// What a user group is, and which hierarchy moves are legal.
//
// A user group is any entity carrying the `user-group` class, which the scene
// serializer persists. It is deliberately not `custom-group`: the Add Layer
// panel finds its own street-prop holders by that class.
//
// These predicates are the only source of legality for the layer panel's drop
// zones, for placement and for the command guard, so the three can never
// disagree about where an item may go.

export const USER_GROUP_CLASS = 'user-group';

const STREET_CONTAINER_ID = 'street-container';

// Items that keep the parent the editor gives them, so they never move into or
// out of a user group: street segments, shapes, the Starting View and anything
// marked not to be reparented, named by a component or attribute. Each is
// something an entity and its data (an `entitycreate` definition, or copied
// entity data) both carry, so the rule reads the same for an item that exists
// and for one about to be created.
const KEEPS_ITS_PARENT = [
  'street-segment',
  'shape',
  'viewer-start',
  'data-transform-no-reparent'
];
// The same, named by a class, which the scene serializer saves: generated
// content, and a backdrop that surrounds the whole scene (the 360° panorama),
// which would otherwise become a group's bounds.
const GENERATED_CLASS = 'autocreated';
export const BACKDROP_CLASS = 'scene-backdrop';
const KEEPS_ITS_PARENT_CLASSES = [GENERATED_CLASS, BACKDROP_CLASS];

export function isUserGroup(el) {
  return !!el?.classList?.contains(USER_GROUP_CLASS);
}

export function isStreetContainer(el) {
  return el?.id === STREET_CONTAINER_ID;
}

/** The scene and the fixed top-level layers, which the layer panel never moves. */
export function isContainer(el) {
  return (
    el.tagName === 'A-SCENE' ||
    el.id === STREET_CONTAINER_ID ||
    el.id === 'reference-layers' ||
    el.id === 'environment'
  );
}

/** Can `parentEl` take children moved or placed into it by the editor? */
export function canAcceptChild(parentEl) {
  return (
    !!parentEl?.isConnected &&
    (isStreetContainer(parentEl) || isUserGroup(parentEl))
  );
}

/**
 * May `child` end up under `newParent`?
 *
 * A move within the current parent is a reorder, which this model always
 * allows; whether a row can be dragged at all is the layer panel's own rule.
 * A move to another parent is allowed only between the scene's top level and
 * user groups, so generated street internals and anything inside a street or an
 * intersection never leave their parent, and a group never enters itself or
 * one of its own descendants.
 */
export function canReparent(child, newParent) {
  if (!child || !newParent) return false;
  if (child.parentNode === newParent) return true;
  if (!canAcceptChild(newParent)) return false;
  if (!canAcceptChild(child.parentNode)) return false;
  if (
    isContainer(child) ||
    child.id === 'cameraRig' ||
    KEEPS_ITS_PARENT_CLASSES.some((name) => child.classList.contains(name)) ||
    KEEPS_ITS_PARENT.some((name) => child.hasAttribute(name))
  ) {
    return false;
  }
  return newParent !== child && !child.contains(newParent);
}

/**
 * May an item described by `data` (an `entitycreate` definition, or entity
 * data from the serializer) be placed in a group? The item-level half of
 * canReparent's rule, the part an item's data carries; the parent and cycle
 * checks are the caller's.
 */
export function isGroupableItem(data) {
  const components = data?.components || {};
  if (KEEPS_ITS_PARENT.some((name) => name in components)) return false;
  const classes = Array.isArray(data?.class)
    ? data.class
    : String(data?.class || '').split(/\s+/);
  return !KEEPS_ITS_PARENT_CLASSES.some((name) => classes.includes(name));
}

// Items the editor creates on the user's behalf rather than ones the user
// adds: while a group is open, creating one tells the user nothing about
// groups and leaves the selection, and so the open group, as it was.
const SYSTEM_ITEM_COMPONENTS = ['viewer-start'];

/**
 * Is the item described by `data` (an `entitycreate` definition, or entity
 * data) one the editor makes for the user, such as the Starting View? Read
 * from its data, like isGroupableItem, so it answers before the item exists.
 */
export function isSystemItem(data) {
  const components = data?.components || {};
  return SYSTEM_ITEM_COMPONENTS.some((name) => name in components);
}

/** The user groups enclosing `el`, outermost first, excluding `el` itself. */
export function userGroupAncestors(el) {
  const groups = [];
  for (let node = el?.parentElement; node; node = node.parentElement) {
    if (isUserGroup(node)) groups.unshift(node);
  }
  return groups;
}

/**
 * Is `el` hidden by its own visibility or an ancestor's, as the layer panel's
 * eye sets it? Reads the object3D, which is what the eye toggles and what
 * mesh batching reads for its effective visibility.
 */
export function isHiddenInHierarchy(el) {
  for (let node = el; node && node.object3D; node = node.parentElement) {
    if (node.object3D.visible === false) return true;
  }
  return false;
}
