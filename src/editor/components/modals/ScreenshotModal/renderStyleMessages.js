import { defineMessages } from 'react-intl';
import { RENDER_STYLES, NONE_STYLE } from '@shared/constants/renderStyles.js';

/**
 * Localized names/descriptions for the shared render style prompt starters.
 * The shared constants keep English fallbacks (the generator has no i18n);
 * the editor passes these through RenderStyleSelector's labels prop.
 * Both maps are keyed by the style ID itself so lookup needs no indirection
 * (same pattern as addLayerMessages.js); message IDs must stay static
 * literals for formatjs extraction.
 */
const styleNameMessages = defineMessages({
  photorealistic: {
    id: 'renderStyles.photorealistic.name',
    defaultMessage: 'Photorealistic'
  },
  watercolor: {
    id: 'renderStyles.watercolor.name',
    defaultMessage: 'Watercolor'
  },
  'color-pencil': {
    id: 'renderStyles.color-pencil.name',
    defaultMessage: 'Blue Pencil'
  },
  'marker-sketch': {
    id: 'renderStyles.marker-sketch.name',
    defaultMessage: 'Marker Sketch'
  },
  'architectural-cartoon': {
    id: 'renderStyles.architectural-cartoon.name',
    defaultMessage: 'Cartoon'
  },
  'pixel-16bit': {
    id: 'renderStyles.pixel-16bit.name',
    defaultMessage: '16-bit Game'
  },
  'urban-diagram': {
    id: 'renderStyles.urban-diagram.name',
    defaultMessage: 'Urban Diagram'
  },
  'isometric-miniature': {
    id: 'renderStyles.isometric-miniature.name',
    defaultMessage: 'Miniature'
  },
  none: {
    id: 'renderStyles.none.name',
    defaultMessage: 'None'
  }
});

const styleDescriptionMessages = defineMessages({
  photorealistic: {
    id: 'renderStyles.photorealistic.description',
    defaultMessage: 'High-detail realistic render'
  },
  watercolor: {
    id: 'renderStyles.watercolor.description',
    defaultMessage: 'Soft hand-painted architectural watercolor'
  },
  'color-pencil': {
    id: 'renderStyles.color-pencil.description',
    defaultMessage: 'Blue colored-pencil architecture concept sketch'
  },
  'marker-sketch': {
    id: 'renderStyles.marker-sketch.description',
    defaultMessage: 'Quick urban-design marker rendering'
  },
  'architectural-cartoon': {
    id: 'renderStyles.architectural-cartoon.description',
    defaultMessage: 'Playful cartoonish architectural illustration'
  },
  'pixel-16bit': {
    id: 'renderStyles.pixel-16bit.description',
    defaultMessage: 'Retro 16-bit pixel art video game scene'
  },
  'urban-diagram': {
    id: 'renderStyles.urban-diagram.description',
    defaultMessage: 'Flat street-design-guide planning diagram'
  },
  'isometric-miniature': {
    id: 'renderStyles.isometric-miniature.description',
    defaultMessage: 'Cute isometric tilt-shift diorama'
  },
  none: {
    id: 'renderStyles.none.description',
    defaultMessage: 'No style language; instructions only'
  }
});

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
      return [
        id,
        {
          name: styleNameMessages[id]
            ? intl.formatMessage(styleNameMessages[id])
            : fallback.name,
          description: styleDescriptionMessages[id]
            ? intl.formatMessage(styleDescriptionMessages[id])
            : fallback.description
        }
      ];
    })
  );
