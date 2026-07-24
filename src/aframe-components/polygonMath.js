// Pure polygon math on the x/z plan-view projection, shared by the `shape`
// component (runtime) and its unit tests. Deliberately dependency-free — no
// THREE, no A-Frame, no store — so it can be imported headlessly (shape.js
// itself registers A-Frame components and imports the store at module load, so
// it cannot be imported into a plain test). Inputs are arrays of vertex-like
// objects with numeric `x` and `z`; `y` is ignored (the shape is planar).

const EPS_AREA = 1e-9; // m² of signed area below which a ring is degenerate

// Enclosed area (m²) of the polygon's x/z footprint, via the shoelace formula
// with Math.abs — winding-independent (CW and CCW report the same magnitude),
// correct for concave rings, and never NaN for finite input. < 3 vertices has
// no enclosed area → 0.
export function polygonAreaXZ(points) {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) * 0.5;
}

// Area-weighted centroid ({x, z}) of the polygon's x/z footprint. Uses the
// SIGNED area (its sign must match the moment sum's, so do NOT abs here). For a
// degenerate ring (< 3 vertices, or |signed area| below EPS — collinear /
// zero-area) it falls back to the arithmetic mean of the vertices, which never
// divides by zero. May fall OUTSIDE a strongly concave ring — that is accepted
// (spec §E; robust in-polygon placement is deferred).
export function polygonCentroidXZ(points) {
  const n = points.length;
  if (n === 0) return { x: 0, z: 0 };
  if (n < 3) return meanXZ(points);
  let signedArea = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const cross = a.x * b.z - b.x * a.z;
    signedArea += cross;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < EPS_AREA) return meanXZ(points);
  const k = 1 / (6 * signedArea);
  return { x: cx * k, z: cz * k };
}

function meanXZ(points) {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  const inv = 1 / points.length;
  return { x: x * inv, z: z * inv };
}
