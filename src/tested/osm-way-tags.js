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
 * Tag coverage tracks #2004 (strassenraumkarte parity): lane counts,
 * widths (`width`/`width:carriageway`/`width:lanes*`), the street-parking
 * schema old and new (side, orientation, width, restriction), cycleway
 * width/separation/buffer (painted lane vs protected track), `turn:lanes*`
 * (surface arrows), bus/PSV lanes inside ordinary roads, `surface`, and
 * sidewalk sides/widths. Width defaults mirror the strassenraumkarte lane
 * model (osmberlin/strassenraumkarte, data/lua/lanes.lua, Apache-2.0).
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
  PARKING_BY_ORIENTATION,
  latLonToLocal,
  localToLatLon,
  nearestWay,
  segmentBuilders,
  segmentsForWay
} from './osm-street-import.js';

const { drive, sidewalk, parking, median, bike, bus, buffer } = segmentBuilders;
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

/** "5", "5.5", "5 m", "5.5m" → meters. Null for feet/quotes/garbage. */
function parseWidthM(v) {
  if (v === undefined || v === null) return null;
  const m = String(v)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*m?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 && n < 100 ? n : null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

const PARKING_ORIENTATIONS = new Set(['parallel', 'diagonal', 'perpendicular']);
const PARKING_RESTRICTED = new Set([
  'no_parking',
  'no_stopping',
  'no_standing'
]);

/**
 * Orientation, mapped width and restriction for one parking side, across
 * the old (`parking:lane:*` values ARE orientations) and post-2022
 * (`parking:<side>` + `:orientation`/`:width`/`:restriction` subkeys)
 * street-parking schemas.
 */
function parkingDetail(tags, side) {
  const oldVal =
    tags[`parking:lane:${side}`] ??
    tags['parking:lane:both'] ??
    tags['parking:lane'];
  const orientationTag =
    tags[`parking:${side}:orientation`] ??
    tags['parking:both:orientation'] ??
    (PARKING_ORIENTATIONS.has(oldVal) ? oldVal : undefined);
  const orientation = PARKING_ORIENTATIONS.has(orientationTag)
    ? orientationTag
    : 'parallel';
  const width =
    parseWidthM(tags[`parking:${side}:width`] ?? tags['parking:both:width']) ??
    parseWidthM(
      tags[`parking:lane:${side}:width`] ?? tags['parking:lane:both:width']
    );
  const restriction =
    tags[`parking:${side}:restriction`] ?? tags['parking:both:restriction'];
  return {
    orientation,
    width,
    restricted: PARKING_RESTRICTED.has(restriction)
  };
}

/**
 * Width and physical protection for one cycleway side. `track` (its own
 * roadway) and any tagged `separation`/`buffer` count as protected — the
 * cross-section gets a raised buffer divider between bike and traffic.
 */
function bikeDetail(tags, side) {
  const kind =
    tags[`cycleway:${side}`] ?? tags['cycleway:both'] ?? tags.cycleway;
  const width = parseWidthM(
    tags[`cycleway:${side}:width`] ??
      tags['cycleway:both:width'] ??
      tags['cycleway:width']
  );
  const detailKeys = (base) => [
    `cycleway:${side}:${base}`,
    `cycleway:${side}:${base}:left`,
    `cycleway:${side}:${base}:right`,
    `cycleway:${side}:${base}:both`,
    `cycleway:both:${base}`,
    `cycleway:${base}`
  ];
  const separation = detailKeys('separation')
    .map((k) => tags[k])
    .find((v) => v !== undefined && v !== 'no');
  const bufferVal = detailKeys('buffer')
    .map((k) => tags[k])
    .find((v) => v !== undefined && v !== 'no' && v !== '0');
  return {
    width: width ?? 1.5,
    protected:
      kind === 'track' ||
      kind === 'opposite_track' ||
      Boolean(separation) ||
      Boolean(bufferVal),
    bufferWidth: parseWidthM(bufferVal) ?? 0.6
  };
}

// `turn:lanes` entry (";"-joined movements) → stencil mixin id, or null.
// The mixins ship in assets.js's stencils group; merge_* and unknown
// movements match no combo and draw nothing rather than a wrong arrow.
const TURN_STENCILS = [
  [['left'], 'left'],
  [['right'], 'right'],
  [['through'], 'straight'],
  [['left', 'through'], 'left-straight'],
  [['right', 'through'], 'right-straight'],
  [['left', 'right'], 'both'],
  [['left', 'right', 'through'], 'all']
];

function stencilForTurnEntry(entry) {
  if (!entry) return null;
  const moves = new Set(
    entry
      .split(';')
      .map((m) => m.trim().replace(/^(slight_|sharp_)/, ''))
      .filter((m) => m && m !== 'none')
  );
  if (moves.size === 0) return null;
  for (const [combo, id] of TURN_STENCILS) {
    if (combo.length === moves.size && combo.every((m) => moves.has(m))) {
      return id;
    }
  }
  return null;
}

/** `a|b|c` lane-value list → array, or null when untagged. */
function laneValues(tag) {
  if (tag === undefined || tag === null) return null;
  return String(tag)
    .split('|')
    .map((v) => v.trim());
}

/**
 * Align `*:lanes` entries (listed leftmost-first from the DRIVER's view)
 * to our lane-array order. Forward/inbound lanes are built rightmost
 * (curbside) first — segments run -x → +x and segments[0] is the way's
 * forward-RIGHT — so their entries map reversed; backward lanes already
 * run driver-left-first in array order and map directly.
 */
function mapLaneEntries(entries, laneCount, reversed) {
  const out = new Array(laneCount).fill(null);
  if (!entries) return out;
  for (let i = 0; i < Math.min(entries.length, laneCount); i++) {
    out[reversed ? laneCount - 1 - i : i] = entries[i];
  }
  return out;
}

// OSM `surface=*` → street-segment surface. Only values with a matching
// texture map; anything else keeps the class default.
const SURFACE_MAP = {
  asphalt: 'asphalt',
  chipseal: 'asphalt',
  concrete: 'concrete',
  'concrete:plates': 'concrete',
  'concrete:lanes': 'concrete',
  paving_stones: 'sidewalk',
  sett: 'sidewalk',
  cobblestone: 'sidewalk',
  unhewn_cobblestone: 'sidewalk',
  bricks: 'sidewalk',
  gravel: 'gravel',
  fine_gravel: 'gravel',
  compacted: 'gravel',
  unpaved: 'gravel',
  dirt: 'gravel',
  ground: 'gravel',
  earth: 'gravel',
  grass: 'grass',
  sand: 'sand'
};

/**
 * @param {Object} tags OSM tags of the matched way.
 * @param {Object} way tile record ({ class, subclass, oneway }) — the
 *   fallback for anything the tags omit.
 * @returns {{ segments: Array, facts: Object }} `facts` fields are
 *   `{ value, source: 'osm' | 'default' }` (or absent when n/a) for
 *   lanes, sidewalk, parking, bike, width, busLanes, surface, plus
 *   `name`, `class`, `oneway`.
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

  // Dressing: OSM sides where tagged, class rules where not.
  const rules = segmentsForWay({ class: cls, subclass, oneway });
  const ruleHas = (type) => rules.some((s) => s.type === type);
  const sidewalkTagged = sides(tags, 'sidewalk', SIDEWALK_YES);
  const sidewalks = sidewalkTagged ?? {
    left: ruleHas('sidewalk'),
    right: ruleHas('sidewalk')
  };
  facts.sidewalk = {
    value: sidewalks,
    source: sidewalkTagged ? 'osm' : 'default'
  };
  const parkingTagged =
    sides(tags, 'parking:lane', PARKING_YES) ??
    sides(tags, 'parking', PARKING_YES);
  const parkings = {
    ...(parkingTagged ?? {
      left: ruleHas('parking-lane'),
      right: ruleHas('parking-lane')
    })
  };
  const parkDetail = {
    left: parkingDetail(tags, 'left'),
    right: parkingDetail(tags, 'right')
  };
  // A tagged restriction (no_parking/no_stopping) beats presence — the
  // kerb exists but nobody may park there, so no parking lane renders.
  if (parkDetail.left.restricted) parkings.left = false;
  if (parkDetail.right.restricted) parkings.right = false;
  facts.parking = {
    value: parkings,
    source: parkingTagged ? 'osm' : 'default',
    orientation: {
      left: parkDetail.left.orientation,
      right: parkDetail.right.orientation
    }
  };
  const bikeTagged = sides(tags, 'cycleway', CYCLEWAY_YES);
  const bikes = bikeTagged ?? { left: false, right: false };
  const bikeDet = {
    left: bikeDetail(tags, 'left'),
    right: bikeDetail(tags, 'right')
  };
  facts.bike = {
    value: bikes,
    source: bikeTagged ? 'osm' : 'default',
    protected: {
      left: bikes.left && bikeDet.left.protected,
      right: bikes.right && bikeDet.right.protected
    }
  };

  // Carriageway width: mapped `width:carriageway`/`width` minus the
  // on-carriageway extras (parking lanes, painted bike lanes) spread over
  // the drive lanes — the strassenraumkarte `width:effective` derivation.
  // Protected tracks sit off the carriageway and don't subtract.
  const carriagewayW =
    parseWidthM(tags['width:carriageway']) ?? parseWidthM(tags.width);
  let derivedLaneW = null;
  if (carriagewayW && fwd + bwd > 0) {
    let extras = 0;
    for (const side of ['left', 'right']) {
      if (parkings[side]) {
        extras +=
          parkDetail[side].width ??
          PARKING_BY_ORIENTATION[parkDetail[side].orientation].width;
      }
      if (bikes[side] && !bikeDet[side].protected) {
        extras += bikeDet[side].width;
      }
    }
    derivedLaneW = clamp((carriagewayW - extras) / (fwd + bwd), 2, 4.5);
    facts.width = { value: carriagewayW, source: 'osm' };
  }

  // One direction's drive/bus lanes with per-lane widths, turn arrows and
  // bus designation. `dirSuffix` is ':forward'/':backward' on two-way
  // ways, '' on one-ways (whose plain `turn:lanes`/`width:lanes` apply).
  const buildDirection = (count, direction, dirSuffix) => {
    if (count === 0) return { lanes: [], busCount: 0 };
    const reversed = direction === 'inbound';
    const widths = mapLaneEntries(
      laneValues(tags[`width:lanes${dirSuffix}`]),
      count,
      reversed
    ).map(parseWidthM);
    const stencils = mapLaneEntries(
      laneValues(tags[`turn:lanes${dirSuffix}`]),
      count,
      reversed
    ).map(stencilForTurnEntry);
    const busEntries = laneValues(
      tags[`bus:lanes${dirSuffix}`] ?? tags[`psv:lanes${dirSuffix}`]
    );
    const busFlags = mapLaneEntries(busEntries, count, reversed).map(
      (v) => v === 'designated' || v === 'yes'
    );
    if (!busEntries) {
      // Count-only tagging: bus lanes hug the curb — the driver's right,
      // which is index 0 for forward lanes and count-1 for backward.
      const n = Math.min(
        parseInt10(tags[`lanes:bus${dirSuffix}`]) ??
          parseInt10(tags[`lanes:psv${dirSuffix}`]) ??
          0,
        count
      );
      for (let i = 0; i < n; i++) {
        busFlags[reversed ? i : count - 1 - i] = true;
      }
    }
    const lanes = [];
    let busCount = 0;
    for (let i = 0; i < count; i++) {
      const w = widths[i] ?? derivedLaneW ?? laneW;
      if (busFlags[i]) {
        busCount++;
        lanes.push(bus(direction, widths[i] ?? 3.2));
        continue;
      }
      const lane = drive(direction, w);
      if (stencils[i]) {
        lane.generated = {
          ...lane.generated,
          stencil: [{ modelsArray: stencils[i], spacing: 20, direction }]
        };
      }
      lanes.push(lane);
    }
    return { lanes, busCount };
  };

  const fwdBuilt = buildDirection(
    fwd,
    'inbound',
    oneway && flowDir === 'inbound' ? '' : ':forward'
  );
  const bwdBuilt = buildDirection(
    bwd,
    'outbound',
    oneway && flowDir === 'outbound' ? '' : ':backward'
  );
  const lanes = [...fwdBuilt.lanes, ...bwdBuilt.lanes];
  if (
    !oneway &&
    (cls === 'motorway' || cls === 'trunk' || cls === 'primary') &&
    fwd > 1 &&
    bwd > 1
  ) {
    lanes.splice(fwd, 0, median());
  }
  const busTotal = fwdBuilt.busCount + bwdBuilt.busCount;
  if (busTotal > 0) facts.busLanes = { value: busTotal, source: 'osm' };

  const swDefault = cls === 'primary' || cls === 'secondary' ? 2.5 : 1.8;
  const sidewalkWidth = (side) =>
    parseWidthM(
      tags[`sidewalk:${side}:width`] ??
        tags['sidewalk:both:width'] ??
        tags['sidewalk:width']
    ) ?? swDefault;

  const segments = [];
  if (sidewalks.right) segments.push(sidewalk(sidewalkWidth('right')));
  if (parkings.right) {
    segments.push(
      parking('inbound', parkDetail.right.orientation, parkDetail.right.width)
    );
  }
  if (bikes.right) {
    segments.push(bike('inbound', bikeDet.right.width));
    if (bikeDet.right.protected) {
      segments.push(buffer(bikeDet.right.bufferWidth));
    }
  }
  segments.push(...lanes);
  if (bikes.left) {
    if (bikeDet.left.protected) {
      segments.push(buffer(bikeDet.left.bufferWidth));
    }
    segments.push(bike('outbound', bikeDet.left.width));
  }
  if (parkings.left) {
    segments.push(
      parking('outbound', parkDetail.left.orientation, parkDetail.left.width)
    );
  }
  if (sidewalks.left) segments.push(sidewalk(sidewalkWidth('left')));

  const surfaceMapped = SURFACE_MAP[tags.surface];
  if (surfaceMapped) {
    for (const s of segments) {
      if (
        s.type === 'drive-lane' ||
        s.type === 'bus-lane' ||
        s.type === 'bike-lane'
      ) {
        s.surface = surfaceMapped;
      }
    }
    facts.surface = { value: tags.surface, source: 'osm' };
  }

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
 * "Main St · 4 lanes · width 12 m · sidewalks both sides · parking right
 * (diagonal)". Defaults are flagged: "lanes not mapped (2 assumed)".
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
  if (facts.width?.source === 'osm') {
    parts.push(`width ${facts.width.value} m`);
  }
  if (facts.busLanes?.value) {
    parts.push(
      `${facts.busLanes.value} bus ${facts.busLanes.value === 1 ? 'lane' : 'lanes'}`
    );
  }
  if (facts.sidewalk?.source === 'osm') {
    parts.push(`sidewalks ${sidesWord(facts.sidewalk.value)}`);
  }
  if (facts.parking?.source === 'osm') {
    let label = `parking ${sidesWord(facts.parking.value)}`;
    const o = facts.parking.orientation;
    const tagged = ['left', 'right'].filter((s) => facts.parking.value[s]);
    if (
      tagged.length > 0 &&
      tagged.every((s) => o?.[s] === o?.[tagged[0]]) &&
      o?.[tagged[0]] !== 'parallel'
    ) {
      label += ` (${o[tagged[0]]})`;
    }
    parts.push(label);
  }
  if (facts.bike?.source === 'osm' && sidesWord(facts.bike.value) !== 'none') {
    const tagged = ['left', 'right'].filter((s) => facts.bike.value[s]);
    const allProtected =
      tagged.length > 0 && tagged.every((s) => facts.bike.protected?.[s]);
    parts.push(
      `${allProtected ? 'protected ' : ''}bike lanes ${sidesWord(facts.bike.value)}`
    );
  }
  if (facts.surface?.source === 'osm' && facts.surface.value !== 'asphalt') {
    parts.push(`${facts.surface.value} surface`);
  }
  return parts.join(' · ');
}
