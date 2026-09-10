/* global describe, it */

/**
 * OSM way → managed street import math (#1930 click-to-upgrade): the
 * flat projection, nearest-way lookup, chord splitting, and Format-2
 * presets. The presets' compatibility with the real managed-street
 * component is covered separately in
 * test/components/osm-street-upgrade.test.js.
 */

import assert from 'assert';
import {
  eastMPerDeg,
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
