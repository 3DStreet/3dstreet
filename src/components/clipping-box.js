/* global AFRAME */

// use a box in the scene to clip a mapping layer to clear space for user content
AFRAME.registerComponent('clipping-box', {
  schema: {
    sourceBoxSelector: { type: 'string' }
  },

  init: function () {
    this.clipPlanes = [];
    this.tempBox = new THREE.Box3();
    this.targetCenter = new THREE.Vector3();
    this.targetSize = new THREE.Vector3();
    this.sourceEl = document.querySelector(this.data.sourceBoxSelector);
    // Enable local clipping in the renderer
    this.el.sceneEl.renderer.localClippingEnabled = true;

    // Create planes
    for (let i = 0; i < 6; i++) {
      this.clipPlanes.push(new THREE.Plane());
    }
  },

  tick: function () {
    if (this.sourceEl && this.sourceEl.object3D) {
      this.updateClipPlanes();
    }
    this.applyClippingPlanes();
  },

  updateClipPlanes: function () {
    // Update bounding box
    this.tempBox.setFromObject(this.sourceEl.object3D);
    this.tempBox.getCenter(this.targetCenter);
    this.tempBox.getSize(this.targetSize);

    // Update plane positions
    const normals = [
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(-1, 0, 0),
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, -1, 0),
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(0, 0, -1)
    ];

    for (let i = 0; i < 6; i++) {
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
