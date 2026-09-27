import { describe, expect, it } from 'vitest';
import {
  migrateSceneJSON,
  migrateEntityData
} from '../../src/scene/migrations/index.js';
import {
  parseStyle,
  stringifyStyle
} from '../../src/scene/migrations/style.js';
import { migrateStreetGeo } from '../../src/scene/migrations/street-geo.js';
import { migrateLegacyFlatteningShape } from '../../src/scene/migrations/flattening-shape.js';
import { migrateCameraRig } from '../../src/scene/migrations/camera-rig.js';
import { migrateStreetSegments } from '../../src/scene/migrations/street-segments.js';
import { migrateDefaultSnapshotToViewerStart } from '../../src/scene/migrations/viewer-start.js';

const clone = (v) => JSON.parse(JSON.stringify(v));

describe('style helpers', () => {
  it('parses a prop string, keeping inner spaces and colons in values', () => {
    expect(
      parseStyle('maps: google3d; blendMode: 30% Opacity; src: a:b')
    ).toEqual({ maps: 'google3d', blendMode: '30% Opacity', src: 'a:b' });
    expect(parseStyle('')).toEqual({});
    expect(parseStyle(undefined)).toEqual({});
  });

  it('copies an object input so callers can mutate the result', () => {
    const input = { maps: 'none' };
    const out = parseStyle(input);
    out.maps = 'tiles2d';
    expect(input.maps).toBe('none');
  });

  it('stringifies back to the serializer format', () => {
    expect(stringifyStyle({ maps: 'tiles2d', opacity: 60 })).toBe(
      'maps: tiles2d; opacity: 60'
    );
  });
});

describe('migrateStreetGeo', () => {
  const geo = (value, extra = {}) => [
    { id: 'reference-layers', components: { 'street-geo': value, ...extra } }
  ];

  it('turns a hidden geo layer into maps: none and drops visible', () => {
    const data = geo('maps: google3d', { visible: false });
    expect(migrateStreetGeo(data)).toBe(1);
    expect(data[0].components).toEqual({ 'street-geo': 'maps: none' });
    const str = geo('maps: google3d', { visible: 'false' });
    migrateStreetGeo(str);
    expect(str[0].components).toEqual({ 'street-geo': 'maps: none' });
  });

  it('converts a google3d blend preset to opacity and drops both blend props', () => {
    const data = geo(
      'maps: google3d; blendingEnabled: true; blendMode: 60% Opacity'
    );
    migrateStreetGeo(data);
    expect(parseStyle(data[0].components['street-geo'])).toEqual({
      maps: 'google3d',
      opacity: '60'
    });
    const implicit = geo('blendingEnabled: true');
    migrateStreetGeo(implicit);
    expect(parseStyle(implicit[0].components['street-geo'])).toEqual({
      opacity: '30'
    });
  });

  it('drops a stale blend flag on a non-google3d map without adding opacity', () => {
    const data = geo('maps: osm3d; blendingEnabled: true; blendMode: Darker');
    migrateStreetGeo(data);
    expect(data[0].components['street-geo']).toBe('maps: osm3d');
  });

  it('does not override an explicit opacity', () => {
    const data = geo('maps: google3d; opacity: 80; blendingEnabled: true');
    migrateStreetGeo(data);
    expect(parseStyle(data[0].components['street-geo'])).toEqual({
      maps: 'google3d',
      opacity: '80'
    });
  });

  it('maps the retired mapbox2d layer onto tiles2d, in string and object form', () => {
    const str = geo('maps: mapbox2d; latitude: 1');
    migrateStreetGeo(str);
    expect(str[0].components['street-geo']).toBe('maps: tiles2d; latitude: 1');
    const obj = geo({ maps: 'mapbox2d' });
    migrateStreetGeo(obj);
    expect(obj[0].components['street-geo']).toEqual({ maps: 'tiles2d' });
  });

  it('leaves a current entry byte-for-byte alone', () => {
    const value = 'maps: tiles2d;  opacity: 60';
    const data = geo(value);
    expect(migrateStreetGeo(data)).toBe(0);
    expect(data[0].components['street-geo']).toBe(value);
  });
});

