// Component to fix z-fighting by adding polygon offset to meshes
AFRAME.registerComponent('polygon-offset', {
  schema: {
    // Negative values move fragments closer to camera; factor and units are multiplied together
    factor: { type: 'number', default: -2 },
    units: { type: 'number', default: -2 }
  },

  init: function () {
    // Bind the update method to maintain correct context
    this.updateMesh = this.updateMesh.bind(this);

    // Initial update when mesh is loaded
    const mesh = this.el.getObject3D('mesh');
    if (mesh) {
      this.updateMesh(mesh);
    }

    // Listen for model-loaded event
    this.el.addEventListener('model-loaded', (evt) => {
      const mesh = this.el.getObject3D('mesh');
      this.updateMesh(mesh);
    });
  },

  updateMesh: function (mesh) {
    if (!mesh) return;

    // Function to recursively process materials
    const processMaterials = (object) => {
      if (object.material) {
        // Handle single material
        if (!Array.isArray(object.material)) {
          this.updateMaterial(object.material);
        } else {
          // Handle multiple materials
          object.material.forEach((material) => {
            this.updateMaterial(material);
          });
        }
      }
      if (object.children) {
        object.children.forEach((child) => {
          processMaterials(child);
        });
      }
    };

    // Start processing from the root mesh
    processMaterials(mesh);
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
      this.updateMesh(mesh);
    }
  }
});
