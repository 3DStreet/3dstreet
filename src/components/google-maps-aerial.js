import { TilesRenderer } from '3d-tiles-renderer';
import {
  TilesFadePlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin
} from '3d-tiles-renderer/plugins';

console.log('3d-tiles-renderer', TilesRenderer);
const MathUtils = AFRAME.THREE.MathUtils;

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
    copyrightEl: { type: 'selector' }
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

    // Get camera and renderer
    this.camera = this.el.sceneEl.camera;
    this.renderer = this.el.sceneEl.renderer;
    // if (!this.camera) {
    //   throw new Error('3D Tiles: Please add an active camera or specify the target camera via the cameraEl property');
    // }

    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.setCamera(this.camera);
    this.tiles.update();

    // Add this to your component's init:
    this.el.addEventListener('cameraChange', (e) => {
      if (e.detail) {
        const prevCamera = this.camera;
        this.camera = e.detail;

        // Delete previous camera from tiles renderer first
        if (prevCamera) {
          this.tiles.deleteCamera(prevCamera);
        }
        // Set new camera and update resolution
        this.tiles.setCamera(this.camera);
        this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
        this.tiles.update();
      }
    });

    if (AFRAME.INSPECTOR && AFRAME.INSPECTOR.opened) {
      // emit play event to start load tiles in aframe-inspector
      this.play();
    }
  },

  tick: function () {
    if (this.tiles && this.camera) {
      // Ensure camera is set on each tick
      this.tiles.setCamera(this.camera);
      this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
      this.tiles.update();
    }
    if (this.data.copyrightEl) {
      this.data.copyrightEl.innerHTML =
        this.tiles.getAttributions()[0]?.value || '';
    }
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
        oldData.longitude !== this.data.longitude ||
        oldData.ellipsoidalHeight !== this.data.ellipsoidalHeight)
    ) {
      this.tiles.setLatLonToYUp(
        this.data.latitude * MathUtils.DEG2RAD,
        this.data.longitude * MathUtils.DEG2RAD
      );
      this.offsetEl.object3D.position.y = -this.data.ellipsoidalHeight;
    }
  }
});
