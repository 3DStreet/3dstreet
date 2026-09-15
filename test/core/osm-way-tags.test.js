/* global describe, it */

/**
 * Overpass tag → cross-section mapping (#1930 phase 6 first slice): exact
 * where OSM has the field, class rules where it doesn't, facts say which.
 */

import assert from 'assert';
import {
  bboxAroundLocalPoints,
  classForHighway,
  crossSectionFromTags,
  describeFacts,
  overpassStreetQuery,
  pickOverpassWay,
  streetJsonFromTags
} from '../../src/tested/osm-way-tags.js';
import {
  localToLatLon,
  latLonToLocal
} from '../../src/tested/osm-street-import.js';

const ORIGIN = { lat: 37.7876, lon: -122.4008 };
const types = (segs) => segs.map((s) => s.type);
const drives = (segs) => segs.filter((s) => s.type === 'drive-lane');

describe('localToLatLon', () => {
  it('inverts latLonToLocal', () => {
    const pt = { lat: 37.79, lon: -122.41 };
    const back = localToLatLon(ORIGIN, latLonToLocal(ORIGIN, pt));
    assert.ok(Math.abs(back.lat - pt.lat) < 1e-9);
    assert.ok(Math.abs(back.lon - pt.lon) < 1e-9);
  });
});

describe('classForHighway', () => {
  it('maps highway values to tile classes and strips _link', () => {
    assert.deepStrictEqual(classForHighway('residential'), {
      class: 'minor',
      subclass: 'residential',
      link: false
    });
    assert.strictEqual(classForHighway('primary_link').class, 'primary');
    assert.strictEqual(classForHighway('primary_link').link, true);
    assert.strictEqual(classForHighway('cycleway').class, 'path');
    assert.strictEqual(classForHighway('proposed'), null);
    assert.strictEqual(classForHighway(undefined), null);
  });
});

describe('overpassStreetQuery / bboxAroundLocalPoints', () => {
  it('pads the bbox and emits a geom query', () => {
    const bbox = bboxAroundLocalPoints(
      ORIGIN,
      [
        { x: 0, z: 0 },
        { x: 100, z: 50 }
      ],
      20
    );
    assert.ok(bbox.south < ORIGIN.lat && bbox.north > ORIGIN.lat);
    assert.ok(bbox.west < ORIGIN.lon && bbox.east > ORIGIN.lon);
    const q = overpassStreetQuery(bbox);
    assert.ok(q.startsWith('[out:json][timeout:8];way["highway"]('));
    assert.ok(q.endsWith(');out tags geom;'));
  });
});

describe('pickOverpassWay', () => {
  const geom = (pts) => pts.map((p) => localToLatLon(ORIGIN, p));
  const elements = [
    {
      type: 'way',
      id: 1,
      tags: { highway: 'residential', name: 'Elm St' },
      geometry: geom([
        { x: 0, z: 0 },
        { x: 100, z: 0 }
      ])
    },
    {
      type: 'way',
      id: 2,
      tags: { highway: 'footway' },
      geometry: geom([
        { x: 0, z: 3 },
        { x: 100, z: 3 }
      ])
    },
    { type: 'node', id: 3, lat: 0, lon: 0 },
    {
      type: 'way',
      id: 4,
      tags: { highway: 'proposed' },
      geometry: geom([
        { x: 0, z: 1 },
        { x: 100, z: 1 }
      ])
    }
  ];

  it('prefers the drivable way even when a footway is closer', () => {
    const hit = pickOverpassWay(elements, ORIGIN, { x: 50, z: 2.5 });
    assert.strictEqual(hit.id, 1);
    assert.strictEqual(hit.tags.name, 'Elm St');
  });

  it('falls back to non-drivable ways and respects maxDist', () => {
    const only = elements.filter((e) => e.id === 2);
    assert.strictEqual(pickOverpassWay(only, ORIGIN, { x: 50, z: 4 }).id, 2);
    assert.strictEqual(
      pickOverpassWay(elements, ORIGIN, { x: 50, z: 80 }),
      null
    );
  });
});

