/* global describe, it */

/**
 * Slippy-map tile math for the OSM data layers (#1962 step F).
 */

import assert from 'assert';
import {
  latLonToTile,
  tileToBBox,
  tileWidthM,
  tileKey,
  tilesWithinRadius
} from '../../src/tested/osm-tile-math.js';

const SF = { lat: 37.7952, lon: -122.3937 };

describe('osm-tile-math', () => {
  it('latLonToTile anchors: the null island center and the antimeridian', () => {
    // (0°, 0°) is the exact center of the world at every zoom.
    assert.deepStrictEqual(latLonToTile(0, 0, 0), { x: 0.5, y: 0.5 });
    assert.deepStrictEqual(latLonToTile(0, 0, 3), { x: 4, y: 4 });
    // The antimeridian is tile-column 0 / n.
    assert.strictEqual(latLonToTile(0, -180, 5).x, 0);
    assert.strictEqual(latLonToTile(0, 180, 5).x, 32);
    // Northern latitudes give smaller y.
    assert.ok(latLonToTile(60, 0, 5).y < latLonToTile(0, 0, 5).y);
  });

  it('tileToBBox inverts latLonToTile (point lies inside its tile bbox)', () => {
    const { x, y } = latLonToTile(SF.lat, SF.lon, 17);
    const bbox = tileToBBox(Math.floor(x), Math.floor(y), 17);
    assert.ok(bbox.south < SF.lat && SF.lat < bbox.north);
    assert.ok(bbox.west < SF.lon && SF.lon < bbox.east);
    assert.ok(bbox.north > bbox.south && bbox.east > bbox.west);
  });

  it('tileWidthM shrinks by half per zoom and with latitude', () => {
    const w16 = tileWidthM(SF.lat, 16);
    const w17 = tileWidthM(SF.lat, 17);
    assert.ok(Math.abs(w16 / w17 - 2) < 1e-9);
    // z17 at SF latitude is ~242 m
    assert.ok(w17 > 200 && w17 < 300);
    assert.ok(tileWidthM(60, 17) < tileWidthM(0, 17));
  });

  it('tilesWithinRadius returns the center tile even for a tiny radius', () => {
    const tiles = tilesWithinRadius(SF.lat, SF.lon, 17, 1);
    const { x, y } = latLonToTile(SF.lat, SF.lon, 17);
    assert.ok(
      tiles.some((t) => t.x === Math.floor(x) && t.y === Math.floor(y))
    );
  });

  it('tilesWithinRadius sorts nearest-first and stays roughly circular', () => {
    const radiusM = 1000;
    const tiles = tilesWithinRadius(SF.lat, SF.lon, 17, radiusM);
    assert.ok(tiles.length > 4);
    for (let i = 1; i < tiles.length; i++) {
      assert.ok(tiles[i].distM >= tiles[i - 1].distM, 'sorted by distance');
    }
    const width = tileWidthM(SF.lat, 17);
    for (const t of tiles) {
      assert.ok(t.distM <= radiusM + width, 'no tile far outside the radius');
      assert.strictEqual(t.key, tileKey(17, t.x, t.y));
    }
    // A circular selection is smaller than the bounding square.
    const span = 2 * Math.ceil(radiusM / width) + 1;
    assert.ok(tiles.length < span * span);
  });
});
