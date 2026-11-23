/* global describe, it */

/**
 * Geospatial Data Source registry and the terrain-grid layer model (#2090).
 */

import assert from 'assert';
import {
  GEO_DATA_SOURCES,
  validateDataSource,
  getDataSource,
  sourcesForLocation
} from '../../src/tested/geo-data-sources.js';
import {
  getTerrainGridFormat,
  crsToCell,
  cellToCrs,
  sampleHeight,
  gridContains,
  gridWindow,
  strideForWindow,
  resolveVerticalAnchor,
  buildGridSurface,
  buildLineRibbons,
  waterBodiesInWindow,
  buildClassTexture
} from '../../src/tested/terrain-grid.js';

// A 4 × 3 grid of 10 m cells in UTM 10N whose height is 100 + col + 10·row.
function syntheticMeta() {
  return {
    width: 4,
    height: 3,
    cell_m: 10,
    min_m: 0,
    max_m: 65535 / 100, // 0.01 m per step
    crs: 'EPSG:32610',
    west: 550000,
    south: 4180000,
    east: 550040,
    north: 4180030,
    heights_file: 'heightmap.u16',
    heights_format: 'uint16-le',
    water_level_m: 0.6,
    habitat_file: 'habitat.u8',
    habitat_classes: [
      { id: 0, name: 'Unmapped', group: 'unmapped' },
      { id: 1, name: 'Bay', group: 'water' },
      { id: 2, name: 'Oak woodland', group: 'woodland' }
    ],
    shade: { file: 'shade.u8', cols: 2, rows: 2, stride: 2 },
    ponds_file: 'ponds.json',
    creeks_file: 'creeks.json',
    layers: [
      {
        id: 'terrain',
        source: 'test',
        confidence: 'inferred',
        attribution: 'x',
        extra: 1
      }
    ]
  };
}

function syntheticFiles(meta) {
  const heights = new ArrayBuffer(meta.width * meta.height * 2);
  const view = new DataView(heights);
  for (let r = 0; r < meta.height; r++) {
    for (let c = 0; c < meta.width; c++) {
      const metres = 100 + c + 10 * r;
      view.setUint16((r * meta.width + c) * 2, metres * 100, true);
    }
  }
  const classes = new Uint8Array([1, 1, 2, 2, 1, 2, 2, 2, 0, 2, 2, 2]).buffer;
  const shade = new Uint8Array([255, 128, 255, 255]).buffer;
  return {
    heights,
    classes,
    shade,
    // Local frame: metres from the centre, x east, z south. Grid centre is
    // (550020, 4180015).
    ponds: {
      ponds: [
        {
          id: 'p1',
          name: null,
          level_m: 3.5,
          confidence: 'inferred',
          rings: [[-5, -5, 5, -5, 5, 5]]
        },
        { id: 'far', level_m: 1, rings: [[5000, 5000, 5010, 5000, 5010, 5010]] }
      ]
    },
    creeks: {
      mapped: [
        {
          id: 'c1',
          name: 'Test Creek',
          confidence: 'documented',
          points: [-15, 0, 15, 0]
        }
      ],
      modelled: [{ id: 'm1', points: [0, -10, 0, 10] }]
    }
  };
}

function parseSynthetic() {
  const meta = syntheticMeta();
  const adapter = getTerrainGridFormat('yelamu-real-city@1');
  return adapter.parse(meta, syntheticFiles(meta));
}

describe('geo-data-sources', () => {
  it('every registry entry is valid', () => {
    const problems = GEO_DATA_SOURCES.flatMap(validateDataSource);
    assert.deepStrictEqual(problems, []);
    const ids = GEO_DATA_SOURCES.map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'ids are unique');
  });

  it('every source pins its data to a version', () => {
    for (const source of GEO_DATA_SOURCES) {
      assert.ok(
        source.baseUrl.includes(source.version),
        `${source.id}: baseUrl should contain version ${source.version}`
      );
    }
  });

  it('reports invalid descriptors', () => {
    const problems = validateDataSource({
      id: 'Bad_ID',
      kind: 'mystery',
      coverage: { west: 10, east: 5, south: 0, north: 1 },
      baseUrl: 'https://example.com/data'
    });
    for (const expected of [
      /missing name/,
      /id must be lowercase/,
      /unknown kind/,
      /coverage must be/,
      /baseUrl must end with/
    ]) {
      assert.ok(
        problems.some((p) => expected.test(p)),
        `expected a problem matching ${expected}: ${problems.join('; ')}`
      );
    }
  });

  it('finds Yelamu in San Francisco and nothing in Oakland', () => {
    const sf = sourcesForLocation(-122.4193, 37.7793).map((s) => s.id);
    assert.ok(sf.includes('yelamu-1769'));
    assert.deepStrictEqual(sourcesForLocation(-122.2711, 37.8044), []);
    assert.deepStrictEqual(sourcesForLocation(NaN, 37.7793), []);
    assert.strictEqual(getDataSource('nope'), null);
  });

  it('keeps culturally sensitive features opt-in', () => {
    assert.deepStrictEqual(getDataSource('yelamu-1769').optInFeatures, [
      'villages'
    ]);
  });
});

