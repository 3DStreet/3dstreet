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

// Minimum interval between flattening-shape updates while a shape is being
// dragged. Every TileFlatteningPlugin shape update forces a CPU re-flatten
// (per-vertex raycasts) of all active tiles, so during a transform drag we
// batch matrix changes and apply at most one re-flatten per interval; the
// trailing update always lands once the drag settles.
const FLATTEN_UPDATE_THROTTLE_MS = 150;

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
    opacity: { type: 'number', default: 1, min: 0, max: 1 }
  },

  init: function () {
    // Initialize tiles
    this.tiles = new TilesRenderer(
      'https://tile.googleapis.com/v1/3dtiles/root.json'
    );

    // Register plugins
    this.tiles.registerPlugin(
      new GoogleCloudAuthPlugin({
        apiToken: this.data.apiToken,
        // Google's 3D Tiles session token expires after a few hours; without
        // this, a tab resumed after sleep/long inactivity gets 4xx on every
        // tile request and needs a reload. With it, the plugin re-fetches
        // root.json for a fresh session and retries the request (#1882).
        autoRefreshToken: true
      })
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

    // Flattening volumes come from the geo-flatten registry (#1476): one
    // entry per active [geo-flatten] entity, keyed by its component. Synced
    // lazily in tick — the dirty flag flips on any registry change and on
    // enableFlattening toggles.
    this.flattenEntries = new Map();
    this.flattenRegistryDirty = true;
    this.lastFlattenApplyTime = -Infinity;
    this.onFlattenRegistryChanged = () => {
      this.flattenRegistryDirty = true;
    };
    this.el.sceneEl.addEventListener(
      'geo-flatten-registry-changed',
      this.onFlattenRegistryChanged
    );

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

    // Tiles whose fetch failed while the tab was hidden (system sleep drops
    // the network mid-request, or the session expired before autoRefreshToken
    // could kick in) are marked FAILED and never retried, leaving permanent
    // holes in the map. Clear the failed state when the tab becomes visible
    // again so the next update() re-queues them (#1882).
    this.onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && this.tiles) {
        this.tiles.resetFailedTiles();
      }
    };
    document.addEventListener('visibilitychange', this.onVisibilityChange);
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

  // Register one geo-flatten component's mesh with the flattening plugin.
  // Returns false when the component has no mesh yet (e.g. a street whose
  // models are still loading) so the caller can retry.
  addFlattenEntry: function (component) {
    const sourceMesh = component.getFlattenMesh();
    if (!sourceMesh) return false;

    // Ensure world transforms are up to date
    this.tiles.group.updateMatrixWorld();

    // Transform the shape into the local frame of the tile set
    const relativeShape = sourceMesh.clone();
    relativeShape.matrixWorld
      .copy(sourceMesh.matrixWorld)
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

    // Add the transformed shape as a flattening shape
    this.flatteningPlugin.addShape(relativeShape, direction, {
      threshold: Infinity
    });

    this.flattenEntries.set(component, {
      sourceMesh,
      sourceGeometry: sourceMesh.geometry,
      relativeShape,
      lastMatrix: new Matrix4().copy(relativeShape.matrixWorld),
      pendingUpdate: false
    });
    return true;
  },

  removeFlattenEntry: function (component, entry) {
    this.flatteningPlugin.deleteShape(entry.relativeShape);
    this.flattenEntries.delete(component);
  },

  clearFlattenEntries: function () {
    this.flattenEntries.forEach((entry) => {
      this.flatteningPlugin.deleteShape(entry.relativeShape);
    });
    this.flattenEntries.clear();
  },

  // Called every tick: reconcile the entry map against the geo-flatten
  // registry when dirty, then track per-entry transform/geometry changes.
  syncFlattening: function (time) {
    // Wait for the root tileset: before it loads the ReorientationPlugin has
    // not positioned tiles.group, so shape-relative transforms (and the
    // ellipsoid flatten direction derived from them) would be garbage.
    if (!this.flatteningPlugin || !this.tiles || !this.tiles.root) return;

    if (this.flattenRegistryDirty) {
      this.flattenRegistryDirty = false;
      const system = this.el.sceneEl.systems['geo-flatten'];
      const active = new Set(
        this.data.enableFlattening && system ? system.getActiveComponents() : []
      );
      this.flattenEntries.forEach((entry, component) => {
        if (!active.has(component)) {
          this.removeFlattenEntry(component, entry);
        }
      });
      active.forEach((component) => {
        if (!this.flattenEntries.has(component)) {
          if (!this.addFlattenEntry(component)) {
            // No mesh yet — stay dirty so the next tick retries; geo-flatten
            // resolves its mesh lazily once the subtree has content.
            this.flattenRegistryDirty = true;
          }
        }
      });
    }

    if (this.flattenEntries.size === 0) return;

    this.tiles.group.updateMatrixWorld();
    const canApply =
      time - this.lastFlattenApplyTime >= FLATTEN_UPDATE_THROTTLE_MS;
    let appliedAny = false;

    for (const [component, entry] of this.flattenEntries) {
      const sourceMesh = component.getFlattenMesh();

      if (!sourceMesh) {
        // Mesh vanished (e.g. model still loading after a rebuild). Drop the
        // entry and leave the registry dirty so we retry next tick.
        this.removeFlattenEntry(component, entry);
        this.flattenRegistryDirty = true;
        continue;
      }

      // The plugin shape was cloned from the source mesh, sharing geometry by
      // reference. Editing the host's geometry (e.g. box width/depth/height)
      // replaces that geometry instance, so the clone goes stale — detect the
      // swap and rebuild the entry.
      if (
        sourceMesh !== entry.sourceMesh ||
        sourceMesh.geometry !== entry.sourceGeometry
      ) {
        // Geometry edits can also arrive continuously (click-drag on a
        // geometry number input), so rebuilds respect the same throttle.
        if (canApply) {
          this.removeFlattenEntry(component, entry);
          this.addFlattenEntry(component);
          appliedAny = true;
        }
        continue;
      }

      // Update the shape only when its transform relative to the tile set
      // actually changed — updateShape() forces a full CPU re-flatten
      // (per-vertex raycasts) of every active tile.
      _relativeMatrix
        .copy(sourceMesh.matrixWorld)
        .premultiply(this.tiles.group.matrixWorldInverse);

      if (!_relativeMatrix.equals(entry.lastMatrix)) {
        entry.pendingUpdate = true;
      }

      if (entry.pendingUpdate && canApply) {
        entry.pendingUpdate = false;
        entry.lastMatrix.copy(_relativeMatrix);
        entry.relativeShape.matrixWorld
          .copy(_relativeMatrix)
          .decompose(
            entry.relativeShape.position,
            entry.relativeShape.quaternion,
            entry.relativeShape.scale
          );
        this.flatteningPlugin.updateShape(entry.relativeShape);
        appliedAny = true;
      }
    }

    if (appliedAny) {
      this.lastFlattenApplyTime = time;
    }
  },

  tick: function (time) {
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

      this.syncFlattening(time);

      this.tiles.update();
    }
  },

  remove: function () {
    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
    this.el.sceneEl.removeEventListener(
      'geo-flatten-registry-changed',
      this.onFlattenRegistryChanged
    );
    if (this.tiles) {
      // Clean up flattening shapes
      if (this.flatteningPlugin) {
        this.clearFlattenEntries();
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

    // Master flattening switch: entries reconcile against the registry on
    // the next tick (an empty active set clears every shape).
    if (oldData.enableFlattening !== this.data.enableFlattening) {
      this.flattenRegistryDirty = true;
    }
  }
});