describe('migrateLegacyFlatteningShape', () => {
  const scene = (
    geoValue,
    shapeComponents = { geometry: 'primitive: box' }
  ) => [
    { id: 'reference-layers', components: { 'street-geo': geoValue } },
    {
      id: 'street-container',
      children: [{ id: 'other' }, { id: 'flat-1', components: shapeComponents }]
    }
  ];

  it('moves the reference onto the shape as a mesh-mode geo-flatten', () => {
    const data = scene('maps: google3d; flatteningShape: flat-1');
    expect(migrateLegacyFlatteningShape(data)).toBe(true);
    expect(data[0].components['street-geo']).toBe('maps: google3d');
    expect(data[1].children[1].components['geo-flatten']).toBe('mode: mesh');
    expect(data[1].children[0].components).toBeUndefined();
  });

  it('keeps an existing geo-flatten on the target', () => {
    const data = scene('flatteningShape: flat-1', {
      'geo-flatten': 'mode: auto'
    });
    migrateLegacyFlatteningShape(data);
    expect(data[1].children[1].components['geo-flatten']).toBe('mode: auto');
  });

  it('drops the transient create-default sentinel without a target', () => {
    const data = scene('maps: google3d; flatteningShape: create-default');
    expect(migrateLegacyFlatteningShape(data)).toBe(false);
    expect(data[0].components['street-geo']).toBe('maps: google3d');
  });

  it('is a no-op on a current file', () => {
    const data = scene('maps: google3d');
    const before = clone(data);
    expect(migrateLegacyFlatteningShape(data)).toBe(false);
    expect(data).toEqual(before);
  });
});

describe('migrateCameraRig', () => {
  it('strips the legacy viewer components from cameraRig only', () => {
    const data = [
      {
        id: 'cameraRig',
        components: {
          'look-controls': '',
          'movement-controls': 'fly: true',
          position: '0 1.6 0'
        }
      },
      {
        id: 'street-container',
        children: [{ id: 'user', components: { 'look-controls': '' } }]
      }
    ];
    expect(migrateCameraRig(data)).toBe(2);
    expect(data[0].components).toEqual({ position: '0 1.6 0' });
    expect(data[1].children[0].components).toEqual({ 'look-controls': '' });
  });
});

describe('migrateStreetSegments', () => {
  it('applies the segment and managed-street value migrations to nested nodes', () => {
    const data = [
      {
        id: 'street-container',
        children: [
          {
            id: 'street',
            components: {
              'managed-street': 'length: 60; showBuildings: false'
            },
            children: [
              {
                id: 'seg',
                components: {
                  'street-segment':
                    'type: building; level: 1; surface: hatched',
                  'street-generated-pedestrians':
                    'density: normal; direction: inbound'
                }
              }
            ]
          }
        ]
      }
    ];
    migrateStreetSegments(data);
    const street = data[0].children[0];
    expect(street.components['managed-street']).toBe(
      'length: 60; showBoundaries: false'
    );
    const seg = street.children[0].components;
    expect(parseStyle(seg['street-segment'])).toEqual({
      type: 'boundary',
      elevation: '0.15',
      surface: 'asphalt',
      direction: 'inbound'
    });
    const stripingKey = Object.keys(seg).find((k) =>
      k.startsWith('street-generated-striping')
    );
    expect(seg[stripingKey]).toBe('striping: hatched');
    expect(seg['street-generated-pedestrians']).toBe('density: normal');
  });
});

describe('migrateDefaultSnapshotToViewerStart', () => {
  const snapshotMemory = (cameraState) => ({
    snapshots: [{ isDefault: true, cameraState }]
  });
  const pose = {
    position: { x: 1, y: 2, z: 3 },
    rotation: { x: 0, y: Math.PI / 2, z: 0 },
    zoom: 42
  };

  it('does nothing without a legacy default-snapshot pose', () => {
    const data = [{ id: 'street-container', children: [] }];
    expect(migrateDefaultSnapshotToViewerStart(data, {})).toEqual({
      viewerStartMigrated: false,
      migrated: false
    });
    expect(data[0].children).toEqual([]);
  });

  it('synthesizes a Starting View under the user layers root', () => {
    const data = [{ id: 'street-container', children: [{ id: 'a' }] }];
    expect(
      migrateDefaultSnapshotToViewerStart(data, snapshotMemory(pose))
    ).toEqual({ viewerStartMigrated: true, migrated: true });
    const added = data[0].children[1];
    expect(added.components['data-layer-name']).toBe('Starting View');
    expect(added.components.position).toEqual({ x: 1, y: 2, z: 3 });
    expect(added.components['viewer-start']).toEqual({ fov: 42 });
    expect(added.components.rotation.y).toBeCloseTo(90);
    expect(added.components.rotation.x).toBeCloseTo(0);
  });

  it('falls back to the top level when there is no container entry', () => {
    const data = [{ id: 'environment' }];
    migrateDefaultSnapshotToViewerStart(data, snapshotMemory(pose));
    expect(data).toHaveLength(2);
    expect(data[1].components['viewer-start']).toBeDefined();
  });

  it('reports ownership and leaves the tree alone once a scene has (had) a Starting View', () => {
    const withEntity = [
      {
        id: 'street-container',
        children: [{ components: { 'viewer-start': '' } }]
      }
    ];
    expect(
      migrateDefaultSnapshotToViewerStart(withEntity, snapshotMemory(pose))
    ).toEqual({ viewerStartMigrated: true, migrated: false });
    expect(withEntity[0].children).toHaveLength(1);

    const deleted = [{ id: 'street-container', children: [] }];
    expect(
      migrateDefaultSnapshotToViewerStart(deleted, {
        ...snapshotMemory(pose),
        viewerStartMigrated: true
      })
    ).toEqual({ viewerStartMigrated: true, migrated: false });
    expect(deleted[0].children).toEqual([]);
  });
});

