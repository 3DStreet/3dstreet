import { describe, it, expect } from 'vitest';
import {
  VIEWER_ASPECT_PRESETS,
  parseAspectRatio,
  fitRectToContainer,
  canonicalRenderSize,
  constrainSizeTo
} from '../../src/aframe-components/viewer-aspect-utils.js';

describe('parseAspectRatio', () => {
  it('parses W:H strings', () => {
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9);
    expect(parseAspectRatio('9:16')).toBeCloseTo(9 / 16);
    expect(parseAspectRatio('1:1')).toBe(1);
    expect(parseAspectRatio('21:9')).toBeCloseTo(21 / 9);
  });

  it('accepts x and / separators and surrounding whitespace', () => {
    expect(parseAspectRatio('16x9')).toBeCloseTo(16 / 9);
    expect(parseAspectRatio('16/9')).toBeCloseTo(16 / 9);
    expect(parseAspectRatio(' 4 : 5 ')).toBeCloseTo(4 / 5);
    expect(parseAspectRatio('16X9')).toBeCloseTo(16 / 9);
  });

  it('accepts plain decimal ratios', () => {
    expect(parseAspectRatio('1.85')).toBeCloseTo(1.85);
    expect(parseAspectRatio('2')).toBe(2);
  });

  it('returns null for fill / empty / non-string input', () => {
    expect(parseAspectRatio('fill')).toBeNull();
    expect(parseAspectRatio('FILL')).toBeNull();
    expect(parseAspectRatio('')).toBeNull();
    expect(parseAspectRatio(null)).toBeNull();
    expect(parseAspectRatio(undefined)).toBeNull();
    expect(parseAspectRatio(1.5)).toBeNull();
  });

  it('returns null for malformed input', () => {
    expect(parseAspectRatio('16:9:4')).toBeNull();
    expect(parseAspectRatio('abc')).toBeNull();
    expect(parseAspectRatio('16:')).toBeNull();
    expect(parseAspectRatio(':9')).toBeNull();
    expect(parseAspectRatio('-16:9')).toBeNull();
  });

  it('rejects degenerate ratios (zero, infinite, slivers)', () => {
    expect(parseAspectRatio('16:0')).toBeNull();
    expect(parseAspectRatio('0:9')).toBeNull();
    expect(parseAspectRatio('100:1')).toBeNull();
    expect(parseAspectRatio('1:100')).toBeNull();
  });

  it('parses every non-fill preset', () => {
    for (const preset of VIEWER_ASPECT_PRESETS) {
      if (preset === 'fill') {
        expect(parseAspectRatio(preset)).toBeNull();
      } else {
        expect(parseAspectRatio(preset)).toBeGreaterThan(0);
      }
    }
  });
});

describe('fitRectToContainer', () => {
  it('letterboxes (bars top/bottom) when the container is taller', () => {
    // 16:9 into a square 1000x1000 container.
    const rect = fitRectToContainer(16 / 9, 1000, 1000);
    expect(rect.width).toBe(1000);
    expect(rect.height).toBe(563); // round(1000 * 9/16)
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(219); // round((1000-563)/2) = 218.5 -> 219
  });

  it('pillarboxes (bars left/right) when the container is wider', () => {
    // 9:16 portrait into a 1920x1080 landscape window.
    const rect = fitRectToContainer(9 / 16, 1920, 1080);
    expect(rect.height).toBe(1080);
    expect(rect.width).toBe(608); // round(1080 * 9/16)
    expect(rect.top).toBe(0);
    expect(rect.left).toBe(656); // (1920-608)/2
  });

  it('fills exactly when the container already matches', () => {
    const rect = fitRectToContainer(16 / 9, 1600, 900);
    expect(rect).toEqual({ width: 1600, height: 900, left: 0, top: 0 });
  });

  it('never returns a zero-sized rect', () => {
    const rect = fitRectToContainer(10, 5, 5);
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe('canonicalRenderSize', () => {
  it('uses the social/video convention for the presets', () => {
    expect(canonicalRenderSize(16 / 9)).toEqual({ width: 1920, height: 1080 });
    expect(canonicalRenderSize(9 / 16)).toEqual({ width: 1080, height: 1920 });
    expect(canonicalRenderSize(1)).toEqual({ width: 1080, height: 1080 });
    expect(canonicalRenderSize(4 / 5)).toEqual({ width: 1080, height: 1350 });
    expect(canonicalRenderSize(21 / 9)).toEqual({ width: 2520, height: 1080 });
  });

  it('pins the short side regardless of orientation', () => {
    expect(canonicalRenderSize(2).height).toBe(1080);
    expect(canonicalRenderSize(0.5).width).toBe(1080);
  });

  it('rounds to even dimensions (H.264 requires them)', () => {
    // 1080 * 1.85 = 1998 (even); 1080 / 0.7 = 1542.86 -> 1542.
    const wide = canonicalRenderSize(1.85);
    expect(wide.width % 2).toBe(0);
    expect(wide.height % 2).toBe(0);
    const tall = canonicalRenderSize(0.7);
    expect(tall.width % 2).toBe(0);
    expect(tall.height % 2).toBe(0);
  });

  it('respects a custom short side', () => {
    expect(canonicalRenderSize(16 / 9, 720)).toEqual({
      width: 1280,
      height: 720
    });
  });
});

describe('constrainSizeTo', () => {
  it('passes through when uncapped (-1/-1, A-Frame default)', () => {
    const size = { width: 3840, height: 2160 };
    expect(constrainSizeTo(size, { width: -1, height: -1 }, 2)).toEqual(size);
    expect(constrainSizeTo(size, undefined, 2)).toEqual(size);
  });

  it('passes through under the cap', () => {
    expect(
      constrainSizeTo(
        { width: 800, height: 450 },
        { width: 1920, height: 1920 },
        1
      )
    ).toEqual({ width: 800, height: 450 });
  });

  it('caps device pixels while preserving aspect', () => {
    // 1600x900 CSS px at DPR 2 = 3200 device px wide, cap 1920.
    const out = constrainSizeTo(
      { width: 1600, height: 900 },
      { width: 1920, height: 1920 },
      2
    );
    expect(out.width).toBe(960); // 1920 / 2
    expect(out.height).toBe(540); // preserves 16:9
  });

  it('does not mutate its input', () => {
    const size = { width: 1600, height: 900 };
    constrainSizeTo(size, { width: 1920, height: 1920 }, 2);
    expect(size).toEqual({ width: 1600, height: 900 });
  });
});
