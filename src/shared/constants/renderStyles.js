/**
 * Render Style Prompts
 *
 * The generation prompt is composed of two user-visible parts:
 *
 *   [instructions] + [style sentence]
 *
 * Both parts live in their own editable text field, stacked so the UI reads
 * top-to-bottom as the exact prompt that gets sent (composePrompt does the
 * literal join — no hidden rewriting). Style chips write only the style
 * field, so a user's instructions always survive switching styles. This
 * deliberately teaches that output styling is controlled by prompt text (a
 * workflow power users discovered on their own): the user watches the style
 * sentence swap while their instructions stay put.
 */

/**
 * Default instructions, prefilled into the instructions field.
 * - editor: renders always start from a screenshot of the 3D scene, so the
 *   default anchors the render to the input geometry (layout, composition
 *   and camera angle survive the restyle).
 * - generator: a friendly example edit; "if provided" keeps it valid
 *   whether or not a source image is attached.
 * - video: the video tab still uses a single prompt field with this as its
 *   empty-field fallback (two-field conversion is a known follow-up).
 */
const DEFAULT_INSTRUCTIONS = {
  editor:
    'Use the guidance of the geometry in the input image to re-render this street scene, keeping the same layout, composition and camera angle.',
  generator:
    'Add trees, flowers, and other green things to the source image if provided.',
  video:
    'create photorealistic animated render of this street scene with accurate shading and lighting'
};

/**
 * All available render styles, in display order.
 *
 * Each style:
 * - name/description: shown in the style picker UI (English fallback; the
 *   editor passes translated labels via the RenderStyleSelector labels prop)
 * - emoji + swatch (CSS background): lightweight visual thumbnail, no image
 *   assets required
 * - stylePrompt: the style description wrapped into the full style sentence
 *   by getStyleSentence
 */
export const RENDER_STYLES = {
  photorealistic: {
    name: 'Photorealistic',
    description: 'High-detail realistic render',
    emoji: '📷',
    swatch: 'linear-gradient(135deg, #4b6cb7 0%, #182848 100%)',
    stylePrompt:
      'a photorealistic rendering with accurate materials, natural lighting and realistic shading'
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
    description: 'Flat street-design-guide planning diagram',
    emoji: '📐',
    swatch: 'linear-gradient(135deg, #96deda 0%, #50c9c3 100%)',
    stylePrompt:
      'a flat vector urban planning diagram in the style of a modern street design guide, with clean flat colors, simplified stylized people and vehicles, muted greens and grays, crisp geometry, and no photorealistic textures'
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
 * Pseudo-style rendered as the last chip: clears the style field so the
 * prompt is instructions only (for asks unrelated to styling).
 */
export const NONE_STYLE = {
  id: 'none',
  name: 'None',
  description: 'No style language; instructions only',
  emoji: '∅',
  swatch: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)'
};

/**
 * Default style ID prefilled into the style field.
 */
export const DEFAULT_RENDER_STYLE_ID = 'photorealistic';

/**
 * Get render styles as an ordered array of { id, ...config }
 * @returns {Array} List of style entries for UI rendering
 */
export const getRenderStylesList = () =>
  Object.entries(RENDER_STYLES).map(([id, config]) => ({ id, ...config }));

/**
 * Default text for the instructions field.
 * @param {string} [variant='editor'] - Which app's default: 'editor' or
 *   'generator'
 * @returns {string}
 */
export const getDefaultInstructions = (variant = 'editor') =>
  DEFAULT_INSTRUCTIONS[variant] || DEFAULT_INSTRUCTIONS.editor;

/**
 * The full sentence a style chip writes into the style field.
 * @param {string} styleId - Render style ID
 * @returns {string} Style sentence, or '' for 'none'/unknown IDs
 */
export const getStyleSentence = (styleId) => {
  const style = RENDER_STYLES[styleId];
  return style ? `Render as ${style.stylePrompt}.` : '';
};

// Style sentences are static, so the reverse lookup is built once
// (describeStyleText runs per keystroke and per render).
const STYLE_ID_BY_SENTENCE = new Map(
  Object.keys(RENDER_STYLES).map((id) => [getStyleSentence(id), id])
);

/**
 * Describe the style field contents: the matching style ID for an unedited
 * chip sentence, 'none' when empty, 'custom' for user-edited text. Drives
 * both chip highlighting (the 'none' chip lights up on empty; 'custom'
 * matches no chip) and analytics.
 *
 * @param {string} styleText - Current contents of the style field
 * @returns {string} Style ID, 'none', or 'custom'
 */
export const describeStyleText = (styleText) => {
  const trimmed = (styleText || '').trim();
  if (!trimmed) return NONE_STYLE.id;
  return STYLE_ID_BY_SENTENCE.get(trimmed) || 'custom';
};

/**
 * Compose the final generation prompt: instructions then style sentence,
 * joined verbatim (with a period added if the instructions don't end in
 * punctuation). Either part may be empty.
 *
 * @param {Object} parts
 * @param {string} [parts.instructions]
 * @param {string} [parts.style]
 * @returns {string}
 */
export const composePrompt = ({ instructions, style } = {}) => {
  const first = (instructions || '').trim();
  const second = (style || '').trim();
  if (!first) return second;
  if (!second) return first;
  // Any trailing punctuation counts as "already punctuated" — the user's
  // text is never rewritten, only a period added when there's none at all.
  const separator = /[.!?,;:]$/.test(first) ? ' ' : '. ';
  return `${first}${separator}${second}`;
};
