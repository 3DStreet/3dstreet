// source https://github.com/dala00/a-frame-car-sample/blob/master/index.html
AFRAME.registerComponent('car', {
  init: function () {
    window.addEventListener('keydown', this.onKeyDown.bind(this));
    window.addEventListener('keyup', this.onKeyUp.bind(this));
    this.rotating = null;
    this.speeding = null;
    this.speed = 0.0;
  },
  onAxisMoveSpeed: function (e) {
    if (e.detail.axis[1] == 0) {
      this.speeding = null;
    } else if (e.detail.axis[1] > 0) {
      this.speeding = 'down';
    } else if (e.detail.axis[1] < 0) {
      this.speeding = 'up';
    }
  },
  onAxisMoveAngle: function (e) {
    if (e.detail.axis[0] == 0) {
      this.rotating = null;
    } else if (e.detail.axis[0] > 0) {
      this.rotating = 'right';
    } else if (e.detail.axis[0] < 0) {
      this.rotating = 'left';
    }
  },
  onKeyDown: function (e) {
    if (e.keyCode == 65) {
      this.rotating = 'left';
    } else if (e.keyCode == 68) {
      this.rotating = 'right';
    } else if (e.keyCode == 87) {
      this.speeding = 'up';
    } else if (e.keyCode == 83) {
      this.speeding = 'down';
    }
  },
  onKeyUp: function (e) {
    if (e.keyCode == 65 && this.rotating == 'left') {
      this.rotating = null;
    } else if (e.keyCode == 68 && this.rotating == 'right') {
      this.rotating = null;
    } else if (e.keyCode == 87 && this.speeding == 'up') {
      this.speeding = null;
    } else if (e.keyCode == 83 && this.speeding == 'down') {
      this.speeding = null;
    }
  },
  tick: function () {
    if (this.speeding != null) {
      const direction = this.speed > 0 ? 1 : -1;
      if (this.rotating == 'left') {
        this.el.object3D.rotateY(direction * Math.PI / 120);
      } else if (this.rotating == 'right') {
        this.el.object3D.rotateY(direction * -Math.PI / 120);
      }
    }
    if (this.speeding == 'up') {
      this.speed = Math.min(this.speed + 0.02, 0.2);
    } else if (this.speeding == 'down') {
      this.speed = Math.max(this.speed - 0.02, -0.2);
    }
    const position = this.el.getAttribute('position');
    const rotation = this.el.getAttribute('rotation');
    const angle = Math.PI * rotation.y / 180;
    position.x += this.speed * Math.sin(angle);
    position.z += this.speed * Math.cos(angle);
    this.el.setAttribute('position', position);
    if (this.speed > 0) {
      this.speed = Math.max(this.speed - 0.01, 0);
    }
    if (this.speed < 0) {
      this.speed = Math.min(this.speed + 0.01, 0);
    }
  }
});

AFRAME.registerComponent('car-controller-left', {
  init: function () {
    this.el.addEventListener('axismove', function (e) {
      const car = document.querySelector('[car]').components.car;
      car.onAxisMoveSpeed(e);
    });
  }
});

AFRAME.registerComponent('car-controller-right', {
  init: function () {
    this.el.addEventListener('axismove', function (e) {
      const car = document.querySelector('[car]').components.car;
      car.onAxisMoveAngle(e);
    });
  }
});
