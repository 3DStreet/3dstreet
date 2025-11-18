/**
 * Replicate AI Model Configurations
 * Central source of truth for Replicate model IDs and metadata (Backend)
 */

const REPLICATE_MODELS = {
  'kontext-realearth': {
    name: 'Kontext Real Earth',
    version: '2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755'
  },
  'flux-kontext-pro-v1': {
    name: 'Flux Kontext Pro',
    version: '2af3274cfd12ae2e0a87619bef1e7df80df2fbcf02d8d9dff23c74e6ca1d5f1d'
  },
  'flux-kontext-pro-v2': {
    name: 'Flux Kontext Pro',
    version: 'aa776ca45ce7f7d185418f700df8ec6ca6cb367bfd88e9cd225666c4c179d1d7'
  },
  'nano-banana': {
    name: 'Nano Banana',
    version: 'f0a9d34b12ad1c1cd76269a844b218ff4e64e128ddaba93e15891f47368958a0'
  },
  'seedream-4': {
    name: 'Seedream v4',
    version: '254faac883c3a411e95cc95d0fb02274a81e388aaa4394b3ce5b7d2a9f7a6569'
  }
};

/**
 * Create reverse mapping from version ID to name
 * Used for Discord posting and logging
 */
const AI_MODEL_NAMES = Object.entries(REPLICATE_MODELS).reduce((acc, [key, model]) => {
  acc[model.version] = model.name;
  return acc;
}, {});

/**
 * Default model version (Kontext Real Earth)
 */
const DEFAULT_MODEL_VERSION = REPLICATE_MODELS['kontext-realearth'].version;

/**
 * Model version constants for easy reference
 */
const MODEL_VERSIONS = {
  KONTEXT_REALEARTH: REPLICATE_MODELS['kontext-realearth'].version,
  NANO_BANANA: REPLICATE_MODELS['nano-banana'].version,
  SEEDREAM_4: REPLICATE_MODELS['seedream-4'].version
};

module.exports = {
  REPLICATE_MODELS,
  AI_MODEL_NAMES,
  DEFAULT_MODEL_VERSION,
  MODEL_VERSIONS
};
