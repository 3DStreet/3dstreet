// URL-parameter feature flag for the experimental nav-controls system.
// Read once at startup. Default ON — pass ?nav=classic to disable and
// fall back to the legacy controls. See claude/specs/001-phase-0-plan.md.

export function isExperimentalNav() {
  if (typeof window === 'undefined' || !window.location) return true;
  const params = new URLSearchParams(window.location.search);
  return params.get('nav') !== 'classic';
}

// Sub-flag: the street-level navigation regime (the swoop descent, street
// FOV zoom, the context button's street action, and the lane double-click
// landing). Default OFF — pass ?streetview=on to enable while it is
// iterated on. The elevated "drone view" nav (everything else) ships
// regardless. Also flippable at runtime via the `nav-experimental-tuning`
// component's `streetLevelEnabled` property.
export function isStreetLevelNav() {
  if (typeof window === 'undefined' || !window.location) return false;
  const params = new URLSearchParams(window.location.search);
  return params.get('streetview') === 'on';
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
  return params.get('wasd') === 'on';
}
