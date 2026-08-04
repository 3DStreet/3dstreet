/* global THREE */

// Editor policy for editing an existing shape's vertices: what separations and
// ring shapes an edit is allowed to produce, when a plane pick is usable, how
// big a handle should be, which handle a press lands on, and what a press is
// allowed to do.
//
// These are EDITOR rules, not model rules — the `shape` component never reads
// them, and a shape loaded from a saved scene is not held to them. Ring
// simplicity is different: the component enforces that itself, because a
// crossing ring has no interior to fill or measure regardless of how it got
// that way (see polygonMath's ringSelfIntersects).
//
// Everything here is a pure function of its arguments — no globals, no scene
// lookups — so the rules can be reasoned about and tested away from a browser.
// The controls layer supplies the camera, the canvas rect and the cursor.

// Metres. An edited or inserted vertex must sit at least this far from EVERY
// other vertex, not only its two ring neighbours: two handles at one screen
// point means whichever loses the hit test can never be grabbed again, and that
// trap does not care about ring adjacency.
//
// Deliberately a separate constant from the draw tool's
// MIN_DRAW_VERTEX_SPACING, which happens to hold the same number but expresses
// a DIFFERENT rule — the draw tool measures a candidate against the previous
// vertex only. Sharing one constant would mean tuning either rule silently
// retunes the other.
export const MIN_EDIT_VERTEX_SEPARATION = 0.05;

// --- Handle sizing -----------------------------------------------------
//
// Handles are sized to a target ON-SCREEN radius rather than a fixed world
// size: a fixed handle is invisible on a 500 m plot and swallows a 2 m one,
// and a vertex has to stay grabbable at whatever zoom the user is at.

export const HANDLE_TARGET_PX = 7; // ≈14 px across — the app's small-control size
export const HANDLE_MIN_M = 0.02;
export const HANDLE_MAX_M = 1.5;
export const MIDPOINT_RADIUS_RATIO = 0.6;
// Forgiveness margin on the hit test. Below the 4 px click-vs-drag threshold,
// so it can never make two handles ambiguous where the separation rule says
// they are not.
export const HIT_SLOP_PX = 3;

// How many world metres one screen pixel spans, at `distance` from the camera.
// The orthographic branch is reachable — the inspector's plan view swaps in a
// real OrthographicCamera — and is distance-independent. Both branches divide
// by camera.zoom, matching the gizmo's own screen-constant factor; the editor's
// zoom currently resizes the ortho frustum and leaves camera.zoom at 1, which
// is exactly why leaving the divisor out would never have been noticed.
export function metresPerPixel(camera, distance, viewportHeightPx) {
  if (!camera || !viewportHeightPx) return 0;
  const zoom = camera.zoom || 1;
  if (camera.isOrthographicCamera) {
    return (camera.top - camera.bottom) / (zoom * viewportHeightPx);
  }
  const fovY = THREE.MathUtils.degToRad(camera.fov);
  return (2 * distance * Math.tan(fovY / 2)) / (zoom * viewportHeightPx);
}

// The world radius to draw a handle at, so it lands near HANDLE_TARGET_PX on
// screen. Clamped at both ends, and the behaviour past each clamp is accepted
// rather than accidental: below HANDLE_MIN_M (a tiny shape, or extreme zoom-in)
// handles stop growing and read LARGER on screen, which is harmless because the
// minimum vertex separation is more than twice the floor; above HANDLE_MAX_M
// (zoomed far out) they shrink toward sub-pixel, which is recoverable by
// zooming in and much better than a distant shape becoming a ball of spheres.
export function clampHandleRadius(mpp) {
  return Math.min(Math.max(HANDLE_TARGET_PX * mpp, HANDLE_MIN_M), HANDLE_MAX_M);
}

// --- Handle hit test ---------------------------------------------------

const _hitScratch = new THREE.Vector3();

// Which handle, if any, a cursor at (clientX, clientY) has landed on.
//
// A screen-space projection test rather than a raycast, deliberately: handles
// are depthTest:false screen-constant spheres, so a distance-sorted raycast
// would return the nearest in WORLD space rather than the nearest to the
// cursor, and would additionally pick up the shape's own fill, x-ray overlay
// and readout arcs — all of which are pick targets sitting exactly where the
// handles are. This test also expresses the priority rule directly: `handles`
// arrives in priority order (vertex handles before midpoint ghosts) and the
// first match wins, so an overlap needs no tie-break.
//
// handles: [{ world: Vector3, screenRadiusPx: number }]. Returns the index of
// the hit, or -1.
export function hitTestHandles(handles, camera, rect, clientX, clientY) {
  if (!camera || !rect) return -1;
  for (let i = 0; i < handles.length; i++) {
    const h = handles[i];
    _hitScratch.copy(h.world).project(camera);
    if (_hitScratch.z > 1) continue; // behind the camera
    const sx = (_hitScratch.x * 0.5 + 0.5) * rect.width + rect.left;
    const sy = (-_hitScratch.y * 0.5 + 0.5) * rect.height + rect.top;
    const d = Math.hypot(clientX - sx, clientY - sy);
    if (d <= h.screenRadiusPx + HIT_SLOP_PX) return i;
  }
  return -1;
}

// --- Press arbitration -------------------------------------------------

// What a press on the canvas is allowed to do:
//   'ignore'    — not ours to look at; record nothing
//   'trackOnly' — record where the press was, but let selection and orbit run
//   'claim'     — take the press: suppress every other consumer and drag
//
// A press with no handle under it must reach 'trackOnly', never 'claim':
// claiming it would kill selection and camera orbit for every canvas press for
// as long as a shape is selected. The press record is still wanted there,
// because clearing the active vertex on a click in empty space is driven from
// presses that are deliberately never claimed.
export function decidePress({
  inspectorOpen,
  targetIsCanvas,
  isPrimaryButton,
  handleHit,
  pressPickOk
}) {
  if (!inspectorOpen || !targetIsCanvas || !isPrimaryButton) return 'ignore';
  if (!handleHit) return 'trackOnly';
  // A press whose plane pick missed or grazed has no usable grab anchor, so it
  // is declined and behaves as an ordinary canvas press.
  if (!pressPickOk) return 'trackOnly';
  return 'claim';
}
