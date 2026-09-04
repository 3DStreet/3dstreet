/**
 * Input validation for the managedStreetCreate / managedStreetUpdate tools.
 *
 * A-Frame silently ignores unknown enum values and unknown stencil / model
 * names, so without this the tool reports "created" for content that never
 * appears (a boundary variant that is dropped, a `bus-only` stencil that does
 * not exist). Enums are read from the live component schemas so this can't
 * drift from what actually renders; the pure `validateSegment` takes them as
 * a parameter so it is unit-testable without A-Frame.
 */

const BOUNDARY_ONLY = ['variant', 'side'];

function splitNames(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim());
  return String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function checkEnum(value, allowed, field, index) {
  if (value === undefined || value === null) return;
  if (!allowed.includes(value)) {
    throw new Error(
      `segments[${index}].${field}: '${value}' is not valid. Valid values: ${allowed.join(', ')}`
    );
  }
}

/**
 * @param {object} segment  One segment as supplied by the model.
 * @param {number} index    Position in the segments array (for messages).
 * @param {object} enums    { types, surfaces, directions, variants, sides,
 *                            stencils, mixins } — arrays of valid ids.
 *                            `mixins` may be null to skip clone-model checks.
 * @returns {string[]} non-fatal warnings (e.g. variant on a non-boundary).
 */
export function validateSegment(segment, index, enums) {
  const warnings = [];
  if (!segment || typeof segment !== 'object') {
    throw new Error(`segments[${index}] must be an object`);
  }
  checkEnum(segment.type, enums.types, 'type', index);
  checkEnum(segment.surface, enums.surfaces, 'surface', index);
  checkEnum(segment.direction, enums.directions, 'direction', index);

  if (segment.type === 'boundary') {
    if (!segment.side) {
      throw new Error(
        `segments[${index}]: type 'boundary' requires side ('left' or 'right')`
      );
    }
    checkEnum(segment.variant, enums.variants, 'variant', index);
    checkEnum(segment.side, enums.sides, 'side', index);
  } else {
    for (const field of BOUNDARY_ONLY) {
      if (segment[field] !== undefined) {
        warnings.push(
          `segments[${index}].${field} is only meaningful for type 'boundary' and was ignored`
        );
      }
    }
  }

  const generated = segment.generated;
  if (generated && typeof generated === 'object') {
    const stencils = Array.isArray(generated.stencil) ? generated.stencil : [];
    stencils.forEach((entry, i) => {
      const bad = splitNames(entry?.modelsArray).filter(
        (name) => !enums.stencils.includes(name)
      );
      if (bad.length) {
        throw new Error(
          `segments[${index}].generated.stencil[${i}].modelsArray: unknown stencil(s) ${bad.join(', ')}. Valid stencils: ${enums.stencils.join(', ')}`
        );
      }
    });
    if (enums.mixins) {
      const clones = Array.isArray(generated.clones) ? generated.clones : [];
      clones.forEach((entry, i) => {
        const bad = splitNames(entry?.modelsArray).filter(
          (name) => !enums.mixins.includes(name)
        );
        if (bad.length) {
          throw new Error(
            `segments[${index}].generated.clones[${i}].modelsArray: unknown model(s) ${bad.join(', ')}. Use listMixins to find valid model ids.`
          );
        }
      });
    }
  }
  return warnings;
}

/** Validate every segment; returns the combined warnings. */
export function validateSegments(segments, enums) {
  if (!Array.isArray(segments)) return [];
  return segments.flatMap((segment, i) => validateSegment(segment, i, enums));
}

/** Read the valid-value lists from the live A-Frame component schemas. */
export function readSegmentEnums({ mixins = null } = {}) {
  const seg = AFRAME.components['street-segment']?.schema || {};
  const stencil = AFRAME.components['street-generated-stencil']?.schema || {};
  return {
    types: seg.type?.oneOf || [],
    surfaces: seg.surface?.oneOf || [],
    directions: seg.direction?.oneOf || [],
    variants: seg.variant?.oneOf || [],
    sides: seg.side?.oneOf || [],
    stencils: stencil.modelsArray?.oneOf || [],
    mixins
  };
}
