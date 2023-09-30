AFRAME.registerComponent('screen-position', {

  init() {
    this.vec3 = new THREE.Vector3()
    this.getScreenPosition = this.getScreenPosition.bind(this)
  },

  getScreenPosition(pos) {

    this.el.object3D.getWorldPosition(this.vec3)

    const camera = this.el.sceneEl.camera
    this.vec3.project(camera)

    const bounds = document.body.getBoundingClientRect();

    pos.x = bounds.width * (this.vec3.x + 1) / 2 
    pos.y = bounds.height - bounds.height * (this.vec3.y + 1) / 2
    return pos
  }
});
// output-screen-position-2', `i: ${i};`);



AFRAME.registerComponent('output-screen-position-labels', {

  schema: {
      i: { type: 'number'}
  },
  dependencies: ['screen-position'],
  adjustOverlayDiv(order, leftPosition, text) {
    var overlayDiv = document.querySelector('#label-' + order);
    overlayDiv.style.left = leftPosition + "px";
    overlayDiv.children[0].textContent = text;
  },
  init() {
    this.pos = new THREE.Vector2()
    this.getScreenPosition = this.el.components['screen-position'].getScreenPosition
  },

  tick() {

    this.getScreenPosition(this.pos)
    // adjustOverlayDiv(200, this.pos.x);  // This will set the width of the overlay div to 200px and its x-position to 100px from the left edge of its container.
    // console.log(this.data.i, this.pos.x);
    const labelText = this.el.getAttribute('data-segmentWidthInFeet') + 'ft\r\n' + this.el.getAttribute('data-segmentWidthInMeters') + 'm\r\n' + this.el.getAttribute('data-segmentType') 
    this.adjustOverlayDiv(this.data.i, this.pos.x, labelText);  // This will set the x-position of the second overlay div to 250px from the left edge of its container.
  
  }
});


