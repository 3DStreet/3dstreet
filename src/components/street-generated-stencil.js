/* global AFRAME */

// a-frame component to generate cloned models along a street
// this moves logic from aframe-streetmix-parsers into this component

AFRAME.registerComponent('street-generated-stencil', {
  multiple: true,
  schema: {
    model: {
      type: 'string',
      oneOf: [
        'sharrow',
        'bike-arrow',
        'left',
        'right',
        'straight',
        'left-straight',
        'right-straight',
        'both',
        'all',
        'word-taxi',
        'word-only',
        'word-bus',
        'word-lane',
        'word-only-small',
        'word-yield',
        'word-slow',
        'word-xing',
        'word-stop',
        'word-loading-small',
        'perpendicular-stalls',
        'parking-t',
        'hash-left',
        'hash-right',
        'hash-chevron',
        'solid-stripe'
      ]
    },
    stencils: {
      // if present, then use this array of stencils instead of 1 model
      type: 'array'
    },
    padding: {
      // distance between stencils within array
      default: 0,
      type: 'number'
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
      default: 0.05,
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
    stencilHeight: {
      default: 0,
      type: 'number'
    },
    direction: {
      // specifying inbound/outbound directions will overwrite facing/randomFacing
      type: 'string',
      oneOf: ['none', 'inbound', 'outbound']
    }
    // seed: {  // seed not yet supported
    //   default: 0,
    //   type: 'number'
    // }
  },
  init: function () {
    this.createdEntities = [];
  },
  remove: function () {
    this.createdEntities.forEach((entity) => entity.remove());
  },
  update: function (oldData) {
    const data = this.data;
    if (AFRAME.utils.deepEqual(oldData, data)) return;

    // Clean up old entities
    this.createdEntities.forEach((entity) => entity.remove());
    this.createdEntities = [];

    // Use either stencils array or single model
    let stencilsToUse = data.stencils.length > 0 ? data.stencils : [data.model];

    // Reverse stencil order if inbound
    if (data.direction === 'inbound') {
      stencilsToUse = stencilsToUse.slice().reverse();
    }

    // Ensure minimum spacing
    this.correctedSpacing = Math.max(1, data.spacing);

    // Calculate number of stencil groups that can fit in the length
    const numGroups = Math.floor(data.length / this.correctedSpacing);

    // Create stencil groups along the street
    for (let groupIndex = 0; groupIndex < numGroups; groupIndex++) {
      const groupPosition =
        data.length / 2 -
        (groupIndex + data.cycleOffset) * this.correctedSpacing;

      // Create each stencil within the group
      stencilsToUse.forEach((stencilName, stencilIndex) => {
        const clone = document.createElement('a-entity');
        clone.setAttribute('mixin', stencilName);

        // Calculate stencil position within group
        const stencilOffset =
          (stencilIndex - (stencilsToUse.length - 1) / 2) * data.padding;

        // Set position with group position and stencil offset
        clone.setAttribute('position', {
          x: data.positionX,
          y: data.positionY,
          z: groupPosition + stencilOffset
        });

        // Handle stencil height if specified
        if (data.stencilHeight > 0) {
          clone.addEventListener('loaded', (evt) => {
            evt.target.setAttribute('geometry', 'height', data.stencilHeight);
            evt.target.setAttribute('atlas-uvs', 'forceRefresh', true);
          });
        }

        // Set rotation - either random, specified facing, or inbound/outbound
        var rotationY = data.facing;
        if (data.direction === 'inbound') {
          rotationY = 180 + data.facing;
        }
        if (data.direction === 'outbound') {
          rotationY = 0 - data.facing;
        }
        if (data.randomFacing) {
          rotationY = Math.random() * 360;
        }
        clone.setAttribute('rotation', `-90 ${rotationY} 0`);

        // Add metadata
        clone.classList.add('autocreated');
        clone.setAttribute('data-no-transform', '');
        clone.setAttribute('data-layer-name', `Cloned Model • ${stencilName}`);

        this.el.appendChild(clone);
        this.createdEntities.push(clone);
      });
    }
  }
});
