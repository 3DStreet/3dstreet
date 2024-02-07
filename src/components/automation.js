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
  },
  addLinearAnimation: function () {
    const el = this.el;
    const streetLength = this.data.streetLength;
    const speed = this.data.speed;
    const direction = this.data.direction;
    const zPos = el.object3D.position.z;

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
    // Animation parameters for the next animation cycle. 
    // They can be changed when changing position of the object in the editor
    const animationAttrs_2 = {
      property: 'object3D.position.z',
      autoplay: false,
      easing: 'linear',
      loop: 'true',
      from: -halfStreet,
      to: halfStreet,
      dur: totalStreetDuration,
      startEvents: 'animationcomplete__1'
    };    
    el.setAttribute('animation__1', animationAttrs_1);
    el.setAttribute('animation__2', animationAttrs_2);
  },
  animationCompleteEvent: function (evt) {
    const elem = evt.target;
  },
  toggleAnimation: function (enabled) {
    const el = this.el;
    const elemComponents = el.components;
    if (elemComponents['animation__1']) {
      // toggle animations that bypass play/pause events that are called by the aframe-inspector
      elemComponents['animation__1'].initialized = enabled;
    };
    if (elemComponents['animation__2']) {
      elemComponents['animation__2'].initialized = enabled;
    }
    if (enabled) {
      // enable animation-mixer
      if (this.data.mixer) el.setAttribute('animation-mixer', {timeScale: 1});
    } else {
      // disable animation-mixer
      if (this.data.mixer) el.setAttribute('animation-mixer', {timeScale: 0});
    }
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
