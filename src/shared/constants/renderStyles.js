/**
 * Render Style Presets
 * Pre-made stylistic rendering options for AI image-to-image generation.
 *
 * "Photorealistic" is the default style and preserves the legacy behavior:
 * the selected model's default prompt is used as-is (all model default
 * prompts already ask for a photorealistic result). Every other style
 * appends a style description to the user's prompt — or, when the prompt is
 * empty, to a generic geometry-preserving base prompt — so the input image's
 * layout and composition survive the restyle.
 */

/**
 * Base prompt used for non-photorealistic styles when the user leaves the
 * prompt empty. Model default prompts all say "photorealistic", which would
 * fight the style suffix, so styled renders get this neutral base instead.
 */
export const STYLED_BASE_PROMPT =
  'use the guidance of the geometry in the input image to re-render this urban street scene, keeping the same layout, composition and camera angle';

/**
 * All available render styles, in display order.
 *
 * Each style:
 * - name/description: shown in the style picker UI
 * - emoji + swatch (CSS background): lightweight visual thumbnail, no image
 *   assets required
 * - stylePrompt: appended to the base prompt; null means "no restyle"
 *   (photorealistic default)
 */
export const RENDER_STYLES = {
  photorealistic: {
    name: 'Photorealistic',
    description: 'High-detail realistic render (default)',
    emoji: '📷',
    swatch: 'linear-gradient(135deg, #4b6cb7 0%, #182848 100%)',
    stylePrompt: null
  },
  watercolor: {
    name: 'Watercolor',
    description: 'Soft hand-painted architectural watercolor',
    emoji: '🎨',
    swatch: 'linear-gradient(135deg, #fbc2eb 0%, #a6c1ee 100%)',
    stylePrompt:
      'a loose watercolor architectural illustration with soft translucent washes of color, visible paper texture, gentle pigment blooms and color bleeding at the edges, and delicate hand-painted ink linework'
  },
  'color-pencil': {
    name: 'Blue Pencil',
    description: 'Blue colored-pencil architecture concept sketch',
    emoji: '✏️',
    swatch: 'linear-gradient(135deg, #e0eafc 0%, #83a4d4 100%)',
    stylePrompt:
      'a blue colored-pencil architectural concept sketch with loose confident pencil strokes on white paper, monochromatic blue line shading, hand-drawn hatching, and unfinished sketchbook edges'
  },
  'marker-sketch': {
    name: 'Marker Sketch',
    description: 'Quick urban-design marker rendering',
    emoji: '🖊️',
    swatch: 'linear-gradient(135deg, #f6d365 0%, #fda085 100%)',
    stylePrompt:
      'a quick urban design marker rendering in the style of a hand-drawn Copic marker architectural sketch, warm gray tones with selective color accents, loose perspective linework, on a white paper background'
  },
  'architectural-cartoon': {
    name: 'Cartoon',
    description: 'Playful cartoonish architectural illustration',
    emoji: '🖍️',
    swatch: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)',
    stylePrompt:
      'a playful cartoonish architectural illustration with bold clean outlines, simplified geometry, flat cheerful colors and soft shadows, like a modern picture book about cities'
  },
  'pixel-16bit': {
    name: '16-bit Game',
    description: 'Retro 16-bit pixel art video game scene',
    emoji: '👾',
    swatch: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
    stylePrompt:
      'a 16-bit pixel art video game scene with chunky visible pixels, a limited retro color palette, dithered gradients, and a SNES-era side-scroller aesthetic'
  },
  'urban-diagram': {
    name: 'Urban Diagram',
    description: 'Flat NACTO-guide-style planning diagram',
    emoji: '📐',
    swatch: 'linear-gradient(135deg, #96deda 0%, #50c9c3 100%)',
    stylePrompt:
      'a flat vector urban planning diagram in the style of the NACTO Urban Street Design Guide, with clean flat colors, simplified stylized people and vehicles, muted greens and grays, crisp geometry, and no photorealistic textures'
  },
  'isometric-miniature': {
    name: 'Miniature',
    description: 'Cute isometric tilt-shift diorama',
    emoji: '🏘️',
    swatch: 'linear-gradient(135deg, #fddb92 0%, #d1fdff 100%)',
    stylePrompt:
      'a cute miniature diorama render with soft studio lighting, clay-like materials, pastel colors, and tilt-shift depth of field, as if photographing a tiny physical scale model'
  }
};

/**
 * Default render style ID (legacy behavior — model default prompts apply)
 */
export const DEFAULT_RENDER_STYLE_ID = 'photorealistic';

/**
 * Get render styles as an ordered array of { id, ...config }
 * @returns {Array} List of style entries for UI rendering
 */
export const getRenderStylesList = () =>
  Object.entries(RENDER_STYLES).map(([id, config]) => ({ id, ...config }));

/**
 * Compose the final generation prompt from the user prompt, the selected
 * model's default prompt, and the selected render style.
 *
 * - photorealistic (or unknown style): user prompt, falling back to the
 *   model's default prompt — identical to pre-style behavior
 * - any other style: user prompt (or the neutral STYLED_BASE_PROMPT when
 *   empty) with the style description appended
 *
 * @param {Object} options
 * @param {string} [options.userPrompt] - Raw text the user typed (may be empty)
 * @param {string} [options.modelDefaultPrompt] - Selected model's default prompt
 * @param {string} [options.styleId] - Selected render style ID
 * @returns {string} The composed prompt to send to the generation backend
 */
export const buildStyledPrompt = ({
  userPrompt,
  modelDefaultPrompt,
  styleId
}) => {
  const style =
    RENDER_STYLES[styleId] || RENDER_STYLES[DEFAULT_RENDER_STYLE_ID];
  const trimmedPrompt = (userPrompt || '').trim();

  if (!style.stylePrompt) {
    return trimmedPrompt || modelDefaultPrompt || '';
  }

  const base = trimmedPrompt || STYLED_BASE_PROMPT;
  return `${base}. Render the result as ${style.stylePrompt}.`;
};
