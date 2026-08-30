// Pure 2D geometry for the managed-intersection prototype (#438/#1029/#1224).
//
// A managed intersection is defined by the street "nodes" that meet it: each
// connecting managed street contributes an *arm* — its endpoint (in the
// intersection's local XZ ground plane), its outward unit direction (pointing
// from the intersection along the street), and the lateral extents of its
// cross-section. From 2+ arms this module derives:
//
//   - the roadway surface polygon (edge lines of adjacent arms intersected,
//     corners rounded with curb-return fillet arcs),
//   - one sidewalk "corner wedge" polygon per adjacent-arm pair (the curb
//     return area between the roadway fillet and the arms' full travelled-way
//     edges — the automatic equivalent of the legacy intersection's curbs),
//   - one *mouth* per arm (the line where the arm's opening meets the
//     intersection): where crosswalks and traffic control are placed.
//
// Everything is math on plain {x, z} points so it stays unit-testable with no
// A-Frame/DOM dependency (see test/editor/managedIntersectionUtils.test.js).
//
// Conventions: points/directions live in the intersection's local ground
// plane as {x, z}. angle(d) = atan2(d.z, d.x); arms are sorted by ascending
// angle ("CCW" in that x/z sense). normal(d) rotates d by +90° in the same
// sense, so an arm's lateral extent {min, max} means min-side offsets lie at
// angle(d) - 90° and max-side offsets at angle(d) + 90°.

const EPS = 1e-9;

function normal(d) {
  return { x: -d.z, z: d.x };
}

function addScaled(p, d, t) {
  return { x: p.x + d.x * t, z: p.z + d.z * t };
}

function dot2(a, b) {
  return a.x * b.x + a.z * b.z;
}

/**
 * Intersect two 2D lines given as base point + direction (not segments).
 * Returns { point, t1, t2 } with p = base1 + dir1 * t1 = base2 + dir2 * t2,
 * or null when the lines are (near-)parallel.
 */
function lineIntersect2D(base1, dir1, base2, dir2) {
  const denom = dir1.x * dir2.z - dir1.z * dir2.x;
  if (Math.abs(denom) < 1e-6) return null;
  const dx = base2.x - base1.x;
  const dz = base2.z - base1.z;
  const t1 = (dx * dir2.z - dz * dir2.x) / denom;
  const t2 = (dx * dir1.z - dz * dir1.x) / denom;
  return { point: addScaled(base1, dir1, t1), t1, t2 };
}

/**
 * Curb-return fillet at a corner where two edge lines meet at `apex`, with
 * `dirA`/`dirB` the outward edge directions (each pointing from the apex away
 * from the intersection, along its arm). Returns null when the corner is too
 * straight/sharp for the radius to fit sensibly.
 *
 * { center, tangentA, tangentB, tangentLength, points } — `points` runs from
 * tangentA to tangentB (exclusive of neither), ready to splice into a polygon
 * traversal that arrives along edge A and leaves along edge B.
 */
function filletCorner(apex, dirA, dirB, radius, arcSegments = 8) {
  if (!(radius > 0)) return null;
  const cosPhi = Math.min(1, Math.max(-1, dot2(dirA, dirB)));
  const phi = Math.acos(cosPhi); // angle between the outward edge directions
  // Nearly collinear edges (straight-through seam) need no fillet; a sliver
  // corner would need a near-infinite tangent length.
  if (phi < 0.06 || phi > Math.PI - 0.06) return null;
  const tangentLength = radius / Math.tan(phi / 2);
  const bisector = {
    x: dirA.x + dirB.x,
    z: dirA.z + dirB.z
  };
  const bisLen = Math.hypot(bisector.x, bisector.z);
  if (bisLen < EPS) return null;
  bisector.x /= bisLen;
  bisector.z /= bisLen;
  const center = addScaled(apex, bisector, radius / Math.sin(phi / 2));
  const tangentA = addScaled(apex, dirA, tangentLength);
  const tangentB = addScaled(apex, dirB, tangentLength);

  const angA = Math.atan2(tangentA.z - center.z, tangentA.x - center.x);
  let angB = Math.atan2(tangentB.z - center.z, tangentB.x - center.x);
  // Sweep the short way (the arc spans PI - phi < PI).
  while (angB - angA > Math.PI) angB -= 2 * Math.PI;
  while (angB - angA < -Math.PI) angB += 2 * Math.PI;

  const points = [];
  for (let s = 0; s <= arcSegments; s++) {
    const a = angA + ((angB - angA) * s) / arcSegments;
    points.push({
      x: center.x + Math.cos(a) * radius,
      z: center.z + Math.sin(a) * radius
    });
  }
  return { center, tangentA, tangentB, tangentLength, points };
}

