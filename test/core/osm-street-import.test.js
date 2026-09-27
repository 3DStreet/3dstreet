/* global describe, it */

/**
 * OSM way → managed street import math (#1930 click-to-upgrade): the
 * flat projection, nearest-way lookup, chord splitting, and Format-2
 * presets. The presets' compatibility with the real managed-street
 * component is covered separately in
 * test/components/osm-street-upgrade.test.js.
 */

import assert from 'assert';
import { crossSectionFromTags } from '../../src/tested/osm-way-tags.js';
import {
  clipStretchToUncovered,
  trimStretchEndsAtWays,
  decodeStretchPoints,
  eastMPerDeg,
  encodeStretchPoints,
  importedCarriagewayMeters,
  importedWidthMeters,
  latLonToLocal,
  localPolylineFromLatLon,
  nearestWay,
  pointToSegment,
  junctionsAlongStretch,
  simplifyPolyline,
  splitStretchAtJunctions,
  splitWayIntoChords,
  stretchForWindow,
  streetJsonForClass,
  streetJsonForWay,
  NORTH_M_PER_DEG
} from '../../src/tested/osm-street-import.js';

const ORIGIN = { lat: 37.7876, lon: -122.4008 };

describe('latLonToLocal', () => {
  it('maps the origin to 0,0 and north/east to +x/+z', () => {
    assert.deepStrictEqual(latLonToLocal(ORIGIN, ORIGIN), { x: 0, z: 0 });
    const north = latLonToLocal(ORIGIN, {
      lat: ORIGIN.lat + 0.001,
      lon: ORIGIN.lon
    });
    assert.ok(Math.abs(north.x - 0.001 * NORTH_M_PER_DEG) < 1e-9);
    assert.strictEqual(north.z, 0);
    const east = latLonToLocal(ORIGIN, {
      lat: ORIGIN.lat,
      lon: ORIGIN.lon + 0.001
    });
    assert.ok(Math.abs(east.z - 0.001 * eastMPerDeg(ORIGIN.lat)) < 1e-9);
  });

  it('converts polylines pointwise', () => {
    const line = localPolylineFromLatLon(ORIGIN, [
      ORIGIN,
      { lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon }
    ]);
    assert.strictEqual(line.length, 2);
    assert.strictEqual(line[0].x, 0);
    assert.ok(line[1].x > 100); // ~111 m per 0.001°
  });
});

describe('pointToSegment / nearestWay', () => {
  const way = (id, polylines, cls = 'minor') => ({
    wayId: id,
    class: cls,
    polylines
  });

  it('finds the closest way and reports the closest point', () => {
    const ways = [
      way('a', [
        [
          { x: 0, z: 0 },
          { x: 100, z: 0 }
        ]
      ]),
      way('b', [
        [
          { x: 0, z: 50 },
          { x: 100, z: 50 }
        ]
      ])
    ];
    const hit = nearestWay(ways, { x: 50, z: 10 }, 30);
    assert.strictEqual(hit.way.wayId, 'a');
    assert.ok(Math.abs(hit.distance - 10) < 1e-9);
    assert.deepStrictEqual(hit.point, { x: 50, z: 0 });
  });

  it('returns null beyond maxDist', () => {
    const ways = [
      way('a', [
        [
          { x: 0, z: 0 },
          { x: 100, z: 0 }
        ]
      ])
    ];
    assert.strictEqual(nearestWay(ways, { x: 50, z: 40 }, 30), null);
  });

  it('clamps to segment endpoints', () => {
    const hit = pointToSegment(
      { x: -10, z: 5 },
      { x: 0, z: 0 },
      { x: 100, z: 0 }
    );
    assert.deepStrictEqual(hit.point, { x: 0, z: 0 });
    assert.strictEqual(hit.t, 0);
  });
});

