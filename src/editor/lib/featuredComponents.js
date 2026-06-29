// Featured components are promoted to first-class, expanded controls at the top
// of the properties sidebar, above the collapsed "Advanced Components" section.
//
// This generalizes a mechanism that previously lived only in
// StreetSegmentSidebar (FEATURED_COMPONENT_PREFIXES = ['street-generated-']) so
// that ANY primitive — Building Box, Asphalt Circle, Grass Box, image planes,
// etc. — gets its key geometry and material properties surfaced without digging
// into Advanced Components, plus any street-generated-* generator attached to it.
//
// See docs/host-generator-pattern.md for the host-primitive + generator pattern
// that this enables (Grass Box + street-generated-grass is the first example).

// Generator components follow the managed-children pattern (street-generated-*).
export const GENERATOR_COMPONENT_PREFIXES = ['street-generated-'];

// Everything promoted to the featured section on a generic entity: the geometry
// and material of the host primitive, plus any attached generators.
export const FEATURED_COMPONENT_PREFIXES = [
  'geometry',
  'material',
  ...GENERATOR_COMPONENT_PREFIXES
];

export function isFeaturedComponent(name) {
  return FEATURED_COMPONENT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function isGeneratorComponent(name) {
  return GENERATOR_COMPONENT_PREFIXES.some((prefix) => name.startsWith(prefix));
}

// Names of featured components actually present on an entity, ordered so the host
// primitive's geometry and material come first, then any generators.
export function getFeaturedComponentNames(entity) {
  if (!entity || !entity.components) {
    return [];
  }
  const order = (name) => {
    if (name === 'geometry') return 0;
    if (name === 'material') return 1;
    return 2;
  };
  return Object.keys(entity.components)
    .filter(isFeaturedComponent)
    .sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1));
}
