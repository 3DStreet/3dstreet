/* global AFRAME, THREE */

var LOADING_MODELS = {};
var MODELS = {};

AFRAME.registerComponent('gltf-part', {
  schema: {
    part: { type: 'string' },
    src: { type: 'asset' }
  },

  init: function () {
    this.dracoLoader = document
      .querySelector('a-scene')
      .systems['gltf-model'].getDRACOLoader();
  },

  update: function () {
    var self = this;
    var el = this.el;
    if (!this.data.part && this.data.src) {
      return;
    }
    // Cleared now, set true once the part resolves (model-loaded) or fails (model-error).
    // batch-models' waitForModelLoaded reads it so a part that resolved before it started
    // listening doesn't hang Promise.all.
    this._loadSettled = false;
    this.getModel(function (modelPart) {
      if (!modelPart) {
        self._loadSettled = true;
        el.emit('model-error', { format: 'gltf-part', src: self.data.src });
        return;
      }
      el.setObject3D('mesh', modelPart);
      self._loadSettled = true;
      el.emit('model-loaded', { format: 'gltf-part', model: modelPart });
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

    // Own geometry per instance (the cached model's geometry is shared by reference via
    // clone(true)); the material stays shared with the cache and other instances.
    mesh.geometry = mesh.geometry.clone();
    return mesh;
  }
});
