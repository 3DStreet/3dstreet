/**
 * Generator seeds on duplicated entities (#1975).
 *
 * The street-generated-clones, -pedestrians and -grass generators lay out
 * their objects from a persisted `seed` (0 means "roll one and persist it").
 * A duplicated lane copies the attribute string verbatim, so both lanes get
 * literally identical traffic. Stripping `seed` from the copy's generator
 * attributes lets each generator roll a fresh seed when the clone loads.
 */

export const SEEDED_GENERATORS = [
  'street-generated-clones',
  'street-generated-pedestrians',
  'street-generated-grass'
];

/**
 * Whether an attribute name is a seeded generator component, with or without
 * a multiple-instance suffix (`street-generated-clones__2`).
 * @param {string} attrName
 * @returns {boolean}
 */
export function isSeededGenerator(attrName) {
  if (typeof attrName !== 'string') return false;
  const base = attrName.split('__')[0];
  return SEEDED_GENERATORS.includes(base);
}

/**
 * Remove the `seed` property from a component's style-string value
 * (`mode: random; seed: 4242; spacing: 20`), leaving every other property
 * verbatim. Returns the string unchanged when it carries no seed.
 * @param {string} value
 * @returns {string}
 */
export function withoutSeed(value) {
  if (typeof value !== 'string' || !/(^|;)\s*seed\s*:/.test(value)) {
    return value;
  }
  return value
    .split(';')
    .filter((entry) => !/^\s*seed\s*:/.test(entry))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join('; ');
}

/**
 * Names and de-seeded values of every seeded generator attribute in a list
 * of `{name, value}` attributes (e.g. `element.attributes`). Only entries
 * whose value actually changes are returned.
 * @param {Iterable<{name: string, value: string}>} attributes
 * @returns {Array<{name: string, value: string}>}
 */
export function reseededGeneratorAttributes(attributes) {
  const changes = [];
  for (const { name, value } of attributes) {
    if (!isSeededGenerator(name)) continue;
    const next = withoutSeed(value);
    if (next !== value) changes.push({ name, value: next });
  }
  return changes;
}
