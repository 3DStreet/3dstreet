/**
 * Flux Image Generator - Create Tab
 * Image creation functionality (source image is optional)
 */

import GeneratorTabBase from './generator-tab-base.js';

// Create tab configuration
const CreateTab = new GeneratorTabBase({
  tabId: 'create',
  tabType: 'create',
  requiresSourceImage: false,
  requiresPrompt: true,
  showImagePromptUI: false,
  defaultPrompt: null,
  title: 'Create Image Settings',
  description: 'Generate a new image from a text prompt.'
});

export default CreateTab;
