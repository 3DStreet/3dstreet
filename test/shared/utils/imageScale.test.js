import { describe, it, expect } from 'vitest';
import { fitScale } from '../../../src/shared/utils/imageScale.js';

describe('fitScale', () => {
  it('returns 1 with no cap', () => {
    expect(fitScale(4000, 3000, null)).toBe(1);
  });

  it('returns 1 when the image already fits', () => {
    expect(fitScale(1920, 1080, 4)).toBe(1);
  });

  it('scales an oversized image down to the cap', () => {
    const scale = fitScale(3840, 2160, 4);
    const w = Math.floor(3840 * scale);
    const h = Math.floor(2160 * scale);
    expect(w * h).toBeLessThanOrEqual(4e6);
    expect(w / h).toBeCloseTo(16 / 9, 2);
  });
});