describe('simplifyPolyline / splitWayIntoChords', () => {
  it('keeps a straight line as one chord', () => {
    const chords = splitWayIntoChords([
      { x: 0, z: 0 },
      { x: 0, z: 30 },
      { x: 0, z: 60 },
      { x: 0, z: 90 }
    ]);
    assert.strictEqual(chords.length, 1);
    assert.strictEqual(chords[0].length, 90);
    assert.deepStrictEqual(chords[0].midpoint, { x: 0, z: 45 });
    // +z (east) chord → bearing 0 (street local +Z points east at yaw 0).
    assert.strictEqual(chords[0].bearingDeg, 0);
  });

  it('splits at a real corner and computes bearings', () => {
    const chords = splitWayIntoChords([
      { x: 0, z: 0 },
      { x: 0, z: 50 },
      { x: 50, z: 50 }
    ]);
    assert.strictEqual(chords.length, 2);
    assert.strictEqual(chords[0].bearingDeg, 0);
    assert.strictEqual(chords[1].bearingDeg, 90); // due north
  });

  it('tolerates gentle curves within maxDeviation', () => {
    const chords = splitWayIntoChords(
      [
        { x: 0, z: 0 },
        { x: 1, z: 40 },
        { x: 0, z: 80 }
      ],
      { maxDeviationM: 1.5, minLengthM: 20 }
    );
    assert.strictEqual(chords.length, 1);
  });

  it('drops chords shorter than minLength', () => {
    const chords = splitWayIntoChords(
      [
        { x: 0, z: 0 },
        { x: 0, z: 10 },
        { x: 30, z: 10 }
      ],
      { maxDeviationM: 0.5, minLengthM: 20 }
    );
    assert.strictEqual(chords.length, 1);
    assert.strictEqual(chords[0].length, 30);
  });

  it('simplifyPolyline preserves endpoints', () => {
    const pts = [
      { x: 0, z: 0 },
      { x: 0.1, z: 10 },
      { x: 0, z: 20 }
    ];
    const out = simplifyPolyline(pts, 1);
    assert.deepStrictEqual(out[0], pts[0]);
    assert.deepStrictEqual(out[out.length - 1], pts[2]);
    assert.strictEqual(out.length, 2);
  });
});

describe('stretchForWindow', () => {
  // A straight +z line, 1000 m in 100 m hops.
  const longLine = Array.from({ length: 11 }, (_, i) => ({
    x: 0,
    z: i * 100
  }));

  it('clips a long way to ±window around the click by arc length', () => {
    const stretch = stretchForWindow([longLine], { x: 5, z: 500 });
    assert.ok(stretch);
    assert.strictEqual(stretch.lengthM, 400);
    // Straight line → simplified to just the interpolated boundary points.
    assert.strictEqual(stretch.points.length, 2);
    assert.deepStrictEqual(stretch.points[0], { x: 0, z: 300 });
    assert.deepStrictEqual(stretch.points[1], { x: 0, z: 700 });
  });

  it('keeps interior corner vertices as control points', () => {
    const bend = [
      { x: 0, z: 0 },
      { x: 0, z: 100 },
      { x: 100, z: 100 }
    ];
    const stretch = stretchForWindow([bend], { x: 0, z: 100 });
    assert.ok(stretch);
    assert.strictEqual(stretch.points.length, 3);
    assert.deepStrictEqual(stretch.points[1], { x: 0, z: 100 });
    assert.strictEqual(stretch.lengthM, 200);
  });

  it('clamps the window at the way ends', () => {
    const stretch = stretchForWindow([longLine], { x: 0, z: 50 });
    assert.ok(stretch);
    assert.deepStrictEqual(stretch.points[0], { x: 0, z: 0 });
    assert.deepStrictEqual(stretch.points[1], { x: 0, z: 250 });
    assert.strictEqual(stretch.lengthM, 250);
  });

  it('null nearPoint anchors the window at the way start', () => {
    const stretch = stretchForWindow([longLine], null);
    assert.ok(stretch);
    assert.deepStrictEqual(stretch.points[0], { x: 0, z: 0 });
    assert.deepStrictEqual(stretch.points[1], { x: 0, z: 200 });
  });

  it('picks the polyline nearest the click on multi-line ways', () => {
    const other = [
      { x: 500, z: 0 },
      { x: 500, z: 100 }
    ];
    const stretch = stretchForWindow([longLine, other], { x: 498, z: 50 });
    assert.ok(stretch);
    assert.strictEqual(stretch.points[0].x, 500);
    assert.strictEqual(stretch.lengthM, 100);
  });

  it('returns null for stretches shorter than minLength', () => {
    const stub = [
      { x: 0, z: 0 },
      { x: 0, z: 10 }
    ];
    assert.strictEqual(stretchForWindow([stub], { x: 0, z: 5 }), null);
    assert.strictEqual(stretchForWindow([], { x: 0, z: 0 }), null);
    assert.strictEqual(stretchForWindow(null, null), null);
  });

  it('honors custom window and deviation options', () => {
    const stretch = stretchForWindow(
      [longLine],
      { x: 0, z: 500 },
      { windowM: 50 }
    );
    assert.ok(stretch);
    assert.strictEqual(stretch.lengthM, 100);
    assert.deepStrictEqual(stretch.points[0], { x: 0, z: 450 });
    assert.deepStrictEqual(stretch.points[1], { x: 0, z: 550 });
  });
});

