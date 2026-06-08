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
  'fal-flux-2-max-edit': {
    name: 'Flux 2 Max',
    type: 'fal',
    endpoint: 'fal-ai/flux-2-max/edit',
    tokenCost: 3
  },
  'fal-flux-2-pro-edit': {
    name: 'Flux 2 Pro',
    type: 'fal',
    endpoint: 'fal-ai/flux-2-pro/edit',
    tokenCost: 2
  },
  'fal-flux-2-edit': {
    name: 'Flux 2 Edit',
    type: 'fal',
    endpoint: 'fal-ai/flux-2/edit',
    tokenCost: 2
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
    tokenCost: 3
  },
  'nano-banana-2': {
    name: 'Nano Banana 2',
    modelName: 'google/nano-banana-2',
    tokenCost: 2
  },
  'seedream-4': {
    name: 'Seedream v4',
    version: '254faac883c3a411e95cc95d0fb02274a81e388aaa4394b3ce5b7d2a9f7a6569',
    tokenCost: 1
  },
  'seedream-4.5': {
    name: 'Seedream v4.5',
    modelName: 'bytedance/seedream-4.5',
    tokenCost: 2
  },
  // Image → 3D Gaussian Splat (Apple SHARP, packaged by kfarr).
  // Single image in, .ply splat out (~4 min on a T4). Used by the Splat tab
  // via generateReplicateSplat, not the image generator.
  'sharp-ml': {
    name: 'SHARP (Image to Splat)',
    modelName: 'kfarr/sharp-ml',
    type: 'splat',
    // How generateReplicateSplat shapes the source + Replicate input:
    //  'image' → base64 staged to Storage, sent as input.image
    //  'video' → client uploads to Storage, sent as input.video
    inputKind: 'image',
    // Naming for the saved gallery asset (kept model-aware so the gallery
    // distinguishes SHARP vs vid2scene outputs).
    assetSlug: 'sharp-splat',
    assetLabel: 'SHARP Splat',
    // User-facing attribution written to the asset's generationMetadata.
    attribution: {
      model: 'apple/sharp-ml',
      modelName: 'SHARP (Image to Splat)',
      sourceType: 'image'
    },
    tokenCost: 1
  },
  // Video → 3D Gaussian Splat (samuelm2/vid2scene, packaged as a Replicate Cog
  // from its standalone `vid2scene_core` pipeline: frame extraction → GLOMAP SfM
  // → gsplat training → .ply). A short phone video in, a .ply splat out (GPU,
  // several minutes). Same async/webhook flow as SHARP — the only difference is
  // a video source (uploaded straight to Storage, not base64'd). Output is a
  // .ply, so the downstream save + RAD/LOD pipeline are reused unchanged.
  //
  // NOTE: `modelName` must point at the Replicate model you push the Cog to
  // (see vid2scene-cog/). Update the owner/slug once published.
  vid2scene: {
    name: 'vid2scene (Video to Splat)',
    modelName: '3dstreet/vid2scene',
    type: 'splat',
    inputKind: 'video',
    assetSlug: 'vid2scene-splat',
    assetLabel: 'vid2scene Splat',
    attribution: {
      model: 'samuelm2/vid2scene',
      modelName: 'vid2scene (Video to Splat)',
      sourceType: 'video'
    },
    // GPU-minutes heavy (SfM + 30k-step gsplat training). Placeholder — tune
    // against measured Replicate cost before public launch.
    tokenCost: 5
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
 * Default model ID key
 */
const DEFAULT_MODEL_ID = 'nano-banana-pro';

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
  SEEDREAM_4_5: 'seedream-4.5', // Uses modelName-based calling, not version hash
  NANO_BANANA_2: 'nano-banana-2' // Uses modelName-based calling, not version hash
};

module.exports = {
  REPLICATE_MODELS,
  AI_MODEL_NAMES,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_VERSION,
  MODEL_VERSIONS
};
