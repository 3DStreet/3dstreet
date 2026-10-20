/**
 * Drift guard for image model token costs.
 *
 * REPLICATE_MODELS in src/shared/constants/replicateModels.js drives the
 * picker and the cost the UI shows; REPLICATE_MODELS in
 * public/functions/replicate-models.js is what generateReplicateImage /
 * generateFalImage actually charge and how they address the provider. The two
 * deployments can't share imports, so a mismatch would only surface as "the
 * UI said 2, I was charged 3" (or a submit to the wrong model).
 */
import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';
import { REPLICATE_MODELS as PICKER_MODELS } from '../../src/shared/constants/replicateModels.js';

const require = createRequire(import.meta.url);
const {
  REPLICATE_MODELS: BACKEND_MODELS
} = require('../../public/functions/replicate-models.js');

describe('image picker models stay in sync with the backend', () => {
  it.each(Object.entries(PICKER_MODELS))(
    '%s exists on the backend with the same tokenCost and provider address',
    (id, model) => {
      const backend = BACKEND_MODELS[id];
      expect(backend).toBeDefined();
      expect(model.tokenCost).toBe(backend.tokenCost);
      if (model.type === 'fal') {
        expect(backend.type).toBe('fal');
        expect(model.endpoint).toBe(backend.endpoint);
      } else {
        expect(model.type).toBe('replicate');
        // Replicate models are addressed by version hash or by model name.
        expect(model.version).toBe(backend.version);
        expect(model.modelName).toBe(backend.modelName);
      }
    }
  );
});
