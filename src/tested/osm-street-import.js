/**
 * OSM way → managed street import math (#1930 click-to-upgrade).
 *
 * Pure module (no AFRAME/THREE/DOM). Converts decoded transportation way
 * records (see vector-tile-buildings.js `decodeTransportation`) into the
 * pieces the `osm-streets` component needs to mint real managed streets:
 *
 * - lat/lon → scene-local meters (x = north, z = east — the same flat
 *   EQUATOR_M projection as osm-building-geometry, so upgraded streets
 *   register exactly with the 2.5D ground and buildings),
 * - nearest-way lookup for a clicked ground point,
 * - stretch extraction (`stretchForWindow`): the arc-length-clipped,
 *   Douglas–Peucker-simplified run of centerline the generate turns into
 *   ONE path-following managed street (a 2-point stretch degenerates to
 *   a plain straight street),
 * - polyline → straight chord splitting (the pre-path scheme; kept for
 *   the degenerate case math and existing callers),
 * - class → managed-street Format-2 JSON presets (`parseStreetObject`
 *   input shape; real lane data arrives with the Overpass-backed
 *   hydrator, #1930 phase 6).
 */

import { EQUATOR_M } from './osm-tile-math.js';
import { roadWidthMeters } from './osm-street-style.js';

export const NORTH_M_PER_DEG = EQUATOR_M / 360;

export function eastMPerDeg(latDeg) {
  return (EQUATOR_M * Math.cos((latDeg * Math.PI) / 180)) / 360;
}

/**
 * Geographic point → scene-local meters relative to the origin.
 * Mercator-conformal on both axes (matches the ground/buildings).
 */
export function latLonToLocal(origin, pt) {
  return {
    x: (pt.lat - origin.lat) * NORTH_M_PER_DEG,
    z: (pt.lon - origin.lon) * eastMPerDeg(origin.lat)
  };
}

/** Inverse of latLonToLocal. */
export function localToLatLon(origin, pt) {
  return {
    lat: origin.lat + pt.x / NORTH_M_PER_DEG,
    lon: origin.lon + pt.z / eastMPerDeg(origin.lat)
  };
}

/** Convert a [{lat, lon}, ...] polyline to local [{x, z}, ...]. */
export function localPolylineFromLatLon(origin, polyline) {
  return polyline.map((pt) => latLonToLocal(origin, pt));
}

