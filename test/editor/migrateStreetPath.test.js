// Load-time migration of path-following streets (managed-street.path →
// owned managed-street.points), #1930 pillar 1.
import { describe, it, expect } from 'vitest';
import {
  migrateStreetPathToPoints,
  parseComponent
} from '@/tested/migrate-street-path.js';
import { parseCenterlinePoints } from '@/tested/street-centerline.js';

const vertex = (x, y, z) => ({
  element: 'a-entity',
  class: ['hideFromSceneGraph'],
  components: { 'shape-vertex': '', position: `${x} ${y} ${z}` }
});

const shape = (
  id,
  extra = {},
  verts = [vertex(-50, 0, -50), vertex(0, 0, 0), vertex(50, 0, 50)]
) => ({
  id,
  element: 'a-entity',
  components: {
    shape: 'lineColor: #fff; curveType: smooth',
    position: '100 0 200',
    ...extra
  },
  children: verts
});

const street = (extra = {}) => ({
  element: 'a-entity',
  components: {
    'managed-street':
      'length: 141.42; path: #osm-path-1; sourceType: json-blob',
    'street-align': 'width: center; length: middle',
    position: '100 0 200',
    ...extra
  }
});

describe('migrateStreetPathToPoints', () => {
  it("copies a sibling shape's vertices into street-local points and drops path", () => {
    const data = [shape('osm-path-1'), street()];
    expect(migrateStreetPathToPoints(data)).toBe(1);
    const ms = parseComponent(data[1].components['managed-street']);
    expect(ms.path).toBeUndefined();
    expect(ms.curveType).toBe('smooth');
    expect(ms.sourceType).toBe('json-blob');
    const pts = parseCenterlinePoints(ms.points);
    expect(pts).toEqual([
      { x: -50, y: 0, z: -50 },
      { x: 0, y: 0, z: 0 },
      { x: 50, y: 0, z: 50 }
    ]);
    // the shape survives as a plain drawing
    expect(data[0].components.shape).toContain('smooth');
  });

  it("accounts for the street's yaw and offset from the shape", () => {
    // Street sits 10 m east of the shape and is yawed 90°: parent +X is
    // street-local +Z.
    const data = [
      shape('osm-path-1', {}, [vertex(0, 0, 0), vertex(30, 0, 0)]),
      street({ position: '100 0 210', rotation: '0 90 0' })
    ];
    migrateStreetPathToPoints(data);
    const pts = parseCenterlinePoints(
      parseComponent(data[1].components['managed-street']).points
    );
    // Parent-space vertices (100,0,200) and (130,0,200), minus the street
    // position → (0,0,-10), (30,0,-10); un-yawed by 90° (parent +X is
    // street +Z, parent -Z is street +X) → (10,0,0), (10,0,30).
    expect(pts[0].x).toBeCloseTo(10);
    expect(pts[0].z).toBeCloseTo(0);
    expect(pts[1].x).toBeCloseTo(10);
    expect(pts[1].z).toBeCloseTo(30);
  });

  it('keeps a linear shape linear and carries fillet radius + closed', () => {
    const data = [
      shape('osm-path-1', {
        shape: {
          curveType: 'arc',
          filletRadius: 8,
          closed: true,
          lineColor: '#fff'
        }
      }),
      street()
    ];
    migrateStreetPathToPoints(data);
    const ms = parseComponent(data[1].components['managed-street']);
    expect(ms.curveType).toBe('arc');
    expect(String(ms.filletRadius)).toBe('8');
    expect(String(ms.closed)).toBe('true');

    const linear = [
      shape('osm-path-1', { shape: 'lineColor: #fff' }),
      street()
    ];
    migrateStreetPathToPoints(linear);
    expect(
      parseComponent(linear[1].components['managed-street']).curveType
    ).toBe('linear');
  });

  it('leaves path alone when the shape is missing, nested elsewhere, or transformed', () => {
    const missing = [street()];
    expect(migrateStreetPathToPoints(missing)).toBe(0);
    expect(parseComponent(missing[0].components['managed-street']).path).toBe(
      '#osm-path-1'
    );

    const nested = [
      { components: {}, children: [shape('osm-path-1')] },
      street()
    ];
    expect(migrateStreetPathToPoints(nested)).toBe(0);

    const rotatedShape = [
      shape('osm-path-1', { rotation: '0 45 0' }),
      street()
    ];
    expect(migrateStreetPathToPoints(rotatedShape)).toBe(0);

    const tiltedStreet = [shape('osm-path-1'), street({ rotation: '10 0 0' })];
    expect(migrateStreetPathToPoints(tiltedStreet)).toBe(0);

    const scaled = [shape('osm-path-1'), street({ scale: '2 2 2' })];
    expect(migrateStreetPathToPoints(scaled)).toBe(0);
  });

  it('walks nested layers and handles object-form components', () => {
    const data = [
      {
        components: {},
        children: [
          shape('osm-path-1'),
          {
            components: {
              'managed-street': { length: 100, path: '#osm-path-1' },
              position: { x: 100, y: 0, z: 200 }
            }
          }
        ]
      }
    ];
    expect(migrateStreetPathToPoints(data)).toBe(1);
    const ms = data[0].children[1].components['managed-street'];
    expect(typeof ms).toBe('object');
    expect(ms.path).toBeUndefined();
    expect(parseCenterlinePoints(ms.points)).toHaveLength(3);
  });

  it('never re-copies over a street that already owns points', () => {
    const data = [
      shape('osm-path-1'),
      street({
        'managed-street':
          'length: 10; path: #osm-path-1; points: 0 0 -5, 1 0 0, 0 0 5'
      })
    ];
    expect(migrateStreetPathToPoints(data)).toBe(1);
    const ms = parseComponent(data[1].components['managed-street']);
    expect(ms.path).toBeUndefined();
    expect(ms.points).toBe('0 0 -5, 1 0 0, 0 0 5');
  });

  it('skips streets without a path and a shape with fewer than two vertices', () => {
    const plain = [{ components: { 'managed-street': 'length: 60' } }];
    expect(migrateStreetPathToPoints(plain)).toBe(0);
    const tiny = [shape('osm-path-1', {}, [vertex(0, 0, 0)]), street()];
    expect(migrateStreetPathToPoints(tiny)).toBe(0);
  });
});
