/* global AFRAME */
/**
 * `geo-layer`: one Geospatial Data Source drawn as an overlay layer (#2090).
 *
 * Each data layer is its own entity, a child of `#reference-layers` (the
 * entity that carries `street-geo`):
 *
 *   <a-entity id="reference-layers" street-geo="latitude: 37.79; ...">
 *     <a-entity data-layer-name="San Francisco c. 1769 (Yelamu)"
 *               geo-layer="source: yelamu-1769; opacity: 70"></a-entity>
 *   </a-entity>
 *
 * - **Why an entity, not a component on `#reference-layers`.** A data layer
 *   is a thing with its own identity and lifecycle: users show, hide,
 *   select, rename, reorder and delete it, and #2090's per-layer state
 *   (skips of features detached by source ID) lives on the layer. The scene
 *   graph, properties panel, undo, save and the AI tools already do all of
 *   that for entities.
 * - **Pinned in place.** Its geometry is placed by geography, so the entity
 *   must not be moved: `data-no-transform` hides the gizmo and transform
 *   rows, and its transform kind (src/tested/transform-kinds.js) refuses a
 *   scale, a tilt or a move to another parent at the command layer.
 * - **Base map vs overlays.** `street-geo.maps` stays the single base map;
 *   any number of data layers draw on top of it, each with its own opacity,
 *   so an overlay can be cross-faded against the base map (1769 vs today).
 * - **Intent in scenes, facts in sources.** The entity and its settings
 *   save with the scene; the meshes are built from the source at load and
 *   never serialized.
 * - **Kinds.** `GEO_LAYER_KINDS` maps a descriptor's `kind` to a renderer
 *   `{ load(source) → Promise<model>, build(model, geo, options) }`.
 *
 * Doc: docs/geo-data-layers.md.
 */
import {
  getDataSource,
  GEO_LAYER_KINDS as KIND_IDS
} from '../tested/geo-data-sources.js';
import { applyReferenceLayerOpacity } from '../tested/transparent-layering.js';
import { NO_SCALE, YAW_ONLY, NO_REPARENT } from '../tested/transform-kinds.js';
import { terrainGridKind } from './geo-layer-terrain-grid.js';
import { debugLog } from '../shared/utils/debug.js';

export const GEO_LAYER_KINDS = {
  [KIND_IDS.TERRAIN_GRID]: terrainGridKind
};

// street-geo fields that move the layer; a change to any other street-geo
// property (map type, base map opacity, ...) leaves the layer as it is.
const ORIGIN_FIELDS = [
  'latitude',
  'longitude',
  'ellipsoidalHeight',
  'geoidHeight',
  'orthometricHeight'
];

// Live instances, for the shared credit line.
const activeLayers = new Set();

function renderCredits() {
  const el = document.getElementById('geo-layer-credits');
  if (!el) return;
  el.textContent = '';
  const sources = [];
  for (const layer of activeLayers) {
    if (layer.built && !sources.includes(layer.source)) {
      sources.push(layer.source);
    }
  }
  for (const source of sources) {
    const line = document.createElement('div');
    const link = document.createElement('a');
    link.href = source.homepage || source.sourceRepository || source.baseUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.name;
    line.append(link, ` — ${source.attribution}.`);
    if (source.caveat) line.append(` ${source.caveat}`);
    el.appendChild(line);
  }
  el.style.visibility = sources.length ? 'visible' : 'hidden';
}

function readOrigin(geoEl) {
  const geo = geoEl?.components?.['street-geo']?.data;
  if (!geo) return null;
  const origin = {};
  for (const field of ORIGIN_FIELDS) origin[field] = geo[field];
  // 0,0 is street-geo's "no location" default.
  if (
    !Number.isFinite(origin.latitude) ||
    !Number.isFinite(origin.longitude) ||
    (origin.latitude === 0 && origin.longitude === 0)
  ) {
    return null;
  }
  return origin;
}

function sameOrigin(a, b) {
  if (!a || !b) return a === b;
  return ORIGIN_FIELDS.every(
    (f) => a[f] === b[f] || (Number.isNaN(a[f]) && Number.isNaN(b[f]))
  );
}

function disposeObject(object) {
  object.traverse((node) => {
    if (node.geometry) node.geometry.dispose();
    const materials = Array.isArray(node.material)
      ? node.material
      : node.material
        ? [node.material]
        : [];
    for (const m of materials) {
      m.map?.dispose();
      m.dispose();
    }
  });
}

