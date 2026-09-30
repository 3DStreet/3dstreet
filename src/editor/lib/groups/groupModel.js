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

export function isUserGroup(el) {
  return !!el?.classList?.contains(USER_GROUP_CLASS);
}

function isStreetContainer(el) {
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
    child.classList.contains('autocreated') ||
    child.hasAttribute('viewer-start') ||
    child.id === 'cameraRig' ||
    child.hasAttribute('street-segment') ||
    child.hasAttribute('data-transform-no-reparent')
  ) {
    return false;
  }
  return newParent !== child && !child.contains(newParent);
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
