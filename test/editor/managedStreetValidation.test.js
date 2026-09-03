import { describe, expect, it } from 'vitest';
import {
  validateSegment,
  validateSegments
} from '../../src/editor/lib/commands/managedStreetValidation.js';

// Mirrors the live street-segment / street-generated-stencil schemas.
const enums = {
  types: ['drive-lane', 'bike-lane', 'sidewalk', 'bus-lane', 'boundary'],
  surfaces: ['asphalt', 'concrete', 'grass'],
  directions: ['none', 'inbound', 'outbound'],
  variants: ['brownstone', 'suburban', 'custom'],
  sides: ['left', 'right'],
  stencils: ['sharrow', 'bike-arrow', 'word-bus', 'word-only'],
  mixins: ['sedan-rig', 'tree3']
};

describe('managed street segment validation', () => {
  it('accepts a plain valid segment', () => {
    expect(
      validateSegment({ type: 'drive-lane', surface: 'asphalt' }, 0, enums)
    ).toEqual([]);
  });

  it('rejects an unknown segment type listing the valid ones', () => {
    expect(() => validateSegment({ type: 'brt-lane' }, 1, enums)).toThrow(
      /segments\[1\]\.type: 'brt-lane' is not valid\. Valid values: drive-lane/
    );
  });

  it('rejects unknown stencil names (the bike-symbol / bus-only case)', () => {
    expect(() =>
      validateSegment(
        {
          type: 'bus-lane',
          generated: {
            stencil: [{ modelsArray: 'bus-only, word-bus', spacing: 20 }]
          }
        },
        0,
        enums
      )
    ).toThrow(/unknown stencil\(s\) bus-only\. Valid stencils: sharrow/);
  });

  it('accepts comma-separated known stencils and array form', () => {
    expect(
      validateSegment(
        {
          type: 'bike-lane',
          generated: {
            stencil: [{ modelsArray: ['bike-arrow', 'sharrow'], spacing: 20 }]
          }
        },
        0,
        enums
      )
    ).toEqual([]);
  });

  it('rejects unknown clone models when a mixin list is provided', () => {
    expect(() =>
      validateSegment(
        {
          type: 'drive-lane',
          generated: {
            clones: [{ mode: 'random', modelsArray: 'sedan-rig, bus-x' }]
          }
        },
        0,
        enums
      )
    ).toThrow(/unknown model\(s\) bus-x/);
  });

  it('skips clone-model checks when mixins is null', () => {
    expect(
      validateSegment(
        {
          type: 'drive-lane',
          generated: { clones: [{ mode: 'random', modelsArray: 'anything' }] }
        },
        0,
        { ...enums, mixins: null }
      )
    ).toEqual([]);
  });

  it('requires side on a boundary and validates variant', () => {
    expect(() =>
      validateSegment({ type: 'boundary', variant: 'brownstone' }, 2, enums)
    ).toThrow(/requires side/);
    expect(() =>
      validateSegment(
        { type: 'boundary', variant: 'mixed-use', side: 'left' },
        2,
        enums
      )
    ).toThrow(/variant: 'mixed-use' is not valid/);
    expect(
      validateSegment(
        { type: 'boundary', variant: 'brownstone', side: 'left' },
        2,
        enums
      )
    ).toEqual([]);
  });

  it('warns (does not throw) for variant/side on a non-boundary', () => {
    const warnings = validateSegments(
      [{ type: 'sidewalk', variant: 'brownstone', side: 'left' }],
      enums
    );
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/only meaningful for type 'boundary'/);
  });

  it('tolerates a missing segments array', () => {
    expect(validateSegments(undefined, enums)).toEqual([]);
  });
});
