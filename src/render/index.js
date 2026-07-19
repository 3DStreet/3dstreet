/**
 * Entry for the headless render page (render.html) behind the renderStreet
 * Cloud Function. A lean sibling of src/index.js: only what a managed-street
 * json-blob import needs to produce a labeled beauty shot — no React editor,
 * no viewer/play UI, no geospatial layers. Keep the component list in sync
 * with the json-blob path of src/index.js when street rendering grows new
 * dependencies (test/components/managed-street-json.test.js documents the
 * minimal set).
 */

// street-segment assigns STREET.colors/types at module load and assets.js
// assigns STREET.catalog, so the global must exist before those imports.
window.STREET = window.STREET || {};
window.STREET.utils = window.STREET.utils || {};

// Console-only notify shim: the full app's notyf-based `notify` scene
// component is UI chrome — pointless in a headless capture, but components
// (managed-street width warnings etc.) still call STREET.notify.*.
const logNotify = (level) => (messageText) =>
  console.log(`[notify:${level}]`, messageText);
window.STREET.notify = {
  successMessage: logNotify('success'),
  errorMessage: logNotify('error'),
  warningMessage: logNotify('warning'),
  infoMessage: logNotify('info'),
  dismissNotification: () => {}
};

require('../three-bvh.js'); // patch THREE prototypes (BVH raycast) — batching expects it
require('../batch-models.js');
require('../aframe-components/gltf-model.js');
require('../aframe-components/gltf-part');
require('../aframe-components/batch-member.js');
require('../lib/animation-mixer.js');
require('../assets.js'); // injects <street-assets> catalog mixins into the scene
require('aframe-atlas-uvs-component'); // stencils use atlas UVs
require('../aframe-components/street-segment.js');
require('../aframe-components/managed-street.js');
require('../aframe-components/street-generated-stencil.js');
require('../aframe-components/street-generated-striping.js');
require('../aframe-components/street-generated-pedestrians.js');
require('../aframe-components/street-generated-rail.js');
require('../aframe-components/street-generated-clones.js');
require('../aframe-components/street-generated-grass.js');
require('../aframe-components/polygon-offset.js');
require('../aframe-components/street-align.js');
require('../aframe-components/street-ground.js');
require('../aframe-components/street-label.js');
require('../aframe-components/blending-opacity.js');
require('../aframe-components/street-environment.js');
require('./street-render-harness.js');
