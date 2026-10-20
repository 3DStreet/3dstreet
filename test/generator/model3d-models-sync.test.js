/**
 * Drift guard for 3D Model tab token costs.
 *
 * MODEL3D_MODELS (src/generator/model3d-models.js) shows the cost in the UI;
 * REPLICATE_MODELS (public/functions/replicate-models.js) is what
 * generateFalMesh actually charges. The two deployments can't share imports,
 * so a mismatch would only surface as "the UI said 5, I was charged 6".
 */
import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';
import { MODEL3D_MODELS } from '../../src/generator/model3d-models.js';

const require = createRequire(import.meta.url);
const {
  REPLICATE_MODELS
} = require('../../public/functions/replicate-models.js');

describe('3D Model tab models stay in sync with the backend', () => {
  it.each(MODEL3D_MODELS.map((m) => [m.id, m]))(
    '%s is a fal-3d model with the same tokenCost',
    (id, model) => {
      const backend = REPLICATE_MODELS[id];
      expect(backend?.type).toBe('fal-3d');
      expect(model.tokenCost).toBe(backend.tokenCost);
    }
  );

  it('every backend fal-3d model is offered in the picker', () => {
    const backendIds = Object.keys(REPLICATE_MODELS).filter(
      (id) => REPLICATE_MODELS[id].type === 'fal-3d'
    );
    expect(MODEL3D_MODELS.map((m) => m.id).sort()).toEqual(backendIds.sort());
  });
});
