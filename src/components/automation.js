/* global AFRAME */
/*
The automation-element component controls all animation of the element
*/
AFRAME.registerComponent('automation-element', {
  schema: {
    // initial z position of element
    zPos: { type: 'number', default: 0 },
    direction: { type: 'string', default: 'outbound', oneOf: ['outbound', 'inbound'] },
    enabled: { type: 'boolean', default: true },
    speed: { type: 'number', default: 1000 },
    streetLength: { type: 'number', default: 60 }
  },
  init: function () {
    const el = this.el;
    this.addLinearAnimation();
    // save position after pause animation (switch to Editor mode)
    let animPausePos = new THREE.Vector3;
    // flag to skip initial animation play
    let firstPlayFlag = true;

    el.addEventListener('play', (evt) => {
      if (!firstPlayFlag && !el.object3D.position.equals(animPausePos)) {
        // the object's position has been changed in the Editor. Update animation
        this.addLinearAnimation();
      }
      firstPlayFlag = false;
    });
    el.addEventListener('pause', () => {
      // save position while animation pause (switch to the Editor mode)
      const pos = el.object3D.position;
      animPausePos.copy(pos);
    });
    el.addEventListener('animationcomplete', () => {
      // move the object to the beginning of the path
      let pos = el.object3D.position;
      pos.z = -pos.z;
      el.setAttribute('position', pos);
      el.removeAttribute('animation');
      // change animtaion settings
      this.addLinearAnimation();
    });
  },
  addLinearAnimation: function () {
    const el = this.el;
    const streetLength = this.data.streetLength;
    const speed = this.data.speed;
    const direction = this.data.direction;
    const zPos = el.object3D.position.z;
    //const zPos = this.data.zPos;

    const totalStreetDuration = (streetLength / speed) * 1000; // time in milliseconds

    if (direction === 'outbound') {
      halfStreet = -streetLength / 2;
      el.setAttribute('rotation', {y: 180});
    } else {
      halfStreet = streetLength / 2;
      el.setAttribute('rotation', {y: 0});
    }
    const startingDistanceToTravel = Math.abs(halfStreet - zPos);
    const startingDuration = (startingDistanceToTravel / speed) * 1000;

    // animation params to move an object from its current position to the end of street
    // in a specified direction
    const animationAttrs_1 = {
      property: 'object3D.position.z',
      easing: 'linear',
      loop: 'false',
      from: zPos,
      to: halfStreet,
      dur: startingDuration
    }; 
 
    el.setAttribute('animation', animationAttrs_1);    
  },
  toggleAnimation: function (enabled) {
    const el = this.el;
    const elemComponents = el.components;
    if (elemComponents['animation']) {
      // toggle animations that bypass play/pause events that are called by the aframe-inspector
      elemComponents['animation'].initialized = enabled;
    };

    if (this.data.mixer) el.setAttribute('animation-mixer', {timeScale: 1 * enabled});
    
    if (elemComponents['wheel']) {
      elemComponents['wheel'].data.isActive = enabled;
    }
  },
  update: function (oldData) {
    // If `oldData` is empty, then this means we're in the initialization process.
    // No need to update.
    if (Object.keys(oldData).length === 0) { return; }

    const changedData = AFRAME.utils.diff(this.data, oldData);
    const changedKeysNumber = Object.keys(changedData).length;
    
    if (changedData.hasOwnProperty('enabled')) {
      this.toggleAnimation(changedData.enabled);
      // if only 'enabled' data changed
      if (changedKeysNumber == 1) return;
    } 

    if (changedKeysNumber > 0) {
      this.addLinearAnimation();
    }
  }
});
