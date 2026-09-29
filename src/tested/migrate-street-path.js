// Load-time migration: path-following streets saved with a shape reference
// (#1930 pillar 1 — street-owned centerlines).
//
// Before this, a curved managed street stored `managed-street.path: #shape`
// and rebuilt its curve from that shape entity's vertices at runtime. The
// street now OWNS its centerline (`managed-street.points`, street-local
// control points + curveType/filletRadius/closed), and a shape is only an
// authoring tool whose vertices are copied in. This pass performs that copy
// on the saved JSON before any entity is minted, so the street loads
// curved without depending on the shape resolving (or existing).
//
// It handles the common layout — street and shape as siblings, both upright
// (rotation about Y only) and unscaled, the shape unrotated — which is what
// every generated and hand-assigned path looked like. Anything else keeps
// its `path` value: managed-street's runtime resolver still copies from the
// live shape (with full transforms) and then clears `path`, so the outcome
// is the same, one frame later.
//
// The shape entity is left in place as a plain drawing; the user can delete
// it. Mutates the entity tree in place; returns the number of streets
// migrated (for tests and a one-line log).

import {
  formatCenterlinePoints,
  parentPointsToStreetLocal
} from './street-centerline.js';

const EPS_DEG = 1e-6;

// '' / 'length: 60; path: #p' / {length, path} → plain object
export function parseComponent(value) {
  if (value && typeof value === 'object') return { ...value };
  const out = {};
  for (const pair of String(value ?? '').split(';')) {
    const i = pair.indexOf(':');
    if (i === -1) continue;
    const key = pair.slice(0, i).trim();
    const val = pair.slice(i + 1).trim();
    if (key) out[key] = val;
  }
  return out;
}

export function stringifyComponent(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

// "1 2 3" / {x, y, z} / undefined → {x, y, z}
export function parseVec3(value, fallback = { x: 0, y: 0, z: 0 }) {
  if (value && typeof value === 'object') {
    return {
      x: Number(value.x) || 0,
      y: Number(value.y) || 0,
      z: Number(value.z) || 0
    };
  }
  if (typeof value === 'string' && value.trim()) {
    const [x, y, z] = value.trim().split(/\s+/).map(Number);
    return { x: x || 0, y: y || 0, z: z || 0 };
  }
  return { ...fallback };
}

function isUprightUnscaled(components, { allowYaw }) {
  const rot = parseVec3(components.rotation);
  if (Math.abs(rot.x) > EPS_DEG || Math.abs(rot.z) > EPS_DEG) return false;
  if (!allowYaw && Math.abs(rot.y) > EPS_DEG) return false;
  if (components.scale !== undefined) {
    const s = parseVec3(components.scale, { x: 1, y: 1, z: 1 });
    if (
      Math.abs(s.x - 1) > 1e-6 ||
      Math.abs(s.y - 1) > 1e-6 ||
      Math.abs(s.z - 1) > 1e-6
    ) {
      return false;
    }
  }
  return true;
}

function shapeVertexPositions(shapeNode) {
  const out = [];
  for (const child of shapeNode.children || []) {
    const comps = child?.components;
    if (!comps || !('shape-vertex' in comps)) continue;
    out.push(parseVec3(comps.position));
  }
  return out;
}

/**
 * Migrate every `managed-street` whose `path` names a sibling shape into an
 * owned `points` centerline. Returns the number migrated.
 */
export function migrateStreetPathToPoints(entitiesData) {
  let migrated = 0;
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const comps = node.components;
      if (comps && 'managed-street' in comps) {
        if (migrateOne(node, nodes)) migrated++;
      }
      walk(node.children);
    }
  };
  walk(entitiesData);
  return migrated;
}

function migrateOne(streetNode, siblings) {
  const comps = streetNode.components;
  const raw = comps['managed-street'];
  const ms = parseComponent(raw);
  const selector = typeof ms.path === 'string' ? ms.path.trim() : '';
  if (!selector) return false;
  if (ms.points) {
    // already owns its centerline (a re-saved scene): the stale reference
    // must not re-copy over user edits
    delete ms.path;
    comps['managed-street'] =
      raw && typeof raw === 'object' ? ms : stringifyComponent(ms);
    return true;
  }
  const id = selector.replace(/^#/, '');
  const shapeNode = siblings.find(
    (n) =>
      n &&
      n !== streetNode &&
      n.id === id &&
      n.components &&
      'shape' in n.components
  );
  if (!shapeNode) return false;
  if (!isUprightUnscaled(comps, { allowYaw: true })) return false;
  if (!isUprightUnscaled(shapeNode.components, { allowYaw: false })) {
    return false;
  }

  const vertices = shapeVertexPositions(shapeNode);
  if (vertices.length < 2) return false;

  const shapePos = parseVec3(shapeNode.components.position);
  const streetPos = parseVec3(comps.position);
  const yaw = parseVec3(comps.rotation).y;
  const parentPts = vertices.map((v) => ({
    x: shapePos.x + v.x,
    y: shapePos.y + v.y,
    z: shapePos.z + v.z
  }));
  const local = parentPointsToStreetLocal(parentPts, streetPos, yaw);

  const shape = parseComponent(shapeNode.components.shape);
  ms.points = formatCenterlinePoints(local);
  // The shape's own settings, verbatim: a deliberate linear path stays
  // linear (the schema default on shape is linear; on the street it is
  // smooth, so write it explicitly either way).
  ms.curveType = shape.curveType || 'linear';
  if (shape.filletRadius !== undefined && shape.filletRadius !== '') {
    ms.filletRadius = shape.filletRadius;
  }
  if (String(shape.closed) === 'true' && vertices.length >= 3) {
    ms.closed = true;
  }
  delete ms.path;
  comps['managed-street'] =
    raw && typeof raw === 'object' ? ms : stringifyComponent(ms);
  return true;
}
