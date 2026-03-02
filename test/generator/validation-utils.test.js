/**
 * Validation and Parameter Building Tests
 *
 * These tests document the validation and parameter building logic
 * that will be extracted into pure functions for React migration.
 *
 * The patterns here define the contracts that React hooks must satisfy.
 */
import { describe, it, expect } from 'vitest';

/**
 * Pure validation function - extracted from GeneratorTabBase.validateGeneration()
 * This is the target API for React migration.
 */
const validateGeneration = (authState, config, formData) => {
  const errors = [];

  // Check authentication
  if (!authState?.isAuthenticated) {
    return { valid: false, error: 'auth_required', errors: ['Not authenticated'] };
  }

  // Check tokens
  if (!(authState?.tokenProfile?.genToken > 0)) {
    return { valid: false, error: 'no_tokens', errors: ['No tokens available'] };
  }

  // Check prompt requirement
  if (config.requiresPrompt && !formData.prompt?.trim()) {
    errors.push('Prompt is required');
  }

  // Check source image requirement
  if (config.requiresSourceImage && !formData.sourceImage) {
    errors.push('Source image is required');
  }

  if (errors.length > 0) {
    return { valid: false, error: 'validation_failed', errors };
  }

  return { valid: true, error: null, errors: [] };
};

/**
 * Pure dimension parser - extracted from buildRequestParams()
 */
const parseDimension = (dimensionString) => {
  const parts = dimensionString.split('x').map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) {
    return null;
  }
  return { width: parts[0], height: parts[1] };
};

/**
 * Pure parameter builder - extracted from buildRequestParams()
 * Returns model-specific parameters without DOM dependencies.
 */
const buildRequestParams = (model, formData, options = {}) => {
  const params = {
    safety_tolerance: options.safetyTolerance ?? 2,
    output_format: options.outputFormat ?? 'jpeg',
    prompt_upsampling: options.promptUpsampling ?? false
  };

  // Add prompt
  if (formData.prompt?.trim()) {
    params.prompt = formData.prompt.trim();
  }

  // Add seed if provided
  if (formData.seed !== undefined && formData.seed !== null) {
    params.seed = parseInt(formData.seed);
  }

  // Add image data based on model
  if (formData.sourceImage) {
    if (model === 'flux-kontext-pro' || model === 'flux-kontext-max') {
      params.input_image = formData.sourceImage;
    } else {
      params.image_prompt = formData.sourceImage;

      if (model === 'flux-pro-1.1-ultra' && formData.imagePromptStrength) {
        params.image_prompt_strength = parseFloat(formData.imagePromptStrength);
      }
    }
  }

  // Model-specific parameters
  switch (model) {
    case 'flux-pro-1.1-ultra':
      params.aspect_ratio = formData.aspectRatio || '16:9';
      if (formData.rawMode) {
        params.raw = true;
      }
      break;

    case 'flux-pro-1.1': {
      const dims = parseDimension(formData.dimension || '1024x768');
      if (dims) {
        params.width = dims.width;
        params.height = dims.height;
      }
      break;
    }

    case 'flux-pro': {
      const dims = parseDimension(formData.dimension || '1024x768');
      if (dims) {
        params.width = dims.width;
        params.height = dims.height;
      }
      params.steps = formData.steps ?? 25;
      params.guidance = formData.guidance ?? 3.0;
      params.interval = formData.interval ?? 2.0;
      break;
    }

    case 'flux-dev': {
      const dims = parseDimension(formData.dimension || '1024x768');
      if (dims) {
        params.width = dims.width;
        params.height = dims.height;
      }
      params.steps = formData.steps ?? 25;
      params.guidance = formData.guidance ?? 3.0;
      break;
    }

    case 'flux-kontext-pro':
    case 'flux-kontext-max':
      params.aspect_ratio = formData.aspectRatio || '16:9';
      break;

    case 'kontext-realearth':
    case 'nano-banana':
    case 'nano-banana-pro':
    case 'seedream-4':
      // These models require source image - validation handles this
      break;
  }

  return params;
};

/**
 * Dimension options by orientation
 */
const getDimensionsByOrientation = (orientation) => {
  const dimensionMap = {
    square: ['1024x1024', '512x512'],
    landscape: ['1024x768', '1280x720', '1440x1080', '1920x1080'],
    portrait: ['768x1024', '720x1280', '1080x1440', '1080x1920']
  };
  return dimensionMap[orientation] || dimensionMap.landscape;
};

/**
 * Validate selected dimension exists in orientation
 */
const getValidDimension = (selectedDimension, orientation) => {
  const validDimensions = getDimensionsByOrientation(orientation);
  if (validDimensions.includes(selectedDimension)) {
    return selectedDimension;
  }
  return validDimensions[0] || '1024x768';
};

// ============= TESTS =============

