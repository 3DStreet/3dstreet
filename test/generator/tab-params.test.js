/**
 * Tab Parameter Builder Tests
 *
 * Tests for the parameter building and validation logic used in
 * video, inpaint, and outpaint tabs. These pure functions will
 * be extracted for React migration.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============= VIDEO TAB EXTRACTABLE FUNCTIONS =============

/**
 * Build video generation request parameters
 * Extracted from VideoTab.buildRequestParams()
 * @param {Object} formData - Form input values
 * @param {Object} options - Additional options
 * @returns {Object|null} - Request params or null if validation fails
 */
const buildVideoParams = (formData, options = {}) => {
  const { imageData, prompt, aspectRatio, duration, modelName } = formData;
  const { onError } = options;

  // Validate required image
  if (!imageData) {
    onError?.('Please upload a reference image');
    return null;
  }

  const params = {
    model_name: modelName || 'bytedance/seedance-1-pro-fast',
    input_image: imageData,
    aspect_ratio: aspectRatio || '16:9',
    duration_seconds: duration || 5
  };

  // Add prompt (use default if empty)
  if (prompt?.trim()) {
    params.prompt = prompt.trim();
  } else {
    params.prompt =
      'create photorealistic animated render of this urban street scene with accurate shading and lighting';
  }

  return params;
};

/**
 * Calculate token cost for video generation
 * @param {number} duration - Duration in seconds (5 or 10)
 * @returns {number} - Token cost
 */
const calculateVideoTokenCost = (duration) => {
  return duration === 10 ? 20 : 10;
};

/**
 * Validate video generation inputs
 * @param {Object} inputs - Form inputs
 * @returns {{ valid: boolean, errors: string[] }}
 */
