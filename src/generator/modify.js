/**
 * Flux Image Generator - Modify Tab
 * Image modification functionality (requires source image)
 */

import GeneratorTabBase from './generator-tab-base.js';

// Modify tab configuration
const ModifyTab = new GeneratorTabBase({
  tabId: 'modify',
  tabType: 'modify',
  requiresSourceImage: true,
  requiresPrompt: false,
  showImagePromptUI: true,
  defaultPrompt:
    'create a photorealistic render of an urban street scene with accurate shading and lighting',
  title: 'Modify Image Settings',
  description:
    'Transform an existing image by applying styling, content, and visual fidelity changes.'
});

export default ModifyTab;
