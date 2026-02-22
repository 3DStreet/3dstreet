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
  'high-quality': {
    label: 'High quality',
    order: 2
  },
  specialized: {
    label: 'Specialized',
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
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp',
    estimatedTime: 30,
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
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp',
    estimatedTime: 25,
    includeIn4x: true,
    tokenCost: 2
  },
  'fal-flux-2-pro-edit': {
    name: 'Flux 2 Pro',
    type: 'fal',
    group: 'high-quality',
    logo: '/ui_assets/model-black-forest-labs.png',
    endpoint: 'fal-ai/flux-2-pro/edit',
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp',
    estimatedTime: 20,
    includeIn4x: false,
    tokenCost: 2,
    requiresSourceImage: true
  },

  // Specialized
  'fal-flux-2-edit': {
    name: 'Flux 2 Edit',
    type: 'fal',
    group: 'specialized',
    logo: '/ui_assets/model-black-forest-labs.png',
    endpoint: 'fal-ai/flux-2/edit',
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp',
    estimatedTime: 30,
    includeIn4x: false,
    tokenCost: 1,
    requiresSourceImage: true
  },
  'fal-flux-2-lora-sfmta': {
    name: 'Flux 2 SFMTA Striping',
    type: 'fal',
    group: 'specialized',
    logo: '/ui_assets/model-black-forest-labs.png',
    endpoint: 'fal-ai/flux-2/lora/edit',
    loras: [
      {
        path: 'https://v3b.fal.media/files/b/0a87f612/4HKUTB4LNJycc4hyZOkr4_pytorch_lora_weights.safetensors',
        scale: 1
      }
    ],
    prompt:
      'Generate a top-down satellite view from this sfmta style striping drawing',
    estimatedTime: 35,
    includeIn4x: false,
    tokenCost: 2,
    requiresSourceImage: true
  },
  'kontext-realearth': {
    name: 'Kontext Real Earth',
    type: 'replicate',
    group: 'specialized',
    logo: '/ui_assets/model-black-forest-labs.png',
    version: '2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755',
    prompt: 'Transform satellite image into high-quality drone shot',
    estimatedTime: 25,
    includeIn4x: true,
    tokenCost: 1,
    requiresSourceImage: true
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
  'wan-video/wan-2.6-i2v': {
    name: 'Wan 2.6 I2V',
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
