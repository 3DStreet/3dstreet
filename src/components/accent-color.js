/* global AFRAME */

AFRAME.registerComponent('accent-color', {
  schema: {
    color: {
      type: 'color'
    },
    index: {
      type: 'int'
    }
  },
  init: function () {
    // Want the color update to apply when the mixin is loaded,
    // which may be at a different time than the component
    this.el.addEventListener('model-loaded', () => this.update());
  },
  update: function (oldData) {
    // Collect meshes
    const meshes = [];
    this.el.object3D.traverse((o) => o.material && meshes.push(o));
    // Remove the tint on the previous mesh
    if (oldData && oldData.index !== this.data.index) {
      const oldMesh = meshes.at(oldData.index);
      oldMesh && oldMesh.material.color.set(1, 1, 1);
    }
    // Ignore negative index
    if (this.data.index < 0) return;
    // Apply tint to selected mesh
    const mesh = meshes.at(this.data.index);
    if (mesh) {
      mesh.material.color.set(this.data.color);
      mesh.material.color.multiplyScalar(255);
    }
  }
});
