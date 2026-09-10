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

function residentialPreset() {
  return [
    sidewalk(1.8),
    parking('inbound'),
    drive('inbound'),
    drive('outbound'),
    parking('outbound'),
    sidewalk(1.8)
  ];
}

function arterialPreset() {
  return [
    sidewalk(),
    drive('inbound', 3.3),
    drive('inbound', 3.3),
    median(),
    drive('outbound', 3.3),
    drive('outbound', 3.3),
    sidewalk()
  ];
}

function servicePreset() {
  return [drive('inbound', 2.75), drive('outbound', 2.75)];
}

function pedestrianPreset() {
  return [
    {
      name: 'Pedestrian Way',
      type: 'sidewalk',
      width: 5,
      elevation: 0.15,
      direction: 'none',
      color: '#ffffff',
      surface: 'sidewalk',
      generated: { pedestrians: [{ density: 'dense' }] }
    }
  ];
}

const PRESET_BY_CLASS = {
  motorway: arterialPreset,
  trunk: arterialPreset,
  primary: arterialPreset,
  secondary: arterialPreset,
  tertiary: residentialPreset,
  minor: residentialPreset,
  busway: residentialPreset,
  bus_guideway: residentialPreset,
  service: servicePreset,
  track: servicePreset,
  raceway: servicePreset,
  pedestrian: pedestrianPreset,
  path: pedestrianPreset
};

/**
 * Managed-street Format-2 object (the `parseStreetObject` /
 * `sourceType: json-blob` input shape) for one chord of an OSM way.
 */
export function streetJsonForClass(cls, lengthM, label) {
  const preset = PRESET_BY_CLASS[cls] || residentialPreset;
  const segments = preset().map((segment) => ({ ...segment }));
  const width = segments.reduce((sum, s) => sum + s.width, 0);
  return {
    name: label || `OSM ${cls || 'street'}`,
    width,
    length: Math.round(lengthM * 100) / 100,
    segments
  };
}

/** Rough total width used for pre-import footprint hints. */
export function importedWidthMeters(cls) {
  return streetJsonForClass(cls, 1).width || roadWidthMeters(cls);
}
