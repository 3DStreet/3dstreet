/* global AFRAME */

AFRAME.registerComponent('clipping-planes', {
  schema: {
    stringSelector: { type: 'string' }
  },

  init: function () {
    this.clipPlanes = [];
    this.targetBox = new THREE.Box3();
    this.targetCenter = new THREE.Vector3();
    this.targetSize = new THREE.Vector3();
    this.targetEl = document.querySelector(this.data.stringSelector);

    // Enable local clipping in the renderer
    this.el.sceneEl.renderer.localClippingEnabled = true;

    // Create planes
    for (let i = 0; i < 6; i++) {
      this.clipPlanes.push(new THREE.Plane());
    }
  },

  tick: function () {
    if (this.targetEl && this.targetEl.object3D) {
      this.updateClipPlanes();
    }
    this.applyClippingPlanes();
  },

  updateClipPlanes: function () {
    var auxQuaternion = new THREE.Quaternion();
    var auxPosition = new THREE.Vector3();
    var auxEuler = new THREE.Euler();
    var auxMatrix = new THREE.Matrix4();
    var identityQuaternion = new THREE.Quaternion();
    var auxScale = new THREE.Vector3();

    var parent = this.targetEl.object3D.parent.parent;
    // Update bounding box
    auxEuler.copy(this.targetEl.object3D.rotation);
    this.targetEl.object3D.rotation.set(0, 0, 0);

    parent.matrixWorld.decompose(auxPosition, auxQuaternion, auxScale);
    auxMatrix.compose(auxPosition, identityQuaternion, auxScale);
    parent.matrixWorld.copy(auxMatrix);

    this.targetBox.setFromObject(this.targetEl.object3D, true);
    this.targetBox.getCenter(this.targetCenter);
    this.targetBox.getSize(this.targetSize);
    // Update plane positions
    const normals = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0), // top
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1)
    ];

    for (let i = 0; i < normals.length; i++) {
      const normal = normals[i];
      let point = this.targetCenter.clone().add(
        normal
          .applyQuaternion(auxQuaternion)
          .clone()
          .multiply(
            this.targetSize.clone().multiply(new THREE.Vector3(0.5, 0.5, 0.5))
          )
      );
      if (i === 2) {
        // set top clipping plane 100m higher
        point = this.targetCenter.clone().add(new THREE.Vector3(0, 100, 0));
      }
      // point.applyQuaternion(auxQuaternion)
      this.clipPlanes[i].setFromNormalAndCoplanarPoint(normal, point);

      parent.matrixWorld.compose(auxPosition, auxQuaternion, auxScale);
      this.targetEl.object3D.rotation.copy(auxEuler);
    }
  },

  applyClippingPlanes: function () {
    this.el.object3D.traverse((obj) => {
      if (obj.type === 'Mesh') {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((material) => {
            material.clippingPlanes = this.clipPlanes;
            material.clipIntersection = true;
          });
        } else {
          obj.material.clippingPlanes = this.clipPlanes;
          obj.material.clipIntersection = true;
        }
      }
    });
  },

  removeClippingPlanes: function () {
    this.el.object3D.traverse((obj) => {
      if (obj.type === 'Mesh') {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((material) => {
            material.clippingPlanes = null;
            material.clipIntersection = false;
          });
        } else {
          obj.material.clippingPlanes = null;
          obj.material.clipIntersection = false;
        }
      }
    });
  },

  remove: function () {
    this.removeClippingPlanes();
  }
});