describe('junctionsAlongStretch', () => {
  // A straight +z stretch, 400 m.
  const stretch = [
    { x: 0, z: 0 },
    { x: 0, z: 400 }
  ];

  it('finds a proper crossing (X junction)', () => {
    const crosser = {
      class: 'minor',
      polylines: [
        [
          { x: -50, z: 200 },
          { x: 50, z: 200 }
        ]
      ]
    };
    const junctions = junctionsAlongStretch(stretch, [crosser]);
    assert.strictEqual(junctions.length, 1);
    assert.strictEqual(junctions[0].s, 200);
    assert.deepStrictEqual(junctions[0].point, { x: 0, z: 200 });
    assert.ok(junctions[0].crossWidthM > 0);
  });

  it('finds an endpoint touch (T junction) within tolerance', () => {
    const tee = {
      class: 'service',
      polylines: [
        [
          { x: 60, z: 300 },
          { x: 1.5, z: 300 } // ends 1.5 m short of the stretch
        ]
      ]
    };
    const junctions = junctionsAlongStretch(stretch, [tee], {
      toleranceM: 2
    });
    assert.strictEqual(junctions.length, 1);
    assert.ok(Math.abs(junctions[0].s - 300) < 1e-9);
  });

  it('ignores a parallel way that never touches', () => {
    const parallel = {
      class: 'minor',
      polylines: [
        [
          { x: 10, z: 0 },
          { x: 10, z: 400 }
        ]
      ]
    };
    assert.deepStrictEqual(junctionsAlongStretch(stretch, [parallel]), []);
  });

  it('merges nearby duplicates, keeping the widest crossing', () => {
    const wide = {
      class: 'primary',
      polylines: [
        [
          { x: -50, z: 200 },
          { x: 50, z: 200 }
        ]
      ]
    };
    const narrowTwin = {
      class: 'service',
      polylines: [
        [
          { x: -50, z: 205 },
          { x: 50, z: 205 }
        ]
      ]
    };
    const junctions = junctionsAlongStretch(stretch, [wide, narrowTwin]);
    assert.strictEqual(junctions.length, 1);
    assert.strictEqual(
      junctions[0].crossWidthM,
      junctionsAlongStretch(stretch, [wide])[0].crossWidthM
    );
  });

  it('drops junctions within the end clearance (way-fragment continuations)', () => {
    // A same-road fragment continues exactly at the stretch's end — its
    // endpoint touch must not read as a T junction.
    const continuation = {
      class: 'secondary',
      polylines: [
        [
          { x: 0, z: 400 },
          { x: 0, z: 600 }
        ]
      ]
    };
    assert.deepStrictEqual(junctionsAlongStretch(stretch, [continuation]), []);
    // A real crossing just inside the window edge is dropped too — its
    // far-side piece could never survive the inset.
    const edgeCross = {
      class: 'minor',
      polylines: [
        [
          { x: -50, z: 5 },
          { x: 50, z: 5 }
        ]
      ]
    };
    assert.deepStrictEqual(junctionsAlongStretch(stretch, [edgeCross]), []);
  });

  it('reports several separated junctions in arc-length order', () => {
    const crossAt = (z) => ({
      class: 'minor',
      polylines: [
        [
          { x: -50, z },
          { x: 50, z }
        ]
      ]
    });
    const junctions = junctionsAlongStretch(stretch, [
      crossAt(300),
      crossAt(100)
    ]);
    assert.deepStrictEqual(
      junctions.map((j) => j.s),
      [100, 300]
    );
  });
});

