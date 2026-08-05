import { MARKING_SURFACE_OFFSET } from '../tested/street-segment-utils';

// How high a closed shape's fill sits above the shape's own plane, how two
// overlapping fills are separated at full opacity, and the render state a fill
// opacity implies. Pure and dependency-free so the rules can be tested
// directly.
//
// A fill exactly coplanar with the road it was drawn on shimmers: two surfaces
// at the same depth fight over which is in front. The fix is a PHYSICAL lift,
// not a render-time depth bias, because a glTF file can carry a height
// difference and cannot carry a polygonOffset - so a biased fill would look
// right here and shimmer in whatever viewer opened the exported scene.
//
// Depth precision alone would want about a millimetre. The lift is far higher
// for an unrelated reason: the lane markings and stencils are transparent
// quads authored with no alpha cut-off, so each writes depth across its whole
// quad including the empty margin, discarding anything translucent drawn
// lower — a 1 mm fill is punched full of holes wherever a marking crosses it.
// So the fill clears the marking layer instead, at the cost of visibly
// floating at grazing angles and exporting that way. Giving the marking
// materials an alpha cut-off undoes the fudge and lets this come back down.
//
// Expressed in terms of the markings' own offset rather than as a bare number,
// so if that offset is lowered — the note beside it says it should be — the
// fill follows it down rather than floating at a figure nobody can justify.
export const FILL_LIFT_M = MARKING_SURFACE_OFFSET + 0.01;

// On top of the marking clearance, each fill is nudged by an amount derived
// from its own enclosed area, SMALLER SITTING HIGHER - so a small marking
// drawn inside a large zone lands on top, where you can see it. This decides
// the stack only where the fills are opaque and the depth buffer is doing the
// work; below full opacity nothing orders one fill against another.
export const FILL_STACK_SPAN_M = 0.001;

// Street shapes run from about a square metre (a stencil) to a hectare (a
// block-scale zone). Outside that range the scale pins, and two pinned shapes
// stack like two of equal area - the accepted case.
const AREA_MIN_M2 = 1;
const AREA_MAX_M2 = 1e4;
const DECADES = 4; // log10(AREA_MAX_M2 / AREA_MIN_M2)

// Ten steps per decade: forty in all, so one step is a factor of ~1.26 in area
// and 25 micrometres of lift.
const AREA_STEPS = 10 * DECADES;

// Where a fill is painted in the transparent queue. One job: put it after the
// large transparent ground plane the satellite map layer draws on. That plane
// is hundreds of metres across but, like all ordinary content, sits at the
// default renderOrder 0, where the queue falls back to comparing each object's
// ORIGIN — so for a fill drawn away from the map's centre the plane can sort
// last and paint over it. 1 is the smallest value that settles this, and stays
// far below every numbered editor overlay (100 and up).
//
// It takes no view on which of two fills is upper: every fill gets this same
// value, and two overlapping translucent fills blend in whatever order the
// queue puts them. Height decides the stack once both are opaque.
export const FILL_RENDER_ORDER = 1;

// A degenerate or unknown area is treated as the LARGEST, so such a fill sits
// lowest and can never hide a real one. This branch MUST come first: area 0
// also satisfies `<= AREA_MIN_M2`, and pinning it to the smallest would give
// it the maximum lift - the exact inversion this rule exists to prevent.
function clampArea(area) {
  if (!Number.isFinite(area) || area <= 0) return AREA_MAX_M2;
  if (area >= AREA_MAX_M2) return AREA_MAX_M2;
  if (area <= AREA_MIN_M2) return AREA_MIN_M2;
  return area;
}

// The single quantised rank: 0 for the smallest shape, AREA_STEPS for the
// largest.
function areaBucket(area) {
  return Math.round(
    (AREA_STEPS * Math.log10(clampArea(area) / AREA_MIN_M2)) / DECADES
  );
}

// Total height above the shape's own plane. Smallest bucket sits highest.
export function fillLiftForArea(area) {
  return FILL_LIFT_M + FILL_STACK_SPAN_M * (1 - areaBucket(area) / AREA_STEPS);
}

// Fill opacity as a 0..1 fraction, plus the two states derived from it. The
// schema's 0-100 min/max binds the properties panel only; a value out of range
// can still arrive by setAttribute or from a hand-edited scene, exactly as for
// lineWidth.
export function fillRenderState(fillOpacityPercent) {
  const pct = Number(fillOpacityPercent);
  const clamped = Number.isFinite(pct) ? Math.min(100, Math.max(0, pct)) : 0;
  const opacity = clamped / 100;
  return { opacity, painted: opacity > 0, opaque: opacity >= 1 };
}
