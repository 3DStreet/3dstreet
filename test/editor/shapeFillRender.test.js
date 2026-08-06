import { describe, expect, it } from 'vitest';
import {
  FILL_LIFT_M,
  FILL_RENDER_ORDER,
  fillPaintOrder,
  fillRenderState
} from '../../src/aframe-components/shapeFillLift.js';
import { MARKING_SURFACE_OFFSET } from '../../src/tested/street-segment-utils.js';

// The lowest renderOrder any editor overlay uses (MeasureLineControls' drag
// handles). The fill band must stay clear of it, so it is asserted rather than
// left as a comment.
const LOWEST_EDITOR_OVERLAY = 100;

describe('fillRenderState', () => {
  it('reports 0% as unpainted', () => {
    expect(fillRenderState(0)).toEqual({ opacity: 0, painted: false });
  });

  it('reports anything above 0 as painted', () => {
    expect(fillRenderState(0.5)).toMatchObject({ painted: true });
    expect(fillRenderState(99)).toEqual({ opacity: 0.99, painted: true });
    expect(fillRenderState(100)).toEqual({ opacity: 1, painted: true });
  });

  it('has no `opaque` flag: 100% is not a distinct render state', () => {
    // The material is transparent and non-depth-writing at every opacity, which
    // is what stops two fills depth-fighting. A reader reintroducing an
    // `opaque` flag should find this red rather than a silently unused field.
    expect(fillRenderState(100)).not.toHaveProperty('opaque');
    expect(Object.keys(fillRenderState(40)).sort()).toEqual([
      'opacity',
      'painted'
    ]);
  });

  it('clamps an out-of-range value rather than trusting the schema bounds', () => {
    // The schema min/max bind the properties panel only; setAttribute and a
    // hand-edited scene can both deliver anything.
    expect(fillRenderState(170)).toEqual({ opacity: 1, painted: true });
    expect(fillRenderState(-20)).toEqual({ opacity: 0, painted: false });
  });

  it('treats a non-numeric value as unpainted', () => {
    expect(fillRenderState(NaN)).toEqual({ opacity: 0, painted: false });
  });

  it('accepts the string a hand-edited scene delivers', () => {
    expect(fillRenderState('40')).toEqual({ opacity: 0.4, painted: true });
  });
});

describe('fillPaintOrder', () => {
  it('lands every real area strictly inside the band', () => {
    for (const area of [1e-6, 1, 16, 100, 1e4, 1e9]) {
      const order = fillPaintOrder(area);
      expect(order).toBeGreaterThan(FILL_RENDER_ORDER);
      expect(order).toBeLessThanOrEqual(FILL_RENDER_ORDER + 1);
    }
  });

  it('paints a smaller shape after a larger one, at every scale', () => {
    // Asserted pairwise rather than on the endpoints: a mapping that is
    // monotone overall but flat somewhere in the middle is exactly how the
    // previous bucketed design failed, and endpoints would not have caught it.
    const areas = [1e-6, 1, 2, 16, 17, 18, 100, 400, 1e4, 1e9];
    const orders = areas.map(fillPaintOrder);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i]).toBeLessThan(orders[i - 1]);
    }
  });

  it('separates 16 m² from 17 m² from 18 m²', () => {
    // The pair that failed the first live test: under the bucketed design 16
    // and 17 shared a bucket, so their separation was exactly zero and the
    // overlap z-fought unconditionally.
    expect(fillPaintOrder(16) - fillPaintOrder(17)).toBeGreaterThan(1e-6);
    expect(fillPaintOrder(17) - fillPaintOrder(18)).toBeGreaterThan(1e-6);
  });

  it('quantises nothing: areas a part in a thousand apart still order', () => {
    const orders = [100, 100.1, 100.2].map(fillPaintOrder);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i - 1] - orders[i]).toBeGreaterThan(0);
    }
  });

  it('sorts a degenerate or unknown area LOWEST, never highest', () => {
    // Area 0 is the trap: it is "small", and a mapping that treated it as the
    // smallest real shape would paint it over everything — the exact inversion
    // this rule exists to prevent. This goes red if that branch regresses.
    for (const area of [NaN, Infinity, 0, -1, '', null, undefined]) {
      expect(fillPaintOrder(area)).toBe(FILL_RENDER_ORDER);
    }
    expect(FILL_RENDER_ORDER).toBeLessThan(fillPaintOrder(1e9));
  });

  it('keeps the whole band clear of the editor overlays', () => {
    // The band's ceiling is what a future change to the mapping would silently
    // blow through, taking fills over the editor's own chrome.
    const supremum = fillPaintOrder(Number.MIN_VALUE);
    expect(supremum).toBeLessThanOrEqual(FILL_RENDER_ORDER + 1);
    expect(supremum).toBeLessThan(LOWEST_EDITOR_OVERLAY);
  });
});

describe('FILL_LIFT_M', () => {
  it('clears the marking layer, and follows it if it moves', () => {
    // The coupling is real, not documentary: this fails if someone re-hardcodes
    // the lift. Deliberately does NOT assert MARKING_SURFACE_OFFSET === 0.05 —
    // that constant is meant to be lowerable, and pinning it would defeat the
    // whole exercise.
    expect(FILL_LIFT_M).toBe(MARKING_SURFACE_OFFSET + 0.01);
    expect(FILL_LIFT_M).toBeGreaterThan(MARKING_SURFACE_OFFSET);
  });
});
