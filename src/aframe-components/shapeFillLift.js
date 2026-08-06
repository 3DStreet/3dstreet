import { MARKING_SURFACE_OFFSET } from '../tested/street-segment-utils';

// How high a closed shape's fill sits above the shape's own plane, the order in
// which two overlapping fills are painted, and the render state a fill opacity
// implies. Pure and dependency-free so the rules can be tested directly.
//
// A fill exactly coplanar with the road it was drawn on shimmers: two surfaces
// at the same depth fight over which is in front. The fix is a PHYSICAL lift,
// not a render-time depth bias, because a glTF file can carry a height
// difference and cannot carry a polygonOffset - so a biased fill would look
// right here and shimmer in whatever viewer opened the exported scene.
//
// On depth-precision grounds alone ~1 mm would do, and that is the figure to
// return to. The lift is far higher for an unrelated reason: the lane markings
// and stencils are transparent quads authored with no alpha cut-off, so each
// writes depth across its whole quad including the empty margin, discarding
// anything translucent drawn lower - a 1 mm fill is punched full of holes
// wherever a marking crosses it. So the fill clears the marking layer instead,
// at the cost of visibly floating at grazing angles and exporting that way.
// Giving the marking materials an alpha cut-off undoes the fudge and lets this
// come back down.
//
// Expressed in terms of the markings' own offset rather than as a bare number,
// so if that offset is lowered - the note beside it says it should be - the
// fill follows it down rather than floating at a figure nobody can justify.
//
// EVERY fill gets the same lift. An earlier design varied it by area so the
// depth buffer would put a smaller fill on top of a larger one, and the reason
// it does not work is worth keeping so it is not re-attempted: a height
// difference carrying an ordering has to be large enough for the depth buffer
// to resolve at the distance you are viewing from, and small enough not to read
// as floating, and at street scale those do not both fit. Ordering two fills is
// paint order's job - see fillPaintOrder, which has no precision floor.
export const FILL_LIFT_M = MARKING_SURFACE_OFFSET + 0.01;

// The floor of the band a fill is painted in, and the value a fill of unknown
// area gets.
//
// The band's first job is to sit above ordinary scene content. Three's
// renderOrder defaults to 0, so all ordinary content - including the satellite
// map layer's ground plane - is implicitly at 0, and within one renderOrder the
// transparent queue falls back to a distance comparison taken at each object's
// ORIGIN. That plane is hundreds of metres across but sorted by its centre, so
// for a fill drawn away from that centre the comparison can put the plane last
// and paint it over the fill. Any positive value settles it; 1 is the smallest,
// and keeps the whole band far below every numbered editor overlay (100 and up).
//
// Its second job is to order fills against each other - see fillPaintOrder,
// which spreads them across (FILL_RENDER_ORDER, FILL_RENDER_ORDER + 1].
export const FILL_RENDER_ORDER = 1;

// Which of two overlapping fills is painted on top: the SMALLER one, so a small
// marking drawn inside a large zone lands where you can see it.
//
// The transparent queue draws in ascending renderOrder and drawn-later means
// composited on top, so this must DECREASE with area. renderOrder is compared
// numerically, not as an integer, so the map can be exact rather than banded
// into steps - which matters, because the areas that overlap in practice are
// often close (16 m2 against 17 m2) and any banding ties exactly those pairs.
//
// 1/(1 + area) is monotone decreasing over every positive area with no clamped
// ends - a clamp would reintroduce ties at both extremes - and lands in
// (FILL_RENDER_ORDER, FILL_RENDER_ORDER + 1], inside the band and still two
// orders of magnitude below the lowest numbered overlay. Double precision keeps
// a 1 m2 difference resolvable past 10^7 m2, far beyond any street shape.
//
// A degenerate or unknown area returns the band floor exactly, so such a fill
// sorts BELOW every real one and can never hide it.
//
// The one case this cannot decide is two areas that are exactly EQUAL: the
// renderOrders tie and the queue falls through to its own origin-distance
// comparison, so the pair swaps as the camera crosses the perpendicular
// bisector between their centres. Accepted.
export function fillPaintOrder(area) {
  if (!Number.isFinite(area) || area <= 0) return FILL_RENDER_ORDER;
  return FILL_RENDER_ORDER + 1 / (1 + area);
}

// Fill opacity as a 0..1 fraction, plus whether the fill is painted at all. The
// schema's 0-100 min/max binds the properties panel only; a value out of range
// can still arrive by setAttribute or from a hand-edited scene, exactly as for
// lineWidth.
//
// There is deliberately no `opaque` flag. The material is transparent and
// non-depth-writing at EVERY opacity, so 100% is not a distinct render state -
// which is what keeps two fills from ever depth-fighting, and what makes the
// ordering above apply at the translucent default rather than only at the top
// of the range.
export function fillRenderState(fillOpacityPercent) {
  const pct = Number(fillOpacityPercent);
  const clamped = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const opacity = clamped / 100;
  return { opacity, painted: opacity > 0 };
}
