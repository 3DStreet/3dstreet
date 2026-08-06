import { MARKING_SURFACE_OFFSET } from '../tested/street-segment-utils';

// Where a closed shape's fill is painted in the draw order, and how far it sits
// above the shape's own plane. Pure and dependency-free so the rules can be
// tested directly.
//
// TWO OVERLAPPING FILLS ARE ORDERED BY PAINT ORDER, NOT BY DEPTH. The material
// is transparent and non-depth-writing at every opacity (see shape.js), so the
// depth buffer never arbitrates between two fills - which is deliberate, and is
// what fillPaintOrder replaces. Ordering by height instead was tried and does
// not work: a height difference carrying an ordering has to be large enough for
// the depth buffer to resolve at the distance you are viewing from, and small
// enough not to read as floating, and at street scale those do not both fit.
//
// WHAT THAT COSTS, so it is a priced trade and not an oversight:
//
//  - Paint order is a renderer setting and glTF cannot record it. All fills sit
//    at one height, so two OVERLAPPING fills are exactly coplanar in an
//    exported file and will z-fight in an external viewer. Accepted. The
//    fill-versus-ROAD clearance below is real geometry and does travel into the
//    file, so an exported fill still does not shimmer against the surface it
//    was drawn on - only against another fill.
//  - Paint order cannot depend on the viewpoint, so the stack does not invert
//    when you look at two fills from underneath: the one that is physically
//    higher still paints over the lower one. Getting that right needs the depth
//    buffer, which means depth-writing fills, which costs either the z-fighting
//    above or - for two translucent fills, which depth-REJECT each other's
//    fragments rather than blending - the overlap blending at all. Both are
//    worse than being wrong from below, which is the rarer view.
//  - A fill at full opacity no longer occludes anything in the depth buffer.
//    Nothing in the scene depended on that, but it is why an editor overlay
//    drawn in the opaque pass can be painted over by a 100% fill.
export const FILL_ORDER_BASE = 1;

// HEIGHT IS THE PRIMARY KEY, AREA THE TIE-BREAK. Two fills on the same surface
// are ordered smaller-on-top, so a small marking drawn inside a large zone
// lands where you can see it; a fill on a raised plane is ordered above one
// below it, whatever their sizes, because that is what "above" means to anyone
// looking at it.
//
// The crossover between the two keys is HEIGHT_TIE_M: a height difference
// larger than that decides on its own, and below it area decides. It is a
// centimetre, which is far above the float noise two probes of the same
// surface can differ by and far below any real step - a kerb is 150 mm.
const HEIGHT_TIE_M = 0.01;

// The height key is linear over this range and pins outside it, which is the
// one case where two fills at genuinely different heights can tie. Deliberately
// generous: the whole band still costs less than 2, and a scene whose shapes
// span more than this vertically does not exist.
const HEIGHT_MIN_M = -1000;
const HEIGHT_MAX_M = 9000;
const HEIGHT_SPAN = 2;
const HEIGHT_PER_M = HEIGHT_SPAN / (HEIGHT_MAX_M - HEIGHT_MIN_M);

// Area gets a sub-slot exactly one centimetre of height wide, which is what
// makes HEIGHT_TIE_M true by construction rather than by a second constant that
// could drift away from it.
const AREA_SPAN = HEIGHT_PER_M * HEIGHT_TIE_M;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Ordering by area within one height. Monotone decreasing over every positive
// area, and EXACT rather than banded into steps - which matters, because the
// areas that overlap in practice are often close (16 m2 against 17 m2) and any
// banding ties exactly those pairs. Double precision keeps a 1 m2 difference
// resolvable past 10^7 m2, far beyond any street shape; beyond about 4.6e15 m2
// the term collapses to zero, which is unreachable and harmless because the
// height key still separates such fills from anything at another height.
//
// A degenerate or unknown area contributes NOTHING, so it sorts below every
// real fill at the same height and can never hide one.
function areaTerm(area) {
  if (!Number.isFinite(area) || area <= 0) return 0;
  return AREA_SPAN / (1 + area);
}

// Where a fill is painted, given the height of its plane and its enclosed area.
//
// The floor of the band is FILL_ORDER_BASE, and its one non-negotiable job is
// to be POSITIVE. Three's renderOrder defaults to 0, so all ordinary scene
// content - including the satellite map layer's ground plane - is implicitly at
// 0, and within one renderOrder the transparent queue falls back to a distance
// comparison taken at each object's ORIGIN. That plane is hundreds of metres
// across but sorted by its centre, so at renderOrder 0 it can sort last and
// paint over a fill drawn away from that centre. Any positive value settles it.
// The whole band tops out just above 3, which stays clear of every editor
// overlay in the WebGL queue (the lowest is 100).
//
// `planeY` is read in the shape's PARENT frame rather than in world space. All
// shapes share one parent and shapes cannot be reparented, so a transform on
// that parent shifts every fill equally and cancels out of the comparison. A
// shape nested somewhere else - which no in-app route creates - would order
// against the others by the wrong number.
export function fillPaintOrder(planeY, area) {
  const y = Number.isFinite(planeY) ? planeY : 0;
  const heightTerm =
    HEIGHT_PER_M * (clamp(y, HEIGHT_MIN_M, HEIGHT_MAX_M) - HEIGHT_MIN_M);
  return FILL_ORDER_BASE + heightTerm + areaTerm(area);
}

// How high the fill sits above the shape's own plane. EVERY fill gets the same
// lift; it separates the fill from the ROAD, and takes no part in ordering one
// fill against another.
//
// A fill exactly coplanar with the road it was drawn on shimmers: two surfaces
// at the same depth fight over which is in front. The fix is a PHYSICAL lift,
// not a render-time depth bias, because a glTF file can carry a height
// difference and cannot carry a polygonOffset - so a biased fill would look
// right here and shimmer in whatever viewer opened the exported scene.
//
// On depth-precision grounds alone ~1 mm would do, and that is the figure to
// return to. The lift is far higher for an unrelated reason: the street's lane
// markings and stencils are transparent quads authored with no alpha cut-off,
// so each writes depth across its whole quad including the empty margin,
// discarding anything translucent drawn lower - a 1 mm fill is punched full of
// holes wherever a marking crosses it. So the fill clears the marking layer
// instead, at the cost of visibly floating at grazing angles and exporting that
// way. Giving the marking materials an alpha cut-off undoes the fudge and lets
// this come back down.
//
// Expressed in terms of the markings' own offset rather than as a bare number,
// so if that offset is lowered - the note beside it says it should be - the
// fill follows it down rather than floating at a figure nobody can justify.
export const FILL_LIFT_M = MARKING_SURFACE_OFFSET + 0.01;

// Fill opacity as a 0..1 fraction, plus whether the fill is painted at all. The
// schema's 0-100 min/max binds the properties panel only; a value out of range
// can still arrive by setAttribute or from a hand-edited scene, exactly as for
// lineWidth.
//
// There is deliberately no `opaque` flag: 100% is not a distinct render state.
// See the material's construction in shape.js for why that matters.
export function fillRenderState(fillOpacityPercent) {
  const pct = Number(fillOpacityPercent);
  const clamped = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const opacity = clamped / 100;
  return { opacity, painted: opacity > 0 };
}
