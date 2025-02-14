import { TilesRenderer } from '3d-tiles-renderer';
import {
  TilesFadePlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin
} from '3d-tiles-renderer/plugins';

console.log('3d-tiles-renderer', TilesRenderer);
const MathUtils = AFRAME.THREE.MathUtils;
const DRACOLoader = AFRAME.THREE.DRACOLoader;

if (typeof AFRAME === 'undefined') {
  throw new Error(
    'Component attempted to register before AFRAME was available.'
  );
}

AFRAME.registerComponent('google-maps-aerial', {
  schema: {
    apiToken: { type: 'string', default: '' },
    latitude: { type: 'number', default: 35.6586 }, // Tokyo Tower
    longitude: { type: 'number', default: 139.7454 },
    minDistance: { type: 'number', default: 500 },
    maxDistance: { type: 'number', default: 20000 },
    ellipsoidalHeight: { type: 'number', default: 0 }
  },

  init: function () {
    this.initialized = false;
    console.log('google-maps-aerial init');
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
        dracoLoader: new DRACOLoader().setDecoderPath(
          'https://unpkg.com/three@0.153.0/examples/jsm/libs/draco/gltf/'
        )
      })
    );

    // Set location
    this.tiles.setLatLonToYUp(
      this.data.latitude * MathUtils.DEG2RAD,
      this.data.longitude * MathUtils.DEG2RAD
    );

    // Create a child entity for the height offset
    const offsetEl = document.createElement('a-entity');
    offsetEl.object3D.position.y = -this.data.ellipsoidalHeight;
    offsetEl.object3D.add(this.tiles.group);
    this.el.appendChild(offsetEl);
    this.offsetEl = offsetEl;

    // Wait for camera and scene to be ready
    this.el.sceneEl.addEventListener('loaded', () => {
      this.camera = this.el.sceneEl.camera;
      this.renderer = this.el.sceneEl.renderer;

      if (this.camera && this.renderer) {
        this.initialized = true;
        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.setCamera(this.camera);
      }
    });

    // Add this to your component's init:
    this.el.addEventListener('cameraChange', (e) => {
      console.log('eventtriggered', e);
      if (e.detail.type === 'PerspectiveCamera' && this.initialized) {
        const prevCamera = this.camera;
        this.camera = e.detail;

        // Delete previous camera from tiles renderer first
        if (prevCamera) {
          this.tiles.deleteCamera(prevCamera);
        }

        // Set new camera and update resolution
        this.tiles.setCamera(this.camera);
        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
      }
    });
  },

  tick: function () {
    // only run this function 10 times total
    // if (this.tickCount >= 10) return;
    if (this.initialized && this.tiles && this.camera) {
      // Ensure camera is set on each tick
      this.tiles.setCamera(this.camera);
      this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
      this.tiles.update();
    }
    this.tickCount++;
  },

  remove: function () {
    if (this.tiles) {
      if (this.offsetEl) {
        this.offsetEl.removeFromParent();
        this.offsetEl = null;
      }
      this.tiles.dispose();
      this.tiles = null;
    }
  },

  update: function (oldData) {
    // Handle property updates
    if (
      this.tiles &&
      (oldData.latitude !== this.data.latitude ||
        oldData.longitude !== this.data.longitude)
    ) {
      this.tiles.setLatLonToYUp(
        this.data.latitude * MathUtils.DEG2RAD,
        this.data.longitude * MathUtils.DEG2RAD
      );
    }
  }
});