describe('splitStretchAtJunctions', () => {
  const stretch = [
    { x: 0, z: 0 },
    { x: 0, z: 400 }
  ];

  it('keeps the whole stretch as one piece with no junctions', () => {
    const { pieces, junctions } = splitStretchAtJunctions(stretch, []);
    assert.strictEqual(pieces.length, 1);
    assert.strictEqual(pieces[0].lengthM, 400);
    assert.deepStrictEqual(junctions, []);
  });

  it('splits around a junction with a width-derived inset', () => {
    const j = { s: 200, point: { x: 0, z: 200 }, crossWidthM: 10 };
    const { pieces, junctions } = splitStretchAtJunctions(stretch, [j], {
      insetPadM: 4
    });
    // Inset = 10/2 + 4 = 9 m each side of s=200.
    assert.strictEqual(pieces.length, 2);
    assert.deepStrictEqual(pieces[0].points[1], { x: 0, z: 191 });
    assert.deepStrictEqual(pieces[1].points[0], { x: 0, z: 209 });
    assert.strictEqual(pieces[0].lengthM, 191);
    assert.strictEqual(pieces[1].lengthM, 191);
    assert.strictEqual(junctions[0].adjacentPieces, 2);
  });

  it('drops slivers and reports fewer adjacent pieces', () => {
    // Junction near the end: the far side is a 6 m sliver.
    const j = { s: 385, point: { x: 0, z: 385 }, crossWidthM: 10 };
    const { pieces, junctions } = splitStretchAtJunctions(stretch, [j], {
      insetPadM: 4,
      minLengthM: 20
    });
    assert.strictEqual(pieces.length, 1);
    assert.strictEqual(junctions[0].adjacentPieces, 1);
  });

  it('merges overlapping cuts from close junctions into ONE junction', () => {
    // An offset dual-carriageway crossing: two junction records 13 m
    // apart must yield a single intersection, not two starved ones.
    const jA = { s: 195, point: { x: 0, z: 195 }, crossWidthM: 10 };
    const jB = { s: 208, point: { x: 0, z: 208 }, crossWidthM: 10 };
    const { pieces, junctions } = splitStretchAtJunctions(stretch, [jA, jB], {
      insetPadM: 4
    });
    assert.strictEqual(pieces.length, 2);
    assert.deepStrictEqual(pieces[0].points[1], { x: 0, z: 186 });
    assert.deepStrictEqual(pieces[1].points[0], { x: 0, z: 217 });
    // One merged cut [186, 217] → one junction at its center, with a
    // cut half-span the minted intersection's snap radius must cover.
    assert.strictEqual(junctions.length, 1);
    assert.strictEqual(junctions[0].adjacentPieces, 2);
    assert.deepStrictEqual(junctions[0].point, { x: 0, z: 201.5 });
    assert.strictEqual(junctions[0].cutHalfM, 15.5);
  });
});

describe('streetJsonForClass', () => {
  it('emits Format-2 with summed width and rounded length', () => {
    const json = streetJsonForClass('minor', 87.6543, 'Test St');
    assert.strictEqual(json.name, 'Test St');
    assert.strictEqual(json.length, 87.65);
    assert.ok(Array.isArray(json.segments) && json.segments.length > 0);
    const sum = json.segments.reduce((s, seg) => s + seg.width, 0);
    assert.ok(Math.abs(json.width - sum) < 1e-9);
  });

  it('gives arterials more lanes than service roads', () => {
    const arterial = streetJsonForClass('primary', 60);
    const service = streetJsonForClass('service', 60);
    const driveLanes = (j) =>
      j.segments.filter((s) => s.type === 'drive-lane').length;
    assert.ok(driveLanes(arterial) > driveLanes(service));
    assert.ok(arterial.width > service.width);
  });

  it('falls back to the residential preset for unknown classes', () => {
    const json = streetJsonForClass('mystery', 60);
    assert.ok(json.segments.some((s) => s.type === 'sidewalk'));
    assert.ok(json.segments.some((s) => s.type === 'drive-lane'));
  });

  it('every segment carries the fields parseStreetObject expects', () => {
    for (const cls of ['minor', 'primary', 'service', 'pedestrian']) {
      for (const seg of streetJsonForClass(cls, 60).segments) {
        assert.strictEqual(typeof seg.type, 'string', cls);
        assert.strictEqual(typeof seg.width, 'number', cls);
        assert.strictEqual(typeof seg.direction, 'string', cls);
        assert.strictEqual(typeof seg.surface, 'string', cls);
      }
    }
  });
});

