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
    this.meshes = [];
    // The group children aren't ready when the component is initialized, so wait a bit.
    // TODO: Find a better way to time this.
    setTimeout(() => {
      this.el.object3D.traverse((o) => o.material && this.meshes.push(o));
      this.update();
    }, 1000);
  },
  update: function (oldData) {
    // Remove the tint on the previous mesh
    if (oldData && oldData.index !== this.data.index) {
      const oldMesh = this.meshes.at(oldData.index);
      oldMesh && oldMesh.material.color.set(1, 1, 1);
    }
    // Ignore negative index
    if (this.data.index < 0) return;
    // Apply tint to selected mesh
    const mesh = this.meshes.at(this.data.index);
    if (mesh) {
      mesh.material.color.set(this.data.color);
      mesh.material.color.multiplyScalar(255);
    }
  }
});
