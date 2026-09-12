/**
 * Overpass-backed street hydration (#1930 phase 6, first slice): the raw
 * OSM tags of the way under a click → a managed-street cross-section.
 *
 * Pure module (no AFRAME/THREE/DOM/fetch). The `osm-streets` component
 * runs the query (`overpassStreetQuery`) through `src/osm/overpass-fetch`,
 * picks the matching way (`pickOverpassWay`), and turns its tags into
 * segments (`crossSectionFromTags`). Every field is exact where OSM has
 * it and falls back to the class rules in osm-street-import.js where it
 * doesn't; `facts` records which is which so the UI can say so.
 *
 * Side convention: managed-street lays segments out from -x to +x, and
 * street-local +z is the way's forward direction, so segments[0] is the
 * way's RIGHT side (OSM `*:right`) and the last segment its LEFT.
 * 'inbound' = forward (+z) travel. Right-hand traffic: forward lanes on
 * the right, i.e. first.
 */

import {
  DRIVABLE_CLASSES,
  LANE_TABLES,
  latLonToLocal,
  localToLatLon,
  nearestWay,
  segmentBuilders,
  segmentsForWay
} from './osm-street-import.js';

const { drive, sidewalk, parking, median, bike } = segmentBuilders;
const { LANES_PER_DIRECTION, ONEWAY_LANES, LANE_WIDTH_M } = LANE_TABLES;

// OSM highway value → OpenMapTiles class (+ subclass where the rules care).
const HIGHWAY_TO_CLASS = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  residential: 'minor',
  unclassified: 'minor',
  living_street: 'minor',
  road: 'minor',
  service: 'service',
  track: 'track',
  raceway: 'raceway',
  busway: 'busway',
  bus_guideway: 'bus_guideway',
  pedestrian: 'pedestrian',
  footway: 'path',
  path: 'path',
  cycleway: 'path',
  bridleway: 'path',
  steps: 'path'
};

/** OSM `highway=*` → { class, subclass } in the tile vocabulary. */
export function classForHighway(highway) {
  if (!highway) return null;
  const base = highway.endsWith('_link') ? highway.slice(0, -5) : highway;
  const cls = HIGHWAY_TO_CLASS[base];
  if (!cls) return null;
  return { class: cls, subclass: base, link: base !== highway };
}

/**
 * Overpass QL for every highway way touching a bbox, with node geometry.
 * `bbox` = { south, west, north, east } in degrees.
 */
export function overpassStreetQuery(bbox, { timeoutS = 8 } = {}) {
  const b = [bbox.south, bbox.west, bbox.north, bbox.east]
    .map((v) => v.toFixed(6))
    .join(',');
  return `[out:json][timeout:${timeoutS}];way["highway"](${b});out tags geom;`;
}

/** Degree bbox around local points, padded by `padM` meters. */
export function bboxAroundLocalPoints(origin, points, padM = 20) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  const sw = localToLatLon(origin, { x: minX - padM, z: minZ - padM });
  const ne = localToLatLon(origin, { x: maxX + padM, z: maxZ + padM });
  return { south: sw.lat, west: sw.lon, north: ne.lat, east: ne.lon };
}

/**
 * The Overpass way (with `geometry`) whose centerline passes nearest a
 * local point, as `{ id, tags, polylines }` (local meters) — or null.
 * Ways without a usable highway class are skipped, so a footway hugging a
 * road never shadows the road itself.
 */
export function pickOverpassWay(
  elements,
  origin,
  localPoint,
  { maxDistM = 12, preferDrivable = true } = {}
) {
  const ways = [];
  for (const el of elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const mapped = classForHighway(el.tags?.highway);
    if (!mapped) continue;
    const polyline = el.geometry.map((g) => latLonToLocal(origin, g));
    if (polyline.length < 2) continue;
    ways.push({
      wayId: String(el.id),
      id: el.id,
      tags: el.tags || {},
      class: mapped.class,
      polylines: [polyline]
    });
  }
  if (ways.length === 0) return null;
  const drivable = ways.filter((w) => DRIVABLE_CLASSES.has(w.class));
  const hit =
    (preferDrivable && nearestWay(drivable, localPoint, maxDistM)) ||
    nearestWay(ways, localPoint, maxDistM);
  return hit ? hit.way : null;
}

