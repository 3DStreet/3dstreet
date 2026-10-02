/**
 * `tree-inventory` component: places a tree model for every tree a data
 * source reports inside an area (circle radius or box) around a location.
 *
 * The fetched trees are stored in the `cache` property, so a saved scene
 * reloads offline and identically. A fetch only happens when the query
 * (source, center, area, maxTrees) no longer matches the cache, e.g. after
 * the user edits the radius in the properties panel.
 *
 * Emits `trees-loaded` { count, source } and `trees-error` { message }.
 */

import { geo, getSceneGeoOrigin, notify } from '../api.js';
import {
  SOURCES,
  decodeCache,
  encodeCache,
  fetchTrees,
  modelForTree,
  queryKey,
  yawForTree
} from './tree-sources.js';

const FETCH_DEBOUNCE_MS = 600;

/** "Platanus x hispanica :: Sycamore, London Plane" → "Sycamore, London Plane" */
function displayName(species) {
  if (!species) return 'Tree';
  const parts = species.split(/ :: | - /).filter(Boolean);
  return parts[parts.length - 1] || 'Tree';
}

export const treeInventoryComponent = {
  schema: {
    source: { type: 'string', default: 'osm', oneOf: Object.keys(SOURCES) },
    // 0, 0 means "the scene's location" (street-geo)
    latitude: { type: 'number', default: 0 },
    longitude: { type: 'number', default: 0 },
    shape: { type: 'string', default: 'circle', oneOf: ['circle', 'box'] },
    radius: { type: 'number', default: 100, min: 1, max: 1000 },
    width: { type: 'number', default: 200, min: 1, max: 2000 },
    depth: { type: 'number', default: 200, min: 1, max: 2000 },
    maxTrees: { type: 'int', default: 200, min: 1, max: 1000 },
    defaultModel: { type: 'string', default: 'tree3' },
    cache: { type: 'string', default: '' }
  },

  init: function () {
    this.treeEls = [];
    this.fetchTimer = null;
    this.abortController = null;
  },

  update: function () {
    const query = this.getQuery();
    if (!query) {
      this.clearTrees();
      return;
    }
    const key = queryKey(query);
    const cache = decodeCache(this.data.cache);
    if (cache && cache.key === key) {
      this.cancelFetch();
      this.renderTrees(cache.trees, query.center);
      return;
    }
    this.scheduleFetch(query, key);
  },

  remove: function () {
    this.cancelFetch();
    this.clearTrees();
  },

  getCenter: function () {
    if (this.data.latitude || this.data.longitude) {
      return { lat: this.data.latitude, lon: this.data.longitude };
    }
    return getSceneGeoOrigin();
  },

  getQuery: function () {
    const center = this.getCenter();
    if (!center) return null;
    const d = this.data;
    return {
      source: d.source,
      center,
      area:
        d.shape === 'box'
          ? { shape: 'box', width: d.width, depth: d.depth }
          : { shape: 'circle', radius: d.radius },
      maxTrees: d.maxTrees
    };
  },

  scheduleFetch: function (query, key) {
    this.cancelFetch();
    // Panel edits arrive keystroke by keystroke; wait for them to settle.
    this.fetchTimer = setTimeout(
      () => this.runFetch(query, key),
      FETCH_DEBOUNCE_MS
    );
  },

  cancelFetch: function () {
    clearTimeout(this.fetchTimer);
    this.fetchTimer = null;
    this.abortController?.abort();
    this.abortController = null;
  },

  runFetch: async function (query, key) {
    const controller = new AbortController();
    this.abortController = controller;
    const label = SOURCES[query.source].label;
    try {
      const trees = await fetchTrees({ ...query, signal: controller.signal });
      if (controller.signal.aborted) return;
      this.abortController = null;
      // Writing the cache re-runs update(), which renders from it.
      this.el.setAttribute('tree-inventory', 'cache', encodeCache(key, trees));
      if (trees.length) {
        notify.success(`Placed ${trees.length} trees from ${label}`);
      } else {
        notify.warning(
          `No trees found here in ${label}. Try another source or a larger area.`
        );
      }
      this.el.emit('trees-loaded', {
        count: trees.length,
        source: query.source
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      this.abortController = null;
      console.warn('[tree-inventory] fetch failed', err);
      notify.error(`Could not load trees from ${label}`);
      this.el.emit('trees-error', { message: err.message });
    }
  },

  clearTrees: function () {
    this.treeEls.forEach((el) => el.parentNode?.removeChild(el));
    this.treeEls = [];
  },

  renderTrees: function (trees, center) {
    this.clearTrees();
    // Trees sit in scene meters relative to the scene's geographic origin
    // (+x north, +z east), so they line up with the map layers; without a
    // scene location they are laid out around the query center instead.
    const origin = getSceneGeoOrigin() || center;
    for (const tree of trees) {
      const { x, z } = geo.latLonToLocal(origin, tree);
      const el = document.createElement('a-entity');
      // Procedural output: regenerated from `cache` on load, never saved.
      el.classList.add('autocreated');
      el.setAttribute('data-no-transform', '');
      el.setAttribute('data-layer-name', displayName(tree.species));
      el.setAttribute('mixin', modelForTree(tree, this.data.defaultModel));
      el.setAttribute('position', `${x.toFixed(2)} 0 ${z.toFixed(2)}`);
      el.setAttribute('rotation', `0 ${yawForTree(tree)} 0`);
      this.el.appendChild(el);
      this.treeEls.push(el);
    }
  }
};
