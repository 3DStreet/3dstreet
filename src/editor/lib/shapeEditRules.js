/* global THREE */

import {
  ringEnclosesArea,
  ringSelfIntersects
} from '../../aframe-components/polygonMath.js';

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
// handles are. Where two handles overlap the FIRST match in the list wins, with
// no distance tie-break; the sole caller passes the shape's vertices in ring
// order, so an overlap resolves to the lower vertex index.
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
//
// `pressViable` asks only whether the press resolves to a live target — a
// vertex handle whose element still exists. It is deliberately NOT "can this
// press drag": a press on a handle does not need a drag plane to be worth
// claiming, because one of the two things a handle press can do — sub-selecting
// the vertex — is a click that never touches one. Gating the whole press on the
// plane pick made a vertex impossible to make active at a near-horizontal
// camera — no active vertex, no delete button, no way to delete — and let the
// declined press fall through to the selection ray, which usually misses the
// thin tube and deselects the shape. The drag plane is checked where the drag
// actually starts instead.
export function decidePress({
  inspectorOpen,
  targetIsCanvas,
  isPrimaryButton,
  handleHit,
  pressViable
}) {
  if (!inspectorOpen || !targetIsCanvas || !isPrimaryButton) return 'ignore';
  if (!handleHit) return 'trackOnly';
  if (!pressViable) return 'trackOnly';
  return 'claim';
}

// --- Click versus drag -------------------------------------------------

// px — a press that travels further than this before release is a drag, not a
// click. Genuinely ONE rule shared with the draw tool ("did the pointer move
// enough to be a drag"), unlike the spacing constants above, which hold the
// same number for two different rules and are therefore kept apart.
export const CLICK_MOVE_THRESHOLD = 4;

// --- Plane picking -----------------------------------------------------

// |dot(ray, plane normal)| below this — about 3° off the plane — is treated as
// a miss.
export const GRAZING_MIN_DOT = 0.05;

// Ray.intersectPlane returns null only when the ray is exactly parallel to the
// plane or points away from it. At a NEAR-edge-on camera it happily returns a
// point hundreds of metres to kilometres from the cursor, and nothing
// downstream rejects it — separation passes, and one far-flung vertex on a
// convex ring usually does not self-cross, so it commits, taking the selection
// box, the area readout and the handle sizing with it. That camera is not
// exotic: street-level navigation is a near-horizontal view over a horizontal
// shape plane.
//
// Both arguments must be normalised.
export function rayPlaneHitIsUsable(
  rayDirection,
  planeNormal,
  minDot = GRAZING_MIN_DOT
) {
  return Math.abs(rayDirection.dot(planeNormal)) >= minDot;
}

// --- Edit validity -----------------------------------------------------

const pairKey = (i, j) => (i < j ? `${i}:${j}` : `${j}:${i}`);

const tooClose = (a, b) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz) < MIN_EDIT_VERTEX_SEPARATION;
};

// The pairs of vertices that are ALREADY closer than the minimum separation.
// Snapshot this when a gesture starts and hand it back to validateVertexEdit
// for the life of that gesture.
//
// The draw tool's spacing rule measures a candidate against the PREVIOUS vertex
// only, so a legally drawn shape can already contain a non-adjacent pair inside
// the threshold. Without the exemption, grabbing any handle on such a shape
// would show the invalid signal from the first frame with no user action, and
// the vertex could never be dragged OUT of the state — the app would read as
// broken. Exempting the offending pairs lets a drag always escape a
// pre-existing violation while still refusing to create a new one.
export function preExistingClosePairs(points) {
  const pairs = new Set();
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      if (tooClose(points[i], points[j])) pairs.add(pairKey(i, j));
    }
  }
  return pairs;
}

