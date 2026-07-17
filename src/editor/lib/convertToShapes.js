/* global STREET */

/**
 * Convert-to-shapes (#1215): bake a live managed street into plain,
 * freely-editable entities.
 *
 * A managed street renders almost everything procedurally: street-segment
 * paints its own surface (geometry/material on the segment entity) and the
 * street-generated-* components create `autocreated` child entities (clones,
 * stencils, striping planes, rails) that the serializer normally skips —
 * they are regenerated from component config on every load. "Shapes" mode
 * inverts that: serialize the rendered output itself (includeAutocreated),
 * strip every managed component and the autocreated markers, and what's left
 * is an ordinary entity tree the user can clone, move, and delete piecemeal.
 */

// Managed machinery on the street root; street-segment and street-generated-*
// (matched by prefix) cover the segment children.
const MANAGED_ROOT_COMPONENTS = [
  'managed-street',
  'street-align',
  'street-ground',
  'street-label'
];

function isManagedComponentName(componentName) {
  return (
    MANAGED_ROOT_COMPONENTS.includes(componentName) ||
    componentName === 'street-segment' ||
    componentName.startsWith('street-generated-')
  );
}

// A material src selector that resolves to a <canvas> is runtime-only state:
// the canvas exists only while the component that painted it (street-label)
// is alive, so the entity cannot survive a save/load round trip.
function hasRuntimeCanvasMaterial(entityData) {
  const material = entityData.components?.material;
  if (typeof material !== 'string') {
    return false;
  }
  const srcMatch = material.match(/src:\s*#([^;\s]+)/);
  if (!srcMatch) {
    return false;
  }
  const referenced = document.getElementById(srcMatch[1]);
  return !!referenced && referenced.tagName === 'CANVAS';
}

// Entities that carry no renderable content once the managed components are
// stripped — e.g. street-generated-grass's holder, whose instanced mesh lives
// on object3D and can't serialize. Transform-only components don't count.
const NON_VISUAL_COMPONENTS = ['position', 'rotation', 'scale', 'visible'];

function isEmptyShape(entityData) {
  if (entityData.mixin || entityData.children?.length) {
    return false;
  }
  const componentNames = Object.keys(entityData.components || {});
  return componentNames.every((name) => NON_VISUAL_COMPONENTS.includes(name));
}

/**
 * Recursively rewrite serialized entity data (getElementData format) into its
 * plain-shapes form. Mutates and returns entityData; returns null for
 * entities that cannot exist outside the managed street (runtime canvas
 * textures, empty procedural holders).
 */
export function toShapesData(entityData) {
  if (hasRuntimeCanvasMaterial(entityData)) {
    return null;
  }

  if (entityData.components) {
    for (const componentName of Object.keys(entityData.components)) {
      if (isManagedComponentName(componentName)) {
        delete entityData.components[componentName];
      }
    }
    if (Object.keys(entityData.components).length === 0) {
      delete entityData.components;
    }
  }

  // Baked entities persist and are freely editable: drop the marker class
  // that excludes them from save and flags them as managed in the UI.
  if (entityData.class) {
    entityData.class = entityData.class.filter(
      (className) => className !== 'autocreated'
    );
    if (entityData.class.length === 0) {
      delete entityData.class;
    }
  }

  if (entityData.children) {
    entityData.children = entityData.children
      .map((child) => toShapesData(child))
      .filter(Boolean);
    if (entityData.children.length === 0) {
      delete entityData.children;
    }
  }

  if (isEmptyShape(entityData)) {
    return null;
  }

  return entityData;
}

/**
 * Rewrite the street root's display name for shapes mode. Managed streets
 * are named "<kind> • <street name>" (kind is "Managed Street" for
 * json-blob/template imports, "Street" for the streetmix loader); the
 * converted root must not read as managed, so the kind becomes
 * "Street Shapes". Names without a kind prefix (user renames) get the
 * prefix added so the layer still reads as converted.
 */
export function shapesLayerName(layerName) {
  const name = (layerName || '').trim();
  if (!name) {
    return 'Street Shapes';
  }
  const separatorIndex = name.indexOf('•');
  if (separatorIndex !== -1) {
    return 'Street Shapes • ' + name.slice(separatorIndex + 1).trim();
  }
  return 'Street Shapes • ' + name;
}

/**
 * Serialize a live managed-street entity into the entity-data form that
 * STREET.utils.createEntityFromObj can recreate as plain shapes.
 */
export function buildStreetShapesData(streetEntity) {
  const entityData = STREET.utils.getElementData(streetEntity, {
    includeAutocreated: true
  });
  const shapesData = toShapesData(entityData) || { id: entityData.id };
  // The root is a plain group now, but never "empty": keep it even if a
  // pathological street serialized to nothing so the command stays symmetric.
  shapesData['data-layer-name'] = shapesLayerName(
    entityData['data-layer-name']
  );
  return shapesData;
}
