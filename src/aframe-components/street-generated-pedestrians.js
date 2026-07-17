/* global AFRAME */
import { createRNG } from '../lib/rng';

AFRAME.registerComponent('street-generated-pedestrians', {
  multiple: true,
  schema: {
    density: {
      type: 'string',
      default: 'normal',
      oneOf: ['empty', 'sparse', 'normal', 'dense']
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
    this.onSegmentChanged = () => {
      const segment = this.el.components['street-segment']?.data;
      if (!segment) return;
      // Pedestrians depend on length and width. Skip when both are unchanged
      // since our last run: the segment's first-init emit during scene load
      // carries the same dimensions we already generated with, so regenerating
      // would tear every pedestrian down and recreate it identically (#1759).
      if (segment.length === this.length && segment.width === this.width) {
        return;
      }
      this.update();
    };
    this.el.addEventListener('segment-changed', this.onSegmentChanged);
  },

  clearEntities: function () {
    // Only detach entities still connected to the DOM (see #1493).
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) entity.remove();
    });
    this.createdEntities.length = 0;
  },
  remove: function () {
    this.el.removeEventListener('segment-changed', this.onSegmentChanged);
    this.clearEntities();
  },
  update: function (oldData) {
    const segment = this.el.components['street-segment']?.data;
    if (!segment?.length || !segment?.width) {
      return;
    }
    this.length = segment.length;
    this.width = segment.width;
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
    this.clearEntities();

    // Calculate x position range based on segment width
    const xRange = {
      min: -(0.37 * this.width),
      max: 0.37 * this.width
    };

    // Calculate total number of pedestrians based on density and street length
    const totalPedestrians = Math.floor(
      this.densityFactors[data.density] * this.length
    );

    // Get Z positions using seeded randomization
    const zPositions = this.getZPositions(
      -this.length / 2,
      this.length / 2,
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
      pedestrian.setAttribute('data-layer-name', 'Cloned Pedestrian');
      pedestrian.setAttribute('data-parent-component', this.attrName);

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