describe('migrateSceneJSON', () => {
  const legacyScene = () => ({
    title: 'Legacy',
    version: '0.5.6',
    memory: {
      snapshots: [
        { isDefault: true, cameraState: { position: { x: 0, y: 5, z: 10 } } }
      ]
    },
    data: [
      {
        id: 'street-container',
        components: { visible: false },
        children: [
          {
            id: 'cameraRig',
            components: { 'look-controls': '', position: '0 0 0' }
          },
          {
            id: 'street',
            components: { 'managed-street': 'length: 40', 'street-align': '' },
            children: [
              {
                id: 'seg',
                components: { 'street-segment': 'type: building; level: 2' }
              }
            ]
          },
          {
            id: 'ruler',
            components: { 'measure-line': 'start: 0 0 0; end: 1 0 0' }
          },
          { id: 'flat', components: { geometry: 'primitive: box' } }
        ]
      },
      {
        id: 'environment',
        components: { 'street-environment': 'preset: day' }
      },
      {
        id: 'reference-layers',
        components: {
          'street-geo':
            'maps: mapbox2d; flatteningShape: flat; blendingEnabled: true',
          visible: false
        }
      }
    ]
  });

  it('applies every migration once and reports the viewer-start flag', () => {
    const scene = legacyScene();
    expect(migrateSceneJSON(scene)).toEqual({ viewerStartMigrated: true });
    const container = scene.data[0];
    expect(container.components).toEqual({});
    const [rig, street, ruler, flat, start] = container.children;
    expect(rig.components).toEqual({ position: '0 0 0' });
    expect(street.components['street-align']).toBe('length: start');
    expect(parseStyle(street.children[0].components['street-segment'])).toEqual(
      {
        type: 'boundary',
        elevation: '0.3'
      }
    );
    expect(ruler.components).toEqual({ shape: '' });
    expect(ruler.children).toHaveLength(2);
    expect(flat.components['geo-flatten']).toBe('mode: mesh');
    expect(start.components['viewer-start']).toBeDefined();
    expect(scene.data[2].components).toEqual({ 'street-geo': 'maps: none' });
    expect(scene.data[1]).toEqual(legacyScene().data[1]);
  });

  it('is idempotent: a second pass changes nothing', () => {
    const scene = legacyScene();
    migrateSceneJSON(scene);
    const once = clone(scene);
    expect(migrateSceneJSON(scene)).toEqual({ viewerStartMigrated: true });
    // Compare through JSON, as the file is stored: the Euler conversion can
    // yield -0 for an unrotated axis, which serializes as 0.
    expect(clone(scene)).toEqual(once);
  });

  it('tolerates a scene with no data or memory', () => {
    expect(migrateSceneJSON({})).toEqual({ viewerStartMigrated: false });
    expect(migrateSceneJSON({ data: 'nope' })).toEqual({
      viewerStartMigrated: false
    });
  });
});

describe('migrateEntityData (paste path)', () => {
  it('migrates a pasted entity tree but not scene-level state', () => {
    const pasted = {
      id: 'street',
      components: { 'managed-street': 'length: 40', 'street-align': '' },
      children: [{ components: { 'street-segment': 'level: 1' } }]
    };
    expect(migrateEntityData([pasted])).toEqual([pasted]);
    expect(pasted.components['street-align']).toBe('length: start');
    expect(pasted.children[0].components['street-segment']).toBe(
      'elevation: 0.15'
    );
    const geo = { components: { 'street-geo': 'maps: mapbox2d' } };
    migrateEntityData([geo]);
    expect(geo.components['street-geo']).toBe('maps: mapbox2d');
  });
});
