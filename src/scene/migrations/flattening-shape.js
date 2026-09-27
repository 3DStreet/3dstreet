// Legacy flattening migration (#1476): street-geo used to reference a single
// flattening shape entity by id (`flatteningShape`); flattening volumes are
// now declared per-entity via geo-flatten components. Move the reference onto
// the target entity as a mesh-mode geo-flatten (preserving the legacy
// flatten-onto-the-box behavior) and drop the deprecated property so a
// re-save writes only the new form. Runs over the whole tree because the
// street-geo entity (reference-layers) and the shape live in different
// subtrees.
import { parseStyle, walkEntities, writeBack } from './style.js';

// 'create-default' was a transient sentinel the old UI could leave behind.
const TRANSIENT_SENTINEL = 'create-default';

/**
 * Mutates the saved-scene entity tree in place. Returns true when a
 * geo-flatten component was attached to the referenced shape.
 */
export function migrateLegacyFlatteningShape(entitiesData) {
  let targetId = null;
  walkEntities(entitiesData, (node) => {
    const components = node.components;
    const geoVal = components?.['street-geo'];
    if (geoVal === undefined || geoVal === null) return;
    const parsed = parseStyle(geoVal);
    if (!('flatteningShape' in parsed)) return;
    if (
      parsed.flatteningShape &&
      parsed.flatteningShape !== TRANSIENT_SENTINEL
    ) {
      targetId = parsed.flatteningShape;
    }
    delete parsed.flatteningShape;
    components['street-geo'] = writeBack(geoVal, parsed);
  });
  if (!targetId) return false;

  let attached = false;
  walkEntities(entitiesData, (node) => {
    if (attached || node.id !== targetId) return;
    node.components = node.components || {};
    if (!node.components['geo-flatten']) {
      node.components['geo-flatten'] = 'mode: mesh';
    }
    attached = true;
  });
  return attached;
}
