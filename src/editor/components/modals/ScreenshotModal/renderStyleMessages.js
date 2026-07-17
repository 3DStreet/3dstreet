import { defineMessages } from 'react-intl';
import { RENDER_STYLES, NONE_STYLE } from '@shared/constants/renderStyles.js';

/**
 * Localized names/descriptions for the shared render style prompt starters.
 * The shared constants keep English fallbacks (the generator has no i18n);
 * the editor passes these through RenderStyleSelector's labels prop.
 * IDs must be static literals for formatjs extraction.
 */
const messages = defineMessages({
  photorealisticName: {
    id: 'renderStyles.photorealistic.name',
    defaultMessage: 'Photorealistic'
  },
  photorealisticDescription: {
    id: 'renderStyles.photorealistic.description',
    defaultMessage: 'High-detail realistic render'
  },
  watercolorName: {
    id: 'renderStyles.watercolor.name',
    defaultMessage: 'Watercolor'
  },
  watercolorDescription: {
    id: 'renderStyles.watercolor.description',
    defaultMessage: 'Soft hand-painted architectural watercolor'
  },
  colorPencilName: {
    id: 'renderStyles.color-pencil.name',
    defaultMessage: 'Blue Pencil'
  },
  colorPencilDescription: {
    id: 'renderStyles.color-pencil.description',
    defaultMessage: 'Blue colored-pencil architecture concept sketch'
  },
  markerSketchName: {
    id: 'renderStyles.marker-sketch.name',
    defaultMessage: 'Marker Sketch'
  },
  markerSketchDescription: {
    id: 'renderStyles.marker-sketch.description',
    defaultMessage: 'Quick urban-design marker rendering'
  },
  architecturalCartoonName: {
    id: 'renderStyles.architectural-cartoon.name',
    defaultMessage: 'Cartoon'
  },
  architecturalCartoonDescription: {
    id: 'renderStyles.architectural-cartoon.description',
    defaultMessage: 'Playful cartoonish architectural illustration'
  },
  pixel16bitName: {
    id: 'renderStyles.pixel-16bit.name',
    defaultMessage: '16-bit Game'
  },
  pixel16bitDescription: {
    id: 'renderStyles.pixel-16bit.description',
    defaultMessage: 'Retro 16-bit pixel art video game scene'
  },
  urbanDiagramName: {
    id: 'renderStyles.urban-diagram.name',
    defaultMessage: 'Urban Diagram'
  },
  urbanDiagramDescription: {
    id: 'renderStyles.urban-diagram.description',
    defaultMessage: 'Flat street-design-guide planning diagram'
  },
  isometricMiniatureName: {
    id: 'renderStyles.isometric-miniature.name',
    defaultMessage: 'Miniature'
  },
  isometricMiniatureDescription: {
    id: 'renderStyles.isometric-miniature.description',
    defaultMessage: 'Cute isometric tilt-shift diorama'
  },
  noneName: {
    id: 'renderStyles.none.name',
    defaultMessage: 'None'
  },
  noneDescription: {
    id: 'renderStyles.none.description',
    defaultMessage: 'No style language; instructions only'
  }
});

const MESSAGE_KEYS_BY_STYLE_ID = {
  photorealistic: ['photorealisticName', 'photorealisticDescription'],
  watercolor: ['watercolorName', 'watercolorDescription'],
  'color-pencil': ['colorPencilName', 'colorPencilDescription'],
  'marker-sketch': ['markerSketchName', 'markerSketchDescription'],
  'architectural-cartoon': [
    'architecturalCartoonName',
    'architecturalCartoonDescription'
  ],
  'pixel-16bit': ['pixel16bitName', 'pixel16bitDescription'],
  'urban-diagram': ['urbanDiagramName', 'urbanDiagramDescription'],
  'isometric-miniature': [
    'isometricMiniatureName',
    'isometricMiniatureDescription'
  ],
  none: ['noneName', 'noneDescription']
};

/**
 * Build the { styleId: { name, description } } labels map consumed by
 * RenderStyleSelector, falling back to the English constants for any style
 * missing a message (e.g. a style added without translations yet).
 * @param {IntlShape} intl
 */
export const getLocalizedStyleLabels = (intl) =>
  Object.fromEntries(
    [...Object.keys(RENDER_STYLES), NONE_STYLE.id].map((id) => {
      const fallback = RENDER_STYLES[id] || NONE_STYLE;
      const [nameKey, descriptionKey] = MESSAGE_KEYS_BY_STYLE_ID[id] || [];
      return [
        id,
        {
          name: messages[nameKey]
            ? intl.formatMessage(messages[nameKey])
            : fallback.name,
          description: messages[descriptionKey]
            ? intl.formatMessage(messages[descriptionKey])
            : fallback.description
        }
      ];
    })
  );
