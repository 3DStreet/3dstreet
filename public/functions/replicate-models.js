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
  // tens of minutes). Same async/webhook flow as SHARP — the only difference is
  // a video source (uploaded straight to Storage, not base64'd). Output is a
  // .ply, so the downstream save + RAD/LOD pipeline are reused unchanged.
  //
  // THREE QUALITY TIERS (Basic/High/Max = 15/30/60 tokens), one pipeline. The
  // `pipeline` knobs ride the submit to the provider; pricing targets COGS ≤
  // ~50% of retail ($0.10/token). The cost lever is target_framecount (SfM is
  // CPU-bound, dominates, and is superlinear in frames); gaussians set
  // detail/file size but are nearly free (steps cap at 30k). Measured on the
  // Modal split shape, 2026-06-11 calibration (exact frame extraction):
  // Basic 300f $0.73 (easy scene), 600f $2.39, Max 893f $2.69 — the flat
  // 600f→900f curve is why High runs 450 frames, not 600.
  //
  // `modelName` points at the Replicate model the Cog (repo:
  // github.com/3DStreet/vid2scene-cog) is pushed to: kfarr/vid2scene, hardware
  // L40S (sm_89 — the build's CUDA arches are 7.5;8.6;8.9, so A100/H100 would
  // not load the kernels). Private model, accessed via the kfarr API token
  // (same as kfarr/sharp-ml). All tiers run on Modal, not Replicate:
  // Replicate's on-demand tier preempts long private jobs (~1/3 observed
  // live), and the Modal split-shape deployment of the SAME cog image is
  // reliable and cheaper. The Replicate model remains the documented fallback
  // — delete a tier's `provider` line to switch it back.
  'vid2scene-basic': {
    name: 'vid2scene Basic (Video to Splat)',
    modelName: 'kfarr/vid2scene',
    type: 'splat',
    inputKind: 'video',
    provider: 'modal',
    assetSlug: 'vid2scene-splat',
    assetLabel: 'vid2scene Splat',
    attribution: {
      model: 'samuelm2/vid2scene',
      modelName: 'vid2scene (Video to Splat)',
      sourceType: 'video'
    },
    // Fewer frames + half the steps of High. Measured $0.73 on the cone;
    // real-video scenes est ≈$0.9–1.0. Good-enough preview quality.
    pipeline: {
      target_framecount: 300,
      training_num_steps: 15000,
      training_max_num_gaussians: 500000,
      resolution: 1920
    },
    tokenCost: 15
  },
  // The DEFAULT vid2scene tier (keeps the original `vid2scene` id so existing
  // job docs and any stored model_id references stay valid).
  vid2scene: {
    name: 'vid2scene High (Video to Splat)',
    modelName: 'kfarr/vid2scene',
    type: 'splat',
    inputKind: 'video',
    provider: 'modal',
    assetSlug: 'vid2scene-splat',
    assetLabel: 'vid2scene Splat',
    attribution: {
      model: 'samuelm2/vid2scene',
      modelName: 'vid2scene (Video to Splat)',
      sourceType: 'video'
    },
    // The default tier. 450 frames, not 600: SfM cost is superlinear in
    // frames and nearly flat 600→900 (measured $2.39 @600f vs $2.69 @893f),
    // so 600-frame High cost ~90% of a Max while charging half. 450f keeps
    // 1.5x Basic's coverage at est ≈$1.6–1.8 COGS (~55–60% of retail).
    pipeline: {
      target_framecount: 450,
      training_num_steps: 30000,
      training_max_num_gaussians: 500000,
      resolution: 1920
    },
    tokenCost: 30
  },
  // Image → 3D mesh (GLB) via fal's unified 3D API. Both are image-to-3D only
  // (no text prompt input). Consumed by the 3D Model tab through
  // generateFalMesh, a synchronous callable (submit → poll → download+save),
  // NOT the image generator or the splat job queue. `imageField` names the
  // model's input-image key (they differ); `params` are model-specific extras.
  // Token cost ≈ fal $ / $0.10 base × 2 margin (Hunyuan $0.16→3, TRELLIS 1024
  // texture $0.30→6).
  'hunyuan-3d': {
    name: 'Hunyuan3D',
    type: 'fal-3d',
    endpoint: 'fal-ai/hunyuan3d/v2',
    imageField: 'input_image_url',
    // textured_mesh bakes a texture (fal charges 3× the white-mesh price, which
    // the token cost below already accounts for).
    params: { textured_mesh: true },
    assetSlug: 'hunyuan3d-model',
    assetLabel: 'Hunyuan3D Model',
    attribution: {
      model: 'tencent/hunyuan3d-2',
      modelName: 'Hunyuan3D v2',
      sourceType: 'image'
    },
    tokenCost: 3
  },
  trellis: {
    name: 'TRELLIS',
    type: 'fal-3d',
    endpoint: 'fal-ai/trellis-2',
    imageField: 'image_url',
    params: { texture_resolution: 1024 },
    assetSlug: 'trellis-model',
    assetLabel: 'TRELLIS Model',
    attribution: {
      model: 'microsoft/trellis-2',
      modelName: 'TRELLIS 2',
      sourceType: 'image'
    },
    tokenCost: 6
  },
  'vid2scene-max': {
    name: 'vid2scene Max (Video to Splat)',
    modelName: 'kfarr/vid2scene',
    type: 'splat',
    inputKind: 'video',
    provider: 'modal',
    assetSlug: 'vid2scene-splat',
    assetLabel: 'vid2scene Splat',
    attribution: {
      model: 'samuelm2/vid2scene',
      modelName: 'vid2scene (Video to Splat)',
      sourceType: 'video'
    },
    // Max detail: 4x the gaussians (≈330 MB .ply) + double Basic's frames;
    // steps cap at 30k so cost grows sub-linearly (measured $2.69 @893f,
    // 45% of retail — the healthiest tier).
    pipeline: {
      target_framecount: 900,
      training_num_steps: 30000,
      training_max_num_gaussians: 2000000,
      resolution: 1920
    },
    tokenCost: 60
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
