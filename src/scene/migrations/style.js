// Hand-rolled equivalents of AFRAME.utils.styleParser.parse / stringify for
// component values in saved scene JSON ("maps: tiles2d; opacity: 60").
// Kept AFRAME-free so the migrations stay pure and unit-testable in jsdom.
// Values stay strings: A-Frame coerces them by schema when the attribute is
// set, exactly as it does for the saved string.

/**
 * Parse a serialized component value into a plain object. An object is
 * shallow-copied so callers can mutate the result without touching the input.
 * @param {string|object|undefined} value
 * @returns {object}
 */
export function parseStyle(value) {
  if (value && typeof value === 'object') return { ...value };
  const out = {};
  for (const pair of String(value ?? '').split(';')) {
    const i = pair.indexOf(':');
    if (i === -1) continue;
    const key = pair.slice(0, i).trim();
    if (!key) continue;
    out[key] = pair.slice(i + 1).trim();
  }
  return out;
}

/** Inverse of parseStyle: `{a: 1, b: 'x'}` → `'a: 1; b: x'`. */
export function stringifyStyle(obj) {
  return Object.entries(obj)
    .map(([key, value]) => `${key}: ${value}`)
    .join('; ');
}

/**
 * Write a parsed value back in the form the input had: a string input gets a
 * re-stringified value, an object input gets the object.
 */
export function writeBack(original, parsed) {
  return typeof original === 'string' ? stringifyStyle(parsed) : parsed;
}

/**
 * Depth-first walk over a saved-scene entity tree (`data` array or any
 * `children` array), calling `visit(node)` for every object node.
 */
export function walkEntities(nodes, visit) {
  if (!Array.isArray(nodes)) return;
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    visit(node);
    walkEntities(node.children, visit);
  }
}
