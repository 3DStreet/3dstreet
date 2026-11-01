/**
 * Per-model input shaping for image generation (image → image edits and
 * text → image). Each provider model names and shapes its inputs differently;
 * the model config (replicate-models.js) picks a shape:
 *
 *   Replicate models: `inputStyle` — 'nano-banana' | 'seedream' | 'grok' |
 *     'kontext' (the default, for the legacy FLUX Kontext version hashes).
 *   fal models: `payloadStyle` — 'flux-2' (the default) | 'flux-2-klein' |
 *     'flux-3' | 'muse'.
 *
 * Pure functions (no Firebase), so they're unit tested directly
 * (test/generator/image-model-inputs.test.js).
 */

// Output aspect for a text-only render (no source image to match).
const TEXT_ONLY_ASPECT_RATIO = '16:9';

/**
 * Build the Replicate `input` object for an image prediction.
 *
 * @param {Object} modelConfig - REPLICATE_MODELS entry
 * @param {Object} args
 * @param {string} args.prompt
 * @param {string|null} args.imageUrl - Public URL of the source image, if any
 * @param {number} args.guidance - Kontext only
 * @param {number} args.numInferenceSteps - Kontext only
 * @param {string} [args.resolution] - Output tier from resolveOutputTier;
 *   defaults to the model's own `resolution`
 */
function buildReplicateImageInput(
  modelConfig,
  { prompt, imageUrl, guidance, numInferenceSteps, resolution }
) {
  switch (modelConfig?.inputStyle) {
    case 'nano-banana': {
      const input = { prompt, output_format: 'jpg' };
      if (imageUrl) {
        input.image_input = [imageUrl];
        input.aspect_ratio = 'match_input_image';
      }
      // Nano Banana Pro / 2 accept '1K' | '2K' | '4K'; the original Nano
      // Banana has no resolution input.
      const outputResolution = resolution || modelConfig.resolution;
      if (outputResolution) input.resolution = outputResolution;
      return input;
    }
    case 'seedream': {
      const input = { prompt, size: modelConfig.size || '2K' };
      if (imageUrl) {
        input.image_input = [imageUrl];
      } else if (modelConfig.textOnlyAspectRatio) {
        // Seedream 5 defaults aspect_ratio to match_input_image, which has
        // nothing to match without a source image.
        input.aspect_ratio = modelConfig.textOnlyAspectRatio;
      }
      if (modelConfig.outputFormat) input.output_format = modelConfig.outputFormat;
      return input;
    }
    case 'grok': {
      // Grok Imagine takes a single `image`; when editing it keeps the input's
      // aspect ratio and ignores aspect_ratio.
      const input = {
        prompt,
        resolution: modelConfig.resolution || '2k',
        quality: 'medium'
      };
      if (imageUrl) {
        input.image = imageUrl;
      } else {
        input.aspect_ratio = TEXT_ONLY_ASPECT_RATIO;
      }
      return input;
    }
    default: {
      // FLUX Kontext (version-hash models).
      const input = {
        prompt,
        guidance,
        num_inference_steps: numInferenceSteps,
        output_format: 'jpg'
      };
      if (imageUrl) input.input_image = imageUrl;
      return input;
    }
  }
}

/**
 * Build the fal queue request body for an image edit.
 *
 * @param {Object} modelConfig - REPLICATE_MODELS entry with type 'fal'
 * @param {Object} args
 * @param {string} args.prompt
 * @param {string} args.imageUrl - Public URL of the source image (required)
 * @param {string|Object} args.imageSize - FLUX.2 [pro/max/dev] only: preset or
 *   {width, height}
 * @param {number} args.guidanceScale - FLUX.2 [pro/max/dev] only
 * @param {number} args.numInferenceSteps - FLUX.2 [pro/max/dev] only
 */
function buildFalImagePayload(
  modelConfig,
  { prompt, imageUrl, imageSize, guidanceScale, numInferenceSteps }
) {
  switch (modelConfig?.payloadStyle) {
    case 'flux-3':
      // FLUX.3 renders at fixed resolution tiers; 'auto' takes the aspect
      // ratio from the first reference image.
      return {
        prompt,
        image_urls: [imageUrl],
        resolution: modelConfig.resolution || '2k',
        aspect_ratio: 'auto',
        output_format: 'jpeg'
      };
    case 'flux-2-klein':
      // Distilled 4-step model: no guidance input, and no image_size so the
      // output keeps the input image's size (capped client-side by
      // maxInputMegapixels).
      return {
        prompt,
        image_urls: [imageUrl],
        enable_safety_checker: true,
        output_format: 'jpeg'
      };
    case 'muse':
      // Muse renders at its own fixed ~2.5 MP; with no aspect_ratio it picks
      // the output dimensions itself.
      return {
        prompt,
        image_urls: [imageUrl],
        output_format: 'jpeg'
      };
    default: {
      // FLUX.2 edit family (incl. the LoRA endpoint).
      const payload = {
        prompt,
        image_urls: [imageUrl],
        image_size: imageSize, // Preset string or {width, height} object
        guidance_scale: guidanceScale,
        num_inference_steps: numInferenceSteps,
        enable_safety_checker: true,
        output_format: 'jpeg'
      };
      if (modelConfig?.loras && modelConfig.loras.length > 0) {
        payload.loras = modelConfig.loras;
      }
      return payload;
    }
  }
}

/**
 * Resolve the output resolution a request asked for, and what it costs.
 * A model's `resolution` is its default tier at its base `tokenCost`;
 * `outputTiers` lists the paid tiers above it (e.g. Nano Banana Pro 4K,
 * #1887). The server prices the tier: the client only names it.
 *
 * @param {Object} modelConfig - REPLICATE_MODELS entry
 * @param {string|null|undefined} requested - e.g. '4K'; empty = default tier
 * @returns {{resolution: string|null, tokenCost: number}|null} null when the
 *   model doesn't offer the requested tier
 */
function resolveOutputTier(modelConfig, requested) {
  const base = {
    resolution: modelConfig?.resolution || null,
    tokenCost: modelConfig?.tokenCost || 1
  };
  if (!requested || requested === base.resolution) return base;
  // Own keys only: `requested` is client input, so 'constructor' and friends
  // must not resolve to a prototype member with no tokenCost.
  const tiers = modelConfig?.outputTiers;
  if (typeof requested !== 'string' || !tiers) return null;
  if (!Object.prototype.hasOwnProperty.call(tiers, requested)) return null;
  const tier = tiers[requested];
  return { resolution: requested, tokenCost: tier.tokenCost };
}

module.exports = {
  resolveOutputTier,
  buildReplicateImageInput,
  buildFalImagePayload
};
