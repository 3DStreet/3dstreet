/* global describe, it */

/**
 * MVT building features → Overpass-shaped elements (#1962 step F data
 * source swap). Covers height/min-height mapping, the hide_3d filter,
 * polygon vs. multipolygon element shapes, and that the output feeds
 * buildTileGeometry unchanged.
 */

import assert from 'assert';
import { featuresToElements } from '../../src/tested/vector-tile-buildings.js';
import { buildTileGeometry } from '../../src/tested/osm-building-geometry.js';

const ORIGIN = { originLat: 37.7952, originLon: -122.3937 };
const d = 5e-5;
const square = (cx, cy, r = d) => [
  [cx - r, cy - r],
  [cx + r, cy - r],
  [cx + r, cy + r],
  [cx - r, cy + r],
  [cx - r, cy - r]
];
const feature = (geometry, properties = {}) => ({
  type: 'Feature',
  geometry,
  properties
});
const polygon = (rings, properties) =>
  feature({ type: 'Polygon', coordinates: rings }, properties);

describe('featuresToElements', () => {
  it('maps a simple polygon to a closed way with height tags', () => {
    const [el] = featuresToElements([
      polygon([square(ORIGIN.originLon, ORIGIN.originLat)], {
        render_height: 12,
        render_min_height: 0,
        class: 'residential'
      })
    ]);
    assert.strictEqual(el.type, 'way');
    assert.strictEqual(el.geometry.length, 5);
    assert.deepStrictEqual(el.geometry[0], {
      lat: ORIGIN.originLat - d,
      lon: ORIGIN.originLon - d
    });
    assert.deepStrictEqual(el.tags, {
      building: 'residential',
      height: 12
    });
  });

  it('maps min height and falls back to building=yes', () => {
    const [el] = featuresToElements([
      polygon([square(0, 0)], { render_height: 30, render_min_height: 10 })
    ]);
    assert.deepStrictEqual(el.tags, {
      building: 'yes',
      height: 30,
      min_height: 10
    });
  });

  it('honors provider-specific height keys', () => {
    const [el] = featuresToElements(
      [polygon([square(0, 0)], { height: 7, min_height: 2 })],
      { heightKeys: ['height'], minHeightKeys: ['min_height'] }
    );
    assert.strictEqual(el.tags.height, 7);
    assert.strictEqual(el.tags.min_height, 2);
  });

  it('omits height when absent so the perimeter heuristic applies', () => {
    const [el] = featuresToElements([polygon([square(0, 0)], {})]);
    assert.strictEqual(el.tags.height, undefined);
  });

  it('drops hide_3d outlines (their parts ship separately)', () => {
    const elements = featuresToElements([
      polygon([square(0, 0)], { hide_3d: true }),
      polygon([square(0, 0.01)], { hide_3d: 'true' }),
      polygon([square(0, 0.02)], { render_height: 5 })
    ]);
    assert.strictEqual(elements.length, 1);
  });

  it('turns polygons with holes into multipolygon relations', () => {
    const [el] = featuresToElements([
      polygon([square(0, 0, 1e-3), square(0, 0, 2e-4)], { render_height: 9 })
    ]);
    assert.strictEqual(el.type, 'relation');
    assert.strictEqual(el.tags.type, 'multipolygon');
    assert.deepStrictEqual(
      el.members.map((m) => m.role),
      ['outer', 'inner']
    );
  });

  it('splits a MultiPolygon into one element per polygon', () => {
    const elements = featuresToElements([
      feature(
        {
          type: 'MultiPolygon',
          coordinates: [[square(0, 0)], [square(0.01, 0)]]
        },
        { render_height: 4 }
      )
    ]);
    assert.strictEqual(elements.length, 2);
    assert.notStrictEqual(elements[0].id, elements[1].id);
  });

  it('skips degenerate rings and non-polygon geometry', () => {
    const elements = featuresToElements([
      polygon(
        [
          [
            [0, 0],
            [1, 1],
            [0, 0]
          ]
        ],
        {}
      ),
      feature({ type: 'Point', coordinates: [0, 0] }, {}),
      feature(null, {})
    ]);
    assert.deepStrictEqual(elements, []);
  });

  it('feeds buildTileGeometry: extrudes to the tile height', () => {
    const elements = featuresToElements([
      polygon([square(ORIGIN.originLon, ORIGIN.originLat)], {
        render_height: 15
      })
    ]);
    const { positions, buildingCount } = buildTileGeometry(elements, {
      ...ORIGIN,
      tileBBox: null
    });
    assert.strictEqual(buildingCount, 1);
    let maxY = -Infinity;
    for (let i = 1; i < positions.length; i += 3) {
      maxY = Math.max(maxY, positions[i]);
    }
    assert.strictEqual(maxY, 15);
  });
});
