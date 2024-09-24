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
    // Update bounding box
    this.targetBox.setFromObject(this.targetEl.object3D);
    this.targetBox.getCenter(this.targetCenter);
    this.targetBox.getSize(this.targetSize);

    // Update plane positions
    const normals = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      //   new THREE.Vector3(0, 1, 0),
      //   new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1)
    ];

    for (let i = 0; i < 4; i++) {
      const normal = normals[i];
      const point = this.targetCenter
        .clone()
        .add(
          normal
            .clone()
            .multiply(
              this.targetSize.clone().multiply(new THREE.Vector3(0.5, 0.5, 0.5))
            )
        );
      this.clipPlanes[i].setFromNormalAndCoplanarPoint(normal, point);
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
  }
});
