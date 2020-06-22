var LOADING_MODELS = {};
var MODELS = {};

// suggested tests:
// make sample test project with these example cubes (https://stackoverflow.com/questions/61840351/)
// test when used that the mesh is actually centered (located at 0,0,0)
// test that Y value is original when excludeY is used
AFRAME.registerComponent('part-center', {
  schema: {
    bottomAlign: { default: false }
  },
  init: function () {
    this.el.addEventListener('model-loaded', (event) => {
      var modelPart = this.el.getObject3D('mesh');
      // center all axes
      modelPart.geometry.center();
      if (this.data.bottomAlign) {
        // align the bottom of the geometry on the y axis
        var box = new THREE.Box3().setFromObject(modelPart);
        var boundingBoxSize = box.max.sub(box.min);
        var height = boundingBoxSize.y;
        modelPart.position.y = height / 2;
      }
    });
  }
});

// suggested tests:
// make component in sample test project with gltf-part with a known simple gltf test with these cubes (https://stackoverflow.com/questions/61840351/)
// test if when object loaded it fires event
// test that it loads all 3 cubes into the scene without specifying a part string
// test with and without draco compression
// test when part string provided it only renders 1 cube
AFRAME.registerComponent('gltf-part', {
  schema: {
    buffer: { default: true },
    part: { type: 'string' },
    src: { type: 'asset' }
  },

  init: function () {
    this.dracoLoader = document.querySelector('a-scene').systems['gltf-model'].getDRACOLoader();
  },

  update: function () {
    var el = this.el;
    var data = this.data;
    if (!this.data.part && this.data.src) { return; }
    this.getModel(function (modelPart) {
      if (!modelPart) { return; }
      el.setObject3D('mesh', modelPart);
      el.emit('model-loaded', { format: 'gltf', part: self.modelPart });
    });
  },

  /**
   * Fetch, cache, and select from GLTF.
   *
   * @returns {object} Selected subset of model.
   */
  getModel: function (cb) {
    var self = this;

    // Already parsed, grab it.
    if (MODELS[this.data.src]) {
      cb(this.selectFromModel(MODELS[this.data.src]));
      return;
    }

    // Currently loading, wait for it.
    if (LOADING_MODELS[this.data.src]) {
      return LOADING_MODELS[this.data.src].then(function (model) {
        cb(self.selectFromModel(model));
      });
    }

    // Not yet fetching, fetch it.
    LOADING_MODELS[this.data.src] = new Promise(function (resolve) {
      var loader = new THREE.GLTFLoader();
      if (self.dracoLoader) {
        loader.setDRACOLoader(self.dracoLoader);
      }
      loader.load(
        self.data.src,
        function (gltfModel) {
          var model = gltfModel.scene || gltfModel.scenes[0];
          MODELS[self.data.src] = model;
          delete LOADING_MODELS[self.data.src];
          cb(self.selectFromModel(model));
          resolve(model);
        },
        function () {},
        console.error
      );
    });
  },

  /**
   * Search for the part name and look for a mesh.
   */
  selectFromModel: function (model) {
    var mesh;
    var part;

    part = model.getObjectByName(this.data.part);
    if (!part) {
      console.error('[gltf-part] `' + this.data.part + '` not found in model.');
      return;
    }

    mesh = part.getObjectByProperty('type', 'Mesh').clone(true);

    if (this.data.buffer) {
      mesh.geometry = mesh.geometry.toNonIndexed();
      return mesh;
    }
    mesh.geometry = new THREE.Geometry().fromBufferGeometry(mesh.geometry);
    return mesh;
  }
});
