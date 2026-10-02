/**
 * 3DStreet plugin API — the one module a plugin may import from outside its
 * own folder. Docs: docs/plugins.md. Rules for agents: src/plugins/CLAUDE.md.
 *
 * A plugin is a folder `src/plugins/<id>/` with a `manifest.json` and an
 * `index.js` that calls `registerPlugin(manifest, { ... })`. The loader
 * (`./index.js`) discovers every folder, so adding a plugin never edits core
 * files.
 *
 * Two rules keep plugins contained:
 *
 * 1. **Components always register.** A saved scene that uses a plugin's
 *    component must load and re-save without losing data even when the
 *    plugin is switched off, so `components` are registered unconditionally.
 *    A component is inert until an entity carries it.
 * 2. **Entry points are gated.** Add Layer cards, AI/WebMCP tools and the
 *    featured properties section only appear when the plugin is enabled:
 *    `status: "stable"` in the manifest, or listed in `?plugins=a,b` /
 *    `?plugins=all` / `localStorage['3dstreet.plugins']`.
 *
 * This module must stay free of editor and store imports so plugins (and
 * their unit tests) can load it without the editor.
 */

import {
  NORTH_M_PER_DEG,
  eastMPerDeg,
  latLonToLocal,
  localToLatLon
} from '../tested/osm-street-import.js';
import { fetchOverpass } from '../osm/overpass-fetch.js';

const plugins = new Map(); // id → { manifest, layerCards, tools, featured }

const STORAGE_KEY = '3dstreet.plugins';

function readFlagList() {
  const ids = new Set();
  try {
    const param = new URLSearchParams(window.location.search).get('plugins');
    if (param) param.split(',').forEach((id) => ids.add(id.trim()));
  } catch (e) {
    // no window (unit tests) — nothing enabled by flag
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) stored.split(',').forEach((id) => ids.add(id.trim()));
  } catch (e) {
    // storage blocked (private window) — URL flag still works
  }
  return ids;
}

/** Whether a registered plugin's entry points (cards, tools, panel) show. */
export function isPluginEnabled(id) {
  const entry = plugins.get(id);
  if (!entry) return false;
  if (entry.manifest.status === 'stable') return true;
  const flags = readFlagList();
  return flags.has('all') || flags.has(id);
}

/**
 * Register a plugin.
 *
 * @param {object} manifest the plugin's manifest.json (id, name, status, ...)
 * @param {object} parts
 * @param {object} [parts.components] { name: A-Frame component definition }
 * @param {object[]} [parts.layerCards] Add Layer cards:
 *   { id, name, description, icon?, img?, create(position) }
 * @param {object[]} [parts.tools] AI/WebMCP tools:
 *   { name, description, inputSchema, handler(args) }
 * @param {object} [parts.featured] { componentName: { hiddenProps: [...] } }
 *   shows the component's schema as a first-class properties-panel section.
 */
export function registerPlugin(manifest, parts = {}) {
  if (!manifest?.id) throw new Error('Plugin manifest needs an id');
  if (plugins.has(manifest.id)) {
    throw new Error(`Plugin "${manifest.id}" is registered twice`);
  }
  const { components = {}, layerCards = [], tools = [], featured = {} } = parts;

  for (const [name, definition] of Object.entries(components)) {
    if (!AFRAME.components[name]) {
      AFRAME.registerComponent(name, definition);
    }
  }
  for (const tool of tools) {
    for (const other of plugins.values()) {
      if (other.tools.some((t) => t.name === tool.name)) {
        throw new Error(`Duplicate plugin tool name: ${tool.name}`);
      }
    }
  }

  plugins.set(manifest.id, {
    manifest,
    layerCards: layerCards.map((card) => ({
      ...card,
      id: `plugin:${manifest.id}:${card.id}`,
      pluginId: manifest.id,
      handlerFunction: card.create
    })),
    tools,
    featured
  });
}

export function getRegisteredPlugins() {
  return Array.from(plugins.values()).map((entry) => ({
    ...entry.manifest,
    enabled: isPluginEnabled(entry.manifest.id)
  }));
}

function enabledEntries() {
  return Array.from(plugins.values()).filter((entry) =>
    isPluginEnabled(entry.manifest.id)
  );
}

/** Add Layer cards from enabled plugins (shown under ⚙️ Custom). */
export function getPluginLayerCards() {
  return enabledEntries().flatMap((entry) => entry.layerCards);
}

/** AI/WebMCP tools from enabled plugins. */
export function getPluginTools() {
  return enabledEntries().flatMap((entry) => entry.tools);
}

/** Featured-section config for a component, or null. */
export function getPluginFeaturedComponent(componentName) {
  for (const entry of enabledEntries()) {
    if (entry.featured[componentName]) return entry.featured[componentName];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers plugins may use. Prefer adding a helper here over importing core.
// ---------------------------------------------------------------------------

/**
 * The scene's geographic origin from the street-geo layer, or null when the
 * scene has no location. Scene axes: +x = north, +z = east (meters), the
 * same projection as the 2D basemap and OSM layers.
 */
export function getSceneGeoOrigin() {
  const geo = document
    .querySelector('#reference-layers[street-geo]')
    ?.getAttribute('street-geo');
  if (!geo || (!geo.latitude && !geo.longitude)) return null;
  return { lat: geo.latitude, lon: geo.longitude };
}

export const geo = {
  latLonToLocal,
  localToLatLon,
  /** meters per degree of latitude */
  northMPerDeg: NORTH_M_PER_DEG,
  /** meters per degree of longitude at a latitude */
  eastMPerDeg,
  fetchOverpass
};

/** Toast messages; no-ops where the notify component isn't mounted. */
export const notify = {
  success: (msg) => STREET?.notify?.successMessage?.(msg),
  error: (msg) => STREET?.notify?.errorMessage?.(msg),
  warning: (msg) => STREET?.notify?.warningMessage?.(msg),
  info: (msg) => STREET?.notify?.infoMessage?.(msg)
};

/**
 * Create a scene entity through the editor's command layer (undoable) when
 * the editor is running, else directly. `definition` is the entitycreate
 * payload: { 'data-layer-name', components: { name: value }, ... }.
 * Resolves with the created entity.
 */
export function createEntity(definition) {
  if (AFRAME.INSPECTOR?.execute) {
    return new Promise((resolve) => {
      AFRAME.INSPECTOR.execute('entitycreate', definition, undefined, resolve);
    });
  }
  const el = document.createElement('a-entity');
  for (const [key, value] of Object.entries(definition)) {
    if (key !== 'components') el.setAttribute(key, value);
  }
  for (const [name, value] of Object.entries(definition.components || {})) {
    el.setAttribute(name, value);
  }
  document.querySelector('a-scene').appendChild(el);
  return Promise.resolve(el);
}
