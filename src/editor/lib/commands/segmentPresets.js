/**
 * Segment type presets for the LLM tools.
 *
 * `STREET.types` (TYPES in street-segment.js) is what the editor applies
 * when a user picks a segment type in the sidebar: surface, color,
 * elevation, default direction, and the generated content (stencils,
 * vehicles, pedestrians…). The tools apply the same table for every field
 * the model leaves out, so an agent's bike lane gets bike arrows and
 * cyclists exactly like a human's — no special powers, no bare grey slabs.
 *
 * Pure so it can be unit-tested without A-Frame; callers pass `STREET.types`.
 */

const PRESET_SCALARS = ['color', 'surface', 'elevation', 'direction'];

/**
 * @returns {{ segment: object, applied: string[] }} a new segment with
 *   preset values filled in for omitted fields, and which fields came from
 *   the preset.
 */
export function applySegmentPreset(segment, types) {
  const out = { ...segment };
  const preset = types?.[segment?.type];
  const applied = [];
  if (!preset) return { segment: out, applied };
  for (const key of PRESET_SCALARS) {
    if (out[key] === undefined && preset[key] !== undefined) {
      out[key] = preset[key];
      applied.push(key);
    }
  }
  if (out.generated === undefined && preset.generated) {
    out.generated = JSON.parse(JSON.stringify(preset.generated));
    applied.push('generated');
  }
  // Boundary presets carry per-variant model overrides that the segment
  // component reads off the same object it generates from. Deep-cloned so a
  // downstream mutation can't leak back into STREET.types.
  if (out.variants === undefined && preset.variants) {
    out.variants = JSON.parse(JSON.stringify(preset.variants));
    applied.push('variants');
  }
  return { segment: out, applied };
}

/** Compact, model-facing summary of every preset (for listSegmentPresets). */
export function summarizePresets(types) {
  return Object.entries(types || {}).map(([type, preset]) => {
    const generated = {};
    for (const [kind, entries] of Object.entries(preset.generated || {})) {
      generated[kind] = (entries || []).map((e) =>
        e.modelsArray !== undefined
          ? e.modelsArray
          : e.density !== undefined
            ? `density: ${e.density}`
            : e.striping !== undefined
              ? e.striping
              : JSON.stringify(e)
      );
    }
    const out = {
      type,
      surface: preset.surface,
      color: preset.color,
      elevation: preset.elevation ?? 0,
      direction: preset.direction,
      generated
    };
    if (preset.variants) out.variants = Object.keys(preset.variants);
    return out;
  });
}
