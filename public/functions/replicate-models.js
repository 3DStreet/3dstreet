/**
 * Replicate AI Model Configurations
 * Central source of truth for Replicate model IDs and metadata (Backend)
 */

const REPLICATE_MODELS = {
  'kontext-realearth': {
    name: 'Kontext Real Earth',
    version: '2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755',
    tokenCost: 1
  },
  // fal.ai Models
  'fal-flux-2-edit': {
    name: 'Flux 2 Edit',
    type: 'fal',
    endpoint: 'fal-ai/flux-2/edit',
    tokenCost: 3
  },
  'fal-flux-2-lora-sfmta': {
    name: 'Flux 2 SFMTA Striping',
    type: 'fal',
    endpoint: 'fal-ai/flux-2/lora/edit',
    loras: [
      {
        path: 'https://v3b.fal.media/files/b/0a87f612/4HKUTB4LNJycc4hyZOkr4_pytorch_lora_weights.safetensors',
        scale: 1
      }
    ],
    tokenCost: 3
  },
  'flux-kontext-pro': {
    name: 'Flux Kontext Pro',
    version: 'aa776ca45ce7f7d185418f700df8ec6ca6cb367bfd88e9cd225666c4c179d1d7',
    tokenCost: 1
  },
  'nano-banana': {
    name: 'Nano Banana',
    version: 'f0a9d34b12ad1c1cd76269a844b218ff4e64e128ddaba93e15891f47368958a0',
    tokenCost: 1
  },
  'nano-banana-pro': {
    name: 'Nano Banana Pro',
    version: '99256cc418d9ac41854575e2f1c8846ce2defd0c0fb6ff2d5cbc3c826be75bc8',
    tokenCost: 4
  },
  'seedream-4': {
    name: 'Seedream v4',
    version: '254faac883c3a411e95cc95d0fb02274a81e388aaa4394b3ce5b7d2a9f7a6569',
    tokenCost: 1
  },
  'seedream-4.5': {
    name: 'Seedream v4.5',
    modelName: 'bytedance/seedream-4.5',
    tokenCost: 1
  }
};

/**
 * Create reverse mapping from version ID or model ID to name
 * Used for Discord posting and logging
 */
const AI_MODEL_NAMES = Object.entries(REPLICATE_MODELS).reduce((acc, [key, model]) => {
  // For Replicate models, use version as key
  if (model.version) {
    acc[model.version] = model.name;
  }
  // For fal.ai and other models, use the model key itself
  acc[key] = model.name;
  return acc;
}, {});

/**
 * Default model version (Nano Banana Pro)
 */
const DEFAULT_MODEL_VERSION = REPLICATE_MODELS['nano-banana-pro'].version;

/**
 * Model version constants for easy reference
 */
const MODEL_VERSIONS = {
  KONTEXT_REALEARTH: REPLICATE_MODELS['kontext-realearth'].version,
  NANO_BANANA: REPLICATE_MODELS['nano-banana'].version,
  NANO_BANANA_PRO: REPLICATE_MODELS['nano-banana-pro'].version,
  SEEDREAM_4: REPLICATE_MODELS['seedream-4'].version,
  SEEDREAM_4_5: 'seedream-4.5' // Uses modelName-based calling, not version hash
};

module.exports = {
  REPLICATE_MODELS,
  AI_MODEL_NAMES,
  DEFAULT_MODEL_VERSION,
  MODEL_VERSIONS
};
