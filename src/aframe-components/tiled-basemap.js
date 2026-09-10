/* global AFRAME */
import { TilesRenderer } from '3d-tiles-renderer';
import {
  GeneratedSurfacePlugin,
  TilesFadePlugin,
  XYZTilesOverlay
} from '3d-tiles-renderer/plugins';

// Web Mercator equatorial circumference in meters. GeneratedSurfacePlugin's
// planar mode emits the whole world as a 1×1 normalized square centered at
// the origin in the XY plane, so scaling the tile group by
// CIRCUMFERENCE × cos(latitude) yields locally true meters at the scene's
// latitude (the cos term cancels Mercator's latitude stretch). Accuracy
// degrades with distance from the scene center — negligible at street scale.
const WEB_MERCATOR_CIRCUMFERENCE_M = 40075016.686;

const MathUtils = AFRAME.THREE.MathUtils;
const Vector3 = AFRAME.THREE.Vector3;

const _pos = new Vector3();

if (typeof AFRAME === 'undefined') {
  throw new Error(
    'Component attempted to register before AFRAME was available.'
  );
}

/**
 * Camera-driven tiled 2D basemap (#1962 step A).
 *
 * Streams raster XYZ ("slippy map") tiles as a planar tiled surface with
 * proper level-of-detail via the same 3d-tiles-renderer machinery that
 * powers `google-maps-aerial`: GeneratedSurfacePlugin builds a quadtree of
 * plane tiles from the overlay's tiling scheme and the TilesRenderer core
 * drives camera-based refinement, the download priority queue, fade and
 * unload. Replacement path for the static single-plane `mapbox2d` layer and
 * osm4vr's fixed-zoom `osm-tiles`.
 *
 * The surface is generated in the entity's local XY plane facing +Z, same
 * as the legacy map planes — hosts lay it flat with rotation "-90 -90 0"
 * (with A-Frame's YXZ rotation order that maps plane east → +Z world and
 * plane north → +X world, matching google3d's legacy frame).
 *
 * Lifecycle (camera tracking, opacity, failed-tile recovery on tab
 * visibility) mirrors google-maps-aerial.
 */