const validateVideoInputs = (inputs) => {
  const errors = [];

  if (!inputs.imageData) {
    errors.push('Source image is required');
  }

  // Prompt is optional for video
  // Duration must be 5 or 10
  if (inputs.duration && ![5, 10].includes(inputs.duration)) {
    errors.push('Duration must be 5 or 10 seconds');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

// ============= INPAINT TAB EXTRACTABLE FUNCTIONS =============

/**
 * Build inpaint generation request parameters
 * Extracted from InpaintTab.generateInpaint()
 * @param {Object} formData - Form input values
 * @returns {Object} - Request params
 */
const buildInpaintParams = (formData) => {
  const {
    imageData,
    maskData,
    prompt,
    steps = 50,
    guidance = 60,
    seed = null,
    promptUpsampling = false,
    outputFormat = 'jpeg',
    safetyTolerance = 2
  } = formData;

  return {
    image: imageData.includes(',') ? imageData.split(',')[1] : imageData,
    mask: maskData.includes(',') ? maskData.split(',')[1] : maskData,
    prompt: prompt.trim(),
    steps: parseInt(steps),
    guidance: parseFloat(guidance),
    seed: seed ? parseInt(seed) : null,
    prompt_upsampling: promptUpsampling,
    output_format: outputFormat,
    safety_tolerance: parseInt(safetyTolerance)
  };
};

/**
 * Validate inpaint inputs
 * @param {Object} inputs
 * @returns {{ valid: boolean, errors: string[] }}
 */
const validateInpaintInputs = (inputs) => {
  const errors = [];

  if (!inputs.imageData) {
    errors.push('Source image is required');
  }

  if (!inputs.maskData) {
    errors.push('Mask is required');
  }

  if (!inputs.prompt?.trim()) {
    errors.push('Prompt is required');
  }

  return {
    valid: errors.length === 0,
    errors
  };
};

/**
 * Check if mask has any white pixels
 * Extracted from InpaintTab.hasMaskContent()
 * @param {Uint8ClampedArray} pixelData - Canvas pixel data
 * @returns {boolean}
 */
const hasMaskContent = (pixelData) => {
  // Check every 4th value (R channel in RGBA)
  for (let i = 0; i < pixelData.length; i += 4) {
    if (pixelData[i] === 255) {
      return true;
    }
  }
  return false;
};

// ============= OUTPAINT TAB EXTRACTABLE FUNCTIONS =============

/**
 * Build outpaint generation request parameters
 * Similar to inpaint but with different mask interpretation
 * @param {Object} formData - Form input values
 * @returns {Object} - Request params
 */
const buildOutpaintParams = (formData) => {
  const {
    imageData,
    maskData,
    prompt,
    steps = 50,
    guidance = 60,
    seed = null,
    promptUpsampling = false,
    outputFormat = 'jpeg',
    safetyTolerance = 2
  } = formData;

  // Outpaint inverts the mask - black areas are extended
  return {
    image: imageData.includes(',') ? imageData.split(',')[1] : imageData,
    mask: maskData.includes(',') ? maskData.split(',')[1] : maskData,
    prompt: prompt.trim(),
    steps: parseInt(steps),
    guidance: parseFloat(guidance),
    seed: seed ? parseInt(seed) : null,
    prompt_upsampling: promptUpsampling,
    output_format: outputFormat,
    safety_tolerance: parseInt(safetyTolerance)
  };
};

// ============= COMMON FUNCTIONS =============

/**
 * Generate a random seed value
 * @returns {number}
 */
const generateRandomSeed = () => {
  return Math.floor(Math.random() * 1000000);
};

/**
 * Check if pending gallery item is valid for a specific tab
 * @param {Object} pendingItem - Item from localStorage
 * @param {string} targetTab - Tab name to check
 * @returns {boolean}
 */
const isPendingItemValidForTab = (pendingItem, targetTab) => {
  if (!pendingItem) return false;
  if (pendingItem.targetTab !== targetTab) return false;
  if (Date.now() - pendingItem.timestamp >= 10000) return false;
  if (!pendingItem.imageDataUrl || typeof pendingItem.imageDataUrl !== 'string')
    return false;
  return true;
};

/**
 * Extract base64 data from data URL
 * @param {string} dataUrl - Full data URL
 * @returns {string} - Base64 portion only (everything after first comma)
 */
const extractBase64FromDataUrl = (dataUrl) => {
  if (!dataUrl) return '';
  const commaIndex = dataUrl.indexOf(',');
  return commaIndex > -1 ? dataUrl.substring(commaIndex + 1) : dataUrl;
};

/**
 * Generate download filename
 * @param {string} prefix - File prefix (e.g., 'video', 'inpaint')
 * @param {string} extension - File extension
 * @returns {string}
 */
const generateDownloadFilename = (prefix, extension = 'mp4') => {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19);
  return `3dstreet-${prefix}-${timestamp}.${extension}`;
};

// ============= TESTS =============

describe('Video Tab Parameters', () => {
  describe('buildVideoParams()', () => {
    it('should return null when no image data', () => {
      const onError = vi.fn();
      const result = buildVideoParams({ imageData: null }, { onError });

      expect(result).toBeNull();
      expect(onError).toHaveBeenCalledWith('Please upload a reference image');
    });

    it('should build params with all required fields', () => {
      const formData = {
        imageData: 'base64ImageData',
        prompt: 'A city street',
        aspectRatio: '16:9',
        duration: 5,
        modelName: 'bytedance/seedance-1-pro-fast'
      };

      const result = buildVideoParams(formData);

      expect(result).toEqual({
        model_name: 'bytedance/seedance-1-pro-fast',
        input_image: 'base64ImageData',
        prompt: 'A city street',
        aspect_ratio: '16:9',
        duration_seconds: 5
      });
    });

    it('should use default prompt when empty', () => {
      const formData = {
        imageData: 'base64ImageData',
        prompt: ''
      };

      const result = buildVideoParams(formData);

      expect(result.prompt).toContain('create photorealistic animated render');
    });

    it('should use default model when not provided', () => {
      const formData = {
        imageData: 'base64ImageData'
      };

      const result = buildVideoParams(formData);

      expect(result.model_name).toBe('bytedance/seedance-1-pro-fast');
    });

    it('should trim prompt whitespace', () => {
      const formData = {
        imageData: 'base64ImageData',
        prompt: '  A beautiful scene  '
      };

      const result = buildVideoParams(formData);

      expect(result.prompt).toBe('A beautiful scene');
    });
  });

  describe('calculateVideoTokenCost()', () => {
    it('should return 10 tokens for 5 second video', () => {
      expect(calculateVideoTokenCost(5)).toBe(10);
    });

    it('should return 20 tokens for 10 second video', () => {
      expect(calculateVideoTokenCost(10)).toBe(20);
    });

    it('should return 10 tokens for default/other values', () => {
      expect(calculateVideoTokenCost(3)).toBe(10);
      expect(calculateVideoTokenCost(undefined)).toBe(10);
    });
  });

  describe('validateVideoInputs()', () => {
    it('should pass when image is provided', () => {
      const result = validateVideoInputs({ imageData: 'data:image/...' });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when image is missing', () => {
      const result = validateVideoInputs({ imageData: null });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Source image is required');
    });

    it('should fail for invalid duration', () => {
      const result = validateVideoInputs({
        imageData: 'data:image/...',
        duration: 7
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Duration must be 5 or 10 seconds');
    });
  });
});

describe('Inpaint Tab Parameters', () => {
  describe('buildInpaintParams()', () => {
    it('should build params with all fields', () => {
      const formData = {
        imageData: 'data:image/png;base64,abc123',
        maskData: 'data:image/png;base64,def456',
        prompt: 'Replace with trees',
        steps: 40,
        guidance: 50,
        seed: 12345,
        promptUpsampling: true,
        outputFormat: 'png',
        safetyTolerance: 3
      };

      const result = buildInpaintParams(formData);

      expect(result).toEqual({
        image: 'abc123',
        mask: 'def456',
        prompt: 'Replace with trees',
        steps: 40,
        guidance: 50,
        seed: 12345,
        prompt_upsampling: true,
        output_format: 'png',
        safety_tolerance: 3
      });
    });

    it('should use default values when not provided', () => {
      const formData = {
        imageData: 'data:image/png;base64,abc',
        maskData: 'data:image/png;base64,def',
        prompt: 'Test prompt'
      };

      const result = buildInpaintParams(formData);

      expect(result.steps).toBe(50);
      expect(result.guidance).toBe(60);
      expect(result.seed).toBeNull();
      expect(result.prompt_upsampling).toBe(false);
      expect(result.output_format).toBe('jpeg');
      expect(result.safety_tolerance).toBe(2);
    });

    it('should extract base64 from data URLs', () => {
      const formData = {
        imageData: 'data:image/png;base64,imageBase64Part',
        maskData: 'data:image/png;base64,maskBase64Part',
        prompt: 'Test'
      };

      const result = buildInpaintParams(formData);

      expect(result.image).toBe('imageBase64Part');
      expect(result.mask).toBe('maskBase64Part');
    });

    it('should handle raw base64 without data URL prefix', () => {
      const formData = {
        imageData: 'rawBase64Image',
        maskData: 'rawBase64Mask',
        prompt: 'Test'
      };

      const result = buildInpaintParams(formData);

      expect(result.image).toBe('rawBase64Image');
      expect(result.mask).toBe('rawBase64Mask');
    });

    it('should trim prompt whitespace', () => {
      const formData = {
        imageData: 'data:image/png;base64,abc',
        maskData: 'data:image/png;base64,def',
        prompt: '  Replace the building  '
      };

      const result = buildInpaintParams(formData);

      expect(result.prompt).toBe('Replace the building');
    });
  });

  describe('validateInpaintInputs()', () => {
    it('should pass when all required fields provided', () => {
      const result = validateInpaintInputs({
        imageData: 'data:image/...',
        maskData: 'data:image/...',
        prompt: 'Test prompt'
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail when image is missing', () => {
      const result = validateInpaintInputs({
        maskData: 'data:image/...',
        prompt: 'Test prompt'
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Source image is required');
    });

    it('should fail when mask is missing', () => {
      const result = validateInpaintInputs({
        imageData: 'data:image/...',
        prompt: 'Test prompt'
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Mask is required');
    });

    it('should fail when prompt is missing', () => {
      const result = validateInpaintInputs({
        imageData: 'data:image/...',
        maskData: 'data:image/...',
        prompt: ''
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prompt is required');
    });

    it('should fail when prompt is only whitespace', () => {
      const result = validateInpaintInputs({
        imageData: 'data:image/...',
        maskData: 'data:image/...',
        prompt: '   '
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Prompt is required');
    });

    it('should return all errors when multiple validation failures', () => {
      const result = validateInpaintInputs({});

      expect(result.valid).toBe(false);
      expect(result.errors).toHaveLength(3);
    });
  });

  describe('hasMaskContent()', () => {
    it('should return true when white pixels exist', () => {
      // RGBA: white pixel has R=255
      const pixelData = new Uint8ClampedArray([255, 255, 255, 255]);

      expect(hasMaskContent(pixelData)).toBe(true);
    });

    it('should return false when all black', () => {
      // RGBA: black pixel has R=0
      const pixelData = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255]);

      expect(hasMaskContent(pixelData)).toBe(false);
    });

    it('should detect white in large pixel array', () => {
      // Create mostly black array with one white pixel in middle
      const pixelData = new Uint8ClampedArray(400);
      pixelData.fill(0);
      pixelData[200] = 255; // Set one R channel to white

      expect(hasMaskContent(pixelData)).toBe(true);
    });

    it('should return false for empty array', () => {
      expect(hasMaskContent(new Uint8ClampedArray([]))).toBe(false);
    });
  });
});

describe('Common Utility Functions', () => {
  describe('generateRandomSeed()', () => {
    it('should return a number', () => {
      const seed = generateRandomSeed();

      expect(typeof seed).toBe('number');
    });

    it('should return value between 0 and 999999', () => {
      for (let i = 0; i < 100; i++) {
        const seed = generateRandomSeed();
        expect(seed).toBeGreaterThanOrEqual(0);
        expect(seed).toBeLessThan(1000000);
      }
    });

    it('should return integer values', () => {
      const seed = generateRandomSeed();

      expect(Number.isInteger(seed)).toBe(true);
    });
  });

  describe('isPendingItemValidForTab()', () => {
    it('should return true for valid recent item', () => {
      const item = {
        targetTab: 'video',
        timestamp: Date.now() - 5000, // 5 seconds ago
        imageDataUrl: 'data:image/png;base64,...'
      };

      expect(isPendingItemValidForTab(item, 'video')).toBe(true);
    });

    it('should return false for wrong tab', () => {
      const item = {
        targetTab: 'inpaint',
        timestamp: Date.now(),
        imageDataUrl: 'data:image/png;base64,...'
      };

      expect(isPendingItemValidForTab(item, 'video')).toBe(false);
    });

    it('should return false for expired item (>10 seconds)', () => {
      const item = {
        targetTab: 'video',
        timestamp: Date.now() - 15000, // 15 seconds ago
        imageDataUrl: 'data:image/png;base64,...'
      };

      expect(isPendingItemValidForTab(item, 'video')).toBe(false);
    });

    it('should return false for null item', () => {
      expect(isPendingItemValidForTab(null, 'video')).toBe(false);
    });

    it('should return false for missing imageDataUrl', () => {
      const item = {
        targetTab: 'video',
        timestamp: Date.now()
      };

      expect(isPendingItemValidForTab(item, 'video')).toBe(false);
    });

    it('should return false for non-string imageDataUrl', () => {
      const item = {
        targetTab: 'video',
        timestamp: Date.now(),
        imageDataUrl: 12345
      };

      expect(isPendingItemValidForTab(item, 'video')).toBe(false);
    });
  });

  describe('extractBase64FromDataUrl()', () => {
    it('should extract base64 from full data URL', () => {
      const dataUrl = 'data:image/png;base64,abc123xyz';

      expect(extractBase64FromDataUrl(dataUrl)).toBe('abc123xyz');
    });

    it('should return raw string if no comma present', () => {
      const rawBase64 = 'abc123xyz';

      expect(extractBase64FromDataUrl(rawBase64)).toBe('abc123xyz');
    });

    it('should return empty string for null/undefined', () => {
      expect(extractBase64FromDataUrl(null)).toBe('');
      expect(extractBase64FromDataUrl(undefined)).toBe('');
    });

    it('should handle data URL with multiple commas', () => {
      // Should only split on first comma
      const dataUrl = 'data:image/png;base64,abc,123,xyz';

      expect(extractBase64FromDataUrl(dataUrl)).toBe('abc,123,xyz');
    });
  });

  describe('generateDownloadFilename()', () => {
    it('should generate filename with prefix and extension', () => {
      const filename = generateDownloadFilename('video');

      expect(filename).toMatch(/^3dstreet-video-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.mp4$/);
    });

    it('should use custom extension', () => {
      const filename = generateDownloadFilename('inpaint', 'jpeg');

      expect(filename).toMatch(/\.jpeg$/);
    });

    it('should use different prefixes correctly', () => {
      expect(generateDownloadFilename('video')).toContain('3dstreet-video');
      expect(generateDownloadFilename('inpaint')).toContain('3dstreet-inpaint');
      expect(generateDownloadFilename('outpaint')).toContain('3dstreet-outpaint');
    });
  });
});

describe('Outpaint Tab Parameters', () => {
  describe('buildOutpaintParams()', () => {
    it('should build params identical to inpaint (same API)', () => {
      const formData = {
        imageData: 'data:image/png;base64,abc123',
        maskData: 'data:image/png;base64,def456',
        prompt: 'Extend the landscape'
      };

      const result = buildOutpaintParams(formData);

      expect(result.image).toBe('abc123');
      expect(result.mask).toBe('def456');
      expect(result.prompt).toBe('Extend the landscape');
    });
  });
});

/**
 * React Migration Notes:
 *
 * These pure functions can be extracted into:
 *
 * // hooks/useVideoGeneration.js
 * const useVideoGeneration = () => {
 *   const [params, setParams] = useState(null);
 *   const tokenCost = useMemo(() => calculateVideoTokenCost(duration), [duration]);
 *
 *   const buildParams = useCallback((formData) => {
 *     const validation = validateVideoInputs(formData);
 *     if (!validation.valid) { ... }
 *     return buildVideoParams(formData);
 *   }, []);
 *
 *   return { params, tokenCost, buildParams };
 * };
 *
 * // hooks/useInpaint.js
 * const useInpaint = () => {
 *   const buildParams = useCallback(buildInpaintParams, []);
 *   const validate = useCallback(validateInpaintInputs, []);
 *   const checkMaskContent = useCallback(hasMaskContent, []);
 *   return { buildParams, validate, checkMaskContent };
 * };
 */