describe('crossSectionFromTags', () => {
  it('uses the exact lane count, split evenly when untagged', () => {
    const { segments, facts } = crossSectionFromTags(
      { highway: 'secondary', lanes: '4' },
      {}
    );
    const d = drives(segments);
    assert.strictEqual(d.length, 4);
    assert.strictEqual(d.filter((s) => s.direction === 'inbound').length, 2);
    assert.deepStrictEqual(facts.lanes, { value: 4, source: 'osm' });
  });

  it('honors lanes:forward / lanes:backward', () => {
    const { segments } = crossSectionFromTags(
      { highway: 'tertiary', lanes: '3', 'lanes:forward': '2' },
      {}
    );
    const d = drives(segments);
    assert.strictEqual(d.filter((s) => s.direction === 'inbound').length, 2);
    assert.strictEqual(d.filter((s) => s.direction === 'outbound').length, 1);
  });

  it('never invents a lane: lanes=2 with lanes:forward=2 stays two lanes', () => {
    const { segments, facts } = crossSectionFromTags(
      { highway: 'residential', lanes: '2', 'lanes:forward': '2' },
      {}
    );
    const d = drives(segments);
    assert.strictEqual(d.length, 2);
    assert.strictEqual(d.filter((s) => s.direction === 'inbound').length, 2);
    assert.strictEqual(facts.lanes.value, 2);
  });

  it('clamps a malformed lanes:forward larger than lanes', () => {
    const { segments } = crossSectionFromTags(
      { highway: 'residential', lanes: '2', 'lanes:forward': '5' },
      {}
    );
    assert.strictEqual(drives(segments).length, 2);
  });

  it('gives a one-way lanes=1 street exactly one lane in the way direction', () => {
    const { segments, facts } = crossSectionFromTags(
      { highway: 'residential', oneway: 'yes', lanes: '1' },
      {}
    );
    const d = drives(segments);
    assert.strictEqual(d.length, 1);
    assert.strictEqual(d[0].direction, 'inbound');
    assert.strictEqual(facts.oneway, 1);
    const rev = crossSectionFromTags(
      { highway: 'residential', oneway: '-1', lanes: '1' },
      {}
    );
    assert.strictEqual(drives(rev.segments)[0].direction, 'outbound');
  });

  it('falls back to class rules and says so when lanes are untagged', () => {
    const { segments, facts } = crossSectionFromTags(
      { highway: 'residential' },
      {}
    );
    assert.strictEqual(drives(segments).length, 2);
    assert.strictEqual(facts.lanes.source, 'default');
    // residential rules: parking + sidewalks both sides
    assert.strictEqual(
      types(segments).filter((t) => t === 'parking-lane').length,
      2
    );
    assert.strictEqual(facts.parking.source, 'default');
  });

  it('places sidewalks, parking and bike lanes on the tagged side', () => {
    const { segments, facts } = crossSectionFromTags(
      {
        highway: 'residential',
        lanes: '2',
        sidewalk: 'right',
        'parking:lane:left': 'parallel',
        'parking:lane:right': 'no_parking',
        'cycleway:right': 'lane'
      },
      {}
    );
    const t = types(segments);
    // right side (way-forward right) is segments[0]
    assert.deepStrictEqual(t, [
      'sidewalk',
      'bike-lane',
      'drive-lane',
      'drive-lane',
      'parking-lane'
    ]);
    assert.deepStrictEqual(facts.sidewalk.value, { left: false, right: true });
    assert.strictEqual(facts.parking.source, 'osm');
    assert.strictEqual(facts.bike.source, 'osm');
  });

  it('understands the newer parking:* schema and sidewalk=no', () => {
    const { segments } = crossSectionFromTags(
      { highway: 'residential', sidewalk: 'no', 'parking:both': 'lane' },
      {}
    );
    const t = types(segments);
    assert.ok(!t.includes('sidewalk'));
    assert.strictEqual(t.filter((x) => x === 'parking-lane').length, 2);
  });

  it('treats motorways as one-way by default and skips dressing', () => {
    const { segments, facts } = crossSectionFromTags(
      { highway: 'motorway', lanes: '3' },
      {}
    );
    assert.strictEqual(facts.oneway, 1);
    assert.strictEqual(drives(segments).length, 3);
    assert.ok(!types(segments).includes('sidewalk'));
  });

  it('routes non-motor highways through the class rules', () => {
    const foot = crossSectionFromTags({ highway: 'footway' }, {});
    assert.deepStrictEqual(types(foot.segments), ['sidewalk']);
    const cycle = crossSectionFromTags({ highway: 'cycleway' }, {});
    assert.ok(types(cycle.segments).every((t) => t === 'bike-lane'));
    assert.strictEqual(foot.facts.lanes, undefined);
  });

  it('falls back to the tile record when there is no highway tag', () => {
    const { facts } = crossSectionFromTags({}, { class: 'primary', oneway: 1 });
    assert.strictEqual(facts.class, 'primary');
    assert.strictEqual(facts.oneway, 1);
  });
});

