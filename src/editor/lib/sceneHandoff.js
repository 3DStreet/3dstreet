/* global STREET */
import {
  DEFLATE_HASH_PREFIX,
  encodeSceneHash
} from '../../tested/scene-hash-codec.js';
import { getSceneIdFromPathname } from '../../tested/scene-url-utils.js';

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

/**
 * Page URL the handoff hash is appended to. A cloud scene's canonical path
 * (`/scenes/UUID`, #1970) is loaded before the hash is looked at, so a
 * fork on that path would reopen the source scene and lose the visitor's
 * objects: it goes to the root instead. The query is dropped too, so
 * `?viewer=`, `?embed=` and `?camera=` never carry into the editor tab.
 */
export function handoffBaseUrl({ origin, pathname }) {
  if (getSceneIdFromPathname(pathname)) return `${origin}/`;
  return `${origin}${pathname}`;
}

/** `https://host/path#deflate-3dstreet-json:…` for a scene object. */
export async function handoffUrlFor(scene, base) {
  const payload = await encodeSceneHash(JSON.stringify(scene));
  return `${base}#${DEFLATE_HASH_PREFIX}${payload}`;
}

/**
 * Serialize the current scene the way Save does and open it in a new
 * tab as an unsaved draft. Resolves to { url, opened }.
 *
 * Must be called from the click handler: the tab is opened synchronously,
 * inside the user gesture, and pointed at the URL once compression
 * resolves. Browsers block a window.open that comes after an await. The
 * opener link is severed by hand, since `noopener` would make window.open
 * return null and leave nothing to navigate.
 *
 * When a popup blocker stops even the in-gesture tab, nothing is retried
 * here (a second window.open after the await is blocked too, and silently):
 * `opened` is false and the caller offers the URL behind a fresh click
 * (HandoffPrompt), so the visitor never loses their design.
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
    const base = handoffBaseUrl(window.location);
    const url = await handoffUrlFor(scene, base);
    // A tab closed while compressing counts as blocked: offer the link.
    const opened = !!tab && !tab.closed;
    if (opened) tab.location.href = url;
    return { url, opened };
  } catch (err) {
    if (tab) tab.close();
    throw err;
  }
}