describe('streetJsonForWay', () => {
  const driveLanes = (j) => j.segments.filter((s) => s.type === 'drive-lane');
  const types = (j) => j.segments.map((s) => s.type);

  it('puts every lane in the way direction on a one-way street', () => {
    const fwd = streetJsonForWay({ class: 'minor', oneway: 1 }, 60);
    assert.ok(driveLanes(fwd).every((s) => s.direction === 'inbound'));
    const back = streetJsonForWay({ class: 'primary', oneway: -1 }, 60);
    assert.ok(driveLanes(back).length >= 2);
    assert.ok(driveLanes(back).every((s) => s.direction === 'outbound'));
    assert.ok(!types(back).includes('divider'));
  });

  it('scales lane count with class', () => {
    const n = (cls) => driveLanes(streetJsonForWay({ class: cls }, 60)).length;
    assert.ok(n('motorway') > n('primary'));
    assert.ok(n('primary') > n('minor'));
    assert.strictEqual(n('minor'), 2);
  });

  it('gives residential streets parking but not unclassified ones', () => {
    const res = streetJsonForWay(
      { class: 'minor', subclass: 'residential' },
      60
    );
    const uncl = streetJsonForWay(
      { class: 'minor', subclass: 'unclassified' },
      60
    );
    assert.ok(types(res).includes('parking-lane'));
    assert.ok(!types(uncl).includes('parking-lane'));
    assert.ok(types(uncl).includes('sidewalk'));
  });

  it('maps cycleways to bike lanes and footways to sidewalks', () => {
    const cycle = streetJsonForWay({ class: 'path', subclass: 'cycleway' }, 60);
    assert.ok(types(cycle).every((t) => t === 'bike-lane'));
    const foot = streetJsonForWay({ class: 'path', subclass: 'footway' }, 60);
    assert.deepStrictEqual(types(foot), ['sidewalk']);
  });

  it('keeps motorways free of sidewalks and parking', () => {
    const t = types(streetJsonForWay({ class: 'motorway' }, 60));
    assert.ok(!t.includes('sidewalk') && !t.includes('parking-lane'));
    assert.ok(t.includes('divider'));
  });
});

