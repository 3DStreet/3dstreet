// Load-time migration: legacy `streetmix-loader` streets that still rebuild
// on every load (#1720 §4, legacy parser removal).
//
// A legacy street normally saves with `synchronize: false` and its full
// expanded DOM, so it loads without the parser. Two saved shapes don't:
//
//  - `synchronize` still true, a Streetmix URL, and NO saved children (~320
//    scenes in the 2026-09-18 census, most from 2025-26): saved before the
//    Streetmix fetch finished, so the street only ever existed by
//    re-fetching and re-parsing on load. Without the parser it would open
//    empty. Convert it to a managed street from the same Streetmix URL,
//    keeping its transform and content toggles, the same mapping as the
//    editor's Convert to managed street command
//    (StreetConvertToManagedCommand). It loads re-fetched from Streetmix as
//    before, now rendered by managed-street; the next save persists it as a
//    managed street. A loader with no URL (~1,800 scenes: the empty
//    `default-street` placeholder older scenes carried) rendered nothing
//    and is left alone.
//
//  - `synchronize` still true WITH saved children (~40 scenes): the
//    saved street is the real content, and re-parsing it on load threw the
//    user's edits away. Mark it synchronized so the saved DOM loads as is.
//
// Runs on the saved JSON before entities are minted. AFRAME-free so it stays
// unit-testable.

// '' / 'a: 1; b: x' / {a, b} → plain object.
function parseProps(value) {
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

function stringifyProps(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

const isFalse = (v) => v === false || v === 'false';
// Properties default to true when absent, like the A-Frame schemas.
const bool = (v) => (v === undefined || v === '' ? true : !isFalse(v));

function hasChildren(node) {
  return Array.isArray(node.children) && node.children.length > 0;
}

// Mutates the saved-scene entity tree in place, depth-first. Returns counts
// of streets converted to managed and legacy streets marked synchronized.
export function migrateLegacyStreetmixLoader(entitiesData) {
  const result = { converted: 0, synchronized: 0 };
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const components = node.components;
      const rawLoader = components?.['streetmix-loader'];
      if (rawLoader !== undefined) {
        const loader = parseProps(rawLoader);
        if (!isFalse(loader.synchronize)) {
          if (hasChildren(node)) {
            loader.synchronize = false;
            components['streetmix-loader'] =
              typeof rawLoader === 'object' ? loader : stringifyProps(loader);
            result.synchronized++;
          } else {
            const url = loader.streetmixStreetURL || loader.streetmixAPIURL;
            if (url) {
              convertToManaged(node, url, loader);
              result.converted++;
              continue; // a fresh managed street has no saved children
            }
          }
        }
      }
      walk(node.children);
    }
  };
  walk(entitiesData);
  return result;
}

function convertToManaged(node, url, loader) {
  const street = parseProps(node.components.street);
  const length = Number(street.length);
  const managed = {
    sourceType: 'streetmix-url',
    sourceValue: url,
    length: Number.isFinite(length) && length > 0 ? length : 60,
    showBoundaries: bool(loader.showBuildings),
    showGround: bool(street.showGround),
    showStriping: bool(street.showStriping),
    showVehicles: bool(street.showVehicles),
    synchronize: true
  };
  const components = { 'managed-street': managed };
  // Keep the root's own placement and identity; the parser-only components
  // (street, streetmix-loader) are dropped. Scale, which a managed street
  // never carries, is removed later by conformToKindLimits.
  for (const [name, value] of Object.entries(node.components)) {
    if (name !== 'street' && name !== 'streetmix-loader') {
      components[name] = value;
    }
  }
  node.components = components;
  delete node.children;
}
