import { describe, it, expect, vi } from 'vitest';
import {
  SKY_GRADIENTS,
  DEFAULT_SKY_PRESET,
  SKY_PLACEHOLDER_WIDTH,
  SKY_PLACEHOLDER_HEIGHT,
  getSkyGradientStops,
  paintSkyGradient,
  createSkyPlaceholderTexture,
  isSkyPlaceholder
} from '@/sky-placeholder';

const HEX = /^#[0-9a-f]{6}$/;

// jsdom has no 2D canvas: a recording context stands in for it.
function fakeContext() {
  const gradient = { addColorStop: vi.fn() };
  const ctx = {
    createLinearGradient: vi.fn(() => gradient),
    fillRect: vi.fn(),
    fillStyle: null,
    gradient
  };
  return ctx;
}

function fakeDocument() {
  const canvases = [];
  return {
    canvases,
    createElement(tag) {
      const ctx = fakeContext();
      const canvas = { tag, width: 0, height: 0, ctx, getContext: () => ctx };
      canvases.push(canvas);
      return canvas;
    }
  };
}

class FakeCanvasTexture {
  constructor(image) {
    this.image = image;
    this.userData = {};
    this.generateMipmaps = true;
  }
}

const fakeThree = {
  CanvasTexture: FakeCanvasTexture,
  EquirectangularReflectionMapping: 'equirect',
  SRGBColorSpace: 'srgb',
  LinearFilter: 'linear'
};

describe('sky placeholder gradients', () => {
  it('has a gradient for every image preset of street-environment', () => {
    expect(Object.keys(SKY_GRADIENTS).sort()).toEqual(
      [
        'day',
        'night',
        'sunny-morning',
        'cloudy-afternoon',
        'sunny-afternoon',
        'sunny-noon',
        'foggy',
        'cloudy'
      ].sort()
    );
  });

  it('uses the same number of valid hex stops for each preset', () => {
    const lengths = new Set();
    for (const stops of Object.values(SKY_GRADIENTS)) {
      lengths.add(stops.length);
      expect(stops.length).toBeGreaterThanOrEqual(2);
      for (const color of stops) expect(color).toMatch(HEX);
    }
    expect(lengths.size).toBe(1);
  });

  it('falls back to the day gradient for unknown or color presets', () => {
    expect(getSkyGradientStops('color')).toBe(
      SKY_GRADIENTS[DEFAULT_SKY_PRESET]
    );
    expect(getSkyGradientStops(undefined)).toBe(SKY_GRADIENTS.day);
    expect(getSkyGradientStops('night')).toBe(SKY_GRADIENTS.night);
  });
});

describe('paintSkyGradient', () => {
  it('paints a top-to-bottom gradient with evenly spaced stops', () => {
    const ctx = fakeContext();
    paintSkyGradient(ctx, 8, 100, ['#000000', '#808080', '#ffffff']);
    expect(ctx.createLinearGradient).toHaveBeenCalledWith(0, 0, 0, 100);
    expect(ctx.gradient.addColorStop.mock.calls).toEqual([
      [0, '#000000'],
      [0.5, '#808080'],
      [1, '#ffffff']
    ]);
    expect(ctx.fillStyle).toBe(ctx.gradient);
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 8, 100);
  });
});

describe('createSkyPlaceholderTexture', () => {
  it('builds a tiny equirect sRGB canvas texture for the preset', () => {
    const doc = fakeDocument();
    const texture = createSkyPlaceholderTexture('night', {
      doc,
      three: fakeThree
    });
    expect(texture).toBeInstanceOf(FakeCanvasTexture);
    const canvas = doc.canvases[0];
    expect(texture.image).toBe(canvas);
    expect(canvas.width).toBe(SKY_PLACEHOLDER_WIDTH);
    expect(canvas.height).toBe(SKY_PLACEHOLDER_HEIGHT);
    expect(canvas.ctx.gradient.addColorStop).toHaveBeenCalledTimes(
      SKY_GRADIENTS.night.length
    );
    expect(canvas.ctx.gradient.addColorStop).toHaveBeenCalledWith(
      0,
      SKY_GRADIENTS.night[0]
    );
    expect(texture.mapping).toBe('equirect');
    expect(texture.colorSpace).toBe('srgb');
    expect(texture.minFilter).toBe('linear');
    expect(texture.generateMipmaps).toBe(false);
    expect(texture.name).toBe('sky-placeholder:night');
    expect(isSkyPlaceholder(texture)).toBe(true);
  });

  it('is not confused with a real sky texture', () => {
    expect(isSkyPlaceholder(null)).toBe(false);
    expect(isSkyPlaceholder({ userData: { skySrc: 'x.jpeg' } })).toBe(false);
  });
});
