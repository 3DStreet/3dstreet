import { describe, expect, it } from 'vitest';
import {
  FILL_LIFT_M,
  FILL_STACK_SPAN_M,
  fillLiftForArea,
  fillRenderState
} from '../../src/aframe-components/shapeFillLift.js';
import { MARKING_SURFACE_OFFSET } from '../../src/tested/street-segment-utils.js';

describe('fillRenderState', () => {
  it('reports 0% as unpainted and not opaque', () => {
    expect(fillRenderState(0)).toEqual({
      opacity: 0,
      painted: false,
      opaque: false
    });
  });

  it('reports anything above 0 and below 100 as painted but translucent', () => {
    expect(fillRenderState(0.5)).toMatchObject({
      painted: true,
      opaque: false
    });
    expect(fillRenderState(99)).toMatchObject({ painted: true, opaque: false });
  });

  it('reports 100% as opaque', () => {
    expect(fillRenderState(100)).toEqual({
      opacity: 1,
      painted: true,
      opaque: true
    });
  });

  it('clamps an out-of-range value rather than trusting the schema bounds', () => {
    // The schema min/max bind the properties panel only; setAttribute and a
    // hand-edited scene can both deliver anything.
    expect(fillRenderState(170)).toEqual({
      opacity: 1,
      painted: true,
      opaque: true
    });
    expect(fillRenderState(-20)).toEqual({
      opacity: 0,
      painted: false,
      opaque: false
    });
  });

  it('treats a non-numeric value as unpainted', () => {
    expect(fillRenderState(NaN)).toEqual({
      opacity: 0,
      painted: false,
      opaque: false
    });
  });

  it('accepts the string a hand-edited scene delivers', () => {
    expect(fillRenderState('40')).toEqual({
      opacity: 0.4,
      painted: true,
      opaque: false
    });
  });
});

describe('fillLiftForArea', () => {
  it('stays within the clearance band for every input, sane or not', () => {
    const areas = [0, 1e-6, 1, 100, 1e4, 1e9, NaN, Infinity, -1];
    for (const area of areas) {
      const lift = fillLiftForArea(area);
      expect(lift).toBeGreaterThanOrEqual(FILL_LIFT_M);
      expect(lift).toBeLessThanOrEqual(FILL_LIFT_M + FILL_STACK_SPAN_M);
    }
  });

  it('sits a smaller shape strictly higher than a larger one', () => {
    const lifts = [1, 10, 100, 1000, 10000].map(fillLiftForArea);
    for (let i = 1; i < lifts.length; i++) {
      expect(lifts[i]).toBeLessThan(lifts[i - 1]);
    }
  });

  it('gives equal area ratios equal steps', () => {
    const decadeLow = fillLiftForArea(1) - fillLiftForArea(10);
    const decadeHigh = fillLiftForArea(100) - fillLiftForArea(1000);
    expect(Math.abs(decadeLow - decadeHigh)).toBeLessThan(1e-12);
  });

  it('separates a stated area ratio by at least the derived minimum', () => {
    // 100 m² over 400 m² separates by exactly 1.5e-4 m by derivation; the bound
    // asserted is the honest floor rather than the derived figure.
    expect(fillLiftForArea(100) - fillLiftForArea(400)).toBeGreaterThanOrEqual(
      1.4e-4
    );
    // A 10x ratio: derived exactly 2.5e-4 m.
    expect(fillLiftForArea(100) - fillLiftForArea(1000)).toBeGreaterThanOrEqual(
      2.4e-4
    );
  });

  it('sits a degenerate or unknown area LOWEST, never highest', () => {
    // Area 0 also satisfies the "at or below the minimum" test, and pinning it
    // to the smallest bucket would give it the MAXIMUM lift — the inversion
    // this ordering rule exists to prevent. This assertion goes red if that
    // branch order regresses.
    const largest = fillLiftForArea(1e4);
    expect(largest).toBe(FILL_LIFT_M);
    for (const area of [NaN, Infinity, 1e9, 0, -1]) {
      expect(fillLiftForArea(area)).toBe(largest);
    }
  });

  it('gives two near-equal areas the same lift, and separates them once they part', () => {
    // Areas are quantised, so shapes within a step of each other tie — the
    // accepted case where no stacking order is promised. The second assertion
    // gives the first a direction: the tie is quantisation, not a constant.
    expect(fillLiftForArea(250)).toBe(fillLiftForArea(260));
    expect(fillLiftForArea(250)).toBeGreaterThan(fillLiftForArea(400));
  });

  it('clears the marking layer, and follows it if it moves', () => {
    // The coupling is real, not documentary: this fails if someone re-hardcodes
    // the lift. Deliberately does NOT assert MARKING_SURFACE_OFFSET === 0.05 —
    // that constant is meant to be lowerable, and pinning it would defeat the
    // whole exercise.
    expect(FILL_LIFT_M).toBe(MARKING_SURFACE_OFFSET + 0.01);
  });
});
