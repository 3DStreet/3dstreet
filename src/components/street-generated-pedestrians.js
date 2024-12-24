/* global AFRAME */
import { createRNG } from '../lib/rng';

AFRAME.registerComponent('street-generated-pedestrians', {
  multiple: true,
  schema: {
    segmentWidth: {
      type: 'number',
      default: 3
    },
    density: {
      type: 'string',
      default: 'normal',
      oneOf: ['empty', 'sparse', 'normal', 'dense']
    },
    length: {
      type: 'number'
    },
    direction: {
      type: 'string',
      default: 'none',
      oneOf: ['none', 'inbound', 'outbound']
    },
    positionY: {
      type: 'number',
      default: 0
    },
    seed: {
      type: 'int',
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
    this.createdEntities.length = 0;
  },

  update: function (oldData) {
    const data = this.data;

    // Handle seed initialization
    if (this.data.seed === 0) {
      const newSeed = Math.floor(Math.random() * 1000000) + 1;
      this.el.setAttribute(this.attrName, 'seed', newSeed);
      return;
    }

    // Create seeded RNG
    this.rng = createRNG(this.data.seed);

    // Clean up old entities
    this.remove();

    // Calculate x position range based on segment width
    const xRange = {
      min: -(0.37 * data.segmentWidth),
      max: 0.37 * data.segmentWidth
    };

    // Calculate total number of pedestrians based on density and street length
    const totalPedestrians = Math.floor(
      this.densityFactors[data.density] * data.length
    );

    // Get Z positions using seeded randomization
    const zPositions = this.getZPositions(
      -data.length / 2,
      data.length / 2,
      1.5
    );

    // Create pedestrians
    for (let i = 0; i < totalPedestrians; i++) {
      const pedestrian = document.createElement('a-entity');
      this.el.appendChild(pedestrian);

      // Set seeded random position within bounds
      const position = {
        x: this.getRandomArbitrary(xRange.min, xRange.max),
        y: data.positionY,
        z: zPositions[i]
      };
      pedestrian.setAttribute('position', position);

      // Set model variant using seeded random
      const variantNumber = this.getRandomIntInclusive(1, 16);
      pedestrian.setAttribute('mixin', `char${variantNumber}`);

      // Set rotation based on direction and seeded random
      if (data.direction === 'none') {
        if (this.rng() < 0.5) {
          pedestrian.setAttribute('rotation', '0 180 0');
        }
      } else if (data.direction === 'outbound') {
        pedestrian.setAttribute('rotation', '0 180 0');
      }

      // Add metadata
      pedestrian.classList.add('autocreated');
      pedestrian.setAttribute('data-no-transform', '');
      pedestrian.setAttribute('data-layer-name', 'Generated Pedestrian');

      this.createdEntities.push(pedestrian);
    }
  },

  // Helper methods now using seeded RNG
  getRandomIntInclusive: function (min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(this.rng() * (max - min + 1) + min);
  },

  getRandomArbitrary: function (min, max) {
    return this.rng() * (max - min) + min;
  },

  getZPositions: function (start, end, step) {
    const len = Math.floor((end - start) / step) + 1;
    const positions = Array(len)
      .fill()
      .map((_, idx) => start + idx * step);

    // Use seeded shuffle (Fisher-Yates algorithm with seeded RNG)
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    return positions;
  }
});
