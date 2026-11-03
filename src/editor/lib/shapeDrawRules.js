// Pure rules of the shape draw tool: whether a point may be placed, whether
// the preview shows it as refused, how a close resolves, and what a finish
// commits. No THREE and no editor state — the tool (ShapeDrawAction.jsx)
// supplies plain {x, y, z} vertices and reads the answers, so the preview and
// every commit path ask the same functions.

import { closingAdjustment } from './shapeSnap.js';
import { ringEnclosesArea, segmentsIntersectXZ } from './shapeMeasure.js';

const edgesCross = (a, b, edges) =>
  edges.some(([c, d]) => segmentsIntersectXZ(a, b, c, d));

// Committed non-closing edges [v_i, v_{i+1}], i = 0..n-2.
function committedEdges(vertices) {
  const edges = [];
  for (let i = 0; i < vertices.length - 1; i++) {
    edges.push([vertices[i], vertices[i + 1]]);
  }
  return edges;
}

// Would `point`, placed as the next vertex, be refused — and why?
//
// Only the new side (last → point) is tested for a crossing: it is permanent,
// so a crossing there can never be undone by drawing on. A triangle cannot
// cross (every candidate edge is adjacent), so a crossing needs n ≥ 3.
//
// The provisional closing edge is deliberately NOT tested. It is discarded the
// moment another vertex is placed, so refusing a click over it would enforce
// "every intermediate ring is simple" — far stronger than the "finished ring
// is simple" that fill and extrusion need, and it would make stars, combs and
// deep concavities near the first vertex undrawable in their natural order.
// Closure is handled by letting the shape stay open instead: see closePlan.
export function placementVerdict(vertices, point, minSpacing) {
  const n = vertices.length;
  const crosses =
    n >= 3 && edgesCross(vertices[n - 1], point, committedEdges(vertices));
  let tooClose = false;
  if (n) {
    const last = vertices[n - 1];
    const d = Math.hypot(point.x - last.x, point.y - last.y, point.z - last.z);
    tooClose = d < minSpacing;
  }
  return { crosses, tooClose };
}

// Is the previewed placement shown as refused? A crossing always is. A point
// too close to the last vertex is refused silently with snap off, as it always
// has been; with snap on it must show, because a pointer behind the last
// vertex projects onto it and the silent zone grows from a small circle into a
// long strip.
export function previewRefused(snapOn, verdict) {
  return snapOn ? verdict.crosses || verdict.tooClose : verdict.crosses;
}

// How closing the committed ring resolves: { ring, refused, adjusted }.
//
// Snap off, two questions decide a refusal: the closing edge must not cross a
// committed edge, AND the ring must enclose a region — a ring of exactly zero
// area (three collinear points) crosses nothing and still has no interior to
// fill, measure or extrude. Snap on, the last vertex slides so that both
// closing corners are snapped turns (closingAdjustment), which carries its own
// edge and area tests.
export function closePlan(vertices, snapStep, minSpacing) {
  const n = vertices.length;
  if (n < 3) return { ring: vertices, refused: true, adjusted: false };
  if (!snapStep) {
    const refused =
      edgesCross(vertices[n - 1], vertices[0], committedEdges(vertices)) ||
      !ringEnclosesArea(vertices);
    return { ring: vertices, refused, adjusted: false };
  }
  const result = closingAdjustment({ vertices, step: snapStep, minSpacing });
  if (result.refused) return { ring: vertices, refused: true, adjusted: false };
  const last = vertices[n - 1];
  const ring = vertices
    .slice(0, n - 1)
    .concat([{ x: result.point.x, y: last.y, z: result.point.z }]);
  return { ring, refused: false, adjusted: true };
}

// What a finish commits. Only an armed, unrefused close commits a closed ring;
// every other exit — including a refused close — commits the placed vertices
// open, so "press Enter to finish it open" always holds.
export function commitOutcome({ vertices, plan }) {
  if (!plan || plan.refused) return { closed: false, vertices };
  return { closed: true, vertices: plan.ring };
}
