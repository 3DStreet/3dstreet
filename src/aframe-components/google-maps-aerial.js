import { TilesRenderer } from '3d-tiles-renderer';
import {
  TilesFadePlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  TileFlatteningPlugin,
  ReorientationPlugin
} from '3d-tiles-renderer/plugins';

// The pre-0.5.0 setLatLonToYUp() oriented the tileset with +Y altitude,
// +X north, +Z east. ReorientationPlugin's default frame is +X west,
// +Z north; a 90° azimuth reproduces the legacy frame exactly, keeping
// every previously saved geo scene aligned.
const LEGACY_AZIMUTH = Math.PI / 2;

const MathUtils = AFRAME.THREE.MathUtils;
const Vector3 = AFRAME.THREE.Vector3;
const Box3 = AFRAME.THREE.Box3;
const Matrix4 = AFRAME.THREE.Matrix4;

const _relativeMatrix = new Matrix4();

if (typeof AFRAME === 'undefined') {
  throw new Error(
    'Component attempted to register before AFRAME was available.'
  );
}

AFRAME.registerComponent('google-maps-aerial', {
  schema: {
    apiToken: { type: 'string', default: '' },
    latitude: { type: 'number', default: 37.795 }, // SF Ferry Building
    longitude: { type: 'number', default: -122.394 },
    minDistance: { type: 'number', default: 500 },
    maxDistance: { type: 'number', default: 20000 },
    ellipsoidalHeight: { type: 'number', default: 0 },
    copyrightEl: { type: 'selector' },
    enableFlattening: { type: 'boolean', default: false },
    flatteningShape: { type: 'string', default: '' },
    opacity: { type: 'number', default: 1, min: 0, max: 1 }
  },

  init: function () {
    // Initialize tiles
    this.tiles = new TilesRenderer(
      'https://tile.googleapis.com/v1/3dtiles/root.json'
    );

    // Register plugins
    this.tiles.registerPlugin(
      new GoogleCloudAuthPlugin({ apiToken: this.data.apiToken })
    );
    this.tiles.registerPlugin(new TileCompressionPlugin());
    this.tiles.registerPlugin(new TilesFadePlugin());
    this.tiles.registerPlugin(
      new GLTFExtensionsPlugin({
        dracoLoader: this.el.sceneEl.systems['gltf-model'].getDRACOLoader()
      })
    );

    // Always create flattening plugin to support runtime toggling
    this.flatteningPlugin = new TileFlatteningPlugin();
    this.tiles.registerPlugin(this.flatteningPlugin);

    // Set location (replaces the setLatLonToYUp() API removed in 0.5.0)
    this.reorientationPlugin = new ReorientationPlugin({
      lat: this.data.latitude * MathUtils.DEG2RAD,
      lon: this.data.longitude * MathUtils.DEG2RAD,
      height: 0,
      azimuth: LEGACY_AZIMUTH
    });
    this.tiles.registerPlugin(this.reorientationPlugin);

    this.tiles.addEventListener('load-model', ({ scene }) => {
      // Apply opacity to each tile as it loads, before its first render —
      // no per-frame traversal, and no flash of opaque tiles popping in.
      if (this.data.opacity < 1) {
        this.applyOpacityToObject(scene);
      }

      if (this.data.copyrightEl) {
        this.data.copyrightEl.innerHTML =
          this.tiles.getAttributions()[0]?.value || '';
      }

      // Add flattening shape after tiles are loaded
      if (
        this.data.enableFlattening &&
        this.data.flatteningShape &&
        !this.flatteningShape
      ) {
        this.addFlatteningShape(this.data.flatteningShape);
      }
    });

    // Create a child entity for the height offset
    const offsetEl = document.createElement('a-entity');
    offsetEl.object3D.position.y = -this.data.ellipsoidalHeight;
    offsetEl.object3D.add(this.tiles.group);
    this.el.appendChild(offsetEl);
    this.offsetEl = offsetEl;

    // Get renderer
    this.renderer = this.el.sceneEl.renderer;

    this.activeCamera = this.el.sceneEl.camera;
    this.tiles.setCamera(this.activeCamera);
    this.tiles.setResolutionFromRenderer(this.activeCamera, this.renderer);
    this.tiles.update();

    if (AFRAME.INSPECTOR && AFRAME.INSPECTOR.opened) {
      // emit play event to start load tiles in aframe-inspector
      this.play();
    }
  },

  // Set opacity on every material under `object`, once — tiles keep their
  // stock materials (no custom shader), so there is no extra draw cost when
  // opacity is 1 and only standard alpha blending when it is below 1.
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

  addFlatteningShape: function (shapeSelector) {
    if (!this.flatteningPlugin || !shapeSelector) return;

    const testMeshEl = document.querySelector(shapeSelector);
    if (!testMeshEl) return;

    const testMesh = testMeshEl.object3D.children[0];
    if (!testMesh) return;

    // Ensure world transforms are up to date
    this.tiles.group.updateMatrixWorld();
    testMesh.updateMatrixWorld(true);

    // Transform the shape into the local frame of the tile set
    const relativeShape = testMesh.clone();
    relativeShape.matrixWorld
      .premultiply(this.tiles.group.matrixWorldInverse)
      .decompose(
        relativeShape.position,
        relativeShape.quaternion,
        relativeShape.scale
      );

    // Calculate the direction to flatten on using ellipsoid
    const direction = new Vector3();
    const box = new Box3();
    box.setFromObject(relativeShape);
    box.getCenter(direction);
    this.tiles.ellipsoid
      .getPositionToNormal(direction, direction)
      .multiplyScalar(-1);

    // Add the transformed plane as a flattening shape
    this.flatteningPlugin.addShape(relativeShape, direction, {
      threshold: Infinity
    });

    // Store references for cleanup and updates
    this.flatteningShape = relativeShape;
    this.flatteningShapeEl = testMeshEl;
    this.originalFlatteningMesh = testMesh;
    this.lastFlatteningMatrix = new Matrix4().copy(relativeShape.matrixWorld);
  },

  tick: function () {
    // At opacity 0 the layer is fully hidden (street-geo sets visible:false
    // on this entity), so skip tiles.update() entirely — otherwise the
    // tileset keeps frustum-testing and downloading metered Google 3D Tiles
    // API data for tiles nobody can see. Resumes on the first tick after
    // opacity returns above 0.
    if (this.data.opacity <= 0) {
      return;
    }
    if (this.tiles && this.el.sceneEl.camera) {
      // Track the scene's active camera. Registering only on change (and
      // deleting the previous registration) keeps the tileset from
      // frustum-testing and loading tiles for stale cameras after mode
      // switches (editor <-> viewer <-> drive).
      const camera = this.el.sceneEl.camera;
      if (camera !== this.activeCamera) {
        if (this.activeCamera) {
          this.tiles.deleteCamera(this.activeCamera);
        }
        this.tiles.setCamera(camera);
        this.activeCamera = camera;
      }
      this.tiles.setResolutionFromRenderer(camera, this.renderer);

      // Update flattening shape only when its transform relative to the
      // tile set actually changed — updateShape() forces a full CPU
      // re-flatten (per-vertex raycasts) of every active tile.
      if (
        this.flatteningPlugin &&
        this.flatteningShape &&
        this.originalFlatteningMesh
      ) {
        // The shape was cloned from the host mesh, sharing its geometry by
        // reference. Editing the host's geometry (e.g. box width/depth/height
        // in the geometry controls) replaces that geometry instance, so the
        // clone goes stale — detect the swap and rebuild the shape.
        const currentMesh = this.flatteningShapeEl?.object3D.children[0];
        if (
          currentMesh &&
          (currentMesh !== this.originalFlatteningMesh ||
            currentMesh.geometry !== this.flatteningShape.geometry)
        ) {
          this.flatteningPlugin.deleteShape(this.flatteningShape);
          this.flatteningShape = null;
          this.originalFlatteningMesh = null;
          this.addFlatteningShape(this.data.flatteningShape);
          this.tiles.update();
          return;
        }

        // Update world transforms
        this.tiles.group.updateMatrixWorld();
        this.originalFlatteningMesh.updateMatrixWorld(true);

        _relativeMatrix
          .copy(this.originalFlatteningMesh.matrixWorld)
          .premultiply(this.tiles.group.matrixWorldInverse);

        if (!_relativeMatrix.equals(this.lastFlatteningMatrix)) {
          this.lastFlatteningMatrix.copy(_relativeMatrix);

          // Re-transform the shape into the local frame of the tile set
          this.flatteningShape.matrixWorld
            .copy(_relativeMatrix)
            .decompose(
              this.flatteningShape.position,
              this.flatteningShape.quaternion,
              this.flatteningShape.scale
            );

          this.flatteningPlugin.updateShape(this.flatteningShape);
        }
      }

      this.tiles.update();
    }
  },

  remove: function () {
    if (this.tiles) {
      // Clean up flattening shape
      if (this.flatteningPlugin && this.flatteningShape) {
        this.flatteningPlugin.deleteShape(this.flatteningShape);
        this.flatteningShape = null;
        this.originalFlatteningMesh = null;
      }

      if (this.offsetEl) {
        this.offsetEl.removeFromParent();
        this.offsetEl = null;
      }
      this.tiles.dispose();
      this.tiles = null;
      this.reorientationPlugin = null;
      this.activeCamera = null;
    }
  },

  update: function (oldData) {
    // Handle property updates
    if (
      this.tiles &&
      (oldData.latitude !== this.data.latitude ||
        oldData.longitude !== this.data.longitude ||
        oldData.ellipsoidalHeight !== this.data.ellipsoidalHeight)
    ) {
      const plugin = this.reorientationPlugin;
      // Keep the plugin's fields in sync so its pending load-root-tileset
      // callback (if the root hasn't loaded yet) uses the new location too.
      //
      // UPGRADE REVIEW (3d-tiles-renderer > 0.5.0): plugin.lat/lon are
      // incidentally-public instance fields — the shipped .d.ts/API.md
      // document them only as constructor options, so a future refactor to
      // private fields would silently break this pre-root-load sync. On any
      // 3d-tiles-renderer (or this component) upgrade, revisit PR #1862
      // review item 10: the supported path is tiles.unregisterPlugin(plugin)
      // + registering a fresh ReorientationPlugin built by a shared options
      // factory, which also de-duplicates height/azimuth between init and
      // here.
      plugin.lat = this.data.latitude * MathUtils.DEG2RAD;
      plugin.lon = this.data.longitude * MathUtils.DEG2RAD;
      plugin.transformLatLonHeightToOrigin(
        plugin.lat,
        plugin.lon,
        0,
        LEGACY_AZIMUTH
      );
      this.offsetEl.object3D.position.y = -this.data.ellipsoidalHeight;
    }

    if (this.tiles && oldData.opacity !== this.data.opacity) {
      this.applyOpacityToLoadedTiles();
    }

    // Handle flattening changes
    const flatteningChanged =
      oldData.enableFlattening !== this.data.enableFlattening;
    const shapeChanged = oldData.flatteningShape !== this.data.flatteningShape;

    if (flatteningChanged || shapeChanged) {
      // Remove old shape if it exists
      if (this.flatteningShape) {
        this.flatteningPlugin.deleteShape(this.flatteningShape);
        this.flatteningShape = null;
        this.originalFlatteningMesh = null;
      }

      // Add new shape if flattening is enabled and we have a shape
      if (this.data.enableFlattening && this.data.flatteningShape) {
        this.addFlatteningShape(this.data.flatteningShape);
      }
    }
  }
});
