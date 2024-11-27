/* global AFRAME */

// a-frame component to generate cloned models along a street
// this moves logic from aframe-streetmix-parsers into this component

AFRAME.registerComponent('street-generated-striping', {
  multiple: true,
  schema: {
    striping: {
      type: 'string'
    },
    side: {
      default: 'left',
      oneOf: ['left', 'right']
    },
    facing: {
      default: 0, // this is a Y Rotation value in degrees -- UI could offer a dropdown with options for 0, 90, 180, 270
      type: 'number'
    },
    length: {
      // length in meters of linear path to fill with clones
      type: 'number'
    },
    positionX: {
      // x position of clones along the length
      default: 0,
      type: 'number'
    },
    positionY: {
      // y position of clones along the length
      default: 0.2, // this is too high, instead this should component should respect elevation to follow street segment
      type: 'number'
    }
  },
  init: function () {
    this.createdEntities = [];
  },
  update: function (oldData) {
    const data = this.data;
    if (AFRAME.utils.deepEqual(oldData, data)) return;

    // Clean up old entities
    this.createdEntities.forEach((entity) => entity.remove());
    this.createdEntities = [];

    const clone = document.createElement('a-entity');
    clone.setAttribute('mixin', data.striping);

    clone.setAttribute('position', {
      x: data.positionX,
      y: data.positionY,
      z: 0
    });

    const scaleY = data.length / 150;
    const scalePlane = '1 ' + scaleY + ' 1';

    clone.setAttribute('scale', scalePlane);

    let repeatY = data.length / 6;
    if (data.striping === 'short-dashed-stripe-yellow') {
      repeatY = data.length / 3;
    }
    clone.setAttribute('rotation', {
      x: -90,
      y: data.facing,
      z: 0
    });

    clone.setAttribute('material', `repeat: 1 ${repeatY}`);

    clone.classList.add('autocreated');
    // clone.setAttribute('data-ignore-raycaster', ''); // i still like clicking to zoom to individual clones, but instead this should show the generated-fixed clone settings
    clone.setAttribute('data-no-transform', '');
    clone.setAttribute('data-layer-name', 'Cloned Striping • ' + data.striping);
    this.el.appendChild(clone);
    this.createdEntities.push(clone);
  }
});