describe('streetJsonFromTags / describeFacts', () => {
  it('names the street from OSM and sums widths', () => {
    const { json, facts } = streetJsonFromTags(
      { highway: 'primary', name: 'Market St', lanes: '4', sidewalk: 'both' },
      {},
      55.555
    );
    assert.strictEqual(json.name, 'Market St');
    assert.strictEqual(json.length, 55.56);
    const sum = json.segments.reduce((s, seg) => s + seg.width, 0);
    assert.ok(Math.abs(json.width - sum) < 1e-9);
    assert.strictEqual(
      describeFacts(facts),
      'Market St · 4 lanes · sidewalks both sides'
    );
  });

  it('flags assumed lanes and reads one-way', () => {
    const { facts } = streetJsonFromTags(
      { highway: 'residential', oneway: 'yes' },
      {},
      10
    );
    assert.strictEqual(
      describeFacts(facts),
      'one-way · lanes not mapped (1 assumed)'
    );
    assert.strictEqual(describeFacts(null), '');
  });
});

describe('crossSectionFromTags — strassenraumkarte-parity tags (#2004)', () => {
  const bare = {
    // Quiet the class-rule dressing so lane-level assertions stay readable.
    sidewalk: 'no',
    'parking:both': 'no'
  };

  it('derives drive-lane width from the carriageway width tag', () => {
    const { segments, facts } = crossSectionFromTags({
      highway: 'residential',
      sidewalk: 'no',
      lanes: '2',
      width: '12',
      'parking:both': 'lane'
    });
    // 12 m minus two 2.2 m parallel parking lanes over 2 drive lanes.
    const d = drives(segments);
    assert.strictEqual(d.length, 2);
    for (const lane of d) assert.ok(Math.abs(lane.width - 3.8) < 1e-9);
    assert.deepStrictEqual(facts.width, { value: 12, source: 'osm' });
  });

  it('clamps an implausible derived lane width', () => {
    const { segments } = crossSectionFromTags({
      highway: 'residential',
      ...bare,
      lanes: '2',
      width: '2'
    });
    for (const lane of drives(segments)) assert.strictEqual(lane.width, 2);
  });

  it('applies width:lanes per lane, leftmost entry first', () => {
    const { segments } = crossSectionFromTags({
      highway: 'residential',
      ...bare,
      'lanes:forward': '2',
      'lanes:backward': '1',
      'width:lanes:forward': '3|4',
      'width:lanes:backward': '2.5'
    });
    // Forward lanes are laid curbside-first (segments[0] = driver's
    // right), so the leftmost width:lanes entry (3) lands on the SECOND
    // forward lane.
    const d = drives(segments);
    assert.deepStrictEqual(
      d.map((l) => l.width),
      [4, 3, 2.5]
    );
  });

  it('reads parking orientation from the new schema', () => {
    const { segments, facts } = crossSectionFromTags({
      highway: 'residential',
      sidewalk: 'no',
      'parking:right': 'lane',
      'parking:right:orientation': 'perpendicular',
      'parking:left': 'no'
    });
    const p = segments.filter((s) => s.type === 'parking-lane');
    assert.strictEqual(p.length, 1);
    assert.strictEqual(p[0].width, 5);
    const clone = p[0].generated.clones[0];
    assert.strictEqual(clone.spacing, 2.5);
    assert.strictEqual(clone.facing, 90);
    assert.strictEqual(facts.parking.orientation.right, 'perpendicular');
  });

  it('reads orientation straight off the old parking:lane schema', () => {
    const { segments } = crossSectionFromTags({
      highway: 'residential',
      sidewalk: 'no',
      'parking:lane:both': 'diagonal'
    });
    const p = segments.filter((s) => s.type === 'parking-lane');
    assert.strictEqual(p.length, 2);
    for (const lane of p) {
      assert.strictEqual(lane.width, 4.5);
      assert.strictEqual(lane.generated.clones[0].spacing, 3.1);
      assert.strictEqual(lane.generated.clones[0].facing, 55);
    }
  });

  it('honors a mapped parking width and a no_stopping restriction', () => {
    const { segments } = crossSectionFromTags({
      highway: 'residential',
      sidewalk: 'no',
      'parking:both': 'lane',
      'parking:left:width': '1.8',
      'parking:right:restriction': 'no_stopping'
    });
    const p = segments.filter((s) => s.type === 'parking-lane');
    assert.strictEqual(p.length, 1);
    assert.strictEqual(p[0].direction, 'outbound'); // left side survives
    assert.strictEqual(p[0].width, 1.8);
  });

  it('separates a protected track with a buffer divider', () => {
    const { segments, facts } = crossSectionFromTags({
      highway: 'residential',
      ...bare,
      'cycleway:right': 'track'
    });
    assert.deepStrictEqual(types(segments), [
      'bike-lane',
      'divider',
      'drive-lane',
      'drive-lane'
    ]);
    assert.strictEqual(facts.bike.protected.right, true);
  });

  it('keeps a painted lane flush and reads its width', () => {
    const { segments, facts } = crossSectionFromTags({
      highway: 'residential',
      ...bare,
      'cycleway:right': 'lane',
      'cycleway:right:width': '2.5'
    });
    assert.deepStrictEqual(types(segments), [
      'bike-lane',
      'drive-lane',
      'drive-lane'
    ]);
    assert.strictEqual(segments[0].width, 2.5);
    assert.strictEqual(facts.bike.protected.right, false);
  });

  it('treats tagged separation as protection', () => {
    const { segments } = crossSectionFromTags({
      highway: 'residential',
      ...bare,
      'cycleway:right': 'lane',
      'cycleway:right:separation:left': 'bollard'
    });
    assert.ok(types(segments).includes('divider'));
  });

  it('stamps turn:lanes arrows on a one-way, curbside entry last', () => {
    const { segments } = crossSectionFromTags({
      highway: 'secondary',
      ...bare,
      oneway: 'yes',
      lanes: '3',
      'turn:lanes': 'left|through|through;right'
    });
    const stencil = (s) => s.generated.stencil?.[0].modelsArray ?? null;
    // Leftmost tag entry → last lane; curbside lane gets through;right.
    assert.deepStrictEqual(drives(segments).map(stencil), [
      'right-straight',
      'straight',
      'left'
    ]);
  });

  it('maps turn:lanes:forward onto the forward lanes only', () => {
    const { segments } = crossSectionFromTags({
      highway: 'residential',
      ...bare,
      'lanes:forward': '1',
      'lanes:backward': '1',
      'turn:lanes:forward': 'left;through'
    });
    const d = drives(segments);
    assert.strictEqual(d[0].generated.stencil[0].modelsArray, 'left-straight');
    assert.strictEqual(d[0].generated.stencil[0].direction, 'inbound');
    assert.strictEqual(d[1].generated.stencil, undefined);
  });

  it('ignores movements with no stencil rather than guessing', () => {
    const { segments } = crossSectionFromTags({
      highway: 'residential',
      ...bare,
      oneway: 'yes',
      lanes: '2',
      'turn:lanes': 'merge_to_left|none'
    });
    for (const lane of drives(segments)) {
      assert.strictEqual(lane.generated.stencil, undefined);
    }
  });

  it('converts designated bus:lanes entries to bus lanes', () => {
    const { segments, facts } = crossSectionFromTags({
      highway: 'secondary',
      ...bare,
      'lanes:forward': '2',
      'lanes:backward': '2',
      'bus:lanes:forward': 'no|designated'
    });
    // Rightmost forward entry = curbside = first segment.
    assert.deepStrictEqual(types(segments), [
      'bus-lane',
      'drive-lane',
      'drive-lane',
      'drive-lane'
    ]);
    assert.deepStrictEqual(facts.busLanes, { value: 1, source: 'osm' });
  });

  it('puts count-only lanes:bus at the curb of each direction', () => {
    const { segments } = crossSectionFromTags({
      highway: 'secondary',
      ...bare,
      'lanes:forward': '2',
      'lanes:backward': '2',
      'lanes:bus:forward': '1',
      'lanes:bus:backward': '1'
    });
    assert.deepStrictEqual(types(segments), [
      'bus-lane',
      'drive-lane',
      'drive-lane',
      'bus-lane'
    ]);
  });

  it('maps surface onto carriageway segments only', () => {
    const { segments, facts } = crossSectionFromTags({
      highway: 'residential',
      surface: 'sett',
      'parking:both': 'lane'
    });
    for (const s of segments) {
      if (s.type === 'drive-lane') assert.strictEqual(s.surface, 'sidewalk');
      if (s.type === 'parking-lane') assert.strictEqual(s.surface, 'concrete');
      if (s.type === 'sidewalk') assert.strictEqual(s.surface, 'sidewalk');
    }
    assert.deepStrictEqual(facts.surface, { value: 'sett', source: 'osm' });
  });

  it('leaves an unknown surface value on the class default', () => {
    const { segments, facts } = crossSectionFromTags({
      highway: 'residential',
      ...bare,
      surface: 'metal'
    });
    for (const lane of drives(segments)) {
      assert.strictEqual(lane.surface, 'asphalt');
    }
    assert.strictEqual(facts.surface, undefined);
  });

  it('reads per-side sidewalk widths', () => {
    const { segments } = crossSectionFromTags({
      highway: 'residential',
      sidewalk: 'both',
      'sidewalk:left:width': '3',
      'parking:both': 'no'
    });
    const walks = segments.filter((s) => s.type === 'sidewalk');
    assert.strictEqual(walks[0].width, 1.8); // right: class default
    assert.strictEqual(walks[walks.length - 1].width, 3); // left: mapped
  });

  it('describes the new facts in the chip line', () => {
    const { facts } = crossSectionFromTags({
      highway: 'residential',
      name: 'Karl-Marx-Straße',
      lanes: '2',
      width: '11',
      sidewalk: 'both',
      surface: 'sett',
      'parking:both': 'lane',
      'parking:both:orientation': 'diagonal',
      'cycleway:right': 'track',
      'lanes:bus:forward': '1'
    });
    assert.strictEqual(
      describeFacts(facts),
      'Karl-Marx-Straße · 2 lanes · width 11 m · 1 bus lane · ' +
        'sidewalks both sides · parking both sides (diagonal) · ' +
        'protected bike lanes right · sett surface'
    );
  });
});
