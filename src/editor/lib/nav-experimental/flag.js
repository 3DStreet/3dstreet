// Feature flags for the experimental nav-controls system. All flags are
// read once at startup: a URL parameter always wins (dev override), then
// the user's persisted Control Scheme preference (View → Control Scheme),
// then the default.
//
// Schemes map to flags as:
//   legacy       → experimental nav OFF (classic controls)
//   standard     → experimental nav ON, street-level + WASD OFF (default)
//   experimental → experimental nav ON, street-level + WASD ON

export const NAV_SCHEME_STORAGE_KEY = 'navScheme';
export const NAV_SCHEMES = ['legacy', 'standard', 'experimental'];

function storedNavScheme() {
  try {
    const stored = window.localStorage.getItem(NAV_SCHEME_STORAGE_KEY);
    if (NAV_SCHEMES.includes(stored)) return stored;
  } catch {
    // ignore storage errors (private mode, etc.)
  }
  return null;
}

/**
 * The effective scheme, derived from the same flag functions the app uses,
 * so the Control Scheme picker reflects URL overrides too.
 */
export function getNavScheme() {
  if (!isExperimentalNav()) return 'legacy';
  return isStreetLevelNav() || isWasdNav() ? 'experimental' : 'standard';
}

/**
 * Persists the chosen scheme, drops any URL flag overrides that would shadow
 * it, and reloads — the flags are read at load time (controls, shortcut map),
 * so a live switch is not supported.
 */
export function applyNavScheme(scheme) {
  if (!NAV_SCHEMES.includes(scheme)) return;
  try {
    window.localStorage.setItem(NAV_SCHEME_STORAGE_KEY, scheme);
  } catch {
    // ignore storage errors (private mode, etc.)
  }
  try {
    const url = new URL(window.location.href);
    ['nav', 'streetview', 'wasd'].forEach((p) => url.searchParams.delete(p));
    window.history.replaceState(null, '', url);
  } catch {
    // ignore — worst case the URL override stays and wins over the pref
  }
  window.location.reload();
}

// Main flag. Default ON — ?nav=classic (or the legacy scheme) disables and
// falls back to the legacy controls (KD-01).
export function isExperimentalNav() {
  if (typeof window === 'undefined' || !window.location) return true;
  const params = new URLSearchParams(window.location.search);
  const param = params.get('nav');
  if (param !== null) return param !== 'classic';
  return storedNavScheme() !== 'legacy';
}

// Sub-flag: the street-level navigation regime (the swoop descent, street
// FOV zoom, the cursor-aware double-click teleport incl. its lane landing,
// and the whole context-action system — the drone/street/daylight button,
// its Space shortcut, and the recovery cues). Default OFF — pass
// ?streetview=on to enable while it is iterated on. The elevated "drone
// view" nav (everything else) ships regardless. Also flippable at runtime
// via the `nav-experimental-tuning` component's `streetLevelEnabled`
// property.
export function isStreetLevelNav() {
  if (typeof window === 'undefined' || !window.location) return false;
  const params = new URLSearchParams(window.location.search);
  const param = params.get('streetview');
  if (param !== null) return param === 'on';
  return storedNavScheme() === 'experimental';
}

// Sub-flag: the first-person movement kit — WASD / arrow-key flight and
// the WASD ↔ rotation interplay (which exists to pair with it). Default
// OFF — pass ?wasd=on to enable. While off, shortcuts.js keeps the legacy w/s/d
// editor shortcuts (translate/scale/clone) active ALONGSIDE their new
// t/l/c homes, so launch ships the exact legacy keymap and the later flag
// flip breaks nothing. Read at load time (the shortcut map does not react
// to the runtime `wasdEnabled` tuning toggle).
export function isWasdNav() {
  if (typeof window === 'undefined' || !window.location) return false;
  const params = new URLSearchParams(window.location.search);
  const param = params.get('wasd');
  if (param !== null) return param === 'on';
  return storedNavScheme() === 'experimental';
}
