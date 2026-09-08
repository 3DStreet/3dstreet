import { describe, expect, it } from 'vitest';
import * as focus from '../../src/editor/lib/streetFocus.js';
const { fitDepthForWidth } = focus;

describe('fitDepthForWidth', () => {
  it('places a cross-section so it spans the fill fraction of view width', () => {
    const fov = 50;
    const aspect = 1.5;
    const width = 20;
    const depth = fitDepthForWidth(width, fov, aspect, 0.9);
    // Reproject: half-width at that depth vs. half the visible width there.
    const halfVisible = depth * Math.tan((fov * Math.PI) / 360) * aspect;
    expect(width / 2 / halfVisible).toBeCloseTo(0.9, 6);
  });

  it('is linear in width and shrinks with a wider fov or aspect', () => {
    expect(fitDepthForWidth(40, 50, 1.5)).toBeCloseTo(
      2 * fitDepthForWidth(20, 50, 1.5)
    );
    expect(fitDepthForWidth(20, 80, 1.5)).toBeLessThan(
      fitDepthForWidth(20, 50, 1.5)
    );
    expect(fitDepthForWidth(20, 50, 2)).toBeLessThan(
      fitDepthForWidth(20, 50, 1.5)
    );
  });
});

describe('segmentFocusSpan', () => {
  const mk = (widths) => {
    let x = -widths.reduce((a, b) => a + b, 0) / 2;
    return {
      segments: widths.map((width, i) => {
        const seg = { el: { i }, width, x: x + width / 2 };
        x += width;
        return seg;
      })
    };
  };
  const { segmentFocusSpan } = focus;

  it('frames a wide span at its true width', () => {
    const frame = mk([6, 6, 6, 6, 6]);
    expect(segmentFocusSpan(frame, frame.segments[2].el).width).toBeCloseTo(
      3 + 6 + 6 + 6 + 3
    );
  });

  it('spans self + both neighbours + half of the next ones out', () => {
    const frame = mk([2, 2, 3, 4, 1, 2, 2]);
    const span = segmentFocusSpan(frame, frame.segments[3].el);
    // half(2) + 3 + 4 + 1 + half(2), floored at the minimum span
    expect(span.width).toBeCloseTo(
      Math.max(1 + 3 + 4 + 1 + 1, focus.SEGMENT_FOCUS_MIN_WIDTH)
    );
    // left edge: seg3 left (-8+2+2+3 = -1) - 3 - 1 = -5; right: 3 + 1 + 1 = 5
    expect(span.xCenter).toBeCloseTo(0);
  });

  it('clips the context at the street edge', () => {
    const frame = mk([3, 2, 2]);
    const span = segmentFocusSpan(frame, frame.segments[0].el);
    expect(span.width).toBeCloseTo(
      Math.max(3 + 2 + 1, focus.SEGMENT_FOCUS_MIN_WIDTH)
    );
    expect(span.xCenter).toBeCloseTo(-3.5 + 3);
  });

  it('returns null for a segment outside the travelled way', () => {
    expect(segmentFocusSpan(mk([2]), { i: 99 })).toBeNull();
  });
});