describe('Validation Utils', () => {
  describe('validateGeneration()', () => {
    const createAuthState = (overrides = {}) => ({
      isAuthenticated: true,
      tokenProfile: { genToken: 10 },
      ...overrides
    });

    const createConfig = (overrides = {}) => ({
      requiresPrompt: false,
      requiresSourceImage: false,
      ...overrides
    });

    it('should return auth_required when not authenticated', () => {
      const result = validateGeneration(
        { isAuthenticated: false },
        createConfig(),
        {}
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('auth_required');
    });

    it('should return auth_required when authState is null', () => {
      const result = validateGeneration(null, createConfig(), {});

      expect(result.valid).toBe(false);
      expect(result.error).toBe('auth_required');
    });

    it('should return no_tokens when genToken is 0', () => {
      const result = validateGeneration(
        createAuthState({ tokenProfile: { genToken: 0 } }),
        createConfig(),
        {}
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('no_tokens');
    });

    it('should return no_tokens when tokenProfile is null', () => {
      const result = validateGeneration(
        createAuthState({ tokenProfile: null }),
        createConfig(),
        {}
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('no_tokens');
    });

    it('should require prompt when config.requiresPrompt is true', () => {
      const result = validateGeneration(
        createAuthState(),
        createConfig({ requiresPrompt: true }),
        { prompt: '' }
      );

      expect(result.valid).toBe(false);
      expect(result.error).toBe('validation_failed');
      expect(result.errors).toContain('Prompt is required');
    });

    it('should accept whitespace-only prompt as empty', () => {
      const result = validateGeneration(
        createAuthState(),
        createConfig({ requiresPrompt: true }),
        { prompt: '   ' }
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prompt is required');
    });

    it('should require source image when config.requiresSourceImage is true', () => {
      const result = validateGeneration(
        createAuthState(),
        createConfig({ requiresSourceImage: true }),
        { sourceImage: null }
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Source image is required');
    });

    it('should return multiple errors when multiple validations fail', () => {
      const result = validateGeneration(
        createAuthState(),
        createConfig({ requiresPrompt: true, requiresSourceImage: true }),
        { prompt: '', sourceImage: null }
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors).toContain('Prompt is required');
      expect(result.errors).toContain('Source image is required');
    });

    it('should return valid when all requirements are met', () => {
      const result = validateGeneration(
        createAuthState(),
        createConfig({ requiresPrompt: true, requiresSourceImage: true }),
        { prompt: 'A beautiful sunset', sourceImage: 'data:image/jpeg;base64,...' }
      );

      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
      expect(result.errors).toHaveLength(0);
    });

    it('should pass when no requirements are set', () => {
      const result = validateGeneration(createAuthState(), createConfig(), {});

      expect(result.valid).toBe(true);
    });
  });

  describe('parseDimension()', () => {
    it('should parse valid dimension string', () => {
      expect(parseDimension('1024x768')).toEqual({ width: 1024, height: 768 });
    });

    it('should parse square dimensions', () => {
      expect(parseDimension('512x512')).toEqual({ width: 512, height: 512 });
    });

    it('should parse large dimensions', () => {
      expect(parseDimension('1920x1080')).toEqual({ width: 1920, height: 1080 });
    });

    it('should return null for invalid format', () => {
      expect(parseDimension('invalid')).toBeNull();
    });

    it('should return null for single number', () => {
      expect(parseDimension('1024')).toBeNull();
    });

    it('should return null for non-numeric values', () => {
      expect(parseDimension('widthxheight')).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseDimension('')).toBeNull();
    });
  });

  describe('buildRequestParams()', () => {
    describe('Common Parameters', () => {
      it('should include default safety and format options', () => {
        const params = buildRequestParams('flux-pro-1.1', {});

        expect(params.safety_tolerance).toBe(2);
        expect(params.output_format).toBe('jpeg');
        expect(params.prompt_upsampling).toBe(false);
      });

      it('should override default options', () => {
        const params = buildRequestParams(
          'flux-pro-1.1',
          {},
          { safetyTolerance: 5, outputFormat: 'png', promptUpsampling: true }
        );

        expect(params.safety_tolerance).toBe(5);
        expect(params.output_format).toBe('png');
        expect(params.prompt_upsampling).toBe(true);
      });

      it('should trim prompt whitespace', () => {
        const params = buildRequestParams('flux-pro-1.1', {
          prompt: '  A beautiful sunset  '
        });

        expect(params.prompt).toBe('A beautiful sunset');
      });

      it('should not include prompt when empty', () => {
        const params = buildRequestParams('flux-pro-1.1', { prompt: '' });

        expect(params.prompt).toBeUndefined();
      });

      it('should include seed when provided', () => {
        const params = buildRequestParams('flux-pro-1.1', { seed: 12345 });

        expect(params.seed).toBe(12345);
      });

      it('should parse seed as integer', () => {
        const params = buildRequestParams('flux-pro-1.1', { seed: '12345' });

        expect(params.seed).toBe(12345);
      });
    });

    describe('flux-pro-1.1-ultra', () => {
      it('should include aspect_ratio', () => {
        const params = buildRequestParams('flux-pro-1.1-ultra', {
          aspectRatio: '4:3'
        });

        expect(params.aspect_ratio).toBe('4:3');
      });

      it('should default aspect_ratio to 16:9', () => {
        const params = buildRequestParams('flux-pro-1.1-ultra', {});

        expect(params.aspect_ratio).toBe('16:9');
      });

      it('should include raw flag when enabled', () => {
        const params = buildRequestParams('flux-pro-1.1-ultra', {
          rawMode: true
        });

        expect(params.raw).toBe(true);
      });

      it('should not include raw flag when disabled', () => {
        const params = buildRequestParams('flux-pro-1.1-ultra', {
          rawMode: false
        });

        expect(params.raw).toBeUndefined();
      });

      it('should include image_prompt_strength with source image', () => {
        const params = buildRequestParams('flux-pro-1.1-ultra', {
          sourceImage: 'data:image/jpeg;base64,...',
          imagePromptStrength: 0.8
        });

        expect(params.image_prompt).toBe('data:image/jpeg;base64,...');
        expect(params.image_prompt_strength).toBe(0.8);
      });
    });

    describe('flux-pro-1.1', () => {
      it('should include width and height from dimension', () => {
        const params = buildRequestParams('flux-pro-1.1', {
          dimension: '1280x720'
        });

        expect(params.width).toBe(1280);
        expect(params.height).toBe(720);
      });

      it('should default to 1024x768', () => {
        const params = buildRequestParams('flux-pro-1.1', {});

        expect(params.width).toBe(1024);
        expect(params.height).toBe(768);
      });
    });

    describe('flux-pro', () => {
      it('should include width, height, steps, guidance, interval', () => {
        const params = buildRequestParams('flux-pro', {
          dimension: '1920x1080',
          steps: 30,
          guidance: 4.0,
          interval: 2.5
        });

        expect(params.width).toBe(1920);
        expect(params.height).toBe(1080);
        expect(params.steps).toBe(30);
        expect(params.guidance).toBe(4.0);
        expect(params.interval).toBe(2.5);
      });

      it('should use default values for steps, guidance, interval', () => {
        const params = buildRequestParams('flux-pro', {});

        expect(params.steps).toBe(25);
        expect(params.guidance).toBe(3.0);
        expect(params.interval).toBe(2.0);
      });
    });

    describe('flux-dev', () => {
      it('should include width, height, steps, guidance (no interval)', () => {
        const params = buildRequestParams('flux-dev', {
          dimension: '1024x1024',
          steps: 20,
          guidance: 3.5
        });

        expect(params.width).toBe(1024);
        expect(params.height).toBe(1024);
        expect(params.steps).toBe(20);
        expect(params.guidance).toBe(3.5);
        expect(params.interval).toBeUndefined();
      });
    });

    describe('flux-kontext models', () => {
      it('should use input_image instead of image_prompt', () => {
        const params = buildRequestParams('flux-kontext-pro', {
          sourceImage: 'data:image/jpeg;base64,...'
        });

        expect(params.input_image).toBe('data:image/jpeg;base64,...');
        expect(params.image_prompt).toBeUndefined();
      });

      it('should include aspect_ratio for kontext models', () => {
        const params = buildRequestParams('flux-kontext-max', {
          aspectRatio: '1:1'
        });

        expect(params.aspect_ratio).toBe('1:1');
      });
    });
  });

  describe('getDimensionsByOrientation()', () => {
    it('should return square dimensions', () => {
      const dims = getDimensionsByOrientation('square');

      expect(dims).toContain('1024x1024');
      expect(dims).toContain('512x512');
    });

    it('should return landscape dimensions', () => {
      const dims = getDimensionsByOrientation('landscape');

      expect(dims).toContain('1024x768');
      expect(dims).toContain('1920x1080');
    });

    it('should return portrait dimensions', () => {
      const dims = getDimensionsByOrientation('portrait');

      expect(dims).toContain('768x1024');
      expect(dims).toContain('1080x1920');
    });

    it('should default to landscape for unknown orientation', () => {
      const dims = getDimensionsByOrientation('unknown');

      expect(dims).toEqual(getDimensionsByOrientation('landscape'));
    });
  });

  describe('getValidDimension()', () => {
    it('should return selected dimension when valid', () => {
      const result = getValidDimension('1024x1024', 'square');

      expect(result).toBe('1024x1024');
    });

    it('should return first dimension when selected is invalid', () => {
      const result = getValidDimension('invalid', 'landscape');

      expect(result).toBe('1024x768');
    });

    it('should return first dimension when selected is from different orientation', () => {
      const result = getValidDimension('768x1024', 'landscape');

      expect(result).toBe('1024x768');
    });
  });
});
