import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildReplicateImageInput,
  buildFalImagePayload
} = require('../../public/functions/image-model-inputs.js');
const {
  REPLICATE_MODELS
} = require('../../public/functions/replicate-models.js');

const IMG = 'https://storage.googleapis.com/bucket/temp/in.jpg';
const replicateArgs = (imageUrl) => ({
  prompt: 'p',
  imageUrl,
  guidance: 2.5,
  numInferenceSteps: 30
});
const falArgs = {
  prompt: 'p',
  imageUrl: IMG,
  imageSize: { width: 1600, height: 900 },
  guidanceScale: 2.5,
  numInferenceSteps: 28
};

describe('buildReplicateImageInput', () => {
  it.each(['nano-banana-pro', 'nano-banana-2'])(
    '%s sends the source image as image_input at 2K',
    (id) => {
      expect(
        buildReplicateImageInput(REPLICATE_MODELS[id], replicateArgs(IMG))
      ).toEqual({
        prompt: 'p',
        image_input: [IMG],
        aspect_ratio: 'match_input_image',
        resolution: '2K',
        output_format: 'jpg'
      });
    }
  );

  it('original Nano Banana sends no resolution', () => {
    const input = buildReplicateImageInput(
      REPLICATE_MODELS['nano-banana'],
      replicateArgs(IMG)
    );
    expect(input.resolution).toBeUndefined();
    expect(input.image_input).toEqual([IMG]);
  });

  it('Seedream 5.0 Pro edits at 2K as JPEG', () => {
    expect(
      buildReplicateImageInput(
        REPLICATE_MODELS['seedream-5-pro'],
        replicateArgs(IMG)
      )
    ).toEqual({
      prompt: 'p',
      size: '2K',
      image_input: [IMG],
      output_format: 'jpeg'
    });
  });

  it('Seedream 5.0 Pro picks a 16:9 aspect for text-only renders', () => {
    const input = buildReplicateImageInput(
      REPLICATE_MODELS['seedream-5-pro'],
      replicateArgs(null)
    );
    expect(input.aspect_ratio).toBe('16:9');
    expect(input.image_input).toBeUndefined();
  });

  it('Seedream 4.5 keeps its original input shape', () => {
    expect(
      buildReplicateImageInput(
        REPLICATE_MODELS['seedream-4.5'],
        replicateArgs(IMG)
      )
    ).toEqual({ prompt: 'p', size: '2K', image_input: [IMG] });
  });

  it('Grok Imagine sends a single image at 2k', () => {
    expect(
      buildReplicateImageInput(
        REPLICATE_MODELS['grok-imagine-image-2'],
        replicateArgs(IMG)
      )
    ).toEqual({ prompt: 'p', image: IMG, resolution: '2k', quality: 'medium' });
  });

  it('Grok Imagine picks a 16:9 aspect for text-only renders', () => {
    const input = buildReplicateImageInput(
      REPLICATE_MODELS['grok-imagine-image-2'],
      replicateArgs(null)
    );
    expect(input.aspect_ratio).toBe('16:9');
    expect(input.image).toBeUndefined();
  });

  it('Kontext models keep input_image + sampler settings', () => {
    expect(
      buildReplicateImageInput(
        REPLICATE_MODELS['flux-kontext-pro'],
        replicateArgs(IMG)
      )
    ).toEqual({
      prompt: 'p',
      guidance: 2.5,
      num_inference_steps: 30,
      output_format: 'jpg',
      input_image: IMG
    });
  });
});

describe('buildFalImagePayload', () => {
  it('FLUX.3 uses the 2k tier and the input aspect ratio', () => {
    expect(
      buildFalImagePayload(REPLICATE_MODELS['fal-flux-3-edit'], falArgs)
    ).toEqual({
      prompt: 'p',
      image_urls: [IMG],
      resolution: '2k',
      aspect_ratio: 'auto',
      output_format: 'jpeg'
    });
  });

  it('FLUX.2 klein sends no sampler settings or image_size', () => {
    expect(
      buildFalImagePayload(
        REPLICATE_MODELS['fal-flux-2-klein-9b-edit'],
        falArgs
      )
    ).toEqual({
      prompt: 'p',
      image_urls: [IMG],
      enable_safety_checker: true,
      output_format: 'jpeg'
    });
  });

  it('Muse sends only the prompt, image and format', () => {
    expect(
      buildFalImagePayload(REPLICATE_MODELS['fal-muse-image-edit'], falArgs)
    ).toEqual({ prompt: 'p', image_urls: [IMG], output_format: 'jpeg' });
  });

  it('FLUX.2 keeps image_size + sampler settings', () => {
    expect(
      buildFalImagePayload(REPLICATE_MODELS['fal-flux-2-max-edit'], falArgs)
    ).toEqual({
      prompt: 'p',
      image_urls: [IMG],
      image_size: { width: 1600, height: 900 },
      guidance_scale: 2.5,
      num_inference_steps: 28,
      enable_safety_checker: true,
      output_format: 'jpeg'
    });
  });

  it('the SFMTA LoRA endpoint still sends its LoRA', () => {
    const payload = buildFalImagePayload(
      REPLICATE_MODELS['fal-flux-2-lora-sfmta'],
      falArgs
    );
    expect(payload.loras).toEqual(
      REPLICATE_MODELS['fal-flux-2-lora-sfmta'].loras
    );
  });
});
