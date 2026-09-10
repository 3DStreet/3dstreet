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
 * - polyline → straight chord splitting (managed streets are straight
 *   until #1930 phase 3 gives them owned centerlines),
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
