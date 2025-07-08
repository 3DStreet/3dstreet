/* global AFRAME */

AFRAME.registerComponent('camera-start-indicator', {
  schema: {
    enabled: { type: 'boolean', default: true },
    color: { type: 'color', default: '#00ff00' },
    radius: { type: 'number', default: 0.4 }
  },

  init: function () {
    this.sphere = null;
    this.createSphere();
  },

  createSphere: function () {
    if (this.sphere) {
      this.el.removeChild(this.sphere);
    }

    this.sphere = document.createElement('a-sphere');
    this.sphere.setAttribute('radius', this.data.radius);
    this.sphere.setAttribute('color', this.data.color);
    this.sphere.setAttribute('material', 'shader: flat');
    this.el.appendChild(this.sphere);
  },

  update: function (oldData) {
    if (oldData.enabled !== this.data.enabled) {
      this.sphere.setAttribute('visible', this.data.enabled);
    }

    if (oldData.color !== this.data.color) {
      this.sphere.setAttribute('color', this.data.color);
    }

    if (oldData.radius !== this.data.radius) {
      this.sphere.setAttribute('radius', this.data.radius);
    }
  },

  remove: function () {
    if (this.sphere) {
      this.el.removeChild(this.sphere);
    }
  }
});
