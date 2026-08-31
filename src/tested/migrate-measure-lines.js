// Load-time migration: measure-line entities (the removed Ruler tool) become
// two-vertex open `shape` polylines, so old scenes keep their measurements
// with the tool that owns measuring now (readout chips on hover/selection,
// vertex editing, streets can follow them as paths).
//
// Runs on the saved JSON before any entity is minted (createEntities in
// json-utils_1.1.js, beside migrateLegacyFlatteningShape), so the editor and
// viewer only ever see shapes. Everything else on the entity — its
// data-layer-name ("Measure Line • N"), transform, id — carries over
// untouched; measure-line stored start/end in the entity's own frame, which
// is exactly the frame shape-vertex children live in. Style is the shape
// schema's defaults: the ruler had no styling of its own to carry over.
//
// The measure-line component itself is gone: this pass is the only thing
// that still understands the old form, and nothing creates new ones.

// '1 2 3' or {x, y, z} → {x, y, z} with non-finite axes coerced to 0, the
// same forgiveness A-Frame's own vec3 parse applies.
function parseVec3(value) {
  if (value && typeof value === 'object') {
    return { x: num(value.x), y: num(value.y), z: num(value.z) };
  }
  const parts = String(value ?? '')
    .trim()
    .split(/\s+/);
  return { x: num(parts[0]), y: num(parts[1]), z: num(parts[2]) };
}

function num(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

// 'start: 1 2 3; end: 4 5 6' → { start: '1 2 3', end: '4 5 6' }. Only the two
// props measure-line ever had; a hand-rolled parse keeps this module pure of
// AFRAME so it stays unit-testable.
function parseMeasureLine(value) {
  if (value && typeof value === 'object') return value;
  const out = {};
  for (const pair of String(value ?? '').split(';')) {
    const i = pair.indexOf(':');
    if (i === -1) continue;
    out[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return out;
}

function vertexNode(p) {
  return {
    components: {
      position: `${p.x} ${p.y} ${p.z}`,
      'shape-vertex': ''
    }
  };
}

// Mutates the saved-scene entity tree in place, depth-first, converting every
// node that carries a measure-line component. Safe on trees with no rulers
// (the common case) and idempotent: a converted node has no measure-line left
// to match.
export function migrateMeasureLinesToShapes(nodes) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const components = node.components;
    if (components && components['measure-line'] !== undefined) {
      const parsed = parseMeasureLine(components['measure-line']);
      const start = parseVec3(parsed.start);
      const end = parseVec3(parsed.end);
      delete components['measure-line'];
      if (components.shape === undefined) components.shape = '';
      if (!Array.isArray(node.children)) node.children = [];
      node.children.push(vertexNode(start), vertexNode(end));
    }
    if (Array.isArray(node.children)) {
      migrateMeasureLinesToShapes(node.children);
    }
  }
}
