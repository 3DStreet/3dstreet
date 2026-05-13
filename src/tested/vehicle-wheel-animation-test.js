/* global AFRAME */

// Vehicle wheel Animation — test-mirror copy of the production
// component in src/index.js, used by the standalone
// vehicle-wheel-animation.html test page.
//
// Kept in sync with the real component intentionally. If you change
// one, change the other.

const { detectWheels } = require('./wheel-detection.js');

AFRAME.registerComponent('wheel', {
  schema: {
    speed: { type: 'number', default: 1 },
    wheelDiameter: { type: 'number', default: 1 }
  },

  init: function () {
    const el = this.el;
    const self = this;
    el.addEventListener('model-loaded', () => {
      const vehicle = el.getObject3D('mesh');
      if (!vehicle) return;
      self.wheels = detectWheels(vehicle);
    });
  },
  tick: function () {
    if (!this.wheels || this.wheels.length === 0) return;
    const speed = this.data.speed / 1000; // speed per millisecond
    const wheelDiameter = this.data.wheelDiameter;
    const rateOfRotation = 2 * (speed / wheelDiameter);
    for (const w of this.wheels) {
      w.object3D.rotateOnAxis(w.axleLocal, rateOfRotation);
    }
  }
});
