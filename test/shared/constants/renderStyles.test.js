import { describe, it, expect } from 'vitest';
import {
  RENDER_STYLES,
  NONE_STYLE,
  DEFAULT_RENDER_STYLE_ID,
  getRenderStylesList,
  getDefaultInstructions,
  getStyleSentence,
  describeStyleText,
  composePrompt
} from '@shared/constants/renderStyles.js';

describe('RENDER_STYLES', () => {
  it('gives every style the fields the picker UI needs', () => {
    getRenderStylesList().forEach((style) => {
      expect(style.id).toBeTruthy();
      expect(style.name).toBeTruthy();
      expect(style.description).toBeTruthy();
      expect(style.emoji).toBeTruthy();
      expect(style.swatch).toContain('gradient');
      expect(style.stylePrompt).toBeTruthy();
    });
  });

  it('lists the default style first', () => {
    expect(getRenderStylesList()[0].id).toBe(DEFAULT_RENDER_STYLE_ID);
  });

  it('keeps the none pseudo-style out of the styles list', () => {
    expect(RENDER_STYLES[NONE_STYLE.id]).toBeUndefined();
  });
});

describe('getDefaultInstructions', () => {
  it('anchors the editor default to the input image geometry', () => {
    expect(getDefaultInstructions()).toContain('input image');
    expect(getDefaultInstructions('editor')).toBe(getDefaultInstructions());
  });

  it('keeps the generator default valid with or without a source image', () => {
    expect(getDefaultInstructions('generator')).toContain('if provided');
  });

  it('falls back to the editor default for unknown variants', () => {
    expect(getDefaultInstructions('not-an-app')).toBe(
      getDefaultInstructions('editor')
    );
  });
});

describe('getStyleSentence', () => {
  it('wraps every style prompt into a full sentence', () => {
    getRenderStylesList().forEach((style) => {
      const sentence = getStyleSentence(style.id);
      expect(sentence.startsWith('Render as ')).toBe(true);
      expect(sentence).toContain(style.stylePrompt);
      expect(sentence.endsWith('.')).toBe(true);
    });
  });

  it('returns an empty string for none and unknown IDs', () => {
    expect(getStyleSentence(NONE_STYLE.id)).toBe('');
    expect(getStyleSentence('not-a-style')).toBe('');
    expect(getStyleSentence(undefined)).toBe('');
  });
});

describe('describeStyleText', () => {
  it('round-trips every style sentence', () => {
    getRenderStylesList().forEach((style) => {
      expect(describeStyleText(getStyleSentence(style.id))).toBe(style.id);
    });
  });

  it('ignores surrounding whitespace', () => {
    expect(describeStyleText(`  ${getStyleSentence('watercolor')}\n`)).toBe(
      'watercolor'
    );
  });

  it('reports none for an empty field', () => {
    expect(describeStyleText('')).toBe('none');
    expect(describeStyleText('   ')).toBe('none');
    expect(describeStyleText(undefined)).toBe('none');
  });

  it('reports custom for edited text', () => {
    expect(describeStyleText('Render as a crayon drawing.')).toBe('custom');
    expect(
      describeStyleText(getStyleSentence('watercolor') + ' At night.')
    ).toBe('custom');
  });
});

describe('composePrompt', () => {
  it('joins instructions and style verbatim', () => {
    expect(
      composePrompt({ instructions: 'Add trees.', style: 'Render as x.' })
    ).toBe('Add trees. Render as x.');
  });

  it('adds a period when the instructions lack terminal punctuation', () => {
    expect(
      composePrompt({ instructions: 'Add trees', style: 'Render as x.' })
    ).toBe('Add trees. Render as x.');
  });

  it('never rewrites trailing punctuation in the instructions', () => {
    expect(
      composePrompt({ instructions: 'Add trees,', style: 'Render as x.' })
    ).toBe('Add trees, Render as x.');
  });

  it('handles either part being empty', () => {
    expect(composePrompt({ instructions: 'Add trees.', style: '' })).toBe(
      'Add trees.'
    );
    expect(composePrompt({ instructions: '', style: 'Render as x.' })).toBe(
      'Render as x.'
    );
    expect(composePrompt({})).toBe('');
    expect(composePrompt()).toBe('');
  });

  it('composes the default prefill into a complete prompt', () => {
    const prompt = composePrompt({
      instructions: getDefaultInstructions(),
      style: getStyleSentence(DEFAULT_RENDER_STYLE_ID)
    });
    expect(prompt).toContain('input image');
    expect(prompt).toContain('photorealistic');
  });
});
