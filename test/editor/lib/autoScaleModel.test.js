import { describe, it, expect } from 'vitest';
import {
  computeAutoScaleFactor,
  formatMeasuredSize,
  autoScaleMessage,
  MIN_PLAUSIBLE_METERS,
  MAX_PLAUSIBLE_METERS
} from '../../../src/editor/lib/asset-upload/autoScaleModel.js';

describe('computeAutoScaleFactor', () => {
  it('leaves plausibly-sized models alone', () => {
    // A 4.5m car, a 2m pedestrian, a 60m building, a 1m bollard.
    for (const size of [4.5, 2, 60, 1, 0.5, 200]) {
      expect(computeAutoScaleFactor(size)).toBe(1);
    }
  });

  it('does not touch either end of the plausible band', () => {
    expect(computeAutoScaleFactor(MIN_PLAUSIBLE_METERS)).toBe(1);
    expect(computeAutoScaleFactor(MAX_PLAUSIBLE_METERS)).toBe(1);
  });

  it('corrects a centimeter-authored model by 1/100', () => {
    // 4.5m car exported in cm measures 450 units.
    expect(computeAutoScaleFactor(450)).toBeCloseTo(0.01);
  });

  it('corrects a millimeter-authored model by 1/1000', () => {
    // 4.5m car exported in mm measures 4500 units.
    expect(computeAutoScaleFactor(4500)).toBeCloseTo(0.001);
    // 30m building exported in mm measures 30000 units.
    expect(computeAutoScaleFactor(30000)).toBeCloseTo(0.001);
  });

  it('only ever returns powers of ten', () => {
    for (const size of [301, 450, 999, 4500, 30000, 250000, 0.009, 0.0001]) {
      const factor = computeAutoScaleFactor(size);
      const exponent = Math.log10(factor);
      expect(Math.abs(exponent - Math.round(exponent))).toBeLessThan(1e-9);
    }
  });

  it('lands every over-large model back in a visible range', () => {
    for (const size of [301, 450, 999, 4500, 30000, 250000, 1e7]) {
      const corrected = size * computeAutoScaleFactor(size);
      expect(corrected).toBeGreaterThan(MIN_PLAUSIBLE_METERS);
      expect(corrected).toBeLessThan(MAX_PLAUSIBLE_METERS);
    }
  });

  it('always improves an under-sized model, never worsens it', () => {
    for (const size of [0.009, 0.0005, 1e-6]) {
      const corrected = size * computeAutoScaleFactor(size);
      expect(corrected).toBeGreaterThan(size);
      expect(corrected).toBeLessThan(MAX_PLAUSIBLE_METERS);
    }
  });

  it('scales sub-centimeter models up instead of down', () => {
    // A 4m object exported after a 0.001 scale-down measures 0.004.
    expect(4).toBeCloseTo(0.004 * computeAutoScaleFactor(0.004));
    expect(computeAutoScaleFactor(0.00004)).toBeGreaterThan(1);
  });

  it('leaves a small-but-real prop alone', () => {
    // A 4cm object is more plausibly a small prop than a kilometer-authored
    // building, so it stays put rather than being inflated to 40m.
    expect(computeAutoScaleFactor(0.04)).toBe(1);
  });

  it('never proposes a decimeter reading', () => {
    // 450 is a 4.5m object in centimeters, not a 45m object in decimeters —
    // decimeters are not a unit anything exports in, so 0.1 is never returned.
    for (const size of [301, 350, 450, 999, 4500, 45000, 1e6]) {
      expect(computeAutoScaleFactor(size)).not.toBeCloseTo(0.1);
    }
  });

  it('keeps a millimeter-authored building at building size', () => {
    // 45m building in mm measures 45000 — the centimeter reading (450m) is
    // implausible, so the millimeter one has to win.
    expect(45000 * computeAutoScaleFactor(45000)).toBeCloseTo(45);
    expect(30000 * computeAutoScaleFactor(30000)).toBeCloseTo(30);
  });

  it('returns 1 for degenerate measurements', () => {
    for (const size of [0, -5, NaN, Infinity, undefined, null]) {
      expect(computeAutoScaleFactor(size)).toBe(1);
    }
  });
});

describe('formatMeasuredSize', () => {
  it('picks a readable unit', () => {
    expect(formatMeasuredSize(4500)).toBe('4.5 km');
    expect(formatMeasuredSize(450)).toBe('450 m');
    expect(formatMeasuredSize(4.5)).toBe('4.50 m');
    expect(formatMeasuredSize(0.004)).toBe('4 mm');
    expect(formatMeasuredSize(0)).toBe('?');
  });
});

describe('autoScaleMessage', () => {
  it('describes a shrink as a fraction', () => {
    expect(autoScaleMessage(0.01, 450)).toContain('1/100');
    expect(autoScaleMessage(0.01, 450)).toContain('450 m');
  });

  it('describes a grow as a multiplier', () => {
    expect(autoScaleMessage(100, 0.004)).toContain('100×');
  });
});