function distSq(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Squared distance from `p` to segment a→b, plus the closest point. */
export function pointToSegment(p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const lenSq = abx * abx + abz * abz;
  let t = 0;
  if (lenSq > 0) {
    t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const closest = { x: a.x + abx * t, z: a.z + abz * t };
  return { distSq: distSq(p, closest), point: closest, t };
}

/**
 * Find the way whose polyline passes closest to `point` ({x, z} local
 * meters), searching `ways` records whose polylines are already in local
 * coordinates. Returns null when nothing is within `maxDistM`.
 *
 * @returns {{ way, distance, point, polylineIndex, segmentIndex }|null}
 */
export function nearestWay(ways, point, maxDistM = 20) {
  let best = null;
  let bestDistSq = maxDistM * maxDistM;
  for (const way of ways || []) {
    for (let pi = 0; pi < way.polylines.length; pi++) {
      const line = way.polylines[pi];
      for (let si = 0; si < line.length - 1; si++) {
        const hit = pointToSegment(point, line[si], line[si + 1]);
        if (hit.distSq <= bestDistSq) {
          bestDistSq = hit.distSq;
          best = {
            way,
            distance: Math.sqrt(hit.distSq),
            point: hit.point,
            polylineIndex: pi,
            segmentIndex: si
          };
        }
      }
    }
  }
  return best;
}

/** Douglas–Peucker simplification on [{x, z}, ...] with a meter tolerance. */
export function simplifyPolyline(points, toleranceM) {
  if (!points || points.length <= 2) return points ? points.slice() : [];
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  const tolSq = toleranceM * toleranceM;
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let maxDistSq = 0;
    let maxIndex = -1;
    for (let i = i0 + 1; i < i1; i++) {
      const { distSq: d } = pointToSegment(points[i], points[i0], points[i1]);
      if (d > maxDistSq) {
        maxDistSq = d;
        maxIndex = i;
      }
    }
    if (maxDistSq > tolSq && maxIndex !== -1) {
      keep[maxIndex] = true;
      stack.push([i0, maxIndex], [maxIndex, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/**
 * Split a way polyline (local [{x, z}, ...]) into straight chords a
 * managed street can stand in for: Douglas–Peucker with `maxDeviationM`
 * picks the corner vertices, then each simplified segment of at least
 * `minLengthM` becomes one chord. Short connector stubs are dropped — the
 * ground street layer keeps drawing beneath, so gaps stay invisible.
 *
 * @returns {Array<{ start, end, length, midpoint, bearingDeg }>}
 */
export function splitWayIntoChords(
  points,
  { maxDeviationM = 1.5, minLengthM = 20 } = {}
) {
  const simplified = simplifyPolyline(points, maxDeviationM);
  const chords = [];
  for (let i = 0; i < simplified.length - 1; i++) {
    const start = simplified[i];
    const end = simplified[i + 1];
    const length = Math.sqrt(distSq(start, end));
    if (length < minLengthM) continue;
    chords.push({
      start,
      end,
      length,
      midpoint: { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 },
      // A-Frame yaw that points the street's local +Z along the chord
      // (same convention as StreetNodeControls: atan2(dir.x, dir.z)).
      bearingDeg: (Math.atan2(end.x - start.x, end.z - start.z) * 180) / Math.PI
    });
  }
  return chords;
}

/** Point at arc-length `s` along [{x, z}, ...] (clamped to the ends). */
function pointAtArcLength(points, cumulative, s) {
  if (s <= 0) return { ...points[0] };
  const total = cumulative[cumulative.length - 1];
  if (s >= total) return { ...points[points.length - 1] };
  let i = 1;
  while (cumulative[i] < s) i++;
  const segLen = cumulative[i] - cumulative[i - 1];
  const t = segLen > 0 ? (s - cumulative[i - 1]) / segLen : 0;
  const a = points[i - 1];
  const b = points[i];
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

/**
 * The contiguous stretch of a way the generate acts on: project
 * `nearPoint` onto the nearest of the way's polylines, clip that
 * polyline to ±`windowM` of the projection BY ARC LENGTH (interpolated
 * boundary points, so the stretch never exceeds 2×windowM even on a
 * kilometers-long way), then Douglas–Peucker the clipped run down to
 * control points for the street's path shape.
 *
 * `nearPoint: null` anchors the window at the first polyline's start
 * (the console `upgradeNearFocus` convenience always passes a point).
 *
 * @param {Array<Array<{x, z}>>} polylines way centerlines, local meters.
 * @returns {{ points, lengthM }|null} `points`: simplified control
 *   points (≥2); `lengthM`: the clipped centerline's arc length (the
 *   real curve re-derives it, this seeds the street JSON). Null when the
 *   stretch is shorter than `minLengthM` — connector stubs stay ground
 *   tint only, same rule chord splitting used.
 */
export function stretchForWindow(
  polylines,
  nearPoint,
  { windowM = 200, maxDeviationM = 1.5, minLengthM = 20, covered = null } = {}
) {
  const lines = (polylines || []).filter((line) => line && line.length >= 2);
  if (lines.length === 0) return null;

  let line = lines[0];
  let s0 = 0;
  if (nearPoint) {
    const hit = nearestWay([{ polylines: lines }], nearPoint, Infinity);
    if (!hit) return null;
    line = lines[hit.polylineIndex];
    let s = 0;
    for (let i = 0; i < hit.segmentIndex; i++) {
      s += Math.sqrt(distSq(line[i], line[i + 1]));
    }
    s0 = s + Math.sqrt(distSq(line[hit.segmentIndex], hit.point));
  }

  const cumulative = cumulativeArcLengths(line);
  const total = cumulative[line.length - 1];
  const sStart = Math.max(0, s0 - windowM);
  const sEnd = Math.min(total, s0 + windowM);
  if (sEnd - sStart < minLengthM) return null;

  let clipped = slicePolylineByArc(line, cumulative, sStart, sEnd);
  if (covered && covered.length > 0) {
    // Extending a partially generated way (#2006): only the stretch NOT
    // already covered by earlier generates becomes a street.
    clipped = clipStretchToUncovered(clipped, covered, { minLengthM });
    if (!clipped) return null;
  }
  const clippedCumulative = cumulativeArcLengths(clipped);
  const lengthM = clippedCumulative[clipped.length - 1];
  if (lengthM < minLengthM) return null;
  const points = simplifyPolyline(clipped, maxDeviationM);
  if (points.length < 2) return null;
  return { points, lengthM: Math.round(lengthM * 100) / 100 };
}

/**
 * The longest run of `points` NOT already covered by previously
 * generated stretches of the same way (#2006): the old boolean per-way
 * gate made the first ±window generate permanent, so a long way could
 * never be completed — clicking the remainder now extends it.
 *
 * The line is resampled at `stepM` so coverage transitions resolve even
 * between far-apart vertices; a sample is covered within `toleranceM` of
 * any covered polyline (loose enough for tile-fragment quantization
 * differences). Runs shorter than `minLengthM` are dropped, so the
 * junction cut gaps between a generate's own pieces never re-trigger. A
 * run boundary that borders coverage snaps to the nearest covered-stretch
 * ENDPOINT within `snapM`, so the new street butts flush against the
 * piece it extends.
 *
 * @param {Array<{x,z}>} points the window-clipped centerline.
 * @param {Array<Array<{x,z}>>} covered previously generated centerlines.
 * @returns {Array<{x,z}>|null} densified run (callers simplify), or null
 *   when nothing generatable remains.
 */
export function clipStretchToUncovered(
  points,
  covered,
  { toleranceM = 5, minLengthM = 20, stepM = 5, snapM = 15 } = {}
) {
  if (!points || points.length < 2) return null;
  if (!covered || covered.length === 0) return points.slice();

  const cumulative = cumulativeArcLengths(points);
  const total = cumulative[points.length - 1];
  const n = Math.max(1, Math.ceil(total / stepM));
  const samples = [];
  for (let i = 0; i <= n; i++) {
    samples.push(pointAtArcLength(points, cumulative, (total * i) / n));
  }
  const tolSq = toleranceM * toleranceM;
  const isCovered = (p) => {
    for (const line of covered) {
      for (let i = 0; i < line.length - 1; i++) {
        if (pointToSegment(p, line[i], line[i + 1]).distSq <= tolSq) {
          return true;
        }
      }
    }
    return false;
  };
  const flags = samples.map(isCovered);

  let best = null;
  let runStart = null;
  for (let i = 0; i <= samples.length; i++) {
    const cov = i === samples.length ? true : flags[i];
    if (!cov && runStart === null) runStart = i;
    if (cov && runStart !== null) {
      const lenM = ((i - 1 - runStart) * total) / n;
      if (!best || lenM > best.lenM) {
        best = { from: runStart, to: i - 1, lenM };
      }
      runStart = null;
    }
  }
  if (!best || best.lenM < minLengthM) return null;

  const run = samples.slice(best.from, best.to + 1);
  const endpoints = [];
  for (const line of covered) {
    if (line.length > 0) endpoints.push(line[0], line[line.length - 1]);
  }
  const snapSq = snapM * snapM;
  const snapBoundary = (idx, bordersCoverage) => {
    if (!bordersCoverage) return;
    let bestEp = null;
    let bestD = snapSq;
    for (const ep of endpoints) {
      const d = distSq(ep, run[idx]);
      if (d <= bestD) {
        bestD = d;
        bestEp = ep;
      }
    }
    if (bestEp) run[idx] = { x: bestEp.x, z: bestEp.z };
  };
  snapBoundary(0, best.from > 0);
  snapBoundary(run.length - 1, best.to < samples.length - 1);
  return run;
}

/** Compact "x,z;x,z" (dm precision) for the data-osm-stretch stamp. */
export function encodeStretchPoints(points) {
  return points.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(';');
}

/** Inverse of encodeStretchPoints; null for anything malformed. */
export function decodeStretchPoints(str) {
  if (!str) return null;
  const pts = [];
  for (const pair of String(str).split(';')) {
    const [x, z] = pair.split(',').map(parseFloat);
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    pts.push({ x, z });
  }
  return pts.length >= 2 ? pts : null;
}

/** Cumulative arc lengths for [{x, z}, ...], starting at 0. */
function cumulativeArcLengths(points) {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) {
    cumulative.push(
      cumulative[i - 1] + Math.sqrt(distSq(points[i - 1], points[i]))
    );
  }
  return cumulative;
}

/** The sub-polyline between arc lengths, with interpolated boundary points. */
function slicePolylineByArc(points, cumulative, sStart, sEnd) {
  const sliced = [pointAtArcLength(points, cumulative, sStart)];
  for (let i = 0; i < points.length; i++) {
    if (cumulative[i] > sStart && cumulative[i] < sEnd) {
      sliced.push(points[i]);
    }
  }
  sliced.push(pointAtArcLength(points, cumulative, sEnd));
  return sliced;
}

/**
 * Intersection point of segments a→b and c→d, or null. Touching counts
 * (t/u clamped range inclusive) so a way whose node lies exactly ON the
 * stretch — the OSM shared-node topology — registers as a junction.
 */
export function segmentIntersection(a, b, c, d) {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const denom = rx * sz - rz * sx;
  if (Math.abs(denom) < 1e-12) return null; // parallel / degenerate
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / denom;
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { point: { x: a.x + rx * t, z: a.z + rz * t }, t };
}

/**
 * Junction points where other ways meet a generated stretch: proper
 * crossings (X junctions) plus other-way ENDPOINTS landing on the
 * stretch within `toleranceM` (T junctions — MVT geometry is quantized,
 * so shared OSM nodes coincide only approximately). Junctions closer
 * than `minSeparationM` along the stretch merge into one (dual
 * carriageways, slightly-offset tile geometry), keeping the widest
 * crossing class.
 *
 * Junctions within `endClearanceM` of either stretch end are DROPPED:
 * vector-tile ways are fragmented (clipped per tile, split per source
 * way), so an adjacent fragment of the SAME road touches exactly at the
 * stretch's own endpoint — a continuation, not a junction — and a real
 * crossing that close to the (arbitrary) generate-window edge couldn't
 * yield a piece on its far side anyway; it gets its intersection when
 * that area is generated.
 *
 * @param {Array<{x, z}>} stretchPoints the stretch centerline.
 * @param {Array<{ class, polylines }>} otherWays candidate crossers
 *   (local-meter polylines; the caller excludes the way itself and
 *   grade-separated crossers like bridges).
 * @returns {Array<{ s, point, crossWidthM, kind }>} sorted by arc length
 *   `s` along the stretch; `crossWidthM` is the widest crossing way's
 *   imported carriageway width (drives the split inset); `kind` is
 *   'crossing' (the other way continues past the stretch) or 'terminal'
 *   (it ends here — a T; callers cut the stretch only at crossings,
 *   #2004 fix 2).
 */
export function junctionsAlongStretch(
  stretchPoints,
  otherWays,
  { toleranceM = 2, minSeparationM = 12, endClearanceM = 10 } = {}
) {
  if (!stretchPoints || stretchPoints.length < 2) return [];
  const cumulative = cumulativeArcLengths(stretchPoints);
  const total = cumulative[cumulative.length - 1];
  const found = [];
  // How close a junction must sit to the other way's own polyline
  // endpoint to read as that way TERMINATING here (a T into the stretch)
  // rather than crossing through — generous, to absorb MVT quantization.
  const TERMINAL_END_M = 6;
  const terminalEndSq = TERMINAL_END_M * TERMINAL_END_M;
  const record = (s, point, cls, kind) => {
    if (s < endClearanceM || s > total - endClearanceM) return;
    found.push({
      s,
      point,
      crossWidthM: importedCarriagewayMeters(cls),
      kind
    });
  };

  for (const other of otherWays || []) {
    for (const line of other.polylines || []) {
      if (!line || line.length < 2) continue;
      // Proper crossings, segment pair by segment pair. A side road's
      // shared node lies exactly ON the stretch, so a T registers here
      // too (touching counts) — classify by whether the other way
      // continues past the junction or ends at it (#2004 fix 2: callers
      // cut the stretch only at crossings).
      for (let i = 0; i < stretchPoints.length - 1; i++) {
        const a = stretchPoints[i];
        const b = stretchPoints[i + 1];
        for (let j = 0; j < line.length - 1; j++) {
          const hit = segmentIntersection(a, b, line[j], line[j + 1]);
          if (hit) {
            const s = cumulative[i] + Math.sqrt(distSq(a, hit.point));
            const endSq = Math.min(
              distSq(hit.point, line[0]),
              distSq(hit.point, line[line.length - 1])
            );
            record(
              s,
              hit.point,
              other.class,
              endSq <= terminalEndSq ? 'terminal' : 'crossing'
            );
          }
        }
      }
      // Endpoint touches (T junctions terminating on the stretch).
      for (const end of [line[0], line[line.length - 1]]) {
        let bestS = null;
        let bestPoint = null;
        let bestDistSq = toleranceM * toleranceM;
        for (let i = 0; i < stretchPoints.length - 1; i++) {
          const hit = pointToSegment(
            end,
            stretchPoints[i],
            stretchPoints[i + 1]
          );
          if (hit.distSq <= bestDistSq) {
            bestDistSq = hit.distSq;
            bestPoint = hit.point;
            bestS =
              cumulative[i] + Math.sqrt(distSq(stretchPoints[i], hit.point));
          }
        }
        if (bestPoint) record(bestS, bestPoint, other.class, 'terminal');
      }
    }
  }

  found.sort((p, q) => p.s - q.s);
  const junctions = [];
  for (const j of found) {
    const last = junctions[junctions.length - 1];
    if (last && j.s - last.s < minSeparationM) {
      last.crossWidthM = Math.max(last.crossWidthM, j.crossWidthM);
      // Any crossing member makes the merged junction a crossing (an
      // offset dual-carriageway crossing with a nearby T still cuts).
      if (j.kind === 'crossing') last.kind = 'crossing';
    } else {
      junctions.push({ ...j });
    }
  }
  return junctions;
}

/**
 * Trim a stretch's ends back to the carriageway EDGE of any way they
 * terminate on — the companion to cutting only at crossings (#2004 fix
 * 2): with terminal junctions no longer splitting the through street, a
 * side street's shared node sits on the through road's centerline, and
 * untrimmed it would poke halfway across the roadway. An end that
 * touches the other way's own ENDPOINT is left alone (that's the same
 * road continuing as another tile fragment, not a T), and a trim that
 * would drop the stretch under `minLengthM` is skipped entirely.
 *
 * @param {Array<{x,z}>} points stretch centerline, local meters.
 * @param {Array<{ class, polylines }>} otherWays candidate through roads
 *   (local-meter polylines; the caller excludes the way itself).
 * @returns {Array<{x,z}>} new points (the input, copied, when untrimmed).
 */
export function trimStretchEndsAtWays(
  points,
  otherWays,
  { touchM = 3, endpointClearM = 8, padM = 2, minLengthM = 20 } = {}
) {
  if (!points || points.length < 2) return points ? points.slice() : [];
  const cumulative = cumulativeArcLengths(points);
  const total = cumulative[points.length - 1];

  const trimFor = (endPoint) => {
    const hit = nearestWay(otherWays || [], endPoint, touchM);
    if (!hit) return 0;
    const line = hit.way.polylines[hit.polylineIndex];
    const clearSq = endpointClearM * endpointClearM;
    if (
      distSq(hit.point, line[0]) <= clearSq ||
      distSq(hit.point, line[line.length - 1]) <= clearSq
    ) {
      return 0; // touching the way's own end: a continuation, not a T
    }
    return importedCarriagewayMeters(hit.way.class) / 2 + padM;
  };

  const sStart = trimFor(points[0]);
  const sEnd = total - trimFor(points[points.length - 1]);
  if (sStart === 0 && sEnd === total) return points.slice();
  if (sEnd - sStart < minLengthM) return points.slice();
  return slicePolylineByArc(points, cumulative, sStart, sEnd);
}

/**
 * Split a stretch at its junctions into street-worthy pieces, each end
 * adjacent to a junction inset by half the crossing width plus
 * `insetPadM` (room for the intersection's curb returns) — the
 * generation-time stand-in for the snap pass, which cannot slide a
 * path-following street. Pieces shorter than `minLengthM` are dropped
 * (the ground ribbons keep drawing beneath).
 *
 * @returns {{ pieces, junctions }} `pieces`: [{ points, lengthM }]
 *   ready for street creation; `junctions`: ONE entry per merged cut —
 *   nearby input junctions (an offset dual-carriageway crossing, tile
 *   double-geometry) share a single intersection — with `s`/`point` at
 *   the cut's center on the stretch, `cutHalfM` (half the cut's arc
 *   span; the minted intersection's snap radius must cover it so the
 *   bordering street ends connect), and `adjacentPieces` — how many
 *   kept pieces border the cut. Callers mint an intersection only where
 *   ≥2 street ends actually meet (a junction whose far side fell below
 *   minLength would otherwise show a dangling placeholder pad).
 */
export function splitStretchAtJunctions(
  stretchPoints,
  junctions,
  // insetPadM 4 → 2 (#2006): with carriageway-based crossing widths the
  // curb returns need less slack, and every meter of inset is a meter of
  // visible gap at the junction.
  { insetPadM = 2, minLengthM = 20 } = {}
) {
  const cumulative = cumulativeArcLengths(stretchPoints);
  const total = cumulative[cumulative.length - 1];
  if (!junctions || junctions.length === 0) {
    return {
      pieces: [
        {
          points: stretchPoints.slice(),
          lengthM: Math.round(total * 100) / 100
        }
      ],
      junctions: []
    };
  }

  // Cut ranges around each junction, merged where they overlap.
  const cuts = junctions
    .map((j) => {
      const inset = j.crossWidthM / 2 + insetPadM;
      return {
        from: j.s - inset,
        to: j.s + inset,
        crossWidthM: j.crossWidthM,
        adjacentPieces: 0
      };
    })
    .sort((a, b) => a.from - b.from);
  const merged = [cuts[0]];
  for (let i = 1; i < cuts.length; i++) {
    const last = merged[merged.length - 1];
    if (cuts[i].from <= last.to) {
      last.to = Math.max(last.to, cuts[i].to);
      last.crossWidthM = Math.max(last.crossWidthM, cuts[i].crossWidthM);
    } else {
      merged.push(cuts[i]);
    }
  }

  // Keep runs between cuts; count how many kept pieces border each cut.
  const pieces = [];
  const keepRun = (sStart, sEnd, cutBefore, cutAfter) => {
    if (sEnd - sStart < minLengthM) return;
    const points = slicePolylineByArc(stretchPoints, cumulative, sStart, sEnd);
    pieces.push({
      points,
      lengthM: Math.round((sEnd - sStart) * 100) / 100
    });
    if (cutBefore) cutBefore.adjacentPieces++;
    if (cutAfter) cutAfter.adjacentPieces++;
  };
  keepRun(0, Math.max(0, merged[0].from), null, merged[0]);
  for (let i = 0; i < merged.length - 1; i++) {
    keepRun(merged[i].to, merged[i + 1].from, merged[i], merged[i + 1]);
  }
  keepRun(
    Math.min(total, merged[merged.length - 1].to),
    total,
    merged[merged.length - 1],
    null
  );

  const outJunctions = merged.map((cut) => {
    const sCenter = (Math.max(0, cut.from) + Math.min(total, cut.to)) / 2;
    return {
      s: sCenter,
      point: pointAtArcLength(stretchPoints, cumulative, sCenter),
      crossWidthM: cut.crossWidthM,
      cutHalfM:
        Math.round(
          ((Math.min(total, cut.to) - Math.max(0, cut.from)) / 2) * 100
        ) / 100,
      adjacentPieces: cut.adjacentPieces
    };
  });
  return { pieces, junctions: outJunctions };
}

// --- class → managed-street Format-2 presets -------------------------------

const drive = (direction, width = 3) => ({
  name: direction === 'inbound' ? 'Drive In' : 'Drive Out',
  type: 'drive-lane',
  width,
  elevation: 0,
  direction,
  color: '#ffffff',
  surface: 'asphalt',
  generated: {
    clones: [
      {
        mode: 'random',
        modelsArray: 'sedan-rig, suv-rig, box-truck-rig',
        spacing: 7.3,
        count: 3
      }
    ]
  }
});

const sidewalk = (width = 2) => ({
  name: 'Sidewalk',
  type: 'sidewalk',
  width,
  // Curb height in meters (same value the round-trip fixture uses).
  elevation: 0.15,
  direction: 'none',
  color: '#ffffff',
  surface: 'sidewalk',
  generated: { pedestrians: [{ density: 'normal' }] }
});

// Street-parking orientation → lane width and parked-car placement.
// Widths and per-car spacing are the strassenraumkarte lane-model values
// (osmberlin/strassenraumkarte data/lua/lanes.lua + proc_cars, validated
// against the Neukölln parking census); `facing` angles the parked clones
// off the travel axis for diagonal/perpendicular bays.
export const PARKING_BY_ORIENTATION = {
  parallel: { width: 2.2, spacing: 5.2, facing: 0 },
  diagonal: { width: 4.5, spacing: 3.1, facing: 55 },
  perpendicular: { width: 5, spacing: 2.5, facing: 90 }
};

const parking = (direction, orientation = 'parallel', width = null) => {
  const o =
    PARKING_BY_ORIENTATION[orientation] ?? PARKING_BY_ORIENTATION.parallel;
  const clone = {
    mode: 'random',
    modelsArray: 'sedan-rig',
    spacing: o.spacing,
    count: 4
  };
  if (o.facing) clone.facing = o.facing;
  return {
    name: 'Parking',
    type: 'parking-lane',
    width: width ?? o.width,
    elevation: 0,
    direction,
    color: '#ffffff',
    surface: 'concrete',
    generated: { clones: [clone] }
  };
};

// Physical separation between a protected cycle lane and traffic
// (cycleway=track / cycleway:*:separation / :buffer): a narrow raised
// divider between the bike lane and the drive lanes. (Named to avoid
// shadowing Node's global Buffer; exported as `buffer`.)
const bikeBuffer = (width = 0.6) => ({
  name: 'Buffer',
  type: 'divider',
  width,
  elevation: 0.15,
  direction: 'none',
  color: '#ffffff',
  surface: 'concrete'
});

const median = (width = 1.2) => ({
  name: 'Median',
  type: 'divider',
  width,
  elevation: 0.15,
  direction: 'none',
  color: '#ffffff',
  surface: 'grass'
});

const bike = (direction, width = 1.5) => ({
  name: direction === 'inbound' ? 'Bike In' : 'Bike Out',
  type: 'bike-lane',
  width,
  elevation: 0,
  direction,
  color: '#ffffff',
  surface: 'asphalt',
  generated: {
    clones: [
      {
        mode: 'random',
        modelsArray: 'cyclist-cargo, cyclist1, cyclist2, cyclist3',
        spacing: 12,
        count: 2
      }
    ]
  }
});

const bus = (direction, width = 3.2) => ({
  name: direction === 'inbound' ? 'Bus In' : 'Bus Out',
  type: 'bus-lane',
  width,
  elevation: 0,
  direction,
  color: '#ffffff',
  surface: 'asphalt',
  generated: {
    clones: [{ mode: 'random', modelsArray: 'bus', spacing: 30, count: 1 }]
  }
});

// Rail corridor preset (#2004): ONE track per OSM way — parallel tracks
// are parallel ways in OSM — on a raised ballast bed flanked by sloped
// gravel berms. Dimensions from the reference scene ("OSM rail"
// managed-street JSON): 12 ft bed at 1 ft elevation, 5 ft berms.
const RAIL_BED_ELEVATION_M = 0.3048;

const railBerm = (name, rising) => ({
  name,
  type: 'grass',
  width: 1.524,
  elevation: 0,
  direction: 'none',
  color: '#cfcfcf',
  surface: 'gravel',
  variant: 'custom',
  side: 'right',
  slope: true,
  slopeStart: rising ? 0 : RAIL_BED_ELEVATION_M,
  slopeEnd: rising ? RAIL_BED_ELEVATION_M : 0
});

const railTrack = ({
  name = 'railway',
  width = 3.6576,
  elevation = RAIL_BED_ELEVATION_M,
  surface = 'gravel'
} = {}) => ({
  name,
  type: 'rail',
  width,
  elevation,
  direction: 'none',
  color: '#ffffff',
  surface,
  // 'custom' keeps this exact generated config — the rail TYPE preset's
  // tram clones don't belong on a heavy-rail corridor.
  variant: 'custom',
  side: 'right',
  generated: { rail: [{ gauge: 1435 }] }
});

const plaza = (width = 5, density = 'dense') => ({
  name: 'Pedestrian Way',
  type: 'sidewalk',
  width,
  elevation: 0.15,
  direction: 'none',
  color: '#ffffff',
  surface: 'sidewalk',
  generated: { pedestrians: [{ density }] }
});

// Per-direction drive lane count by class for a two-way street, and the
// total for a one-way street. Rules, not data: OpenMapTiles carries no
// lane count (that arrives with the Overpass hydrator, #1930 phase 6).
const LANES_PER_DIRECTION = {
  motorway: 3,
  trunk: 3,
  primary: 2,
  secondary: 2,
  tertiary: 1,
  minor: 1,
  service: 1,
  track: 1,
  raceway: 1
};
const ONEWAY_LANES = {
  motorway: 3,
  trunk: 3,
  primary: 3,
  secondary: 2,
  tertiary: 2,
  minor: 1,
  service: 1,
  track: 1,
  raceway: 1
};
const NON_MOTOR_CLASSES = new Set([
  'pedestrian',
  'path',
  'busway',
  'bus_guideway',
  'rail',
  'transit'
]);

const LANE_WIDTH_M = {
  motorway: 3.5,
  trunk: 3.5,
  primary: 3.3,
  secondary: 3.2,
  tertiary: 3,
  minor: 3,
  service: 2.75,
  track: 2.5,
  raceway: 4
};

/**
 * Cross-section rules from the fields the vector tiles do carry:
 * `class`, `subclass` (the OSM highway value for minor/path/service) and
 * `oneway` (1 with the way direction, -1 against, else two-way).
 *
 * Street-local +z is the way's start→end direction (chords keep polyline
 * order and rotate by atan2(dx, dz)), and managed-street 'inbound' means
 * +z travel, so oneway 1 → every lane inbound, -1 → outbound.
 */
export function segmentsForWay({ class: cls, subclass, oneway }) {
  const oneWay =
    oneway === 1 || oneway === -1 || oneway === '1' || oneway === '-1';
  const flowDir = String(oneway) === '-1' ? 'outbound' : 'inbound';
  const laneW = LANE_WIDTH_M[cls] ?? 3;

  // Non-motor classes first.
  if (cls === 'pedestrian') return [plaza()];
  if (cls === 'path') {
    if (subclass === 'cycleway') {
      return oneWay ? [bike(flowDir, 2)] : [bike('inbound'), bike('outbound')];
    }
    if (subclass === 'bridleway') return [plaza(3, 'sparse')];
    return [plaza(2.5, 'normal')];
  }
  if (cls === 'busway' || cls === 'bus_guideway') {
    const lanes = oneWay ? [bus(flowDir)] : [bus('inbound'), bus('outbound')];
    return [sidewalk(), ...lanes, sidewalk()];
  }
  if (cls === 'rail') {
    // Heavy rail: single ballasted track between berms (previously fell
    // through to the residential fallback — a railway generated as a
    // two-way road with parking).
    return [
      railBerm('left berm', true),
      railTrack(),
      railBerm('right berm', false)
    ];
  }
  if (cls === 'transit') {
    // Urban rail (tram / light_rail): flush track, no berms. Merging
    // street-running track into the underlying road's cross-section is
    // tracked in #2004 phase B.
    return [
      railTrack({
        name: 'Tram track',
        width: 3,
        elevation: 0,
        surface: 'concrete'
      })
    ];
  }

  // Drivable classes: lanes, then dress by class/subclass.
  let lanes;
  if (oneWay) {
    const n = ONEWAY_LANES[cls] ?? 1;
    lanes = Array.from({ length: n }, () => drive(flowDir, laneW));
  } else {
    const n = LANES_PER_DIRECTION[cls] ?? 1;
    lanes = [
      ...Array.from({ length: n }, () => drive('inbound', laneW)),
      ...Array.from({ length: n }, () => drive('outbound', laneW))
    ];
    if ((cls === 'motorway' || cls === 'trunk' || cls === 'primary') && n > 1) {
      lanes.splice(n, 0, median());
    }
  }

  if (cls === 'motorway' || cls === 'trunk') return lanes;
  if (cls === 'primary' || cls === 'secondary') {
    return [sidewalk(2.5), ...lanes, sidewalk(2.5)];
  }
  if (cls === 'tertiary') {
    return [
      sidewalk(),
      parking('inbound'),
      ...lanes,
      parking('outbound'),
      sidewalk()
    ];
  }
  if (cls === 'minor') {
    if (subclass === 'living_street') {
      return [
        sidewalk(1.5),
        ...lanes.map((l) => ({ ...l, width: 2.5 })),
        sidewalk(1.5)
      ];
    }
    if (subclass === 'unclassified') {
      return [sidewalk(1.8), ...lanes, sidewalk(1.8)];
    }
    // residential (and anything else under minor): parked cars both sides.
    return [
      sidewalk(1.8),
      parking('inbound'),
      ...lanes,
      parking('outbound'),
      sidewalk(1.8)
    ];
  }
  // service, track, raceway, unknown drivable: bare lanes.
  return lanes;
}

// Segment factories + lane tables, shared with the Overpass tag mapper
// (osm-way-tags.js) so hydrated and rule-based streets look alike.
export const segmentBuilders = {
  drive,
  sidewalk,
  parking,
  median,
  bike,
  bus,
  buffer: bikeBuffer
};
export const LANE_TABLES = { LANES_PER_DIRECTION, ONEWAY_LANES, LANE_WIDTH_M };
export const DRIVABLE_CLASSES = new Set(Object.keys(LANE_WIDTH_M));

/**
 * Managed-street Format-2 object (the `parseStreetObject` /
 * `sourceType: json-blob` input shape) for one chord of an OSM way record
 * (`{ class, subclass, oneway }`; unknown class → residential rules).
 */
export function streetJsonForWay(way, lengthM, label) {
  const known =
    LANE_WIDTH_M[way.class] !== undefined || NON_MOTOR_CLASSES.has(way.class);
  const cls = known ? way.class : 'minor';
  const segments = segmentsForWay({ ...way, class: cls });
  const width = segments.reduce((sum, s) => sum + s.width, 0);
  return {
    name: label || `OSM ${way.class || 'street'}`,
    width,
    length: Math.round(lengthM * 100) / 100,
    segments
  };
}

/** Class-only convenience (two-way, no subclass). */
export function streetJsonForClass(cls, lengthM, label) {
  return streetJsonForWay({ class: cls }, lengthM, label);
}

/** Rough total width used for pre-import footprint hints. */
export function importedWidthMeters(cls) {
  return streetJsonForClass(cls, 1).width || roadWidthMeters(cls);
}

/**
 * Carriageway-only width (sidewalks excluded) of a crossing street —
 * what a junction cut through it must clear. Full-street widths doubled
 * every junction gap (#2006): a residential crossing is 14 m
 * sidewalk-to-sidewalk but only 10.4 m of it is roadway.
 */
export function importedCarriagewayMeters(cls) {
  const carriageway = streetJsonForClass(cls, 1)
    .segments.filter((s) => s.type !== 'sidewalk')
    .reduce((sum, s) => sum + s.width, 0);
  return carriageway || roadWidthMeters(cls);
}