// Whether the shape would be legal with vertex `index` where `points` now has
// it. Two rules:
//
//   Separation — the moved vertex must clear EVERY other vertex, not just its
//   two ring neighbours. Two handles at one screen point means whichever loses
//   the hit test can never be grabbed again, and that trap does not care about
//   ring adjacency. Applies to open polylines too.
//
//   Ring validity — TWO questions, not one, and conflating them is what leaves
//   a gap. `ringSelfIntersects` asks whether the boundary CROSSES itself;
//   `ringEnclosesArea` asks whether it bounds anything at all. A collinear ring
//   answers "no" to the first and still has no interior to fill, measure or
//   extrude, while a ring pinched onto its own edge encloses a real region and
//   crosses itself — so neither predicate can stand in for the other, and a
//   closed shape must satisfy both. Open polylines are unconstrained by either:
//   they have no interior to begin with.
//
// `exemptPairs` is only ever consulted for pairs INVOLVING `index`, which is
// what a caller has to know to hand it the right set. A snapshot built with
// `index` left out of it is therefore inert — every pair it skipped is exactly
// a pair this function would have looked up — so a path that wants the moved or
// inserted vertex held to the rule passes no set at all rather than a filtered
// one. The insert path does exactly that.
export function validateVertexEdit(points, closed, index, exemptPairs) {
  if (!vertexSeparationOk(points, index, exemptPairs)) return false;
  if (closed && ringSelfIntersects(points)) return false;
  if (closed && !ringEnclosesArea(points)) return false;
  return true;
}

// The separation half of validateVertexEdit, named so the two clauses read as
// the two different questions they are: separation is a property of ONE vertex,
// ring validity a property of the WHOLE ring.
//
// Module-private, because there is no second caller and no reason to invite
// one. In particular it is NOT the gate the insert buttons hide on — that is
// canOfferInsert, which tests separation against a point not yet in the
// array and so cannot be expressed through this signature (see its own note).
function vertexSeparationOk(points, index, exemptPairs) {
  for (let j = 0; j < points.length; j++) {
    if (j === index) continue;
    if (exemptPairs && exemptPairs.has(pairKey(index, j))) continue;
    if (tooClose(points[index], points[j])) return false;
  }
  return true;
}

// --- Inserting a vertex at a segment midpoint --------------------------

// The segment indices adjacent to vertex `index` on a shape of `n` vertices.
// ONE home, because two layers need the identical answer: the properties panel
// pins these segments' captions and the controls layer offers an insert button
// beside each of them. A ring gives two; an endpoint of an open polyline gives
// one. Segment s runs from vertex s to vertex (s + 1) % n.
export function adjacentSegments(index, n, closed) {
  if (n < 2 || index < 0 || index >= n) return [];
  if (closed) return [(index - 1 + n) % n, index];
  const out = [];
  if (index > 0) out.push(index - 1);
  if (index < n - 1) out.push(index);
  return out;
}

// The midpoint a segment insert would produce. Module-private; both functions
// below use it, so the formula exists once.
const segmentMidpoint = (points, segment) => {
  const a = points[segment];
  const b = points[(segment + 1) % points.length];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
};

// Would a midpoint insert into `segment` produce a vertex that clears every
// existing vertex by the minimum separation? O(n), no allocation beyond the
// midpoint itself.
//
// Deliberately NOT written as validateVertexEdit(candidate, …). That version is
// wrong in two directions at once. It would apply the ring clauses, hiding every
// insert affordance on an already-crossing shape — where the whole point is that
// they stay, and refuse on the press, because the crossing is nowhere near any
// of them. And it would fail the candidate on close pairs between two EXISTING
// vertices, hiding every affordance on a shape the draw tool legally produced
// (its spacing rule measures against the previous vertex only, so such a pair is
// ordinary). Both fall out of this loop's shape: it tests only pairs involving
// the new point, so a pair it should not judge is never judged at all.
export function canOfferInsert(points, segment) {
  const mid = segmentMidpoint(points, segment);
  for (let j = 0; j < points.length; j++) {
    if (tooClose(mid, points[j])) return false;
  }
  return true;
}

