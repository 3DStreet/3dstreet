// Component to fix z-fighting by adding polygon offset to meshes
AFRAME.registerComponent('polygon-offset', {
  schema: {
    // Negative values move fragments closer to camera
    factor: { type: 'number', default: -2 },
    units: { type: 'number', default: -2 }
  },

  init: function () {
    // Initial update when mesh is loaded
    const mesh = this.el.getObject3D('mesh');
    if (mesh) {
      this.applyPolygonOffsetToObject(mesh);
    }

    // Listen for model-loaded event
    this.el.addEventListener('model-loaded', (evt) => {
      const mesh = this.el.getObject3D('mesh');
      this.applyPolygonOffsetToObject(mesh);
    });
  },

  applyPolygonOffsetToObject: function (object3D) {
    if (!object3D) return;

    object3D.traverse((obj) => {
      if (obj.isMesh) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((material) => {
            this.updateMaterial(material);
          });
        } else {
          this.updateMaterial(obj.material);
        }
      }
    });
  },

  updateMaterial: function (material) {
    if (!material) return;

    material.polygonOffset = true;
    material.polygonOffsetFactor = this.data.factor;
    material.polygonOffsetUnits = this.data.units;

    // Ensure material updates
    material.needsUpdate = true;
  },

  update: function (oldData) {
    // Handle property updates
    const mesh = this.el.getObject3D('mesh');
    if (mesh) {
      this.applyPolygonOffsetToObject(mesh);
    }
  },

  remove: function () {
    const mesh = this.el.getObject3D('mesh');
    if (mesh) {
      mesh.traverse((obj) => {
        if (obj.isMesh) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((material) => {
              material.polygonOffset = false;
              material.polygonOffsetFactor = 0;
              material.polygonOffsetUnits = 0;
              material.needsUpdate = true;
            });
          } else if (obj.material) {
            obj.material.polygonOffset = false;
            obj.material.polygonOffsetFactor = 0;
            obj.material.polygonOffsetUnits = 0;
            obj.material.needsUpdate = true;
          }
        }
      });
    }
  }
});