describe('terrain-grid', () => {
  describe('yelamu-real-city@1 adapter', () => {
    it('lists the files meta.json names', () => {
      const files =
        getTerrainGridFormat('yelamu-real-city@1').files(syntheticMeta());
      assert.deepStrictEqual(files, {
        heights: ['heightmap.u16', 'arraybuffer'],
        classes: ['habitat.u8', 'arraybuffer'],
        shade: ['shade.u8', 'arraybuffer'],
        ponds: ['ponds.json', 'json'],
        creeks: ['creeks.json', 'json']
      });
    });

    it('decodes uint16 heights over [min_m, max_m]', () => {
      const grid = parseSynthetic();
      assert.strictEqual(grid.cols, 4);
      assert.strictEqual(grid.rows, 3);
      assert.ok(Math.abs(grid.heights[0] - 100) < 1e-4);
      assert.ok(Math.abs(grid.heights[2 * 4 + 3] - 123) < 1e-4);
      assert.strictEqual(grid.classes[1], 1);
      assert.strictEqual(grid.shade.stride, 2);
      assert.strictEqual(grid.waterLevelM, 0.6);
      // Provenance keeps only the documented fields.
      assert.deepStrictEqual(Object.keys(grid.layers[0]).sort(), [
        'attribution',
        'confidence',
        'id',
        'source'
      ]);
    });

    it('moves ponds and creeks from the local frame into the CRS', () => {
      const grid = parseSynthetic();
      // Local (-5, -5) is 5 m west and 5 m north of the centre.
      assert.deepStrictEqual(
        grid.waterBodies[0].rings[0].slice(0, 2),
        [550015, 4180020]
      );
      assert.strictEqual(grid.waterBodies[0].levelM, 3.5);
      assert.deepStrictEqual(
        grid.lines.map((l) => [l.id, l.kind, l.name]),
        [
          ['c1', 'creek', 'Test Creek'],
          ['m1', 'modelled-stream', null]
        ]
      );
      assert.deepStrictEqual(
        grid.lines[0].points,
        [550005, 4180015, 550035, 4180015]
      );
    });

    it('rejects a height file of the wrong size', () => {
      const meta = syntheticMeta();
      const files = syntheticFiles(meta);
      files.heights = new ArrayBuffer(10);
      assert.throws(
        () => getTerrainGridFormat('yelamu-real-city@1').parse(meta, files),
        /expected 24/
      );
      assert.throws(() => getTerrainGridFormat('cog@1'), /Unknown/);
    });
  });

  describe('sampling and windows', () => {
    it('maps cell centres to the CRS and back', () => {
      const grid = parseSynthetic();
      assert.deepStrictEqual(cellToCrs(grid, 0, 0), [550005, 4180025]);
      assert.deepStrictEqual(crsToCell(grid, 550015, 4180015), [1, 1]);
      assert.ok(gridContains(grid, 550000, 4180000));
      assert.ok(!gridContains(grid, 549990, 4180000));
    });

    it('samples heights bilinearly and clamps at the edge', () => {
      const grid = parseSynthetic();
      // Between cells (1,1)=111 and (2,1)=112.
      assert.ok(Math.abs(sampleHeight(grid, 550020, 4180015) - 111.5) < 1e-3);
      // Far outside the north-west corner clamps to cell (0,0).
      assert.ok(Math.abs(sampleHeight(grid, 0, 1e7) - 100) < 1e-3);
    });

    it('clamps a window to the grid and misses when out of range', () => {
      const grid = parseSynthetic();
      assert.deepStrictEqual(gridWindow(grid, 550020, 4180015, 1000), {
        c0: 0,
        r0: 0,
        c1: 3,
        r1: 2
      });
      assert.deepStrictEqual(gridWindow(grid, 550005, 4180025, 10), {
        c0: 0,
        r0: 0,
        c1: 1,
        r1: 1
      });
      assert.strictEqual(gridWindow(grid, 600000, 4180015, 100), null);
    });

    it('picks a stride that caps vertices per side', () => {
      const win = { c0: 0, r0: 0, c1: 599, r1: 399 };
      assert.strictEqual(strideForWindow(win, 256), 3);
      assert.strictEqual(strideForWindow(win, 1000), 1);
    });
  });

  describe('vertical anchor', () => {
    it('uses street-geo elevation once activated', () => {
      assert.deepStrictEqual(
        resolveVerticalAnchor(
          {
            ellipsoidalHeight: -20,
            geoidHeight: -32.5,
            orthometricHeight: 12.5
          },
          50
        ),
        { mode: 'geo', frameEllipsoidalHeight: -20, geoidHeight: -32.5 }
      );
      // Geoid derived from the pair when only it is missing.
      assert.strictEqual(
        resolveVerticalAnchor(
          { ellipsoidalHeight: -20, geoidHeight: null, orthometricHeight: 12 },
          50
        ).geoidHeight,
        -32
      );
    });

    it('anchors to its own ground before activation', () => {
      assert.deepStrictEqual(
        resolveVerticalAnchor({ ellipsoidalHeight: null }, 42),
        { mode: 'self', frameEllipsoidalHeight: 42, geoidHeight: 0 }
      );
    });
  });

  describe('geometry', () => {
    // Plain local map: x = north offset, z = east offset, y = height.
    const toScene = (x, y, h) => [y - 4180015, h, x - 550020];

    it('builds an upward-facing grid surface with full-window UVs', () => {
      const grid = parseSynthetic();
      const win = { c0: 0, r0: 0, c1: 3, r1: 2 };
      const s = buildGridSurface(grid, win, toScene);
      assert.strictEqual(s.cols, 4);
      assert.strictEqual(s.rows, 3);
      assert.strictEqual(s.indices.length, 3 * 2 * 6);
      // First vertex: cell (0,0) = 10 m north, 15 m west, height 100.
      assert.deepStrictEqual(
        Array.from(s.positions.slice(0, 3)),
        [10, 100, -15]
      );
      // Every triangle faces +Y.
      const P = s.positions;
      for (let i = 0; i < s.indices.length; i += 3) {
        const [a, b, c] = [s.indices[i], s.indices[i + 1], s.indices[i + 2]];
        const ux = P[b * 3] - P[a * 3];
        const uz = P[b * 3 + 2] - P[a * 3 + 2];
        const vx = P[c * 3] - P[a * 3];
        const vz = P[c * 3 + 2] - P[a * 3 + 2];
        assert.ok(uz * vx - ux * vz > 0, `triangle ${i / 3} faces up`);
      }
      assert.strictEqual(s.uvs[0], 0.5 / 4);
      assert.ok(Math.abs(s.uvs[1] - 0.5 / 3) < 1e-6);
    });

    it('strides vertices but always includes the window edge', () => {
      const grid = parseSynthetic();
      const s = buildGridSurface(
        grid,
        { c0: 0, r0: 0, c1: 3, r1: 2 },
        toScene,
        {
          stride: 2,
          heightAt: () => 0.6
        }
      );
      assert.strictEqual(s.cols, 3); // 0, 2, 3
      assert.strictEqual(s.rows, 2); // 0, 2
      assert.ok(
        Array.from(s.positions).every(
          (v, i) => i % 3 !== 1 || Math.abs(v - 0.6) < 1e-6
        )
      );
    });

    it('drapes creek ribbons on the terrain, clipped to the window', () => {
      const grid = parseSynthetic();
      const win = { c0: 0, r0: 0, c1: 3, r1: 2 };
      const r = buildLineRibbons(grid, win, [grid.lines[0]], toScene, {
        widthM: 2,
        liftM: 0.5
      });
      assert.strictEqual(r.positions.length, 4 * 3);
      assert.strictEqual(r.indices.length, 6);
      // West end at (550005, 4180015) is cell (0, 1): height 110 + lift;
      // heading east, so the strip spans ±1 m north/south.
      assert.deepStrictEqual(
        Array.from(r.positions.slice(0, 6)),
        [-1, 110.5, -15, 1, 110.5, -15]
      );
      const outside = buildLineRibbons(
        grid,
        win,
        [{ points: [600000, 4180015, 600010, 4180015] }],
        toScene
      );
      assert.strictEqual(outside.positions.length, 0);
    });

    it('keeps only water bodies that reach the window', () => {
      const grid = parseSynthetic();
      const win = { c0: 0, r0: 0, c1: 3, r1: 2 };
      assert.deepStrictEqual(
        waterBodiesInWindow(grid, win, grid.waterBodies).map((b) => b.id),
        ['p1']
      );
    });
  });

  describe('class texture', () => {
    it('colours cells by class group and applies the shade', () => {
      const grid = parseSynthetic();
      const tex = buildClassTexture(
        grid,
        { c0: 0, r0: 0, c1: 3, r1: 2 },
        {
          water: '#0000ff',
          woodland: '#00ff00',
          unmapped: '#808080'
        }
      );
      assert.strictEqual(tex.width, 4);
      assert.strictEqual(tex.height, 3);
      // Cell (0,0): water, shade 255.
      assert.deepStrictEqual(
        Array.from(tex.data.slice(0, 4)),
        [0, 0, 255, 255]
      );
      // Cell (2,0): woodland, shade cell (1,0) = 128.
      assert.deepStrictEqual(
        Array.from(tex.data.slice(8, 12)),
        [0, 128, 0, 255]
      );
      // Cell (0,2): unmapped class 0.
      assert.deepStrictEqual(
        Array.from(tex.data.slice(32, 36)),
        [128, 128, 128, 255]
      );
    });
  });
});