const YES = new Set(['yes', 'true', '1', 'both', 'left', 'right']);

function parseInt10(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function onewayFromTags(tags, cls, fallback) {
  const v = tags.oneway;
  if (v === 'yes' || v === 'true' || v === '1') return 1;
  if (v === '-1' || v === 'reverse') return -1;
  if (v === 'no' || v === 'false' || v === '0') return 0;
  if (tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  // OSM default: motorways (and their links) are one-way unless tagged.
  if (cls === 'motorway') return 1;
  if (
    fallback === 1 ||
    fallback === -1 ||
    fallback === '1' ||
    fallback === '-1'
  ) {
    return Number(fallback);
  }
  return 0;
}

// { right: bool, left: bool } from `key`, `key:both`, `key:left`,
// `key:right` with a predicate on the value. Returns null if untagged.
function sides(tags, key, isYes) {
  const both = tags[key] ?? tags[`${key}:both`];
  const left = tags[`${key}:left`];
  const right = tags[`${key}:right`];
  if (both === undefined && left === undefined && right === undefined) {
    return null;
  }
  const out = { left: false, right: false };
  if (both !== undefined) {
    if (both === 'left') out.left = isYes(both);
    else if (both === 'right') out.right = isYes(both);
    else out.left = out.right = isYes(both);
  }
  if (left !== undefined) out.left = isYes(left);
  if (right !== undefined) out.right = isYes(right);
  return out;
}

const SIDEWALK_YES = (v) => YES.has(v);
const PARKING_YES = (v) =>
  [
    'parallel',
    'diagonal',
    'perpendicular',
    'marked',
    'yes',
    'lane',
    'street_side',
    'on_kerb',
    'half_on_kerb',
    'on_street'
  ].includes(v);
const CYCLEWAY_YES = (v) =>
  ['lane', 'track', 'opposite_lane', 'opposite_track', 'share_busway'].includes(
    v
  );

/**
 * @param {Object} tags OSM tags of the matched way.
 * @param {Object} way tile record ({ class, subclass, oneway }) — the
 *   fallback for anything the tags omit.
 * @returns {{ segments: Array, facts: Object }} `facts` fields are
 *   `{ value, source: 'osm' | 'default' }` (or absent when n/a) for
 *   lanes, sidewalk, parking, bike, plus `name`, `class`, `oneway`.
 */
export function crossSectionFromTags(tags = {}, way = {}) {
  const mapped = classForHighway(tags.highway);
  const cls = mapped ? mapped.class : way.class || 'minor';
  const subclass = mapped ? mapped.subclass : way.subclass;
  const oneway = onewayFromTags(tags, cls, way.oneway);
  const facts = { name: tags.name || null, class: cls, oneway };

  if (!DRIVABLE_CLASSES.has(cls)) {
    // Footways, cycleways, plazas, busways: the rules already read the
    // subclass; tags add nothing we render yet.
    return {
      segments: segmentsForWay({ class: cls, subclass, oneway }),
      facts
    };
  }

  const laneW = LANE_WIDTH_M[cls] ?? 3;
  const flowDir = oneway === -1 ? 'outbound' : 'inbound';

  // Lanes: exact from `lanes` (+ forward/backward split), else the rules.
  const lanesTag = parseInt10(tags.lanes);
  let fwd;
  let bwd;
  if (oneway) {
    const n = lanesTag ?? ONEWAY_LANES[cls] ?? 1;
    fwd = flowDir === 'inbound' ? n : 0;
    bwd = flowDir === 'inbound' ? 0 : n;
    facts.lanes = { value: n, source: lanesTag ? 'osm' : 'default' };
  } else {
    const f = parseInt10(tags['lanes:forward']);
    const b = parseInt10(tags['lanes:backward']);
    if (lanesTag) {
      fwd = f ?? (b ? lanesTag - b : Math.ceil(lanesTag / 2));
      // Never invent a lane the tags don't carry: lanes=2 +
      // lanes:forward=2 is a two-way road whose second direction has no
      // marked lane, not three lanes. Malformed lanes:forward > lanes
      // clamps the split to what's tagged.
      fwd = Math.min(Math.max(fwd, 0), lanesTag);
      bwd = Math.max(lanesTag - fwd, 0);
      if (fwd + bwd === 0) fwd = 1;
      facts.lanes = { value: lanesTag, source: 'osm' };
    } else if (f || b) {
      fwd = f ?? b;
      bwd = b ?? f;
      facts.lanes = { value: fwd + bwd, source: 'osm' };
    } else {
      fwd = bwd = LANES_PER_DIRECTION[cls] ?? 1;
      facts.lanes = { value: fwd + bwd, source: 'default' };
    }
  }
  const lanes = [
    ...Array.from({ length: fwd }, () => drive('inbound', laneW)),
    ...Array.from({ length: bwd }, () => drive('outbound', laneW))
  ];
  if (
    !oneway &&
    (cls === 'motorway' || cls === 'trunk' || cls === 'primary') &&
    fwd > 1 &&
    bwd > 1
  ) {
    lanes.splice(fwd, 0, median());
  }

  // Dressing: OSM sides where tagged, class rules where not.
  const rules = segmentsForWay({ class: cls, subclass, oneway });
  const ruleHas = (type) => rules.some((s) => s.type === type);
  const sidewalks = sides(tags, 'sidewalk', SIDEWALK_YES) ?? {
    left: ruleHas('sidewalk'),
    right: ruleHas('sidewalk')
  };
  facts.sidewalk = {
    value: sidewalks,
    source: sides(tags, 'sidewalk', SIDEWALK_YES) ? 'osm' : 'default'
  };
  const parkingTagged =
    sides(tags, 'parking:lane', PARKING_YES) ??
    sides(tags, 'parking', PARKING_YES);
  const parkings = parkingTagged ?? {
    left: ruleHas('parking-lane'),
    right: ruleHas('parking-lane')
  };
  facts.parking = {
    value: parkings,
    source: parkingTagged ? 'osm' : 'default'
  };
  const bikes = sides(tags, 'cycleway', CYCLEWAY_YES) ?? {
    left: false,
    right: false
  };
  facts.bike = {
    value: bikes,
    source: sides(tags, 'cycleway', CYCLEWAY_YES) ? 'osm' : 'default'
  };

  const sw = cls === 'primary' || cls === 'secondary' ? 2.5 : 1.8;
  const segments = [];
  if (sidewalks.right) segments.push(sidewalk(sw));
  if (parkings.right) segments.push(parking('inbound'));
  if (bikes.right) segments.push(bike('inbound'));
  segments.push(...lanes);
  if (bikes.left) segments.push(bike('outbound'));
  if (parkings.left) segments.push(parking('outbound'));
  if (sidewalks.left) segments.push(sidewalk(sw));
  return { segments, facts };
}

/** Format-2 street object from tags (name from OSM when present). */
export function streetJsonFromTags(tags, way, lengthM) {
  const { segments, facts } = crossSectionFromTags(tags, way);
  const width = segments.reduce((sum, s) => sum + s.width, 0);
  return {
    json: {
      name: facts.name || `OSM ${facts.class || 'street'}`,
      width,
      length: Math.round(lengthM * 100) / 100,
      segments
    },
    facts
  };
}

function sidesWord(v) {
  if (v.left && v.right) return 'both sides';
  if (v.left) return 'left';
  if (v.right) return 'right';
  return 'none';
}

/**
 * One-line human summary for the chip, e.g.
 * "Main St · 4 lanes · sidewalks both sides · parking right".
 * Defaults are flagged: "lanes not mapped (2 assumed)".
 */
export function describeFacts(facts) {
  if (!facts) return '';
  const parts = [];
  if (facts.name) parts.push(facts.name);
  if (facts.oneway) parts.push('one-way');
  if (facts.lanes) {
    parts.push(
      facts.lanes.source === 'osm'
        ? `${facts.lanes.value} ${facts.lanes.value === 1 ? 'lane' : 'lanes'}`
        : `lanes not mapped (${facts.lanes.value} assumed)`
    );
  }
  if (facts.sidewalk?.source === 'osm') {
    parts.push(`sidewalks ${sidesWord(facts.sidewalk.value)}`);
  }
  if (facts.parking?.source === 'osm') {
    parts.push(`parking ${sidesWord(facts.parking.value)}`);
  }
  if (facts.bike?.source === 'osm' && sidesWord(facts.bike.value) !== 'none') {
    parts.push(`bike lanes ${sidesWord(facts.bike.value)}`);
  }
  return parts.join(' · ');
}
