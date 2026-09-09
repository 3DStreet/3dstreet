/**
 * Slippy-map (XYZ) tile math for the OSM data layers (#1962 step F).
 *
 * Pure module: shared by the buildings worker (tile → Overpass bbox), the
 * osm-buildings component (camera → wanted tile set), and — by design — any
 * future OSM fetcher (#1930's street centerlines use the same tiling).
 */

export const EQUATOR_M = 40075017;
export const POLES_M = 40007863;

/** Fractional tile coordinates for a lat/lon at zoom (standard XYZ). */
export function latLonToTile(lat, lon, zoom) {
  const n = 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return {
    x: (n * (lon + 180)) / 360,
    y:
      (n * (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) /
      2
  };
}

/** Geographic bounds of tile (x, y) at zoom: { south, west, north, east }. */
export function tileToBBox(x, y, zoom) {
  const n = 2 ** zoom;
  const lon = (tx) => (tx / n) * 360 - 180;
  const lat = (ty) => {
    const t = Math.PI - (2 * Math.PI * ty) / n;
    return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(t) - Math.exp(-t)));
  };
  return { south: lat(y + 1), west: lon(x), north: lat(y), east: lon(x + 1) };
}

/** Ground width of one tile in meters at the given latitude. */
export function tileWidthM(lat, zoom) {
  return (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export function tileKey(zoom, x, y) {
  return `${zoom}/${x}/${y}`;
}

/**
 * Integer tiles whose centers lie within radiusM of (lat, lon), sorted
 * nearest-first — the load order for streaming. Every tile touching the
 * radius square is considered, then filtered by center distance so the
 * loaded set is roughly circular rather than a square block.
 */
export function tilesWithinRadius(lat, lon, zoom, radiusM) {
  const center = latLonToTile(lat, lon, zoom);
  const width = tileWidthM(lat, zoom);
  const tileRadius = radiusM / width;
  const n = 2 ** zoom;
  const minX = Math.floor(center.x - tileRadius);
  const maxX = Math.floor(center.x + tileRadius);
  const minY = Math.max(0, Math.floor(center.y - tileRadius));
  const maxY = Math.min(n - 1, Math.floor(center.y + tileRadius));

  const tiles = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = (x + 0.5 - center.x) * width;
      const dy = (y + 0.5 - center.y) * width;
      const distM = Math.hypot(dx, dy);
      // Center tile always qualifies even with a tiny radius.
      if (distM <= radiusM + width * 0.5) {
        const wrappedX = ((x % n) + n) % n;
        tiles.push({ x: wrappedX, y, key: tileKey(zoom, wrappedX, y), distM });
      }
    }
  }
  tiles.sort((a, b) => a.distM - b.distM);
  return tiles;
}
