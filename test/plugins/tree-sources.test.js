import { describe, expect, it, vi } from 'vitest';
import {
  SOURCES,
  bboxAround,
  decodeCache,
  encodeCache,
  fetchTrees,
  modelForTree,
  queryKey,
  selectTrees,
  suggestSource,
  yawForTree
} from '../../src/plugins/tree-inventory/tree-sources.js';
// Recorded responses (trimmed). sf/nyc are verbatim API output; the OSM file
// keeps two real Civic Center nodes and adds two synthetic ones to cover the
// circumference and needleleaved tags.
import osmFixture from './fixtures/osm-sf-civic-center.json';
import sfFixture from './fixtures/sf-civic-center.json';
import nycFixture from './fixtures/nyc-city-hall.json';

const SF_CENTER = { lat: 37.7793, lon: -122.4193 };
const NYC_CENTER = { lat: 40.7128, lon: -74.006 };

const okResponse = (body) => ({ ok: true, json: async () => body });

describe('bboxAround', () => {
  it('spans the radius in meters on both axes', () => {
    const b = bboxAround(SF_CENTER, { shape: 'circle', radius: 100 });
    // ~111.3 km per degree of latitude
    expect((b.north - b.south) * 111319.49).toBeCloseTo(200, 0);
    const eastM =
      (b.east - b.west) * 111319.49 * Math.cos((SF_CENTER.lat * Math.PI) / 180);
    expect(eastM).toBeCloseTo(200, 0);
  });

  it('uses width east-west and depth north-south for a box', () => {
    const b = bboxAround(SF_CENTER, { shape: 'box', width: 400, depth: 100 });
    expect((b.north - b.south) * 111319.49).toBeCloseTo(100, 0);
    expect(b.east - b.west).toBeGreaterThan(b.north - b.south);
  });
});

describe('source parsers', () => {
  it('normalizes OSM nodes', () => {
    const trees = SOURCES.osm.parse(osmFixture);
    expect(trees).toHaveLength(4);
    expect(trees[0]).toMatchObject({
      id: 'osm-8717839624',
      lat: 37.7798623,
      lon: -122.4187743,
      dbhCm: null
    });
    expect(trees[0].species).toContain('London plane');
    // circumference 1.57 m → ~50 cm diameter
    expect(trees[2].dbhCm).toBeCloseTo(50, 0);
    expect(trees[3].species).toBe('conifer');
  });

  it('normalizes DataSF rows (text numbers, inches)', () => {
    const trees = SOURCES.sf.parse(sfFixture);
    expect(trees).toHaveLength(4);
    expect(trees[0]).toEqual({
      id: 'sf-109549',
      lat: 37.77889,
      lon: -122.419832,
      species: 'Platanus x hispanica :: Sycamore, London Plane',
      dbhCm: 4 * 2.54
    });
    // a row without mapdbh
    expect(trees[2].dbhCm).toBeNull();
  });

  it('normalizes NYC forestry points (GeoJSON lon, lat order)', () => {
    const trees = SOURCES.nyc.parse(nycFixture);
    expect(trees.length).toBeGreaterThan(0);
    expect(trees[0].lat).toBeCloseTo(40.7133, 3);
    expect(trees[0].lon).toBeCloseTo(-74.0064, 3);
    expect(trees[0].dbhCm).toBeCloseTo(26 * 2.54);
  });
});

