import { describe, it, expect } from 'vitest';
import {
  RENDER_STYLES,
  DEFAULT_RENDER_STYLE_ID,
  STYLED_BASE_PROMPT,
  getRenderStylesList,
  buildStyledPrompt
} from '@shared/constants/renderStyles.js';

const MODEL_DEFAULT =
  'use the guidance of the geometry in the input image to create a photorealistic rendering of street improvements with accurate shading and lighting';

describe('RENDER_STYLES', () => {
  it('includes the photorealistic default with no style prompt', () => {
    expect(RENDER_STYLES[DEFAULT_RENDER_STYLE_ID]).toBeDefined();
    expect(RENDER_STYLES[DEFAULT_RENDER_STYLE_ID].stylePrompt).toBeNull();
  });

  it('gives every style the fields the picker UI needs', () => {
    getRenderStylesList().forEach((style) => {
      expect(style.id).toBeTruthy();
      expect(style.name).toBeTruthy();
      expect(style.description).toBeTruthy();
      expect(style.emoji).toBeTruthy();
      expect(style.swatch).toContain('gradient');
    });
  });

  it('gives every non-default style a non-empty style prompt', () => {
    getRenderStylesList()
      .filter((style) => style.id !== DEFAULT_RENDER_STYLE_ID)
      .forEach((style) => {
        expect(style.stylePrompt).toBeTruthy();
      });
  });

  it('lists photorealistic first as the default option', () => {
    expect(getRenderStylesList()[0].id).toBe(DEFAULT_RENDER_STYLE_ID);
  });
});

describe('buildStyledPrompt', () => {
  it('preserves legacy behavior for photorealistic: user prompt wins', () => {
    expect(
      buildStyledPrompt({
        userPrompt: '  add street trees  ',
        modelDefaultPrompt: MODEL_DEFAULT,
        styleId: 'photorealistic'
      })
    ).toBe('add street trees');
  });

  it('preserves legacy behavior for photorealistic: falls back to model default', () => {
    expect(
      buildStyledPrompt({
        userPrompt: '',
        modelDefaultPrompt: MODEL_DEFAULT,
        styleId: 'photorealistic'
      })
    ).toBe(MODEL_DEFAULT);
  });

  it('appends the style description to the user prompt', () => {
    const result = buildStyledPrompt({
      userPrompt: 'add street trees',
      modelDefaultPrompt: MODEL_DEFAULT,
      styleId: 'watercolor'
    });
    expect(result.startsWith('add street trees. ')).toBe(true);
    expect(result).toContain(RENDER_STYLES.watercolor.stylePrompt);
  });

  it('uses the neutral styled base prompt when user prompt is empty', () => {
    const result = buildStyledPrompt({
      userPrompt: '   ',
      modelDefaultPrompt: MODEL_DEFAULT,
      styleId: 'pixel-16bit'
    });
    expect(result.startsWith(STYLED_BASE_PROMPT)).toBe(true);
    expect(result).toContain(RENDER_STYLES['pixel-16bit'].stylePrompt);
    // The model's photorealistic default must not leak into styled renders
    expect(result).not.toContain('photorealistic');
  });

  it('falls back to photorealistic behavior for unknown style IDs', () => {
    expect(
      buildStyledPrompt({
        userPrompt: '',
        modelDefaultPrompt: MODEL_DEFAULT,
        styleId: 'not-a-style'
      })
    ).toBe(MODEL_DEFAULT);
  });

  it('handles missing arguments without throwing', () => {
    expect(buildStyledPrompt({})).toBe('');
    expect(buildStyledPrompt({ styleId: 'watercolor' })).toContain(
      RENDER_STYLES.watercolor.stylePrompt
    );
  });
});