const DEFAULT_OPTIONS = {
  curbRadius: 3,
  arcSegments: 8,
  minSetback: 1, // mouth never closer to the endpoint than this
  mouthMargin: 0.3, // extra clearance past the corner tangents
  maxCornerDistance: 60 // clamp runaway corners of near-parallel arms
};

/**
 * arms: [{
 *   point: {x,z}   — the street node (travelled-way centerline endpoint),
 *   dir:   {x,z}   — unit outward direction (from intersection along street),
 *   road:  {min,max} — curb-to-curb lateral extent along normal(dir),
 *   full:  {min,max} — full travelled-way extent (incl. sidewalks),
 *   id     — opaque caller reference (street element id)
 * }]
 *
 * Returns null for fewer than 2 arms. Otherwise:
 * {
 *   surface: [{x,z}…]                    — roadway polygon,
 *   corners: [{ apex, arc, wedge }…]     — one per adjacent-arm pair; wedge
 *                                          is the sidewalk corner polygon or
 *                                          null when the arms carry no
 *                                          sidewalk band on that side,
 *   mouths:  [{ arm, t, center, left, right, width, dir, normal }…]
 *                                        — per input arm (original order)
 * }
 */
function computeIntersectionGeometry(arms, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  if (!arms || arms.length < 2) return null;

  const sorted = arms
    .map((arm, originalIndex) => ({
      ...arm,
      originalIndex,
      angle: Math.atan2(arm.dir.z, arm.dir.x),
      n: normal(arm.dir)
    }))
    .sort((a, b) => a.angle - b.angle);
  const N = sorted.length;

  // --- corners: one per adjacent pair (i -> next, CCW) --------------------
  // Arm i's edge facing the next arm is its max-side edge; the next arm's
  // edge facing back is its min-side edge.
  const makeCorner = (armA, armB, extentKey) => {
    const baseA = addScaled(armA.point, armA.n, armA[extentKey].max);
    const baseB = addScaled(armB.point, armB.n, armB[extentKey].min);
    const hit = lineIntersect2D(baseA, armA.dir, baseB, armB.dir);
    if (
      hit &&
      Math.abs(hit.t1) <= opts.maxCornerDistance &&
      Math.abs(hit.t2) <= opts.maxCornerDistance
    ) {
      return { apex: hit.point, tA: hit.t1, tB: hit.t2, fallback: false };
    }
    // Near-parallel (straight-through pair) or degenerate sliver: seam at the
    // midpoint of the two edge base points.
    return {
      apex: {
        x: (baseA.x + baseB.x) / 2,
        z: (baseA.z + baseB.z) / 2
      },
      tA: 0,
      tB: 0,
      fallback: true
    };
  };

  const corners = [];
  for (let i = 0; i < N; i++) {
    const armA = sorted[i];
    const armB = sorted[(i + 1) % N];
    const road = makeCorner(armA, armB, 'road');
    const full = makeCorner(armA, armB, 'full');
    const arc = road.fallback
      ? null
      : filletCorner(
          road.apex,
          armA.dir,
          armB.dir,
          opts.curbRadius,
          opts.arcSegments
        );
    corners.push({ armA, armB, road, full, arc });
  }

  // --- mouth setback per sorted arm ---------------------------------------
  // The mouth must clear both adjacent corners (their fillet tangent points
  // when rounded) so the crosswalk band sits on straight edge, not on an arc.
  const mouthT = new Array(N).fill(opts.minSetback);
  const projT = (arm, p) =>
    dot2({ x: p.x - arm.point.x, z: p.z - arm.point.z }, arm.dir);
  corners.forEach((corner, i) => {
    const { armA, armB, road, arc } = corner;
    const iA = i;
    const iB = (i + 1) % N;
    const pA = arc ? arc.tangentA : road.apex;
    const pB = arc ? arc.tangentB : road.apex;
    mouthT[iA] = Math.max(mouthT[iA], projT(armA, pA) + opts.mouthMargin);
    mouthT[iB] = Math.max(mouthT[iB], projT(armB, pB) + opts.mouthMargin);
  });

  // --- roadway surface polygon --------------------------------------------
  // CCW traversal. Per arm: enter on the min edge at the previous corner,
  // out to the mouth, across the mouth, back in on the max edge, then the
  // corner (arc or apex) toward the next arm.
  const surface = [];
  for (let i = 0; i < N; i++) {
    const arm = sorted[i];
    const t = mouthT[i];
    surface.push(
      addScaled(addScaled(arm.point, arm.dir, t), arm.n, arm.road.min)
    );
    surface.push(
      addScaled(addScaled(arm.point, arm.dir, t), arm.n, arm.road.max)
    );
    const corner = corners[i];
    if (corner.arc) {
      surface.push(...corner.arc.points);
    } else {
      surface.push(corner.road.apex);
    }
  }

  // --- sidewalk corner wedges ---------------------------------------------
  const cornerResults = corners.map((corner, i) => {
    const { armA, armB, road, full, arc } = corner;
    const tA = mouthT[i];
    const tB = mouthT[(i + 1) % N];
    const sidewalkA = armA.full.max - armA.road.max;
    const sidewalkB = armB.road.min - armB.full.min;
    let wedge = null;
    if (sidewalkA > 0.05 || sidewalkB > 0.05) {
      // Inner boundary along the roadway corner…
      wedge = [
        addScaled(addScaled(armA.point, armA.dir, tA), armA.n, armA.road.max)
      ];
      if (arc) {
        wedge.push(...arc.points);
      } else {
        wedge.push(road.apex);
      }
      wedge.push(
        addScaled(addScaled(armB.point, armB.dir, tB), armB.n, armB.road.min)
      );
      // …then back around the outer (full travelled-way) boundary.
      wedge.push(
        addScaled(addScaled(armB.point, armB.dir, tB), armB.n, armB.full.min)
      );
      wedge.push(full.apex);
      wedge.push(
        addScaled(addScaled(armA.point, armA.dir, tA), armA.n, armA.full.max)
      );
    }
    return { apex: road.apex, arc, wedge };
  });

  // --- mouths (in the caller's original arm order) -------------------------
  const mouths = new Array(N);
  sorted.forEach((arm, i) => {
    const t = mouthT[i];
    const at = addScaled(arm.point, arm.dir, t);
    const mid = (arm.road.min + arm.road.max) / 2;
    mouths[arm.originalIndex] = {
      arm: arm.originalIndex,
      id: arm.id,
      t,
      center: addScaled(at, arm.n, mid),
      left: addScaled(at, arm.n, arm.road.min),
      right: addScaled(at, arm.n, arm.road.max),
      width: arm.road.max - arm.road.min,
      dir: arm.dir,
      normal: arm.n
    };
  });

  return { surface, corners: cornerResults, mouths };
}

export {
  normal,
  lineIntersect2D,
  filletCorner,
  computeIntersectionGeometry,
  DEFAULT_OPTIONS
};