AFRAME.registerComponent('tiled-basemap', {
  schema: {
    // XYZ URL template with {z}/{x}/{y} placeholders. Provider/API-key
    // handling arrives with the provider registry (#1962 step B); until
    // then callers pass a full template.
    urlTemplate: { type: 'string', default: '' },
    latitude: { type: 'number', default: 0 },
    longitude: { type: 'number', default: 0 },
    // Deepest tile level to fetch. 20 ≈ 15 cm/px at mid latitudes.
    maxLevel: { type: 'number', default: 20 },
    opacity: { type: 'number', default: 1, min: 0, max: 1 }
  },

  init: function () {
    this.rootLoaded = false;
    this.onLoadRootTileSet = () => {
      this.rootLoaded = true;
      this.positionSurface();
    };
    this.onLoadModel = ({ scene }) => {
      // Apply opacity per tile as it loads — no per-frame traversal and no
      // flash of opaque tiles popping in (same pattern as google3d).
      if (this.data.opacity < 1) {
        this.applyOpacityToObject(scene);
      }
    };

    // Tiles whose fetch failed while the tab was hidden are marked FAILED
    // and never retried; clear them when the tab becomes visible again so
    // the next update() re-queues them (#1882, same as google3d).
    this.onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && this.tiles) {
        this.tiles.resetFailedTiles();
      }
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.createTiles();

    if (AFRAME.INSPECTOR && AFRAME.INSPECTOR.opened) {
      // emit play event to start loading tiles in aframe-inspector
      this.play();
    }
  },

  createTiles: function () {
    const data = this.data;
    if (!data.urlTemplate) {
      return;
    }

    this.overlay = new XYZTilesOverlay({
      url: data.urlTemplate,
      levels: data.maxLevel,
      tileDimension: 256
    });
    this.surfacePlugin = new GeneratedSurfacePlugin({
      overlay: this.overlay,
      shape: 'planar',
      applyOverlayTexture: true
    });

    this.tiles = new TilesRenderer();
    this.tiles.registerPlugin(this.surfacePlugin);
    this.tiles.registerPlugin(new TilesFadePlugin());
    this.tiles.addEventListener('load-root-tileset', this.onLoadRootTileSet);
    this.tiles.addEventListener('load-model', this.onLoadModel);

    this.el.object3D.add(this.tiles.group);

    this.renderer = this.el.sceneEl.renderer;
    this.activeCamera = this.el.sceneEl.camera;
    if (this.activeCamera) {
      this.tiles.setCamera(this.activeCamera);
      this.tiles.setResolutionFromRenderer(this.activeCamera, this.renderer);
    }
    this.tiles.update();
  },

  disposeTiles: function () {
    if (!this.tiles) {
      return;
    }
    this.rootLoaded = false;
    this.tiles.removeEventListener('load-root-tileset', this.onLoadRootTileSet);
    this.tiles.removeEventListener('load-model', this.onLoadModel);
    this.el.object3D.remove(this.tiles.group);
    this.tiles.dispose();
    this.tiles = null;
    this.surfacePlugin = null;
    this.overlay = null;
    this.activeCamera = null;
  },

  // Scale the normalized world-square to true meters at the scene latitude
  // and translate it so latitude/longitude lands on the entity's origin.
  // Requires the root tileset (the plugin's tiling scheme is derived from
  // the overlay during loadRootTileset), hence the rootLoaded gate.
  positionSurface: function () {
    if (!this.tiles || !this.surfacePlugin || !this.rootLoaded) {
      return;
    }
    const latRad = this.data.latitude * MathUtils.DEG2RAD;
    const lonRad = this.data.longitude * MathUtils.DEG2RAD;
    const scale = WEB_MERCATOR_CIRCUMFERENCE_M * Math.cos(latRad);
    this.surfacePlugin.getPositionFromCartographic(latRad, lonRad, _pos);
    this.tiles.group.scale.setScalar(scale);
    this.tiles.group.position.set(-_pos.x * scale, -_pos.y * scale, 0);
  },

  // Set opacity on every material under `object`, once — tiles keep their
  // stock materials, so no extra draw cost at opacity 1 and only standard
  // alpha blending below it (same as google-maps-aerial).
  applyOpacityToObject: function (object) {
    const opacity = this.data.opacity;
    const transparent = opacity < 1;
    object.traverse((obj) => {
      if (obj.material) {
        const materials = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        for (const material of materials) {
          if (material.transparent !== transparent) {
            material.transparent = transparent;
            material.needsUpdate = true;
          }
          material.opacity = opacity;
        }
      }
    });
  },

  applyOpacityToLoadedTiles: function () {
    if (!this.tiles) {
      return;
    }
    this.tiles.forEachLoadedModel((scene) => {
      this.applyOpacityToObject(scene);
    });
  },

  update: function (oldData) {
    const data = this.data;

    // A changed tile source invalidates every loaded tile: rebuild.
    if (
      oldData.urlTemplate !== undefined &&
      (oldData.urlTemplate !== data.urlTemplate ||
        oldData.maxLevel !== data.maxLevel)
    ) {
      this.disposeTiles();
      this.createTiles();
      return;
    }

    if (
      oldData.latitude !== data.latitude ||
      oldData.longitude !== data.longitude
    ) {
      this.positionSurface();
    }

    if (this.tiles && oldData.opacity !== data.opacity) {
      this.applyOpacityToLoadedTiles();
    }
  },

  tick: function () {
    // At opacity 0 the layer is fully hidden (street-geo sets visible:false
    // on this entity), so skip tiles.update() entirely — no tile downloads
    // while invisible. Resumes on the first tick after opacity returns.
    if (this.data.opacity <= 0) {
      return;
    }
    if (this.tiles && this.el.sceneEl.camera) {
      // Track the scene's active camera; register only on change so the
      // tileset doesn't refine against stale cameras after mode switches.
      const camera = this.el.sceneEl.camera;
      if (camera !== this.activeCamera) {
        if (this.activeCamera) {
          this.tiles.deleteCamera(this.activeCamera);
        }
        this.tiles.setCamera(camera);
        this.activeCamera = camera;
      }
      this.tiles.setResolutionFromRenderer(camera, this.renderer);
      this.tiles.update();
    }
  },

  remove: function () {
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.disposeTiles();
  }
});
