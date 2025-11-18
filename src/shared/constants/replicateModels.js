/**
 * Replicate AI Model Configurations
 * Central source of truth for Replicate model IDs and metadata
 */

export const REPLICATE_MODELS = {
  'kontext-realearth': {
    name: 'Kontext Real Earth',
    version: '2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755',
    prompt: 'Transform satellite image into high-quality drone shot'
  },
  'nano-banana': {
    name: 'Nano Banana',
    version: 'f0a9d34b12ad1c1cd76269a844b218ff4e64e128ddaba93e15891f47368958a0',
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp'
  },
  'seedream-4': {
    name: 'Seedream',
    version: '254faac883c3a411e95cc95d0fb02274a81e388aaa4394b3ce5b7d2a9f7a6569',
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
