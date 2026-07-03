/**
 * Image Tab
 *
 * Single medium-based image generator (formerly split into Create + Modify).
 * A source image is optional: the upload shows an amber "recommended" indicator
 * and an empty-image submit nudges the user toward providing one, but text-only
 * generation is allowed. All models are shown at all times, regardless of
 * whether an image is present. The prompt is optional — when left empty the
 * selected model's default prompt is used (behavior carried over from the
 * former Modify tab).
 */

import GeneratorTabBase from './generator-tab-base.js';

const ImageTab = new GeneratorTabBase({
  tabId: 'image',
  tabType: 'image',
  requiresSourceImage: false,
  requiresPrompt: false,
  showImagePromptUI: true,
  optionalSourceImage: true,
  defaultPrompt: null,
  title: 'Image Settings',
  description:
    'Generate an image from a text prompt, optionally guided by a reference image.'
});

export default ImageTab;
