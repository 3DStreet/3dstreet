import { beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHAPE_STYLE } from '../../src/editor/lib/shapeStyle.js';

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
  it('agrees on all four appearance defaults', () => {
    const schema = AFRAME.components.shape.schema;
    expect(schema.lineColor.default).toBe(DEFAULT_SHAPE_STYLE.lineColor);
    expect(schema.lineWidth.default).toBe(DEFAULT_SHAPE_STYLE.lineWidth);
    expect(schema.fillColor.default).toBe(DEFAULT_SHAPE_STYLE.fillColor);
    expect(schema.fillOpacity.default).toBe(DEFAULT_SHAPE_STYLE.fillOpacity);
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
