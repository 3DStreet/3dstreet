AFRAME.registerComponent('instanced-mesh', {
  schema: {
    retainParent: { default: false },
    retainChildren: { default: false }, // Not yet implemented
    inheritMat: { default: true },
    mergeInstances: { default: false }, // Not yet implemented
    frustumCulled: { default: true },
    center: { default: false },
    bottomAlign: { default: false }
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
      this.el.addEventListener('part-loaded', e => {
        this.update.call(this, this.data);
      });
      return;
    }
    var material = mesh.material.clone();

    mesh.traverse(function (node) {
      if (node.type != 'Mesh') return;
      geometry = node.geometry;
    });

    var amesh = new THREE.InstancedMesh(geometry, material, quantity);

    for (i = 0; i < quantity; i++) {
      matrix = new THREE.Matrix4();
      child = this.el.children[i];
      applyMatrix(i, matrix);
      amesh.setMatrixAt(i, matrix);

      if (this.data.center) {
        amesh.geometry.center();
        if (this.data.bottomAlign) {
          var box = new THREE.Box3().setFromObject(amesh);
          var boundingBoxSize = box.max.sub(box.min);
          var height = boundingBoxSize.y;
          amesh.position.y = height / 2;
        }
      }
    }
    // frustumCulled
    amesh.frustumCulled = this.data.frustumCulled;
    this.el.object3D.add(amesh);
    // retainParent
    if (!self.data.retainParent) { this.el.object3D.remove(mesh); }
    // inheritMat (Set material attribute to cloned material)
    if (self.data.inheritMat) {
      this.el.components.material.material = material;
    }
  }
});
