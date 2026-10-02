/**
 * Tree data sources for the tree-inventory plugin. Pure: no AFRAME, THREE
 * or DOM, so every function here is unit-tested (test/plugins/).
 *
 * Each source turns a lat/lon bounding box into an HTTP request and its
 * response into normalized trees:
 *   { id, lat, lon, species, dbhCm }   (species/dbhCm may be '' / null)
 *
 * To add a city: add an entry to SOURCES with `request(bbox, limit)` and
 * `parse(json)`, plus a recorded response fixture and a test.
 */

import { geo } from '../api.js';

const INCH_CM = 2.54;
const NORTH_M_PER_DEG = geo.northMPerDeg;
const eastMPerDeg = geo.eastMPerDeg;

const num = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Bounding box around a center for a circle (radius) or box (width east-west
 * × depth north-south), all in meters.
 */
export function bboxAround(center, area) {
  const halfNS = area.shape === 'box' ? area.depth / 2 : area.radius;
  const halfEW = area.shape === 'box' ? area.width / 2 : area.radius;
  const dLat = halfNS / NORTH_M_PER_DEG;
  const dLon = halfEW / eastMPerDeg(center.lat);
  return {
    south: center.lat - dLat,
    north: center.lat + dLat,
    west: center.lon - dLon,
    east: center.lon + dLon
  };
}

const f6 = (n) => n.toFixed(6);

export const SOURCES = {
  osm: {
    label: 'OpenStreetMap (worldwide)',
    attribution: '© OpenStreetMap contributors (ODbL)',
    overpassQuery(bbox, limit) {
      const b = [bbox.south, bbox.west, bbox.north, bbox.east].map(f6);
      return `[out:json][timeout:25];node["natural"="tree"](${b.join(',')});out body ${limit};`;
    },
    parse(json) {
      return (json.elements || [])
        .filter((el) => el.type === 'node')
        .map((el) => {
          const tags = el.tags || {};
          const circumferenceM = num(tags.circumference);
          return {
            id: `osm-${el.id}`,
            lat: el.lat,
            lon: el.lon,
            species: [
              tags['species:en'],
              tags.species,
              tags.genus,
              tags.taxon,
              tags.leaf_type === 'needleleaved' ? 'conifer' : ''
            ]
              .filter(Boolean)
              .join(' :: '),
            dbhCm: circumferenceM ? (circumferenceM * 100) / Math.PI : null
          };
        });
    }
  },
  sf: {
    label: 'San Francisco Street Tree List (DataSF)',
    attribution: 'San Francisco Public Works via DataSF',
    request(bbox, limit) {
      const where =
        `latitude::number between ${f6(bbox.south)} and ${f6(bbox.north)}` +
        ` and longitude::number between ${f6(bbox.west)} and ${f6(bbox.east)}` +
        ` and planttype='Tree'`;
      const params = new URLSearchParams({
        $select: 'treeid,species,mapdbh,latitude,longitude',
        $where: where,
        $limit: String(limit)
      });
      return `https://data.sf.gov/resource/tkzw-k3nq.json?${params}`;
    },
    parse(rows) {
      return rows
        .map((row) => ({
          id: `sf-${row.treeid}`,
          lat: num(row.latitude),
          lon: num(row.longitude),
          // "Platanus x hispanica :: Sycamore, London Plane"
          species: row.species || '',
          dbhCm: num(row.mapdbh) ? num(row.mapdbh) * INCH_CM : null
        }))
        .filter((t) => t.lat !== null && t.lon !== null);
    }
  },
  nyc: {
    label: 'New York City Forestry Tree Points (NYC Open Data)',
    attribution: 'NYC Parks via NYC Open Data',
    request(bbox, limit) {
      const where =
        `within_box(location, ${f6(bbox.north)}, ${f6(bbox.west)}, ` +
        `${f6(bbox.south)}, ${f6(bbox.east)}) AND tpstructure='Full'`;
      const params = new URLSearchParams({
        $select: 'objectid,genusspecies,dbh,location',
        $where: where,
        $limit: String(limit)
      });
      return `https://data.cityofnewyork.us/resource/hn5i-inap.json?${params}`;
    },
    parse(rows) {
      return rows
        .filter((row) => row.location?.coordinates)
        .map((row) => ({
          id: `nyc-${row.objectid}`,
          lat: row.location.coordinates[1],
          lon: row.location.coordinates[0],
          // "Acer nigrum - black maple"
          species: row.genusspecies || '',
          dbhCm: num(row.dbh) ? num(row.dbh) * INCH_CM : null
        }));
    }
  }
};

/** Meters between two lat/lon points (local flat approximation). */
function distanceM(a, b) {
  const dn = (b.lat - a.lat) * NORTH_M_PER_DEG;
  const de = (b.lon - a.lon) * eastMPerDeg(a.lat);
  return Math.hypot(dn, de);
}

/**
 * Keep trees inside the area (sources query a bbox; circles are trimmed
 * here), nearest first, at most maxTrees.
 */