AFRAME.registerComponent('geo-layer', {
  schema: {
    // Registry id (src/tested/geo-data-sources.js).
    source: { type: 'string', default: '' },
    // Percent, like street-geo.opacity. 0 skips drawing.
    opacity: { type: 'number', default: 100, min: 0, max: 100 },
    // Metres around the street-geo origin to draw.
    radius: { type: 'number', default: 2000, min: 250, max: 6000 },
    // Feature toggles for terrain-grid sources.
    water: { type: 'boolean', default: true },
    creeks: { type: 'boolean', default: true }
  },

  init: function () {
    const el = this.el;
    // Transform kind 'geo-layer' (src/tested/transform-kinds.js): the
    // command guard reads the kind; the stock gizmo reads these markers.
    el.setAttribute(NO_SCALE, '');
    el.setAttribute(YAW_ONLY, '');
    el.setAttribute(NO_REPARENT, '');
    // UI gate: no gizmo and no transform rows.
    el.setAttribute('data-no-transform', '');
    el.setAttribute('data-ignore-raycaster', '');

    this.generation = 0;
    this.source = null;
    this.built = false;
    this.builtOrigin = null;
    // The street-geo entity is the parent (#reference-layers); a layer
    // anywhere else has no origin and draws nothing.
    this.geoEl = el.parentEl?.hasAttribute('street-geo')
      ? el.parentEl
      : el.closest('#reference-layers');
    this.onGeoChanged = (event) => {
      if (event.target !== this.geoEl) return;
      if (event.detail?.name !== 'street-geo') return;
      if (!sameOrigin(readOrigin(this.geoEl), this.builtOrigin)) {
        this.rebuild();
      }
    };
    this.geoEl?.addEventListener('componentchanged', this.onGeoChanged);
    this.geoEl?.addEventListener('componentinitialized', this.onGeoChanged);
    activeLayers.add(this);
  },

  update: function (oldData) {
    const diff = AFRAME.utils.diff(oldData || {}, this.data);
    const structural = ['source', 'radius', 'water', 'creeks'].some(
      (key) => key in diff
    );
    if (structural || !oldData || !Object.keys(oldData).length) {
      this.rebuild();
    } else if ('opacity' in diff) {
      this.applyOpacity();
    }
  },

  remove: function () {
    this.geoEl?.removeEventListener('componentchanged', this.onGeoChanged);
    this.geoEl?.removeEventListener('componentinitialized', this.onGeoChanged);
    this.generation++;
    this.clear();
    activeLayers.delete(this);
    renderCredits();
  },

  /** Rebuild from scratch for the current source and origin. */
  rebuild: async function () {
    const generation = ++this.generation;
    const el = this.el;
    const source = getDataSource(this.data.source);
    const kind = source && GEO_LAYER_KINDS[source.kind];
    if (!kind) {
      if (this.data.source) {
        console.warn(`geo-layer: unknown data source "${this.data.source}"`);
      }
      this.clear();
      return;
    }
    if (!el.getAttribute('data-layer-name')) {
      el.setAttribute('data-layer-name', source.name);
    }
    const origin = readOrigin(this.geoEl);
    if (!origin) {
      // No location yet; a street-geo change retries.
      this.clear();
      return;
    }

    el.emit('stream-active', { kind: 'geo-layer' });
    try {
      const model = await kind.load(source);
      if (generation !== this.generation) return;
      const { object, info } = kind.build(model, origin, this.data);
      if (generation !== this.generation) {
        if (object) disposeObject(object);
        return;
      }
      this.replaceObject(object);
      this.source = source;
      this.builtOrigin = origin;
      this.built = Boolean(object);
      this.applyOpacity();
      debugLog('[geo-layer]', source.id, info);
      if (info.status === 'outside') {
        console.info(
          `geo-layer: the scene location is outside ${source.name}'s coverage`
        );
      }
      el.emit('geo-layer-built', { source: source.id, ...info });
    } catch (err) {
      if (generation !== this.generation) return;
      console.warn(`geo-layer: could not load ${source.id}`, err);
      el.emit('geo-layer-error', { source: source.id, message: err.message });
    } finally {
      el.emit('stream-idle', { kind: 'geo-layer' });
      renderCredits();
    }
  },

  replaceObject: function (object) {
    const old = this.el.getObject3D('mesh');
    if (old) {
      this.el.removeObject3D('mesh');
      disposeObject(old);
    }
    if (object) this.el.setObject3D('mesh', object);
  },

  applyOpacity: function () {
    const object = this.el.getObject3D('mesh');
    if (!object) return;
    const opacity = this.data.opacity / 100;
    // Opacity 0 skips the draw. This is the layer's own inner group, not an
    // entity's object3D: the entity's `visible` stays the user's show/hide
    // toggle, and this mesh is never batched.
    object.visible = opacity > 0;
    if (opacity > 0) applyReferenceLayerOpacity(object, opacity);
  },

  clear: function () {
    this.replaceObject(null);
    this.built = false;
    this.builtOrigin = null;
    renderCredits();
  }
});
