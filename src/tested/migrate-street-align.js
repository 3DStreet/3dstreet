// Load-time migration: managed streets saved before street-align was always
// written explicitly (#1863).
//
// The street-align length default flipped from 'start' to 'middle'. Before
// the flip the serializer stripped default-valued props, so a street at the
// old default was saved as `"street-align": ""` (or without the component at
// all) and its 'start' alignment lived only in the schema. Since the flip the
// serializer writes width and length on every managed street, so a missing
// length can only mean a pre-flip file: stamp 'start' so the street stays
// where its author placed it. Stamping into the JSON before entities are
// minted means the next save writes the value out explicitly and this pass
// never applies to that scene again (old scenes self-heal on save).
//
// Runtime-created streets (Add Layer panel, URL-hash imports, AI tools) do
// not pass through here — they get the schema default, 'middle'.

export const LEGACY_LENGTH_ALIGN = 'start';

// '' / 'width: left; length: end' / {width, length} → {width?, length?}.
// Hand-rolled so the module stays AFRAME-free and unit-testable.
function parseAlign(value) {
  if (value && typeof value === 'object') return { ...value };
  const out = {};
  for (const pair of String(value ?? '').split(';')) {
    const i = pair.indexOf(':');
    if (i === -1) continue;
    const key = pair.slice(0, i).trim();
    const val = pair.slice(i + 1).trim();
    if (key && val) out[key] = val;
  }
  return out;
}

function stringifyAlign(obj) {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('; ');
}

// Mutates the saved-scene entity tree in place, depth-first. Returns the
// number of streets stamped (handy for tests and a one-line log).
export function migrateImplicitStreetAlign(entitiesData) {
  let stamped = 0;
  const walk = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const components = node.components;
      if (components && 'managed-street' in components) {
        const raw = components['street-align'];
        const align = parseAlign(raw);
        if (!align.length) {
          align.length = LEGACY_LENGTH_ALIGN;
          components['street-align'] =
            raw && typeof raw === 'object' ? align : stringifyAlign(align);
          stamped++;
        }
      }
      walk(node.children);
    }
  };
  walk(entitiesData);
  return stamped;
}
