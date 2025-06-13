import { TilesRenderer } from '3d-tiles-renderer';
import {
  TilesFadePlugin,
  TileCompressionPlugin,
  GLTFExtensionsPlugin,
  GoogleCloudAuthPlugin,
  TileFlatteningPlugin
} from '3d-tiles-renderer/plugins';

console.log('3d-tiles-renderer', TilesRenderer);
const MathUtils = AFRAME.THREE.MathUtils;
const Vector3 = AFRAME.THREE.Vector3;

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
    enableFlattening: { type: 'boolean', default: true }
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

    // Add flattening plugin if enabled
    if (this.data.enableFlattening) {
      this.flatteningPlugin = new TileFlatteningPlugin();
      this.tiles.registerPlugin(this.flatteningPlugin);
      console.log('TileFlatteningPlugin enabled');
    }
    // Set location
    this.tiles.setLatLonToYUp(
      this.data.latitude * MathUtils.DEG2RAD,
      this.data.longitude * MathUtils.DEG2RAD
    );

    this.tiles.addEventListener('load-model', () => {
      if (this.data.copyrightEl) {
        this.data.copyrightEl.innerHTML =
          this.tiles.getAttributions()[0]?.value || '';
      }

      // Add flattening shape after tiles are loaded
      if (this.data.enableFlattening && this.flatteningPlugin) {
        const testMeshEl = document.querySelector('#flattening-mesh');

        if (testMeshEl && !this.flatteningShape) {
          const testMesh = testMeshEl.object3D.children[0];
          console.log('testMesh', testMesh);

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

          // Add the transformed plane as a flattening shape
          this.flatteningPlugin.addShape(
            relativeShape,
            new Vector3(-1, 0, 0),
            Infinity
          );
          console.log(
            'Added flattening shape from #flattening-mesh after load-model'
          );

          // Store reference for cleanup
          this.flatteningShape = relativeShape;
        }
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

    this.tiles.setResolutionFromRenderer(this.el.sceneEl.camera, this.renderer);
    this.tiles.setCamera(this.el.sceneEl.camera);
    this.tiles.update();

    if (AFRAME.INSPECTOR && AFRAME.INSPECTOR.opened) {
      // emit play event to start load tiles in aframe-inspector
      this.play();
    }
  },

  tick: function () {
    if (this.tiles && this.el.sceneEl.camera) {
      // Ensure camera is set on each tick
      this.tiles.setCamera(this.el.sceneEl.camera);
      this.tiles.setResolutionFromRenderer(
        this.el.sceneEl.camera,
        this.renderer
      );

      // Update flattening shape if it exists
      if (this.flatteningPlugin && this.flatteningShape) {
        this.flatteningPlugin.updateShape(this.flatteningShape);
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
      }

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
