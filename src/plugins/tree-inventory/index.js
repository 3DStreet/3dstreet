/**
 * Tree Inventory plugin — the reference example for docs/plugins.md.
 *
 * Adds: the `tree-inventory` component, an Add Layer card (⚙️ Custom tab),
 * an `importTrees` AI/WebMCP tool, and a featured properties section.
 */

import manifest from './manifest.json';
import {
  createEntity,
  getSceneGeoOrigin,
  notify,
  registerPlugin
} from '../api.js';
import { treeInventoryComponent } from './tree-inventory-component.js';
import { SOURCES, suggestSource } from './tree-sources.js';

const LOAD_TIMEOUT_MS = 45000;

async function createTreeInventory(settings = {}) {
  const center =
    settings.latitude || settings.longitude
      ? { lat: settings.latitude, lon: settings.longitude }
      : getSceneGeoOrigin();
  if (!center) {
    notify.warning(
      'Set a scene location first, or enter a latitude and longitude for the trees.'
    );
  }
  const config = { source: suggestSource(center), ...settings };
  return createEntity({
    'data-layer-name': 'Tree Inventory',
    components: {
      // Trees are placed in scene meters from the map origin, so the layer
      // itself sits at the origin rather than where the card was dropped.
      position: '0 0 0',
      'tree-inventory': config
    }
  });
}

function waitForTrees(el) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Timed out waiting for tree data')),
      LOAD_TIMEOUT_MS
    );
    el.addEventListener(
      'trees-loaded',
      (e) => {
        clearTimeout(timer);
        resolve(e.detail);
      },
      { once: true }
    );
    el.addEventListener(
      'trees-error',
      (e) => {
        clearTimeout(timer);
        reject(new Error(e.detail.message));
      },
      { once: true }
    );
  });
}

const importTreesTool = {
  name: 'importTrees',
  description:
    'Place real street trees from a tree database around a location. ' +
    'Uses the scene location when latitude/longitude are omitted. ' +
    'Sources: ' +
    Object.entries(SOURCES)
      .map(([id, s]) => `"${id}" = ${s.label}`)
      .join('; ') +
    '. Defaults to the best source for the location.',
  inputSchema: {
    type: 'object',
    properties: {
      source: { type: 'string', enum: Object.keys(SOURCES) },
      latitude: { type: 'number' },
      longitude: { type: 'number' },
      shape: {
        type: 'string',
        enum: ['circle', 'box'],
        description:
          'circle uses radius; box uses width (east-west) and depth (north-south)'
      },
      radius: { type: 'number', description: 'meters, default 100' },
      width: { type: 'number', description: 'meters' },
      depth: { type: 'number', description: 'meters' },
      maxTrees: { type: 'number', description: 'default 200' }
    },
    required: []
  },
  handler: async (args) => {
    const el = await createTreeInventory(args);
    if (!el.components?.['tree-inventory']?.getQuery()) {
      throw new Error(
        'No location: set the scene location or pass latitude/longitude'
      );
    }
    const { count, source } = await waitForTrees(el);
    return { entityId: el.id, treesPlaced: count, source };
  }
};

registerPlugin(manifest, {
  components: { 'tree-inventory': treeInventoryComponent },
  layerCards: [
    {
      id: 'tree-inventory',
      name: 'Tree Inventory',
      description:
        'Real trees from OpenStreetMap or a city tree database, placed around the scene location.',
      icon: '',
      img: '',
      create: () => createTreeInventory()
    }
  ],
  tools: [importTreesTool],
  featured: {
    'tree-inventory': { hiddenProps: ['cache'] }
  }
});