// The vertex array a midpoint insert into `segment` would produce, plus that
// vertex's index and position. `vertexIndex === n` on the wrap edge, where
// splice appends. The midpoint is a THREE.Vector3 like every other member, so
// `cand` stays homogeneous and a consumer may call Vector3 methods on `mid`.
export function insertCandidate(points, segment) {
  const vertexIndex = segment + 1;
  const cand = points.slice();
  const m = segmentMidpoint(points, segment);
  cand.splice(vertexIndex, 0, new THREE.Vector3(m.x, m.y, m.z));
  return { cand, vertexIndex, mid: cand[vertexIndex] };
}

// What a released drag should do. Kept as a pure function of the gesture's
// endpoints because the ordering around it is delicate: the raw revert and the
// command have to happen in that order, and the decision has to be taken before
// any of the gesture state is cleared.
//
// An invalid release still COMMITS, to the last position that was valid — drag
// a corner ten metres to a good spot, carry on across an edge and release, and
// it lands on the good spot rather than throwing the ten metres away. That is a
// real geometry change, so it goes through history like any other; only a
// release that nets out to no movement writes nothing.
export function resolveDragRelease({ preDrag, lastValid, finalValid, final }) {
  const candidate = finalValid ? final : lastValid;
  if (!candidate || candidate.equals(preDrag)) {
    return { action: 'rawRevert', value: preDrag };
  }
  return { action: 'commit', value: candidate };
}

// A shape needs two vertices to be a shape at all, so on a two-vertex shape no
// vertex is deletable — not this one, not the other one, not after moving
// anything. That is a STRUCTURAL refusal, unlike the self-intersection one
// below, and the difference is why the two are surfaced differently: the delete
// button is hidden here (there is nothing the user could do to make it work,
// and the route to disposing of a two-vertex shape is to delete the shape),
// while a self-intersection refusal keeps the button and flashes, because
// nudging a neighbouring vertex makes the very same delete legal.
export const MIN_SHAPE_VERTICES = 2;

export function anyVertexIsDeletable(vertexCount) {
  return vertexCount > MIN_SHAPE_VERTICES;
}

// Whether the Delete key means "remove the sub-selected vertex" — the single
// source for that question, read both by the key handler and by the store flag
// that keeps the global whole-shape Delete inert. One rule, two readers, so
// they cannot drift into disagreeing about which layer owns the key.
//
// When this is false the key is left alone and reaches the editor's ordinary
// whole-shape delete. That covers two states, and treating them the same is the
// point rather than a shortcut: nothing sub-selected (Delete plainly means the
// shape), and a sub-selected vertex on a shape already at the two-vertex floor,
// where removing the vertex is impossible and deleting the shape is the only
// thing the user can be reaching for. The whole-shape path asks for
// confirmation, so the escalation is never silent.
export function deleteKeyTargetsVertex(hasActiveVertex, vertexCount) {
  return !!hasActiveVertex && anyVertexIsDeletable(vertexCount);
}

// Whether the shape survives losing vertex `index`.
export function validateVertexDelete(points, closed, index) {
  if (!anyVertexIsDeletable(points.length)) return false;
  const remaining = points.filter((_, i) => i !== index);
  // Removing a vertex merges its two edges into one, and the merged edge can
  // cross the rest of the ring where neither original did.
  if (closed && ringSelfIntersects(remaining)) return false;
  return true;
}

// --- The delete button's placement -------------------------------------

export const BUTTON_PX = 24; // the app's small-icon-button size
const BUTTON_HALF = BUTTON_PX / 2;
export const OFFSET_MARGIN_PX = 4;
// Below this handle radius the button is not shown at all.
export const TRASH_MIN_HANDLE_PX = 5;

