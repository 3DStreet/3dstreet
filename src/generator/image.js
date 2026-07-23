/**
 * Image Tab
 *
 * Single medium-based image generator (formerly split into Create + Modify).
 * A source image is optional: the upload shows an amber "recommended" indicator
 * and an empty-image submit nudges the user toward providing one, but text-only
 * generation is allowed. All models are shown at all times, regardless of
 * whether an image is present. The prompt fields are prefilled with visible
 * defaults; an all-empty composed prompt is rejected (no hidden fallback).
 */

import GeneratorTabBase from './generator-tab-base.js';
import { t } from './i18n/messages.js';

const ImageTab = new GeneratorTabBase({
  tabId: 'image',
  tabType: 'image',
  requiresSourceImage: false,
  showImagePromptUI: true,
  optionalSourceImage: true,
  title: t('image.settingsTitle'),
  description: t('image.settingsDescription')
});

export default ImageTab;
