/* global AFRAME */

// Source: https://github.com/kfarr/aframe-gltf-helpers/blob/8fff88dfe3f876d4092d30a382870eef0c21eb31/index.js
// This version only works with gltf "parts" that have single materials / single mesh

if (typeof AFRAME === 'undefined') {
  throw new Error('Component attempted to register before AFRAME was available.');
}

var LOADING_MODELS = {};
var MODELS = {};

AFRAME.registerComponent('gltf-part-plus', {
  schema: {
    buffer: { default: true },
    part: { type: 'string' },
    src: { type: 'asset' },
    resetPosition: { default: false }
  },

  init: function () {
    this.dracoLoader = document
      .querySelector('a-scene')
      .systems['gltf-model'].getDRACOLoader();
  },

  update: function () {
    var el = this.el;
    var data = this.data;
    if (!this.data.part && this.data.src) {
      return;
    }
    this.getModel(function (modelPart) {
      if (!modelPart) {
        return;
      }
      if (data.resetPosition) {
        el.setAttribute(
          'position',
          modelPart.position.x +
            ' ' +
            modelPart.position.y +
            ' ' +
            modelPart.position.z
        );

        modelPart.position.set(0, 0, 0);
      }
      el.setObject3D('mesh', modelPart);
      el.emit('model-loaded', {format: 'gltf', part: this.modelPart});
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
/*
AFRAME.registerComponent('model-center', {
  schema: {
    bottomAlign: { default: false }
  },
  init: function () {
    this.el.addEventListener('model-loaded', (event) => {
      var modelPart = this.el.getObject3D('mesh');
      modelPart.position.set(0, 0, 0);
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

AFRAME.registerComponent('anisotropy', {
  schema: { default: 0 }, // default 0 will apply max anisotropy according to hardware
  dependencies: ['material', 'geometry'],
  init: function () {
    this.maxAnisotropy = this.el.sceneEl.renderer.capabilities.getMaxAnisotropy();
    // console.log('this.maxAnisotropy', this.maxAnisotropy);

    ['model-loaded', 'materialtextureloaded'].forEach(evt =>
      this.el.addEventListener(evt, () => {
        const mesh = this.el.getObject3D('mesh');
        // console.log('mesh', mesh);

        var anisotropyTargetValue = this.data;
        anisotropyTargetValue = +anisotropyTargetValue || 0; // https://stackoverflow.com/questions/7540397/convert-nan-to-0-in-javascript
        // console.log('anisotropyTargetValue', anisotropyTargetValue);

        if (anisotropyTargetValue === 0) {
          anisotropyTargetValue = this.maxAnisotropy;
          // console.log('anisotropyTargetValue', anisotropyTargetValue);
        }

        mesh.traverse((object) => {
          if (object.isMesh === true && object.material.map !== null) {
            // console.log('object', object);
            // console.log('object.material.map.anisotropy', object.material.map.anisotropy);
            object.material.map.anisotropy = anisotropyTargetValue;
            // console.log('object.material.map.anisotropy', object.material.map.anisotropy);
            object.material.map.needsUpdate = true;
          }
        });
      }, false)
    );
    // this.el.addEventListener('model-loaded', () => {
    //   const mesh = this.el.getObject3D('mesh');
    //   // console.log('mesh', mesh);

    //   var anisotropyTargetValue = this.data;
    //   anisotropyTargetValue = +anisotropyTargetValue || 0; // https://stackoverflow.com/questions/7540397/convert-nan-to-0-in-javascript
    //   // console.log('anisotropyTargetValue', anisotropyTargetValue);

    //   if (anisotropyTargetValue === 0) {
    //     anisotropyTargetValue = this.maxAnisotropy;
    //     // console.log('anisotropyTargetValue', anisotropyTargetValue);
    //   }

    //   mesh.traverse((object) => {
    //     if (object.isMesh === true && object.material.map !== null) {
    //       // console.log('object', object);
    //       // console.log('object.material.map.anisotropy', object.material.map.anisotropy);
    //       object.material.map.anisotropy = anisotropyTargetValue;
    //       // console.log('object.material.map.anisotropy', object.material.map.anisotropy);
    //       object.material.map.needsUpdate = true;
    //     }
    //   });
    // });
  }
});
*/
// original source: https://github.com/EX3D/aframe-InstancedMesh/blob/master/instancedmesh.js
AFRAME.registerComponent('instancedmesh', {
  schema: {
    retainParent: {default: false},
    retainChildren: {default: false}, // Not yet implemented
    inheritMat: {default: true},
    mergeInstances: {default: false}, // Not yet implemented
    frustumCulled: {default: true}
  },

  init: function () {
  },
  update: function () {
    var self = this;
    var el = this.el;
    var list = this.el.children;
    var quantity = 0;

    var applyMatrix = (function () {
      var position = new THREE.Vector3();
      var rotation = new THREE.Euler();
      var scale = new THREE.Vector3();
      var quaternion = new THREE.Quaternion();
      return function (i, matrix) {
        position.x = el.children[i].object3D.position.x;
        position.y = el.children[i].object3D.position.y;
        position.z = el.children[i].object3D.position.z;
        rotation.x = el.children[i].object3D.rotation.x;
        rotation.y = el.children[i].object3D.rotation.y;
        rotation.z = el.children[i].object3D.rotation.z;
        quaternion.setFromEuler(rotation);
        scale.x = el.children[i].object3D.scale.x;
        scale.y = el.children[i].object3D.scale.y;
        scale.z = el.children[i].object3D.scale.z;
        matrix.compose(position, quaternion, scale);
      }; // High verbosity because imma N00b don´t know how to access matrix on an uninitialized object
    }());

    for (var item of list) {
      quantity = quantity + 1;
    }

    var mesh = this.el.getObject3D('mesh');
    if (!mesh) {
      this.el.addEventListener('model-loaded', e => {
        this.update(this.data);
      });
      return;
    }
    var material = mesh.material.clone();

    var geometry = null;
    mesh.traverse(function (node) {
      if (node.isMesh === true) {
        geometry = node.geometry;
      }
    });

    var amesh = new THREE.InstancedMesh(geometry, material, quantity);

    for (var i = 0; i < quantity; i++) {
      var matrix = new THREE.Matrix4();
      // var child = this.el.children[i];
      applyMatrix(i, matrix);
      amesh.setMatrixAt(i, matrix);
    }
    // frustumCulled
    amesh.frustumCulled = this.data.frustumCulled;
    this.el.object3D.add(amesh);
    // retainParent
    if (!self.data.retainParent) { this.el.object3D.remove(mesh); }
    // inheritMat (Set material attribute to cloned material)
    if (self.data.inheritMat) {
      this.el.components.material.material = material;
    } // why? maybe this is helpful for modifying the material of the instances after the scene initializes? otherwise modifying material on the parent element will not affect the cloned material used by the intances?
  }
});