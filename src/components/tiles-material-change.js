/* global AFRAME */
AFRAME.registerComponent('tiles-material-change', {
  schema: {
    opacity: { type: 'number', default: 1.0, min: 0, max: 1 },
    blendMode: {
      type: 'string',
      default: 'Normal',
      oneOf: [
        'Normal',
        'Additive',
        'Subtract',
        'Multiply',
        'Screen',
        'Overlay',
        'Lighten',
        'Darken',
        'ColorDodge',
        'ColorBurn'
      ]
    }
  },

  init: function () {
    // Bind methods
    this.updateMaterials = this.updateMaterials.bind(this);
    this.onModelLoaded = this.onModelLoaded.bind(this);

    // Add event listeners
    this.el.addEventListener('model-loaded', this.onModelLoaded);

    // Initial setup
    this.updateMaterials();

    // Blending mode map
    this.blendModes = {
      Normal: THREE.NormalBlending,
      Additive: THREE.AdditiveBlending,
      Subtract: THREE.SubtractiveBlending,
      Multiply: THREE.MultiplyBlending,
      Screen: THREE.CustomBlending,
      Overlay: THREE.CustomBlending,
      Lighten: THREE.CustomBlending,
      Darken: THREE.CustomBlending,
      ColorDodge: THREE.CustomBlending,
      ColorBurn: THREE.CustomBlending
    };
  },

  update: function (oldData) {
    // Only update if the data has actually changed
    if (
      oldData.tintColor !== this.data.tintColor ||
      oldData.opacity !== this.data.opacity ||
      oldData.blendMode !== this.data.blendMode
    ) {
      this.updateMaterials();
    }
  },

  remove: function () {
    this.el.removeEventListener('model-loaded', this.onModelLoaded);
  },

  onModelLoaded: function () {
    this.updateMaterials();
  },

  setCustomBlendMode: function (material, blendMode) {
    material.blending = THREE.CustomBlending;

    switch (blendMode) {
      case 'Screen':
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneMinusSrcColorFactor;
        break;
      case 'Overlay':
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneMinusSrcAlphaFactor;
        break;
      case 'Lighten':
        material.blendEquation = THREE.MaxEquation;
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneFactor;
        break;
      case 'Darken':
        material.blendEquation = THREE.MinEquation;
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneFactor;
        break;
      case 'ColorDodge':
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.OneFactor;
        material.blendDst = THREE.OneMinusSrcColorFactor;
        break;
      case 'ColorBurn':
        material.blendEquation = THREE.AddEquation;
        material.blendSrc = THREE.OneMinusDstColorFactor;
        material.blendDst = THREE.OneFactor;
        break;
    }
  },

  updateMaterials: function () {
    const opacity = this.data.opacity;
    const blendMode = this.data.blendMode;

    this.el.object3D.traverse((node) => {
      if (node.type === 'Mesh') {
        const materials = Array.isArray(node.material)
          ? node.material
          : [node.material];

        materials.forEach((material) => {
          material.transparent = opacity < 1.0;
          material.opacity = opacity;

          // Set blending mode
          if (
            blendMode === 'Normal' ||
            blendMode === 'Additive' ||
            blendMode === 'Subtract' ||
            blendMode === 'Multiply'
          ) {
            material.blending = this.blendModes[blendMode];
          } else {
            this.setCustomBlendMode(material, blendMode);
          }

          material.needsUpdate = true;
        });
      }
    });
  },

  tick: function () {
    // Only update materials if there are changes
    // if (this.el.getAttribute('tiles-material-change').needsUpdate) {
    //   this.updateMaterials();
    //   this.el.getAttribute('tiles-material-change').needsUpdate = false;
    // }
    this.updateMaterials();
  }
});
