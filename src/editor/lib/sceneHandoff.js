/* global STREET */
import JSONCrush from 'jsoncrush';

// Open the live scene in a fresh editor tab through the JSON-in-hash
// loader (`#crushed-3dstreet-json:` in json-utils_1.1.js). Built for
// Visitor Build (docs/visitor-build.md): a visitor keeps what they placed
// by taking the whole scene, their objects included, into an ordinary
// unsaved draft, where Edit needs no account and Save signs them in and
// saves it as their own. The hash never reaches a server and is small
// (a street plus a few hundred objects crushes to under 10 KB).
//
// Two edits to the JSON on the way out, both so the fork is a plain scene
// rather than another build scene: `build-area` components are stripped
// (the visitor now owns the objects; their shape stays as a shape), and
// the source scene id is stamped into memory for attribution. Visitor
// markers need no stripping: `data-viewer-added` is never serialized.

function stripBuildAreas(entities) {
  for (const entity of entities || []) {
    if (entity?.components?.['build-area']) {
      delete entity.components['build-area'];
    }
    if (entity?.children) stripBuildAreas(entity.children);
  }
}

/** The scene JSON the handoff carries (exported for tests). */
export function buildHandoffScene({
  sceneObject,
  sourceSceneId = null,
  cameraState = null
}) {
  const scene = JSON.parse(JSON.stringify(sceneObject));
  stripBuildAreas(scene.data);
  scene.memory = scene.memory || {};
  if (cameraState) scene.memory.cameraState = cameraState;
  if (sourceSceneId) scene.memory.forkedFrom = sourceSceneId;
  return scene;
}

/** `https://host/path#crushed-3dstreet-json:…` for a scene object. */
export function handoffUrlFor(scene, base) {
  const crushed = JSONCrush.crush(JSON.stringify(scene));
  return `${base}#crushed-3dstreet-json:${encodeURIComponent(crushed)}`;
}

/**
 * Serialize the current scene the way Save does and open it in a new
 * tab as an unsaved draft. Returns the URL (also for tests/analytics).
 */
export function openSceneInNewEditor({ getCameraState } = {}) {
  const container = document.getElementById('street-container');
  const raw = STREET.utils.convertDOMElToObject(container);
  const sceneObject = JSON.parse(STREET.utils.filterJSONstreet(raw));
  const scene = buildHandoffScene({
    sceneObject,
    sourceSceneId: STREET.utils.getCurrentSceneId() || null,
    cameraState: getCameraState ? getCameraState() : null
  });
  const base = `${window.location.origin}${window.location.pathname}`;
  const url = handoffUrlFor(scene, base);
  window.open(url, '_blank', 'noopener');
  return url;
}
