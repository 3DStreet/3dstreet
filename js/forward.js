// source: https://github.com/networked-aframe/networked-aframe/blob/master/server/static/js/forward.component.js
AFRAME.registerComponent('forward', {
  schema: {
    speed: {default: 0.1},
  },

  init: function() {
    var worldDirection = new THREE.Vector3();

    this.el.object3D.getWorldDirection(worldDirection);
//          worldDirection.multiplyScalar(-1);

    this.worldDirection = worldDirection;
    console.error(this.worldDirection);
  },

  tick: function() {
    var el = this.el;

    var currentPosition = el.getAttribute('position');
    var newPosition = this.worldDirection
                      .clone()
                      .multiplyScalar(this.data.speed)
                      .add(currentPosition);
    el.setAttribute('position', newPosition);
  }
});
