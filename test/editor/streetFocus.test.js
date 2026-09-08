import { describe, expect, it } from 'vitest';
import { fitDepthForWidth } from '../../src/editor/lib/streetFocus.js';

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
