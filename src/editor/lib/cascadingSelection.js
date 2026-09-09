/**
 * Figma-style cascading click selection (epic #1720).
 *
 * A single viewport click never selects the raw intersected entity directly.
 * Instead it selects one step down the intersected entity's ancestor chain,
 * starting from the topmost selectable ancestor: with nothing selected,
 * clicking a vehicle inside a managed street selects the street; clicking
 * again selects the street-segment; clicking again selects the vehicle.
 * "Keep clicking to drill in", exactly like Figma's nested-group selection.
 *
 * The rules generalize beyond streets — any nested entity tree cascades the
 * same way — and reduce to plain direct selection for top-level entities
 * (chain of length one).
 */

// Grouping-only elements that head the scene graph; a chain never includes
// them and never crosses above them (mirrors isContainer in
// editor/components/scenegraph/Entity.jsx, minus A-SCENE which is handled
// by the tag check).
const CONTAINER_IDS = ['street-container', 'reference-layers', 'environment'];

function isContainerLike(el) {
  return el.tagName === 'A-SCENE' || CONTAINER_IDS.includes(el.id);
}

// Ancestors that may appear as intermediate cascade stops. The intersected
// entity itself always stays in the chain regardless of this filter.
function isSelectableAncestor(el) {
  if (!el.isEntity || isContainerLike(el)) return false;
  const dataset = el.dataset || {};
  if (el.isInspector || dataset.isInspector || 'aframeInspector' in dataset) {
    return false;
  }
  if (el.classList && el.classList.contains('hideFromSceneGraph')) {
    return false;
  }
  return true;
}

/**
 * Ancestor chain of an intersected entity, ordered top-down:
 * [topmost selectable ancestor, ..., intersectedEl].
 * Walks up until the scene, a container element, or a non-entity parent.
 */
export function getSelectionChain(intersectedEl) {
  const chain = [intersectedEl];
  let node = intersectedEl.parentElement;
  while (node && node.isEntity && !isContainerLike(node)) {
    if (isSelectableAncestor(node)) {
      chain.unshift(node);
    }
    node = node.parentElement;
  }
  return chain;
}

/**
 * Resolve what a click on `intersectedEl` should select, given the current
 * selection. Returns null for a click on empty space (deselect).
 *
 * - Nothing selected → the top of the chain (e.g. the managed street).
 * - Selection on the chain → one step deeper toward the click target
 *   (clicking the deepest entity keeps it selected).
 * - Selection elsewhere → Figma's "entered scope" rule: the ancestors of the
 *   current selection are the scopes the user has drilled into; select the
 *   child of the deepest such scope that also contains the click target.
 *   E.g. with a vehicle selected, clicking a vehicle in a sibling segment
 *   selects that segment; clicking a sibling vehicle in the same segment
 *   selects it directly.
 * - Selection in an unrelated tree → back to the top of the chain.
 */
export function resolveClickSelection(intersectedEl, selectedEntity) {
  if (!intersectedEl) return null;
  const chain = getSelectionChain(intersectedEl);
  if (!selectedEntity) return chain[0];

  const selectedIndex = chain.indexOf(selectedEntity);
  if (selectedIndex !== -1) {
    return chain[Math.min(selectedIndex + 1, chain.length - 1)];
  }

  let node = selectedEntity.parentElement;
  while (node && node.isEntity) {
    const scopeIndex = chain.indexOf(node);
    if (scopeIndex !== -1) {
      return chain[Math.min(scopeIndex + 1, chain.length - 1)];
    }
    node = node.parentElement;
  }
  return chain[0];
}