// Where to put the delete button relative to the handle it belongs to, in
// screen pixels, or null when it should be hidden.
//
// OFFSET, not ON the handle. A press on a DOM control never reaches the canvas,
// so a button sitting on the handle makes that handle undraggable — and since
// clicking a handle is the only way to reach delete, a vertex you had clicked
// could no longer be moved.
//
// The offset has a PIXEL floor rather than being a pure multiple of the radius.
// A radius-proportional offset with a fixed-size button move in opposite
// directions as you zoom out: past the size clamp the offset shrinks toward a
// couple of pixels while the button still spans ±12, so the button covers the
// handle and its neighbours — turning a press near them into a delete. The
// floor makes "disjoint at every zoom" true by construction: at any radius the
// nearest button edge clears the handle edge by OFFSET_MARGIN_PX on each axis.
//
// Hidden below TRASH_MIN_HANDLE_PX because past the size clamp handles go
// sub-pixel, and a full-size DESTRUCTIVE control must not be the one thing
// still easily hittable where nothing else is. Delete stays reachable by
// keyboard, and by zooming in.
export function trashButtonOffset(
  handleRadiusPx,
  handleX,
  handleY,
  viewportWidth,
  viewportHeight
) {
  if (handleRadiusPx < TRASH_MIN_HANDLE_PX) return null;
  const d = Math.max(
    1.75 * handleRadiusPx,
    handleRadiusPx + BUTTON_HALF + OFFSET_MARGIN_PX
  );
  // Up and to the right by default; flipped per axis when the button would
  // otherwise land off the edge of the canvas or under the panel chrome.
  let dx = d;
  let dy = -d;
  if (handleX + dx > viewportWidth - BUTTON_PX) dx = -d;
  if (handleY + dy < BUTTON_PX) dy = d;
  return { dx, dy };
}

// --- The insert button's placement -------------------------------------

// Half a caption chip's height. The chip is 12 px text with `line-height:
// normal` and 2 px padding top and bottom, so its box is 16 + 2 + 2 = 20 px and
// half of that is 10 — where the 16 is the ASSUMPTION in this number, since
// `normal` resolves per font (≈1.2–1.35 × font-size) rather than to anything
// stated. Owned by the readout layer (ShapeReadouts._makeLabel, which carries
// the matching pointer back here); if the caption styling changes this drifts,
// and the only symptom is the button sitting a little closer to or further from
// the label it belongs to.
const CAPTION_HALF_PX = 10;
// Anchor centre to button centre. The anchor IS the caption's own point, so the
// gap is measured from the caption's edge outward.
const INSERT_OFFSET_PX = CAPTION_HALF_PX + OFFSET_MARGIN_PX + BUTTON_PX / 2;

// Where to put an insert button relative to the segment midpoint it is anchored
// to, as the literal transform string for its inner wrapper — or null when it
// should be hidden.
//
// PIXELS ONLY, centre to centre, exactly as trashButtonOffset returns them.
// CSS2DRenderer writes `translate(-50%,-50%) translate(Xpx, Ypx)` on the OUTER
// element every pass, and the outer shrink-wraps the button, so the outer is
// already centred on the anchor. A percentage written here would resolve
// against the inner's own box and centre it a second time.
//
// Above by default; below when above would put the button off the top of the
// viewport, which a street-level camera does routinely — the shape's captions
// end up high on screen, and a control off the top is unreachable rather than
// merely awkward. The flip fires while the button's top edge is still inside
// the viewport, and on deliberately the same comparison trashButtonOffset makes
// on its own vertical flip, so the two controls turn over at one height rather
// than at two that happen to be close.
//
// Hidden below the same handle-radius floor the delete button uses. Past the
// size clamp handles go sub-pixel while a full-size control still spans ±12 px,
// so ANY 24 px control at that zoom covers the handle it belongs to and its
// neighbours — and clicking a handle is the only route to this button. The
// floor is shared rather than duplicated so the three controls appear and
// disappear as one set.
export function insertButtonTransform(handleRadiusPx, anchorY) {
  if (handleRadiusPx < TRASH_MIN_HANDLE_PX) return null;
  const below = anchorY - INSERT_OFFSET_PX < BUTTON_PX;
  const dy = below ? INSERT_OFFSET_PX : -INSERT_OFFSET_PX;
  return `translate(0px, ${dy}px)`;
}
