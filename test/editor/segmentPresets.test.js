import { describe, expect, it } from 'vitest';
import {
  applySegmentPreset,
  summarizePresets
} from '../../src/editor/lib/commands/segmentPresets.js';

const types = {
  'bike-lane': {
    type: 'bike-lane',
    color: '#00ff00',
    surface: 'asphalt',
    elevation: 0,
    generated: {
      stencil: [{ modelsArray: 'bike-arrow', spacing: 20 }],
      clones: [{ mode: 'random', modelsArray: 'cyclist1, cyclist2', count: 4 }]
    }
  },
  sidewalk: {
    type: 'sidewalk',
    surface: 'sidewalk',
    color: '#ffffff',
    elevation: 0.15,
    direction: 'none',
    generated: { pedestrians: [{ density: 'normal' }] }
  },
  boundary: {
    type: 'boundary',
    surface: 'none',
    generated: { clones: [{ mode: 'fixed', modelsArray: 'block-a' }] },
    variants: { brownstone: { modelsArray: 'block-b' } }
  }
};

describe('applySegmentPreset', () => {
  it('fills every omitted field from the type preset and reports them', () => {
    const { segment, applied } = applySegmentPreset(
      { type: 'bike-lane', width: 2 },
      types
    );
    expect(segment.color).toBe('#00ff00');
    expect(segment.surface).toBe('asphalt');
    expect(segment.generated.stencil[0].modelsArray).toBe('bike-arrow');
    expect(segment.generated.clones[0].modelsArray).toBe('cyclist1, cyclist2');
    expect(applied).toEqual(['color', 'surface', 'elevation', 'generated']);
  });

  it('keeps explicit values and an explicit generated override', () => {
    const { segment, applied } = applySegmentPreset(
      { type: 'bike-lane', color: '#123456', generated: { stencil: [] } },
      types
    );
    expect(segment.color).toBe('#123456');
    expect(segment.generated).toEqual({ stencil: [] });
    expect(applied).toEqual(['surface', 'elevation']);
  });

  it('deep-copies the preset so later mutation cannot leak back', () => {
    const { segment } = applySegmentPreset({ type: 'sidewalk' }, types);
    segment.generated.pedestrians[0].density = 'dense';
    expect(types.sidewalk.generated.pedestrians[0].density).toBe('normal');
  });

  it('carries boundary variants through for the segment component', () => {
    const { segment } = applySegmentPreset(
      { type: 'boundary', variant: 'brownstone', side: 'left' },
      types
    );
    expect(segment.variants).toBe(types.boundary.variants);
    expect(segment.variant).toBe('brownstone');
  });

  it('is a no-op for an unknown type or missing table', () => {
    expect(applySegmentPreset({ type: 'weird' }, types).applied).toEqual([]);
    expect(applySegmentPreset({ type: 'sidewalk' }, undefined).applied).toEqual(
      []
    );
  });
});

describe('summarizePresets', () => {
  it('produces a compact model-facing summary', () => {
    const out = summarizePresets(types);
    const bike = out.find((p) => p.type === 'bike-lane');
    expect(bike.generated).toEqual({
      stencil: ['bike-arrow'],
      clones: ['cyclist1, cyclist2']
    });
    const walk = out.find((p) => p.type === 'sidewalk');
    expect(walk.generated.pedestrians).toEqual(['density: normal']);
    expect(walk.elevation).toBe(0.15);
    expect(out.find((p) => p.type === 'boundary').variants).toEqual([
      'brownstone'
    ]);
  });
});
