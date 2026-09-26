/* global STREET */
import {
  DEFLATE_HASH_PREFIX,
  encodeSceneHash
} from '../../tested/scene-hash-codec.js';

// Open the live scene in a fresh editor tab through the JSON-in-hash
// loader (`#deflate-3dstreet-json:` in json-utils_1.1.js). Built for
// Visitor Build (docs/visitor-build.md): a visitor keeps what they placed
// by taking the whole scene, their objects included, into an ordinary
// unsaved draft, where Edit needs no account and Save signs them in and
// saves it as their own. The hash never reaches a server and is small.
//
// Native deflate, not JSONCrush: JSONCrush is super-linear and main-thread
// bound, and froze the page for 20-30 s on a real scene before the tab
// opened; deflate takes about a millisecond (src/tested/scene-hash-codec.js).
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
export async function handoffUrlFor(scene, base) {
  const payload = await encodeSceneHash(JSON.stringify(scene));
  return `${base}#${DEFLATE_HASH_PREFIX}${payload}`;
}

/**
 * Serialize the current scene the way Save does and open it in a new
 * tab as an unsaved draft. Resolves to the URL (also for tests/analytics).
 *
 * Must be called from the click handler: the tab is opened synchronously,
 * inside the user gesture, and pointed at the URL once compression
 * resolves. Browsers block a window.open that comes after an await. The
 * opener link is severed by hand, since `noopener` would make window.open
 * return null and leave nothing to navigate.
 */
export async function openSceneInNewEditor({ getCameraState } = {}) {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  try {
    const container = document.getElementById('street-container');
    const raw = STREET.utils.convertDOMElToObject(container);
    const sceneObject = JSON.parse(STREET.utils.filterJSONstreet(raw));
    const scene = buildHandoffScene({
      sceneObject,
      sourceSceneId: STREET.utils.getCurrentSceneId() || null,
      cameraState: getCameraState ? getCameraState() : null
    });
    const base = `${window.location.origin}${window.location.pathname}`;
    const url = await handoffUrlFor(scene, base);
    if (tab) tab.location.href = url;
    else window.open(url, '_blank', 'noopener'); // popup blocked the blank tab
    return url;
  } catch (err) {
    if (tab) tab.close();
    throw err;
  }
}
