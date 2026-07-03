/* global AFRAME, THREE */
import { removeMember } from '../batch-models';

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

  update: function (oldData) {
    var self = this;
    var el = this.el;
    // A part/src change on an already-batched entity must drop its batch slot first: batching
    // stripped the original mesh, so the stale part would otherwise ghost in the BatchedMesh and
    // onLateModelLoaded won't re-classify it (its _batchStatus is still set). gltf-model gets
    // this for free via loadModel() -> remove() -> removeMember; gltf-part only released in
    // remove() until now. No-op when the entity isn't batched.
    if (
      oldData &&
      (oldData.part !== this.data.part || oldData.src !== this.data.src)
    ) {
      removeMember(el);
    }
    // Cleared now, set true once the part resolves (model-loaded) or fails (model-error).
    // batch-models' waitForModelLoaded reads it so a part that resolved before it started
    // listening doesn't hang Promise.all.
    this._loadSettled = false;
    if (!this.data.part && this.data.src) {
      // No part name to select — nothing will load. Mark settled so batch-models doesn't wait
      // out LOAD_TIMEOUT_MS for a mesh that never arrives (the entity still matches
      // BATCHABLE_SELECTOR).
      this._loadSettled = true;
      return;
    }
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

  remove: function () {
    // batch-models' removal cleanup runs HERE, not from a child-detached listener. A-Frame calls
    // component.remove() during the entity's disconnectedCallback for ANY document-disconnection
    // — including every descendant of a removed subtree — whereas child-detached doesn't reliably
    // reach the scene (a managed-street teardown detaches the whole subtree, then street-generated
    // clearEntities removes the already-disconnected members, so their child-detached never
    // bubbles). removeMember frees a built member's slot or drops a pending late-batch candidate
    // from the tally. Without this its instance stays visible and its now-parentless object3D
    // crashes the editor hover box.
    removeMember(this.el);
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

    // Currently loading, wait for it. A null model means the shared load failed (see the
    // error callback below) — pass undefined through so update()'s callback emits model-error.
    if (LOADING_MODELS[this.data.src]) {
      return LOADING_MODELS[this.data.src].then(function (model) {
        cb(model ? self.selectFromModel(model) : undefined);
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
        function (error) {
          // Settle this component (cb() -> update() emits model-error, sets _loadSettled),
          // evict the cache entry so a later use of this src retries instead of chaining onto a
          // dead promise, and resolve waiters with null so they emit model-error too. Without
          // this a 404'd part never settles and stalls batchModels' Promise.all for the full
          // LOAD_TIMEOUT_MS, leaving every deferred duplicate invisible until then.
          console.error(error);
          delete LOADING_MODELS[self.data.src];
          cb();
          resolve(null);
        }
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
