/**
 * AI Model Configurations
 * Central source of truth for all AI model IDs and metadata (fal.ai + Replicate)
 */

/**
 * Model group definitions
 */
export const MODEL_GROUPS = {
  'best-quality': {
    label: 'Best quality',
    order: 1
  },
  'high-quality': {
    label: 'High quality',
    order: 2
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
    estimatedTime: 60,
    includeIn4x: true,
    tokenCost: 3
  },
  'fal-flux-2-max-edit': {
    name: 'Flux 2 Max',
    type: 'fal',
    group: 'best-quality',
    logo: '/ui_assets/model-black-forest-labs.png',
    endpoint: 'fal-ai/flux-2-max/edit',
    estimatedTime: 60,
    includeIn4x: true,
    tokenCost: 3,
    requiresSourceImage: true
  },

  // High quality
  'seedream-4.5': {
    name: 'Seedream 4.5',
    type: 'replicate',
    group: 'high-quality',
    logo: '/ui_assets/model-bytedance.png',
    modelName: 'bytedance/seedream-4.5',
    estimatedTime: 20,
    includeIn4x: true,
    tokenCost: 2
  },
  'nano-banana-2': {
    name: 'Nano Banana 2',
    type: 'replicate',
    group: 'high-quality',
    logo: '/ui_assets/model-google.png',
    modelName: 'google/nano-banana-2',
    estimatedTime: 30,
    includeIn4x: true,
    tokenCost: 2
  },
  'fal-flux-2-pro-edit': {
    name: 'Flux 2 Pro',
    type: 'fal',
    group: 'high-quality',
    logo: '/ui_assets/model-black-forest-labs.png',
    endpoint: 'fal-ai/flux-2-pro/edit',
    estimatedTime: 30,
    includeIn4x: false,
    tokenCost: 2,
    requiresSourceImage: true
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
 * Default model ID key
 */
export const DEFAULT_REPLICATE_MODEL_ID = 'nano-banana-pro';

/**
 * Default model version (Nano Banana Pro)
 */
export const DEFAULT_REPLICATE_MODEL_VERSION =
  REPLICATE_MODELS['nano-banana-pro'].version;

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
  'kwaivgi/kling-v3-video': {
    name: 'Kling v3.0 Pro',
    type: 'replicate',
    group: 'video-best-quality',
    logo: '/ui_assets/model-kling.png',
    estimatedTime: 330,
    tokenCost5s: 20,
    tokenCost10s: 40
  },
  'google/veo-3.1': {
    name: 'Veo 3.1',
    type: 'replicate',
    group: 'video-best-quality',
    logo: '/ui_assets/model-google.png',
    estimatedTime: 120,
    tokenCost5s: 20,
    tokenCost10s: 40
  },
  'google/veo-3.1-fast': {
    name: 'Veo 3.1 Fast',
    type: 'replicate',
    group: 'video-high-quality-fast',
    logo: '/ui_assets/model-google.png',
    estimatedTime: 90,
    tokenCost5s: 10,
    tokenCost10s: 20
  },
  'bytedance/seedance-1-pro-fast': {
    name: 'SeeDance 1 Pro Fast',
    type: 'replicate',
    group: 'video-high-quality-fast',
    logo: '/ui_assets/model-bytedance.png',
    estimatedTime: 65,
    tokenCost5s: 7,
    tokenCost10s: 14
  },
  'lightricks/ltx-2-fast': {
    name: 'LTX-2 Fast',
    type: 'replicate',
    group: 'video-high-quality-fast',
    logo: '/ui_assets/model-lightricks.png',
    estimatedTime: 40,
    tokenCost5s: 5,
    tokenCost10s: 10
  },
  'wan-video/wan-2.6-i2v': {
    name: 'Wan 2.6 I2V',
    type: 'replicate',
    group: 'video-versatile',
    logo: '/ui_assets/model-wan.png',
    estimatedTime: 100,
    tokenCost5s: 15,
    tokenCost10s: 30
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
