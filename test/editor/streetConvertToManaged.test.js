import { afterEach, describe, expect, it, vi } from 'vitest';

// A mock factory means entity.jsx is never loaded, so the command module can be
// imported for what it is; every binding it takes from entity.jsx is here.
vi.mock('../../src/editor/lib/entity.jsx', () => ({
  createUniqueId: () => 'x'
}));

import { StreetConvertToManagedCommand } from '../../src/editor/lib/commands/StreetConvertToManagedCommand.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

// A classic street as the command reads it: its street and loader data, and
// the serialized snapshot getElementData gives.
function classicStreet() {
  const entity = document.createElement('div');
  entity.id = 'classic';
  const street = { length: 60, showGround: true };
  const loader = {
    streetmixStreetURL: 'https://streetmix.net/someone/1',
    showBuildings: true
  };
  entity.getAttribute = (name) =>
    name === 'street' ? street : name === 'streetmix-loader' ? loader : null;
  return entity;
}

describe('converting a classic street to a managed street', () => {
  it('drops the scale from the managed street and keeps its position and tilt, while the snapshot undo restores keeps the scale (fails if the managed definition is not levelled, if its tilt is levelled, or if the copy loses the snapshot scale)', () => {
    vi.stubGlobal('STREET', {
      utils: {
        getElementData: () => ({
          id: 'classic',
          components: {
            street: 'length: 60',
            'streetmix-loader':
              'streetmixStreetURL: https://streetmix.net/someone/1',
            position: '1 0 2',
            rotation: '5 30 0',
            scale: '2 2 2'
          }
        })
      }
    });
    const command = new StreetConvertToManagedCommand(
      {},
      { entity: classicStreet() }
    );
    const managed = command.managedData.components;
    expect(managed['managed-street']).toMatchObject({
      sourceType: 'streetmix-url',
      sourceValue: 'https://streetmix.net/someone/1'
    });
    expect(managed.position).toBe('1 0 2');
    expect(managed.rotation).toBe('5 30 0');
    expect(managed.scale).toBe('1 1 1');
    expect(command.legacyData.components.scale).toBe('2 2 2');
    expect(command.legacyData.components.rotation).toBe('5 30 0');
  });
});