export function selectTrees(trees, center, area, maxTrees) {
  const bbox = bboxAround(center, area);
  return trees
    .filter(
      (t) =>
        t.lat >= bbox.south &&
        t.lat <= bbox.north &&
        t.lon >= bbox.west &&
        t.lon <= bbox.east
    )
    .map((t) => ({ tree: t, d: distanceM(center, t) }))
    .filter(({ d }) => area.shape === 'box' || d <= area.radius)
    .sort((a, b) => a.d - b.d)
    .slice(0, maxTrees)
    .map(({ tree }) => tree);
}

/**
 * Fetch, normalize and select trees.
 * @param {object} options { source, center: {lat, lon}, area, maxTrees,
 *   fetchImpl?, signal? }
 */
export async function fetchTrees(options) {
  const { source, center, area, maxTrees, fetchImpl = fetch, signal } = options;
  const def = SOURCES[source];
  if (!def) throw new Error(`Unknown tree source: ${source}`);
  const bbox = bboxAround(center, area);
  // Ask for extra rows: a circle trims the bbox corners, and the nearest
  // trees are kept after sorting.
  const limit = Math.max(maxTrees * 2, 50);
  let json;
  if (def.overpassQuery) {
    json = await geo.fetchOverpass(def.overpassQuery(bbox, limit), {
      fetchImpl,
      signal
    });
  } else {
    const response = await fetchImpl(def.request(bbox, limit), { signal });
    if (!response.ok) {
      throw new Error(`${def.label} responded ${response.status}`);
    }
    json = await response.json();
  }
  return selectTrees(def.parse(json), center, area, maxTrees);
}

// ---------------------------------------------------------------------------
// Species → catalog model
// ---------------------------------------------------------------------------

const MODEL_RULES = [
  [
    /palm|phoenix|washingtonia|syagrus|trachycarpus|archontophoenix/,
    'sp-tree-palm-26ft'
  ],
  [/quercus|\boak\b/, 'sp-tree-buroak-24ft'],
  [/gleditsia|honey ?locust/, 'sp-tree-honeylocust-24ft'],
  [/prunus|plum|cherry/, 'sp-tree-purpleplum-16ft'],
  [/syringa|lilac/, 'sp-tree-japaneselilac-20ft']
];

const YOUNG_TREE_DBH_CM = 15;

/** Pick a catalog model for a tree; `defaultModel` when nothing matches. */
export function modelForTree(tree, defaultModel) {
  const species = (tree.species || '').toLowerCase();
  for (const [pattern, model] of MODEL_RULES) {
    if (pattern.test(species)) return model;
  }
  if (tree.dbhCm !== null && tree.dbhCm < YOUNG_TREE_DBH_CM) {
    return 'sp-tree-small-15ft';
  }
  return defaultModel;
}

/** Stable 0..360 yaw from a tree id, so a reload looks the same. */
export function yawForTree(tree) {
  let hash = 0;
  for (const ch of String(tree.id)) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(hash) % 360;
}

// ---------------------------------------------------------------------------
// Cache: the fetched trees are saved inside the scene so a saved scene
// reloads offline, identically, without hitting the source again.
// ---------------------------------------------------------------------------

export function queryKey({ source, center, area, maxTrees }) {
  const size =
    area.shape === 'box' ? `${area.width}x${area.depth}` : `r${area.radius}`;
  return [source, f6(center.lat), f6(center.lon), size, maxTrees].join('|');
}

const r7 = (n) => Math.round(n * 1e7) / 1e7;

export function encodeCache(key, trees) {
  // Scenes save components as A-Frame style strings ("a: 1; b: 2"), so a
  // ';' inside a value would split the property. Only species can hold one.
  return JSON.stringify({
    key,
    trees: trees.map((t) => [
      t.id,
      r7(t.lat),
      r7(t.lon),
      (t.species || '').replace(/;/g, ','),
      t.dbhCm === null ? null : Math.round(t.dbhCm)
    ])
  });
}

/** Returns { key, trees } or null for an empty/invalid cache string. */
export function decodeCache(text) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return {
      key: parsed.key,
      trees: parsed.trees.map(([id, lat, lon, species, dbhCm]) => ({
        id,
        lat,
        lon,
        species,
        dbhCm
      }))
    };
  } catch (e) {
    return null;
  }
}

// Rough city extents for picking the best source for a location.
const CITY_BOUNDS = {
  sf: { south: 37.7, north: 37.84, west: -122.53, east: -122.35 },
  nyc: { south: 40.49, north: 40.92, west: -74.26, east: -73.69 }
};

/** The city source covering a location, else worldwide OSM. */
export function suggestSource(center) {
  if (!center) return 'osm';
  for (const [source, b] of Object.entries(CITY_BOUNDS)) {
    if (
      center.lat >= b.south &&
      center.lat <= b.north &&
      center.lon >= b.west &&
      center.lon <= b.east
    ) {
      return source;
    }
  }
  return 'osm';
}