describe('generation continuity (#2006)', () => {
  // A straight 400 m north-south test line at x=0.
  const line = (z0, z1, step = 10) => {
    const pts = [];
    const n = Math.round((z1 - z0) / step);
    for (let i = 0; i <= n; i++) pts.push({ x: 0, z: z0 + i * step });
    return pts;
  };

  describe('importedCarriagewayMeters', () => {
    it('excludes sidewalks from the crossing width', () => {
      const full = importedWidthMeters('minor');
      const carriageway = importedCarriagewayMeters('minor');
      assert.ok(carriageway < full);
      // residential: 2 × 3 m drive + 2 × 2.2 m parking = 10.4 m.
      assert.ok(Math.abs(carriageway - 10.4) < 1e-9);
    });

    it('junctionsAlongStretch reports carriageway widths', () => {
      const stretch = line(0, 400);
      const crosser = {
        class: 'minor',
        polylines: [
          [
            { x: -50, z: 200 },
            { x: 50, z: 200 }
          ]
        ]
      };
      const [j] = junctionsAlongStretch(stretch, [crosser]);
      assert.ok(Math.abs(j.crossWidthM - 10.4) < 1e-9);
    });
  });

  it('default inset pad is 2 m', () => {
    const stretch = line(0, 400);
    const j = { s: 200, point: { x: 0, z: 200 }, crossWidthM: 10 };
    const { pieces } = splitStretchAtJunctions(stretch, [j]);
    // Inset = 10/2 + 2 = 7 m each side of s=200.
    assert.strictEqual(pieces[0].points[pieces[0].points.length - 1].z, 193);
    assert.strictEqual(pieces[1].points[0].z, 207);
  });

  describe('clipStretchToUncovered', () => {
    it('passes through untouched with no coverage', () => {
      const pts = line(0, 100);
      assert.deepStrictEqual(clipStretchToUncovered(pts, []), pts);
    });

    it('returns null when fully covered', () => {
      const pts = line(0, 100);
      assert.strictEqual(clipStretchToUncovered(pts, [line(-20, 120)]), null);
    });

    it('keeps the longest uncovered run and snaps to the covered end', () => {
      // Coverage over the first 150 m; window runs 0–400 m.
      const covered = [line(0, 150)];
      const run = clipStretchToUncovered(line(0, 400), covered);
      assert.ok(run);
      // Boundary snapped exactly onto the covered stretch's endpoint.
      assert.deepStrictEqual(run[0], { x: 0, z: 150 });
      const end = run[run.length - 1];
      assert.ok(Math.abs(end.z - 400) < 1e-6);
    });

    it('drops a remainder below the minimum length', () => {
      const covered = [line(0, 390)];
      assert.strictEqual(
        clipStretchToUncovered(line(0, 400), covered, { minLengthM: 20 }),
        null
      );
    });

    it('ignores junction-cut-sized gaps between covered pieces', () => {
      // Two pieces with a 14 m cut gap between them: nothing to extend.
      const covered = [line(0, 193, 10.16), line(207, 400, 10.16)];
      assert.strictEqual(clipStretchToUncovered(line(0, 400), covered), null);
    });
  });

  it('stretchForWindow clips against coverage and re-derives length', () => {
    const polylines = [line(0, 400)];
    const covered = [line(0, 200)];
    const stretch = stretchForWindow(
      polylines,
      { x: 0, z: 200 },
      {
        windowM: 200,
        covered
      }
    );
    assert.ok(stretch);
    assert.strictEqual(stretch.points[0].z, 200); // snapped to covered end
    assert.ok(Math.abs(stretch.lengthM - 200) < 5);
    // Fully covered window → null.
    assert.strictEqual(
      stretchForWindow(
        polylines,
        { x: 0, z: 100 },
        {
          windowM: 90,
          covered: [line(0, 400)]
        }
      ),
      null
    );
  });

  it('encode/decode stretch points round-trips at dm precision', () => {
    const pts = [
      { x: 1.234, z: -5.678 },
      { x: 100, z: 200.05 }
    ];
    const decoded = decodeStretchPoints(encodeStretchPoints(pts));
    assert.deepStrictEqual(decoded, [
      { x: 1.2, z: -5.7 },
      { x: 100, z: 200.1 }
    ]);
    assert.strictEqual(decodeStretchPoints(''), null);
    assert.strictEqual(decodeStretchPoints('1,2;bogus'), null);
    assert.strictEqual(decodeStretchPoints('1,2'), null); // needs ≥2 points
  });
});

describe('rail and transit presets (#2004)', () => {
  it('generates heavy rail as a ballasted track between berms', () => {
    const json = streetJsonForClass('rail', 100, 'OSM rail');
    const t = json.segments.map((s) => s.type);
    assert.deepStrictEqual(t, ['grass', 'rail', 'grass']);
    // No residential fallback artifacts.
    assert.ok(!t.includes('drive-lane') && !t.includes('parking-lane'));
    const [left, track, right] = json.segments;
    assert.strictEqual(track.width, 3.6576); // 12 ft bed
    assert.strictEqual(track.elevation, 0.3048); // 1 ft ballast
    assert.deepStrictEqual(track.generated.rail, [{ gauge: 1435 }]);
    assert.strictEqual(track.variant, 'custom'); // no tram-clone preset
    // Berms ramp up to the bed and back down.
    assert.strictEqual(left.slopeStart, 0);
    assert.strictEqual(left.slopeEnd, 0.3048);
    assert.strictEqual(right.slopeStart, 0.3048);
    assert.strictEqual(right.slopeEnd, 0);
    assert.ok(Math.abs(json.width - 6.7056) < 1e-9);
  });

  it('generates transit as a single flush tram track', () => {
    const json = streetJsonForClass('transit', 50);
    assert.strictEqual(json.segments.length, 1);
    const [track] = json.segments;
    assert.strictEqual(track.type, 'rail');
    assert.strictEqual(track.elevation, 0);
    assert.strictEqual(track.surface, 'concrete');
    assert.deepStrictEqual(track.generated.rail, [{ gauge: 1435 }]);
  });

  it('crossSectionFromTags routes rail through the preset, not tags', () => {
    // A railway way has no highway tag; the tile class must win.
    const { segments } = crossSectionFromTags({}, { class: 'rail' });
    assert.deepStrictEqual(
      segments.map((s) => s.type),
      ['grass', 'rail', 'grass']
    );
  });
});

