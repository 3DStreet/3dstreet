import { describe, it, expect } from 'vitest';
import { computeRenderGridCell } from '../../src/editor/components/modals/ScreenshotModal/renderGridLayout.js';

describe('computeRenderGridCell', () => {
  it('keeps a 16:9 screenshot shape when the container is wide enough', () => {
    const cell = computeRenderGridCell({
      width: 1200,
      height: 700,
      aspect: 16 / 9
    });
    expect(cell.width / cell.height).toBeCloseTo(16 / 9, 1);
    expect(cell.width * 2 + 12).toBeLessThanOrEqual(1200);
    expect(cell.height * 2 + 12).toBeLessThanOrEqual(700);
  });

  it('falls back to square cells when the container is too narrow', () => {
    const cell = computeRenderGridCell({
      width: 500,
      height: 700,
      aspect: 16 / 9
    });
    expect(cell.width).toBe(cell.height);
    expect(cell.width * 2 + 12).toBeLessThanOrEqual(500);
  });

  it('uses square cells for a portrait or square screenshot', () => {
    expect(
      computeRenderGridCell({ width: 1200, height: 700, aspect: 1 })
    ).toEqual({ width: 294, height: 294 });
  });

  it('returns null until sizes are known', () => {
    expect(computeRenderGridCell({ width: 0, height: 700, aspect: 1.7 })).toBe(
      null
    );
    expect(
      computeRenderGridCell({ width: 1200, height: 700, aspect: null })
    ).toBe(null);
  });
});
