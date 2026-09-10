/**
 * Cloud-scene URL helpers (#1970).
 *
 * Cloud scene links are path-based (`/scenes/UUID`) so the server sees which
 * scene a link points to (social unfurls, SEO, per-scene OG tags). The legacy
 * hash form (`#/scenes/UUID`, with an optional `?camera=` inside the hash)
 * must keep working forever — old links live in Discord/docs/emails — and
 * self-upgrades to the path form on arrival via history.replaceState.
 *
 * Pure string functions only (no window access) so they stay unit-testable:
 * test/core/scene-url-utils.test.js.
 */

const UUID_PATTERN =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

// Bare scene path only — `/scenes/UUID.json` is the getScene data endpoint
// (firebase.json rewrite), not an app URL, so `.json` must not match.
const SCENE_PATHNAME_RE = new RegExp(`^/scenes/(${UUID_PATTERN})/?$`, 'i');

// Tolerant hash match: `#/scenes/UUID` (or the older `#scenes/UUID.json`
// form) anywhere in the hash, with anything (e.g. `?camera=…`, `.json`)
// after the id.
const SCENE_HASH_RE = new RegExp(`#/?scenes/(${UUID_PATTERN})`, 'i');

/**
 * @param {string} pathname - window.location.pathname
 * @returns {string|null} lowercase scene UUID, or null
 */
function getSceneIdFromPathname(pathname) {
  const match = (pathname || '').match(SCENE_PATHNAME_RE);
  return match ? match[1].toLowerCase() : null;
}

/**
 * @param {string} hash - window.location.hash (leading '#' included)
 * @returns {string|null} lowercase scene UUID, or null
 */
function getSceneIdFromHash(hash) {
  const match = (hash || '').match(SCENE_HASH_RE);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Canonical app URL path for a cloud scene.
 * @param {string} sceneId
 * @returns {string} `/scenes/<sceneId>`
 */
function scenePath(sceneId) {
  return `/scenes/${sceneId}`;
}

/**
 * Upgrade a legacy hash scene URL to the canonical path form, for
 * history.replaceState on boot. Query params written before the hash
 * (`?embed=true#/scenes/UUID`) are preserved, and a `?camera=` param carried
 * inside the hash (`#/scenes/UUID?camera=…`) is folded into the real query
 * string (hash wins if both exist).
 *
 * @param {{ search: string, hash: string }} parts - window.location parts
 * @returns {string|null} path + query (no origin), or null when the hash is
 *   not a scene link
 */
function upgradedSceneUrlFromHash({ search, hash }) {
  const sceneId = getSceneIdFromHash(hash);
  if (!sceneId) {
    return null;
  }
  const params = new URLSearchParams(search || '');
  const hashQueryIndex = (hash || '').indexOf('?');
  if (hashQueryIndex !== -1) {
    const hashParams = new URLSearchParams(hash.substring(hashQueryIndex + 1));
    const camera = hashParams.get('camera');
    if (camera) {
      params.set('camera', camera);
    }
  }
  const query = params.toString();
  return scenePath(sceneId) + (query ? `?${query}` : '');
}

/**
 * URL to restore on "new scene": root path (resets a `/scenes/UUID` path the
 * same way clearing the hash reset the old links), keeping unrelated query
 * params (`?viewer=`, `?embed=`, …) but dropping `?camera=` — a camera
 * vantage belongs to the scene link it arrived on.
 *
 * @param {{ search: string }} parts - window.location parts
 * @returns {string} path + query (no origin)
 */
function clearedSceneUrl({ search }) {
  const params = new URLSearchParams(search || '');
  params.delete('camera');
  const query = params.toString();
  return '/' + (query ? `?${query}` : '');
}

export {
  getSceneIdFromPathname,
  getSceneIdFromHash,
  scenePath,
  upgradedSceneUrlFromHash,
  clearedSceneUrl
};
