import { t } from './i18n/messages.js';

// Selectable image -> mesh models (all GLB output via fal). tokenCost mirrors
// the backend source of truth (public/functions/replicate-models.js), which
// enforces the real charge; test/generator/model3d-models-sync.test.js guards
// drift. The first entry is the default selection. estimatedTime drives the
// progress bar only.
export const MODEL3D_MODELS = [
  {
    id: 'trellis',
    name: t('model3d.modelTrellisName'),
    tokenCost: 6,
    estimatedTime: 60
  },
  {
    id: 'hunyuan-3d',
    name: t('model3d.modelHunyuanName'),
    tokenCost: 8,
    estimatedTime: 600
  },
  {
    id: 'meshy',
    name: t('model3d.modelMeshyName'),
    tokenCost: 24,
    estimatedTime: 120
  }
];