describe('T junctions: crossings cut, terminals do not (#2004 fix 2)', () => {
  const stretch = [
    { x: 0, z: 0 },
    { x: 0, z: 400 }
  ];
  const mainWay = {
    class: 'minor',
    polylines: [stretch]
  };

  it('classifies a through crossing vs a terminating side road', () => {
    const crosser = {
      class: 'minor',
      polylines: [
        [
          { x: -50, z: 200 },
          { x: 50, z: 200 }
        ]
      ]
    };
    // Shared node exactly ON the stretch: registers as a segment
    // intersection, but the way ends there — still a terminal.
    const teeOnStretch = {
      class: 'service',
      polylines: [
        [
          { x: 0, z: 300 },
          { x: 60, z: 300 }
        ]
      ]
    };
    const junctions = junctionsAlongStretch(stretch, [crosser, teeOnStretch]);
    assert.strictEqual(junctions.length, 2);
    assert.strictEqual(junctions[0].kind, 'crossing');
    assert.strictEqual(junctions[1].kind, 'terminal');
  });

  it('a merged mixed junction stays a crossing', () => {
    const crosser = {
      class: 'minor',
      polylines: [
        [
          { x: -50, z: 200 },
          { x: 50, z: 200 }
        ]
      ]
    };
    const tee = {
      class: 'service',
      polylines: [
        [
          { x: 1, z: 205 },
          { x: 60, z: 205 }
        ]
      ]
    };
    const junctions = junctionsAlongStretch(stretch, [tee, crosser]);
    assert.strictEqual(junctions.length, 1);
    assert.strictEqual(junctions[0].kind, 'crossing');
  });

  describe('trimStretchEndsAtWays', () => {
    it('pulls an end back to the through carriageway edge', () => {
      const side = [
        { x: 0, z: 200 },
        { x: 80, z: 200 }
      ];
      const trimmed = trimStretchEndsAtWays(side, [mainWay]);
      // minor carriageway 10.4 m → trim 10.4/2 + 2 = 7.2 m.
      assert.ok(Math.abs(trimmed[0].x - 7.2) < 1e-9);
      assert.deepStrictEqual(trimmed[trimmed.length - 1], { x: 80, z: 200 });
    });

    it('leaves an end alone when it meets the other way END to end', () => {
      const side = [
        { x: 0, z: 200 },
        { x: 80, z: 200 }
      ];
      const continuation = {
        class: 'minor',
        polylines: [
          [
            { x: 0, z: 200 },
            { x: -80, z: 200 }
          ]
        ]
      };
      assert.deepStrictEqual(trimStretchEndsAtWays(side, [continuation]), side);
    });

    it('skips a trim that would drop the stretch under the minimum', () => {
      const shortSide = [
        { x: 0, z: 200 },
        { x: 22, z: 200 }
      ];
      const wallEast = {
        class: 'minor',
        polylines: [
          [
            { x: 22, z: 0 },
            { x: 22, z: 400 }
          ]
        ]
      };
      assert.deepStrictEqual(
        trimStretchEndsAtWays(shortSide, [mainWay, wallEast]),
        shortSide
      );
    });

    it('is a no-op with no ways in touching range', () => {
      const side = [
        { x: 30, z: 200 },
        { x: 80, z: 200 }
      ];
      assert.deepStrictEqual(trimStretchEndsAtWays(side, [mainWay]), side);
    });
  });
});
