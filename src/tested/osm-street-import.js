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
  { windowM = 200, maxDeviationM = 1.5, minLengthM = 20 } = {}
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
  const lengthM = sEnd - sStart;
  if (lengthM < minLengthM) return null;

  const clipped = slicePolylineByArc(line, cumulative, sStart, sEnd);
  const points = simplifyPolyline(clipped, maxDeviationM);
  if (points.length < 2) return null;
  return { points, lengthM: Math.round(lengthM * 100) / 100 };
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
 * @param {Array<{x, z}>} stretchPoints the stretch centerline.
 * @param {Array<{ class, polylines }>} otherWays candidate crossers
 *   (local-meter polylines; the caller excludes the way itself and
 *   grade-separated crossers like bridges).
 * @returns {Array<{ s, point, crossWidthM }>} sorted by arc length `s`
 *   along the stretch; `crossWidthM` is the widest crossing way's
 *   imported street width (drives the split inset).
 */
export function junctionsAlongStretch(
  stretchPoints,
  otherWays,
  { toleranceM = 2, minSeparationM = 12 } = {}
) {
  if (!stretchPoints || stretchPoints.length < 2) return [];
  const cumulative = cumulativeArcLengths(stretchPoints);
  const found = [];
  const record = (s, point, cls) => {
    found.push({ s, point, crossWidthM: importedWidthMeters(cls) });
  };

  for (const other of otherWays || []) {
    for (const line of other.polylines || []) {
      if (!line || line.length < 2) continue;
      // Proper crossings, segment pair by segment pair.
      for (let i = 0; i < stretchPoints.length - 1; i++) {
        const a = stretchPoints[i];
        const b = stretchPoints[i + 1];
        for (let j = 0; j < line.length - 1; j++) {
          const hit = segmentIntersection(a, b, line[j], line[j + 1]);
          if (hit) {
            const s = cumulative[i] + Math.sqrt(distSq(a, hit.point));
            record(s, hit.point, other.class);
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
        if (bestPoint) record(bestS, bestPoint, other.class);
      }
    }
  }

  found.sort((p, q) => p.s - q.s);
  const junctions = [];
  for (const j of found) {
    const last = junctions[junctions.length - 1];
    if (last && j.s - last.s < minSeparationM) {
      last.crossWidthM = Math.max(last.crossWidthM, j.crossWidthM);
    } else {
      junctions.push({ ...j });
    }
  }
  return junctions;
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
 *   ready for street creation; `junctions`: the input junctions with
 *   `adjacentPieces` — how many kept pieces border each junction's cut.
 *   Callers mint an intersection only where ≥2 street ends actually
 *   meet (a junction whose far side fell below minLength would
 *   otherwise show a dangling placeholder pad).
 */
export function splitStretchAtJunctions(
  stretchPoints,
  junctions,
  { insetPadM = 4, minLengthM = 20 } = {}
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
      return { from: j.s - inset, to: j.s + inset, junctions: [j] };
    })
    .sort((a, b) => a.from - b.from);
  const merged = [cuts[0]];
  for (let i = 1; i < cuts.length; i++) {
    const last = merged[merged.length - 1];
    if (cuts[i].from <= last.to) {
      last.to = Math.max(last.to, cuts[i].to);
      last.junctions.push(...cuts[i].junctions);
    } else {
      merged.push(cuts[i]);
    }
  }

  // Keep runs between cuts; track which cut each kept piece borders.
  const outJunctions = junctions.map((j) => ({ ...j, adjacentPieces: 0 }));
  const junctionsOf = (cut) =>
    outJunctions.filter((oj) => cut.junctions.some((j) => j.s === oj.s));
  const pieces = [];
  const keepRun = (sStart, sEnd, cutBefore, cutAfter) => {
    if (sEnd - sStart < minLengthM) return;
    const points = slicePolylineByArc(stretchPoints, cumulative, sStart, sEnd);
    pieces.push({
      points,
      lengthM: Math.round((sEnd - sStart) * 100) / 100
    });
    if (cutBefore) junctionsOf(cutBefore).forEach((j) => j.adjacentPieces++);
    if (cutAfter) junctionsOf(cutAfter).forEach((j) => j.adjacentPieces++);
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

const parking = (direction, width = 2.2) => ({
  name: 'Parking',
  type: 'parking-lane',
  width,
  elevation: 0,
  direction,
  color: '#ffffff',
  surface: 'concrete',
  generated: {
    clones: [{ mode: 'random', modelsArray: 'sedan-rig', spacing: 6, count: 4 }]
  }
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
  'bus_guideway'
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
export const segmentBuilders = { drive, sidewalk, parking, median, bike, bus };
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
