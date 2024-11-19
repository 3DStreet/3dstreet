/* global AFRAME */

// a-frame component to one cloned model along a street
// this moves logic from aframe-streetmix-parsers into this component

AFRAME.registerComponent('street-generated-single', {
  multiple: true,
  schema: {
    model: {
      type: 'string'
    },
    length: {
      // length in meters of segment
      type: 'number'
    },
    justify: {
      default: 'middle',
      oneOf: ['start', 'middle', 'end']
    },
    padding: {
      // spacing in meters between segment edge and model
      default: 4,
      type: 'number'
    },
    positionX: {
      // x position of model
      default: 0,
      type: 'number'
    },
    positionY: {
      // y position of model
      default: 0,
      type: 'number'
    },
    facing: {
      default: 0, // this is a Y Rotation value in degrees -- UI could offer a dropdown with options for 0, 90, 180, 270
      type: 'number'
    },
    randomFacing: {
      // if true, facing is ignored and a random Y Rotation is applied to each clone
      default: false,
      type: 'boolean'
    }
  },
  init: function () {
    this.createdEntities = [];
  },
  update: function (oldData) {
    const data = this.data;
    // if oldData is same as current data, then don't update
    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
    }

    // For each clone in this.entities, remove it
    this.createdEntities.forEach((entity) => {
      entity.remove();
    });
    this.createdEntities = [];

    const clone = document.createElement('a-entity');
    clone.setAttribute('mixin', data.model);

    // Position z is dependent upon length and padding
    let positionZ = 0; // middle
    if (data.justify === 'start') {
      positionZ = data.length / 2 - data.padding;
    } else if (data.justify === 'end') {
      positionZ = -data.length / 2 + data.padding;
    }

    clone.setAttribute('position', {
      x: data.positionX,
      y: data.positionY,
      z: positionZ
    });

    if (data.randomFacing) {
      clone.setAttribute('rotation', `0 ${Math.random() * 360} 0`);
    } else {
      clone.setAttribute('rotation', `0 ${data.facing} 0`);
    }
    clone.classList.add('autocreated');
    // clone.setAttribute('data-ignore-raycaster', ''); // i still like clicking to zoom to individual clones, but instead this should show the generated-fixed clone settings
    // clone.setAttribute('data-no-transform', '');
    clone.setAttribute('data-layer-name', 'Cloned Model • ' + data.model);
    this.el.appendChild(clone);
    this.createdEntities.push(clone);
  }
});
