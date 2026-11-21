import { describe, expect, it } from 'vitest';
import { migrateLegacyStreetmixLoader } from '../../../src/tested/migrate-legacy-streetmix-loader.js';

const URL = 'https://streetmix.net/kfarr/3/example-street';
const API =
  'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr';

const legacy = (loader, { street, children, extra } = {}) => ({
  id: 'default-street',
  'data-layer-name': 'Streetmix • Example',
  components: {
    position: '1 0 2',
    rotation: '0 90 0',
    street: street ?? 'left: grass; right: narrow; synchronize: false',
    'streetmix-loader': loader,
    ...extra
  },
  ...(children ? { children } : {})
});

describe('migrateLegacyStreetmixLoader', () => {
  it('converts a still-synchronizing loader with no saved street to a managed street', () => {
    const data = [legacy(`streetmixStreetURL: ${URL}; synchronize: true`)];
    expect(migrateLegacyStreetmixLoader(data)).toEqual({
      converted: 1,
      synchronized: 0
    });
    const node = data[0];
    expect(node.id).toBe('default-street');
    expect(node.components).toEqual({
      'managed-street': {
        sourceType: 'streetmix-url',
        sourceValue: URL,
        length: 60,
        showBoundaries: true,
        showGround: true,
        showStriping: true,
        showVehicles: true,
        synchronize: true
      },
      position: '1 0 2',
      rotation: '0 90 0'
    });
  });

  it('treats a loader without a synchronize prop as synchronizing (schema default)', () => {
    const data = [legacy({ streetmixStreetURL: URL })];
    expect(migrateLegacyStreetmixLoader(data).converted).toBe(1);
    expect(data[0].components['managed-street'].sourceValue).toBe(URL);
  });

  it('carries over length, buildings and content toggles', () => {
    const data = [
      legacy(
        { streetmixStreetURL: URL, showBuildings: 'false' },
        {
          street:
            'length: 150; showGround: false; showStriping: false; showVehicles: false'
        }
      )
    ];
    migrateLegacyStreetmixLoader(data);
    expect(data[0].components['managed-street']).toMatchObject({
      length: 150,
      showBoundaries: false,
      showGround: false,
      showStriping: false,
      showVehicles: false
    });
  });

  it('falls back to the API URL when the page URL is missing', () => {
    const data = [legacy(`streetmixAPIURL: ${API}`)];
    migrateLegacyStreetmixLoader(data);
    expect(data[0].components['managed-street'].sourceValue).toBe(API);
  });

  it('keeps other root components', () => {
    const data = [
      legacy({ streetmixStreetURL: URL }, { extra: { visible: false } })
    ];
    migrateLegacyStreetmixLoader(data);
    expect(data[0].components.visible).toBe(false);
    expect(data[0].components.street).toBeUndefined();
    expect(data[0].components['streetmix-loader']).toBeUndefined();
  });

  it('marks a still-synchronizing loader with a saved street as synchronized (string form)', () => {
    const children = [{ class: ['street-parent'], components: {} }];
    const data = [
      legacy(`streetmixStreetURL: ${URL}; synchronize: true`, { children })
    ];
    expect(migrateLegacyStreetmixLoader(data)).toEqual({
      converted: 0,
      synchronized: 1
    });
    expect(data[0].components['streetmix-loader']).toBe(
      `streetmixStreetURL: ${URL}; synchronize: false`
    );
    expect(data[0].children).toBe(children);
  });

  it('marks a saved street synchronized in object form', () => {
    const data = [
      legacy({ streetmixStreetURL: URL }, { children: [{ components: {} }] })
    ];
    migrateLegacyStreetmixLoader(data);
    expect(data[0].components['streetmix-loader']).toEqual({
      streetmixStreetURL: URL,
      synchronize: false
    });
  });

  it('leaves already-synchronized legacy streets alone', () => {
    const loader = `streetmixStreetURL: ${URL}; synchronize: false`;
    const data = [legacy(loader, { children: [{ components: {} }] })];
    expect(migrateLegacyStreetmixLoader(data)).toEqual({
      converted: 0,
      synchronized: 0
    });
    expect(data[0].components['streetmix-loader']).toBe(loader);
  });

  it('leaves a loader with no URL alone (nothing to convert from)', () => {
    const data = [legacy('synchronize: true')];
    expect(migrateLegacyStreetmixLoader(data).converted).toBe(0);
    expect(data[0].components['streetmix-loader']).toBe('synchronize: true');
  });

  it('finds legacy streets nested under the street container', () => {
    const data = [
      {
        id: 'street-container',
        components: {},
        children: [legacy({ streetmixStreetURL: URL })]
      }
    ];
    expect(migrateLegacyStreetmixLoader(data).converted).toBe(1);
    expect(data[0].children[0].components['managed-street']).toBeDefined();
  });

  it('is idempotent', () => {
    const data = [legacy({ streetmixStreetURL: URL })];
    migrateLegacyStreetmixLoader(data);
    expect(migrateLegacyStreetmixLoader(data)).toEqual({
      converted: 0,
      synchronized: 0
    });
  });
});
