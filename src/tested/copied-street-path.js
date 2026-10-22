// A copy that holds both a street and the shape it follows should follow its
// own copy of the shape, not the original (curved street paths).
//
// A managed street names its path as `#<id>`. Copying gives every element a
// new id and leaves that selector alone, so the copied street would keep
// following the original shape (or, for a cut and paste, a shape that is gone
// and draw straight). When the copy also holds the shape the street follows,
// the selector is pointed at the copy; a street copied without its shape keeps
// following the original. Both copy routes (duplicate and paste) record the
// ids they change as a Map of old id -> new id and call the rules here.
//
// Hand-rolled, with no A-Frame, so the module stays unit-testable.

/**
 * The id of the copy of the shape `selector` names, when `selector` is
 * `#<id>` and the copy made a new id for it; otherwise null. Any other form of
 * selector is left alone: the editor writes only `#<id>`.
 * @param {unknown} selector
 * @param {Map<string, string>} idMap old id -> new id
 * @returns {string|null}
 */
export function copiedPathTarget(selector, idMap) {
  if (typeof selector !== 'string') return null;
  const match = /^#([^\s;]+)$/.exec(selector.trim());
  if (!match) return null;
  return idMap.get(match[1]) ?? null;
}

// `path: #id` as a property of a style string: after the start or a `;`, and
// ending at the next `;` or the end, so `subpath:` and `#p10` for `#p1` never
// match.
const PATH_PROPERTY = /((?:^|;)\s*path\s*:\s*)#([^;\s]+)(?=\s*(?:;|$))/;

/**
 * The `managed-street` value (a style string or an object) with its `path`
 * pointed at the copy of the shape it names, when the copy holds one; the value
 * itself otherwise. Every other byte of a string, and every other property of
 * an object, is kept.
 * @param {string|object} value
 * @param {Map<string, string>} idMap old id -> new id
 */
export function retargetStreetPath(value, idMap) {
  if (value && typeof value === 'object') {
    const target = copiedPathTarget(value.path, idMap);
    return target === null ? value : { ...value, path: `#${target}` };
  }
  if (typeof value !== 'string') return value;
  return value.replace(PATH_PROPERTY, (whole, before, id) => {
    const target = copiedPathTarget(`#${id}`, idMap);
    return target === null ? whole : `${before}#${target}`;
  });
}
