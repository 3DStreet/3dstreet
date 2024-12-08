/* global AFRAME */

// a-frame component to generate cloned pedestrian models along a street
AFRAME.registerComponent('street-generated-pedestrians', {
  multiple: true,
  schema: {
    segmentWidth: {
      // width of the segment in meters
      type: 'number',
      default: 3
    },
    density: {
      type: 'string',
      default: 'normal',
      oneOf: ['empty', 'sparse', 'normal', 'dense']
    },
    length: {
      // length in meters of linear path to fill with clones
      type: 'number'
    },
    direction: {
      type: 'string',
      default: 'none',
      oneOf: ['none', 'inbound', 'outbound']
    },
    // animated: {
    //   // load 8 animated characters instead of 16 static characters
    //   type: 'boolean',
    //   default: false
    // },
    positionY: {
      // y position of pedestrians
      type: 'number',
      default: 0
    }
  },

  init: function () {
    this.createdEntities = [];
    this.densityFactors = {
      empty: 0,
      sparse: 0.03,
      normal: 0.125,
      dense: 0.25
    };
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

    // Calculate x position range based on segment width
    const xRange = {
      min: -(0.37 * data.segmentWidth),
      max: 0.37 * data.segmentWidth
    };

    // Calculate total number of pedestrians based on density and street length
    const totalPedestrians = Math.floor(
      this.densityFactors[data.density] * data.length
    );

    // Get available z positions
    const zPositions = this.getZPositions(
      -data.length / 2,
      data.length / 2,
      1.5
    );

    // Create pedestrians
    for (let i = 0; i < totalPedestrians; i++) {
      const pedestrian = document.createElement('a-entity');

      // Set random position within bounds
      const position = {
        x: this.getRandomArbitrary(xRange.min, xRange.max),
        y: data.positionY,
        z: zPositions.pop()
      };
      pedestrian.setAttribute('position', position);

      // Set model variant
      const variantNumber = this.getRandomIntInclusive(
        1,
        data.animated ? 8 : 16
      );
      const variantPrefix = data.animated ? 'a_char' : 'char';
      pedestrian.setAttribute('mixin', `${variantPrefix}${variantNumber}`);

      // Set rotation based on direction
      if (data.direction === 'none' && Math.random() < 0.5) {
        pedestrian.setAttribute('rotation', '0 180 0');
      } else if (data.direction === 'outbound') {
        pedestrian.setAttribute('rotation', '0 180 0');
      }

      // Add metadata
      pedestrian.classList.add('autocreated');
      pedestrian.setAttribute('data-no-transform', '');
      pedestrian.setAttribute('data-layer-name', 'Generated Pedestrian');

      this.el.appendChild(pedestrian);
      this.createdEntities.push(pedestrian);
    }
  },

  // Helper methods from legacy function
  getRandomIntInclusive: function (min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1) + min);
  },

  getRandomArbitrary: function (min, max) {
    return Math.random() * (max - min) + min;
  },

  getZPositions: function (start, end, step) {
    const len = Math.floor((end - start) / step) + 1;
    const arr = Array(len)
      .fill()
      .map((_, idx) => start + idx * step);
    return arr.sort(() => 0.5 - Math.random());
  }
});
