/* global AFRAME */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SHAPE_STYLE,
  normaliseShapeStyle
} from '../../src/editor/lib/shapeStyle.js';
import {
  PATTERN_SPACING_DEFAULT,
  PATTERN_SPACING_MIN,
  PATTERN_WIDTH_DEFAULT,
  PATTERN_WIDTH_MIN
} from '../../src/tested/shape-fill.js';

// shape.js statically imports the app store, which pulls in the Firebase/PostHog
// dependency chain at module scope — the same two-method stub the other shape
// component tests use.
vi.mock('../../src/store.js', () => ({
  default: {
    getState: () => ({ unitsPreference: 'metric' }),
    subscribe: () => () => {}
  }
}));

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  await import('../../src/aframe-components/shape.js');
  window.AFRAME.emitReady();
});

// The sticky-style defaults deliberately MIRROR the shape schema's literals
// rather than reading them, so that an A-Frame schema still carries a literal
// default where a reader expects one. This is what keeps the two honest: change
// either side alone and this fails.
describe('shape schema defaults vs DEFAULT_SHAPE_STYLE', () => {
  it('agrees on every sticky appearance default', () => {
    const schema = AFRAME.components.shape.schema;
    const keys = Object.keys(DEFAULT_SHAPE_STYLE);
    expect(keys).toHaveLength(11);
    for (const key of keys) {
      expect(schema[key].default).toBe(DEFAULT_SHAPE_STYLE[key]);
    }
    // Angle and Offset are per shape: schema properties, never sticky.
    for (const key of ['fillAngle', 'fillOffsetAlong', 'fillOffsetAcross']) {
      expect(schema[key]).toBeDefined();
      expect(key in DEFAULT_SHAPE_STYLE).toBe(false);
    }
  });

  // The shipped fill defaults. Frozen once released, because a saved scene
  // omits any value equal to its default.
  it('keeps the shipped fill defaults', () => {
    const schema = AFRAME.components.shape.schema;
    const defaults = Object.fromEntries(
      [
        'fillMaterial',
        'fillOpacity',
        'fillPattern',
        'fillPatternOpacity',
        'fillPatternColor',
        'fillPatternSpacing',
        'fillPatternWidth',
        'fillTint',
        'fillAngle',
        'fillOffsetAlong',
        'fillOffsetAcross'
      ].map((key) => [key, schema[key].default])
    );
    expect(defaults).toEqual({
      fillMaterial: 'solid',
      fillOpacity: 40,
      fillPattern: 'none',
      fillPatternOpacity: 100,
      fillPatternColor: '#ffffff',
      fillPatternSpacing: 1,
      fillPatternWidth: 0.15,
      fillTint: '#ffffff',
      fillAngle: 0,
      fillOffsetAlong: 0,
      fillOffsetAcross: 0
    });
  });

  // Unlike the test above this compares nothing: the spec's min/max are not
  // exported, so these are literals restated here. It pins the SCHEMA's bounds
  // against silent drift. They are not required to match the sticky store's
  // clamps — the store floors `lineWidth` above zero because zero is a poor
  // DEFAULT, while zero remains a legal width on the component. What the store
  // clamps to is covered by the unit suite (test/editor/shapeStyle.test.js).
  it('declares the expected schema bounds on the numeric properties', () => {
    const schema = AFRAME.components.shape.schema;
    expect(schema.lineWidth.min).toBe(0);
    expect(schema.fillOpacity.min).toBe(0);
    expect(schema.fillOpacity.max).toBe(100);
  });
});

// The fill's lists and pattern floors are restated as schema literals and
// used by the sticky style and the render guard; these keep them in step.
describe('shape schema fill lists and floors vs the sticky style', () => {
  it('keeps every material and pattern the schema offers', () => {
    const schema = AFRAME.components.shape.schema;
    for (const fillMaterial of schema.fillMaterial.oneOf) {
      expect(normaliseShapeStyle({ fillMaterial }).fillMaterial).toBe(
        fillMaterial
      );
    }
    for (const fillPattern of schema.fillPattern.oneOf) {
      expect(normaliseShapeStyle({ fillPattern }).fillPattern).toBe(
        fillPattern
      );
    }
  });

  it('floors pattern lengths where the schema does, and defaults them alike', () => {
    const schema = AFRAME.components.shape.schema;
    expect(schema.fillPatternSpacing.min).toBe(PATTERN_SPACING_MIN);
    expect(schema.fillPatternWidth.min).toBe(PATTERN_WIDTH_MIN);
    expect(schema.fillPatternSpacing.default).toBe(PATTERN_SPACING_DEFAULT);
    expect(schema.fillPatternWidth.default).toBe(PATTERN_WIDTH_DEFAULT);
    expect(
      normaliseShapeStyle({ fillPatternSpacing: 0 }).fillPatternSpacing
    ).toBe(schema.fillPatternSpacing.min);
    expect(normaliseShapeStyle({ fillPatternWidth: 0 }).fillPatternWidth).toBe(
      schema.fillPatternWidth.min
    );
  });
});
