/* global AFRAME */

// Vehicle wheel Animation
AFRAME.registerComponent('wheel', {
  schema: {
    speed: { type: 'number', default: 1 },
    wheelDiameter: { type: 'number', default: 1 }
  },

  init: function () {
    const el = this.el;
    const self = this;
    el.addEventListener('model-loaded', (e) => {
      const vehicle = el.getObject3D('mesh');
      if (!vehicle) {
        return;
      }

      self.wheel_F_L = vehicle.getObjectByName('wheel_F_L');
      self.wheel_F_R = vehicle.getObjectByName('wheel_F_R');
      self.wheel_B_L = vehicle.getObjectByName('wheel_B_L');
      self.wheel_B_R = vehicle.getObjectByName('wheel_B_R');

      // For Truck exrta Wheels
      self.wheel_B_L_2 = vehicle.getObjectByName('wheel_B_L_2');
      self.wheel_B_R_2 = vehicle.getObjectByName('wheel_B_R_2');

      self.main_bone = vehicle.getObjectByName('main_bone');
    });
  },
  tick: function () {
    const speed = this.data.speed;
    const wheelDiameter = this.data.wheelDiameter;

    const dist = Math.PI * wheelDiameter;
    const distx = speed * 0.003;
    const t = (distx / dist) * (2 * Math.PI);

    if (this.main_bone) {
      this.main_bone.position.z += distx;
    }
    if (this.wheel_F_L) {
      this.wheel_F_L.rotateY(t);
    }
    if (this.wheel_F_R) {
      this.wheel_F_R.rotateY(t);
    }
    if (this.wheel_B_L) {
      this.wheel_B_L.rotateY(t);
    }

    if (this.wheel_B_L_2) {
      this.wheel_B_L_2.rotateY(t);
    }

    if (this.wheel_B_R_2) {
      this.wheel_B_R_2.rotateY(t);
    }
    if (this.wheel_B_R) {
      this.wheel_B_R.rotateY(t);
    }
  }
});
