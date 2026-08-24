/* global AFRAME, THREE */

/**
 * Street fill (naive v1): clone a managed street along each segment of a
 * polyline shape.
 *
 * For every consecutive vertex pair (A, B) of the shape (plus the wrap
 * segment when the shape is closed), one clone of the source street is
 * created with:
 *   - position at A (the segment's start vertex, at that vertex's height)
 *   - Y rotation so the street's local +z axis points at B
 *   - managed-street.length = the XZ distance A→B
 *   - street-align length 'end', which lays the street out spanning local
 *     z [0, +length] — i.e. the street's START endpoint (the one the
 *     endpoint-node gizmo shows at the origin under this alignment) sits
 *     exactly on the polyline vertex, per the naive design: no elbow or
 *     miter geometry at joints, segments simply meet at the shared vertex.
 *
 * The street is serialized from live DOM via
 * STREET.utils.getManagedStreetJSON (Format-2, re-imports via json-blob),
 * so per-segment edits on the source street carry into every clone.
 *
 * All clones are children of one wrapper entity, created through a single
 * entitycreate command — one undo step removes the whole fill. The fill is
 * a snapshot: editing the shape's vertices afterwards does NOT re-lay the
 * streets; run the fill again for a fresh wrapper.
 */

import { createUniqueId } from './entity.js';

// The XZ heading (degrees) that points an entity's local +z axis from a to b.
function yawDegreesTowards(a, b) {
  return THREE.MathUtils.radToDeg(Math.atan2(b.x - a.x, b.z - a.z));
}

// World-space vertex positions of a shape entity, in DOM order.
export function getShapeWorldVertices(shapeEl) {
  const shape = shapeEl?.components?.shape;
  if (!shape || typeof shape.getVertexEls !== 'function') return [];
  return shape
    .getVertexEls()
    .map((el) => el.object3D.getWorldPosition(new THREE.Vector3()));
}

// The managed streets a fill can clone: every managed street in the scene
// that is not itself part of a street-fill wrapper (filling with a fill's
// own output would double geometry on re-fill).
export function getFillableStreets() {
  return Array.from(
    document.querySelectorAll('a-entity[managed-street]')
  ).filter((el) => !el.parentElement?.hasAttribute?.('data-street-fill'));
}

// The fill wrappers previously created for this shape. The wrapper's
// data-street-fill attribute carries the shape's id, tying the two together
// without the shape schema having to persist an entity reference.
export function getShapeFillWrappers(shapeEl) {
  if (!shapeEl?.id) return [];
  return Array.from(
    document.querySelectorAll(`[data-street-fill="${shapeEl.id}"]`)
  );
}

// The id of the street a shape is currently filled with ('' when unfilled),
// read back off the wrapper so the UI reflects what is actually in the scene.
export function getShapeFillSourceId(shapeEl) {
  const wrapper = getShapeFillWrappers(shapeEl)[0];
  return wrapper?.getAttribute('data-street-fill-source') || '';
}

// One entry point for the sidebar: '' / null clears the fill, a street
// entity (re)fills with it. Both legs go through inspector commands, so
// each change is undoable; a re-fill is two undo steps (remove + create).
export function setShapeFill(shapeEl, streetEl) {
  getShapeFillWrappers(shapeEl).forEach((wrapper) => {
    AFRAME.INSPECTOR.execute('entityremove', wrapper);
  });
  if (!streetEl) return 0;
  return fillShapeWithStreet(shapeEl, streetEl);
}

export function fillShapeWithStreet(shapeEl, streetEl) {
  const points = getShapeWorldVertices(shapeEl);
  if (points.length < 2) {
    throw new Error('Shape needs at least 2 vertices to fill with a street');
  }
  const closed =
    !!shapeEl.components?.shape?.data?.closed && points.length >= 3;

  // The wrapper records the source street by id; make sure it has one.
  if (!streetEl.id) streetEl.id = createUniqueId();

  const streetJSON = window.STREET.utils.getManagedStreetJSON(streetEl);
  const sourceMS = streetEl.getAttribute('managed-street') || {};

  const shapeName =
    shapeEl.getAttribute('data-layer-name') || shapeEl.id || 'Shape';
  const streetName = streetJSON.name || 'Street';

  const segmentCount = closed ? points.length : points.length - 1;
  const children = [];
  for (let i = 0; i < segmentCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    // Managed streets lay out flat, so the clone takes the start vertex's
    // height and the XZ run as its length; any Y difference between the two
    // vertices is ignored (documented naive-v1 limitation).
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    if (length < 0.01) continue; // degenerate segment (coincident vertices)
    children.push({
      id: createUniqueId(),
      components: {
        position: `${a.x} ${a.y} ${a.z}`,
        rotation: `0 ${yawDegreesTowards(a, b)} 0`,
        'managed-street': {
          sourceType: 'json-blob',
          sourceValue: JSON.stringify({
            ...streetJSON,
            name: `${streetName} • fill ${i + 1}`,
            length
          }),
          showVehicles: sourceMS.showVehicles !== false,
          showStriping: sourceMS.showStriping !== false,
          synchronize: true
        },
        // Origin at the START endpoint (see module docblock) so the clone
        // begins exactly on its polyline vertex.
        'street-align': { width: 'center', length: 'end' },
        'data-layer-name': `${streetName} • fill ${i + 1}`
      }
    });
  }
  if (children.length === 0) {
    throw new Error('Shape has no segments with usable length');
  }

  const definition = {
    id: createUniqueId(),
    components: {
      'data-layer-name': `Street Fill • ${shapeName}`,
      'data-street-fill': shapeEl.id,
      'data-street-fill-source': streetEl.id
    },
    children
  };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
  return children.length;
}