describe('request builders', () => {
  const bbox = bboxAround(SF_CENTER, { shape: 'circle', radius: 50 });

  it('DataSF filters numerically on the text lat/lon columns', () => {
    const url = new URL(SOURCES.sf.request(bbox, 10));
    expect(url.host).toBe('data.sf.gov');
    expect(url.searchParams.get('$where')).toContain('latitude::number');
    expect(url.searchParams.get('$limit')).toBe('10');
  });

  it('NYC uses within_box on the location column, living trees only', () => {
    const url = new URL(SOURCES.nyc.request(bbox, 10));
    const where = url.searchParams.get('$where');
    expect(where).toMatch(/^within_box\(location, /);
    expect(where).toContain("tpstructure='Full'");
  });

  it('Overpass queries tree nodes in south,west,north,east order', () => {
    const q = SOURCES.osm.overpassQuery(bbox, 10);
    expect(q).toContain('node["natural"="tree"]');
    expect(q).toContain(`(${bbox.south.toFixed(6)},${bbox.west.toFixed(6)},`);
    expect(q).toContain('out body 10;');
  });
});

describe('selectTrees', () => {
  const trees = [
    { id: 'far', lat: SF_CENTER.lat + 0.0008, lon: SF_CENTER.lon }, // ~89 m N
    { id: 'near', lat: SF_CENTER.lat + 0.0001, lon: SF_CENTER.lon }, // ~11 m
    { id: 'corner', lat: SF_CENTER.lat + 0.0006, lon: SF_CENTER.lon + 0.00076 } // bbox corner, ~94 m
  ];

  it('trims a circle to its radius, nearest first', () => {
    const out = selectTrees(
      trees,
      SF_CENTER,
      { shape: 'circle', radius: 90 },
      10
    );
    expect(out.map((t) => t.id)).toEqual(['near', 'far']);
  });

  it('keeps bbox corners for a box and honors maxTrees', () => {
    const box = { shape: 'box', width: 200, depth: 200 };
    expect(selectTrees(trees, SF_CENTER, box, 10)).toHaveLength(3);
    expect(selectTrees(trees, SF_CENTER, box, 1).map((t) => t.id)).toEqual([
      'near'
    ]);
  });
});

describe('fetchTrees', () => {
  it('fetches a Socrata source and selects inside the area', async () => {
    const fetchImpl = vi.fn(async () => okResponse(sfFixture));
    const trees = await fetchTrees({
      source: 'sf',
      center: SF_CENTER,
      area: { shape: 'circle', radius: 200 },
      maxTrees: 3,
      fetchImpl
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0][0]).toContain('data.sf.gov');
    expect(trees).toHaveLength(3);
  });

  it('posts OSM queries through the Overpass client', async () => {
    const fetchImpl = vi.fn(async () => okResponse(osmFixture));
    const trees = await fetchTrees({
      source: 'osm',
      center: SF_CENTER,
      area: { shape: 'circle', radius: 200 },
      maxTrees: 10,
      fetchImpl
    });
    expect(fetchImpl.mock.calls[0][1].method).toBe('POST');
    expect(trees).toHaveLength(4);
  });

  it('reports HTTP errors', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503 });
    await expect(
      fetchTrees({
        source: 'nyc',
        center: NYC_CENTER,
        area: { shape: 'circle', radius: 50 },
        maxTrees: 5,
        fetchImpl
      })
    ).rejects.toThrow('503');
  });
});

describe('modelForTree', () => {
  it('maps species to catalog models', () => {
    const m = (species, dbhCm = 40) =>
      modelForTree({ species, dbhCm }, 'tree3');
    expect(m('Washingtonia robusta :: Mexican Fan Palm')).toBe(
      'sp-tree-palm-26ft'
    );
    expect(m('Quercus agrifolia :: Coast Live Oak')).toBe(
      'sp-tree-buroak-24ft'
    );
    expect(m('Gleditsia triacanthos - honeylocust')).toBe(
      'sp-tree-honeylocust-24ft'
    );
    expect(m('Prunus cerasifera :: Cherry Plum')).toBe(
      'sp-tree-purpleplum-16ft'
    );
    expect(m('Platanus x hispanica :: London Plane')).toBe('tree3');
    expect(m('Platanus x hispanica :: London Plane', 8)).toBe(
      'sp-tree-small-15ft'
    );
    expect(m('', null)).toBe('tree3');
  });

  it('gives each tree a stable yaw', () => {
    expect(yawForTree({ id: 'sf-1' })).toBe(yawForTree({ id: 'sf-1' }));
    expect(yawForTree({ id: 'sf-1' })).toBeGreaterThanOrEqual(0);
    expect(yawForTree({ id: 'sf-1' })).toBeLessThan(360);
  });
});

describe('cache', () => {
  it('round-trips trees and its query key', () => {
    const query = {
      source: 'sf',
      center: SF_CENTER,
      area: { shape: 'circle', radius: 100 },
      maxTrees: 200
    };
    const key = queryKey(query);
    const trees = SOURCES.sf.parse(sfFixture);
    const decoded = decodeCache(encodeCache(key, trees));
    expect(decoded.key).toBe(key);
    expect(decoded.trees).toHaveLength(trees.length);
    expect(decoded.trees[0].lat).toBeCloseTo(trees[0].lat, 6);
    expect(decoded.trees[0].dbhCm).toBe(10);
  });

  it('changes key when the area changes and tolerates bad input', () => {
    const base = {
      source: 'osm',
      center: SF_CENTER,
      area: { shape: 'circle', radius: 100 },
      maxTrees: 200
    };
    expect(queryKey(base)).not.toBe(
      queryKey({ ...base, area: { shape: 'circle', radius: 150 } })
    );
    expect(decodeCache('')).toBeNull();
    // a ';' would split the saved A-Frame style string
    const encoded = encodeCache('k', [
      { id: 'x', lat: 1, lon: 2, species: 'a; b', dbhCm: null }
    ]);
    expect(encoded).not.toContain(';');
    expect(decodeCache('{not json')).toBeNull();
  });
});

describe('suggestSource', () => {
  it('picks the city dataset that covers the location', () => {
    expect(suggestSource(SF_CENTER)).toBe('sf');
    expect(suggestSource(NYC_CENTER)).toBe('nyc');
    expect(suggestSource({ lat: 51.5, lon: -0.12 })).toBe('osm');
    expect(suggestSource(null)).toBe('osm');
  });
});
