/* global AFRAME */

// a-frame component to generate cloned models along a street
// this moves logic from aframe-streetmix-parsers into this component

AFRAME.registerComponent('street-generated-fixed', {
  multiple: true,
  schema: {
    model: {
      type: 'string'
    },
    length: {
      // length in meters of linear path to fill with clones
      type: 'number'
    },
    spacing: {
      // spacing in meters between clones
      default: 15,
      type: 'number'
    },
    positionX: {
      // x position of clones along the length
      default: 0,
      type: 'number'
    },
    positionY: {
      // y position of clones along the length
      default: 0,
      type: 'number'
    },
    cycleOffset: {
      // z (inbound/outbound) offset as a fraction of spacing value
      default: 0.5, // this is used to place different models at different z-levels with the same spacing value
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
    },
    rotationX: {
      default: 0,
      type: 'number'
    }
    // seed: {  // seed not yet supported
    //   default: 0,
    //   type: 'number'
    // }
  },
  init: function () {
    this.createdEntities = [];
  },
  update: function (oldData) {
    // generate a function that creates a cloned set of x entities based on spacing and length values from the model shortname gltf file loaded in aframe
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

    this.correctedSpacing = data.spacing < 1 ? 1 : data.spacing; // return 1 if data.spacing is less than 1

    // Calculate number of clones needed based on length and spacing
    const numClones = Math.floor(data.length / this.correctedSpacing);

    // Create clones and position them along the length
    for (let i = 0; i < numClones; i++) {
      const clone = document.createElement('a-entity');
      clone.setAttribute('mixin', data.model);
      // Position each clone evenly spaced along z-axis
      // offset default is 0.5 so that clones don't start exactly at street start which looks weird
      const positionZ =
        data.length / 2 - (i + data.cycleOffset) * this.correctedSpacing;
      clone.setAttribute('position', {
        x: data.positionX,
        y: data.positionY,
        z: positionZ
      });

      if (data.randomFacing) {
        clone.setAttribute(
          'rotation',
          `${data.rotationX} ${Math.random() * 360} 0`
        );
      } else {
        clone.setAttribute('rotation', `${data.rotationX} ${data.facing} 0`);
      }
      clone.classList.add('autocreated');
      // clone.setAttribute('data-ignore-raycaster', ''); // i still like clicking to zoom to individual clones, but instead this should show the generated-fixed clone settings
      clone.setAttribute('data-no-transform', '');
      clone.setAttribute('data-layer-name', 'Cloned Model • ' + data.model);

      this.el.appendChild(clone);
      this.createdEntities.push(clone);
    }
  }
});
