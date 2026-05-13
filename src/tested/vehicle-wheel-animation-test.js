/* global AFRAME, THREE */

// Vehicle wheel Animation — test-mirror copy of the production
// component in src/index.js, used by the standalone
// vehicle-wheel-animation.html test page.
//
// Kept in sync with the real component intentionally. If you change
// one, change the other.

const { detectWheels } = require('./wheel-detection.js');

AFRAME.registerComponent('wheel', {
  schema: {
    speed: { type: 'number', default: 0 },
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
    this._prevPos = null;
    this._tmpVec = new THREE.Vector3();
  },
  tick: function (t, dt) {
    if (!this.wheels || this.wheels.length === 0 || dt <= 0) return;
    let speedMps = this.data.speed;
    if (speedMps <= 0) {
      const cur = this._tmpVec.copy(this.el.object3D.position);
      if (!this._prevPos) {
        this._prevPos = new THREE.Vector3().copy(cur);
        return;
      }
      speedMps = (cur.distanceTo(this._prevPos) * 1000) / dt;
      this._prevPos.copy(cur);
    }
    const speedPerMs = speedMps / 1000;
    for (const w of this.wheels) {
      const diameter = w.radius > 0 ? w.radius * 2 : this.data.wheelDiameter;
      const rate = 2 * (speedPerMs / diameter) * dt;
      w.object3D.rotateOnAxis(w.axleLocal, rate);
    }
  }
});
