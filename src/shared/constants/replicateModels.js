/**
 * AI Model Configurations
 * Central source of truth for all AI model IDs and metadata (BFL + Replicate)
 */

/**
 * Model group definitions
 */
export const MODEL_GROUPS = {
  'best-quality': {
    label: 'Best quality',
    order: 1
  },
  'high-quality-fast': {
    label: 'High quality and fast',
    order: 2
  },
  versatile: {
    label: 'Versatile',
    order: 3
  }
};

/**
 * All available AI models with metadata
 */
export const REPLICATE_MODELS = {
  // Best quality
  'nano-banana-pro': {
    name: 'Nano Banana Pro',
    type: 'replicate',
    group: 'best-quality',
    logo: '/ui_assets/model-google.png',
    version: '99256cc418d9ac41854575e2f1c8846ce2defd0c0fb6ff2d5cbc3c826be75bc8',
    prompt:
      'use the guidance of the geometry in the input image to create a photorealistic rendering of street improvements with accurate shading and lighting',
    estimatedTime: 40,
    includeIn4x: true,
    tokenCost: 4
  },

  // High quality and fast
  'kontext-realearth': {
    name: 'Kontext Real Earth',
    type: 'replicate',
    group: 'high-quality-fast',
    logo: '/ui_assets/model-black-forest-labs.png',
    version: '2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755',
    prompt: 'Transform satellite image into high-quality drone shot',
    estimatedTime: 25,
    includeIn4x: true,
    tokenCost: 1
  },
  'seedream-4': {
    name: 'Seedream',
    type: 'replicate',
    group: 'high-quality-fast',
    logo: '/ui_assets/model-bytedance.png',
    version: '254faac883c3a411e95cc95d0fb02274a81e388aaa4394b3ce5b7d2a9f7a6569',
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp',
    estimatedTime: 25,
    includeIn4x: true,
    tokenCost: 1
  },

  // Versatile
  'flux-kontext-pro': {
    name: 'Flux Kontext Pro',
    type: 'replicate',
    group: 'versatile',
    logo: '/ui_assets/model-black-forest-labs.png',
    version: 'aa776ca45ce7f7d185418f700df8ec6ca6cb367bfd88e9cd225666c4c179d1d7',
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp',
    estimatedTime: 15,
    includeIn4x: true,
    tokenCost: 1
  },
  'nano-banana': {
    name: 'Nano Banana',
    type: 'replicate',
    group: 'versatile',
    logo: '/ui_assets/model-google.png',
    version: 'f0a9d34b12ad1c1cd76269a844b218ff4e64e128ddaba93e15891f47368958a0',
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp',
    estimatedTime: 20,
    includeIn4x: false,
    tokenCost: 1
  },

  // BFL Models - kept for backwards compatibility but hidden from UI
  'flux-dev': {
    name: 'Flux Dev',
    type: 'bfl',
    group: null, // null = hidden from UI
    logo: '/ui_assets/model-black-forest-labs.png',
    estimatedTime: 10,
    tokenCost: 1,
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp'
  },
  'flux-pro-1.1': {
    name: 'Flux Pro 1.1',
    type: 'bfl',
    group: null, // null = hidden from UI
    logo: '/ui_assets/model-black-forest-labs.png',
    estimatedTime: 20,
    tokenCost: 2,
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp'
  },
  'flux-pro-1.1-ultra': {
    name: 'Flux Pro 1.1 Ultra',
    type: 'bfl',
    group: null, // null = hidden from UI
    logo: '/ui_assets/model-black-forest-labs.png',
    estimatedTime: 30,
    tokenCost: 3,
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp'
  }
};

/**
 * Get model name by version ID
 * @param {string} version - The model version ID
 * @returns {string} The human-readable model name
 */
export const getModelNameByVersion = (version) => {
  const model = Object.values(REPLICATE_MODELS).find(
    (m) => m.version === version
  );
  return model?.name || 'AI Model';
};

/**
 * Get model configuration by version ID
 * @param {string} version - The model version ID
 * @returns {Object|null} The model configuration object
 */
export const getModelByVersion = (version) => {
  return (
    Object.values(REPLICATE_MODELS).find((m) => m.version === version) || null
  );
};

/**
 * Default model version (Kontext Real Earth)
 */
export const DEFAULT_REPLICATE_MODEL_VERSION =
  REPLICATE_MODELS['kontext-realearth'].version;

/**
 * Get models grouped by their group property
 * @returns {Object} Object with group keys and arrays of model entries
 */
export const getGroupedModels = () => {
  const grouped = {};

  // Initialize groups
  Object.keys(MODEL_GROUPS).forEach((groupKey) => {
    grouped[groupKey] = [];
  });

  // Group models
  Object.entries(REPLICATE_MODELS).forEach(([modelId, modelConfig]) => {
    const group = modelConfig.group;
    if (group && grouped[group]) {
      grouped[group].push({
        id: modelId,
        ...modelConfig
      });
    }
  });

  return grouped;
};

/**
 * Video model group definitions
 */
export const VIDEO_MODEL_GROUPS = {
  'video-best-quality': {
    label: 'Best quality',
    order: 1
  },
  'video-high-quality-fast': {
    label: 'High quality and fast',
    order: 2
  },
  'video-versatile': {
    label: 'Versatile',
    order: 3
  }
};

/**
 * Video models configuration
 */
export const VIDEO_MODELS = {
  'kwaivgi/kling-v2.5-turbo-pro': {
    name: 'Kling v2.5 Turbo Pro',
    type: 'replicate',
    group: 'video-best-quality',
    logo: '/ui_assets/model-kling.png',
    estimatedTime: 130,
    tokenCost: 3
  },
  'bytedance/seedance-1-pro-fast': {
    name: 'SeeDance 1 Pro Fast',
    type: 'replicate',
    group: 'video-high-quality-fast',
    logo: '/ui_assets/model-bytedance.png',
    estimatedTime: 45,
    tokenCost: 1
  },
  'lightricks/ltx-2-fast': {
    name: 'LTX-2 Fast',
    type: 'replicate',
    group: 'video-high-quality-fast',
    logo: '/ui_assets/model-lightricks.png',
    estimatedTime: 40,
    tokenCost: 1
  },
  'wan-video/wan-2.2-i2v-fast': {
    name: 'Wan 2.2 I2V Fast',
    type: 'replicate',
    group: 'video-versatile',
    logo: '/ui_assets/model-wan.png',
    estimatedTime: 110,
    tokenCost: 2
  }
};

/**
 * Get video models grouped by their group property
 * @returns {Object} Object with group keys and arrays of model entries
 */
export const getGroupedVideoModels = () => {
  const grouped = {};

  // Initialize groups
  Object.keys(VIDEO_MODEL_GROUPS).forEach((groupKey) => {
    grouped[groupKey] = [];
  });

  // Group models
  Object.entries(VIDEO_MODELS).forEach(([modelId, modelConfig]) => {
    const group = modelConfig.group;
    if (group && grouped[group]) {
      grouped[group].push({
        id: modelId,
        ...modelConfig
      });
    }
  });

  return grouped;
};
