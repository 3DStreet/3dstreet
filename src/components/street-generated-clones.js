/* global AFRAME */

AFRAME.registerComponent('street-generated-clones', {
  multiple: true,
  schema: {
    // Common properties
    model: { type: 'string' },
    modelsArray: { type: 'array' }, // For random selection from multiple models
    length: { type: 'number' }, // length in meters of segment
    positionX: { default: 0, type: 'number' },
    positionY: { default: 0, type: 'number' },
    facing: { default: 0, type: 'number' }, // Y Rotation in degrees
    randomFacing: { default: false, type: 'boolean' },

    // Mode-specific properties
    mode: { default: 'fixed', oneOf: ['fixed', 'random', 'single'] },

    // Unified spacing and offset properties
    spacing: { default: 15, type: 'number' }, // minimum distance between objects
    cycleOffset: { default: 0.5, type: 'number' }, // offset as a fraction of spacing

    // Random mode properties
    count: { default: 1, type: 'number' },

    // Single mode properties
    justify: { default: 'middle', oneOf: ['start', 'middle', 'end'] },
    padding: { default: 4, type: 'number' }
  },

  init: function () {
    this.createdEntities = [];
  },

  update: function (oldData) {
    const data = this.data;

    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
    }

    // Clear existing entities
    this.createdEntities.forEach((entity) => entity.remove());
    this.createdEntities = [];

    // Generate new entities based on mode
    switch (data.mode) {
      case 'fixed':
        this.generateFixed();
        break;
      case 'random':
        this.generateRandom();
        break;
      case 'single':
        this.generateSingle();
        break;
    }
  },

  generateFixed: function () {
    const data = this.data;
    const correctedSpacing = Math.max(1, data.spacing);
    const numClones = Math.floor(data.length / correctedSpacing);

    for (let i = 0; i < numClones; i++) {
      const positionZ =
        data.length / 2 - (i + data.cycleOffset) * correctedSpacing;
      this.createClone(positionZ);
    }
  },

  generateRandom: function () {
    const data = this.data;
    const positions = this.randPlacedElements(
      data.length,
      data.spacing,
      data.count,
      data.cycleOffset
    );

    positions.forEach((positionZ) => {
      this.createClone(positionZ);
    });
  },

  generateSingle: function () {
    const data = this.data;
    let positionZ = 0;

    if (data.justify === 'start') {
      positionZ = data.length / 2 - data.padding;
    } else if (data.justify === 'end') {
      positionZ = -data.length / 2 + data.padding;
    }

    this.createClone(positionZ);
  },

  createClone: function (positionZ) {
    const data = this.data;
    const clone = document.createElement('a-entity');

    clone.setAttribute('mixin', this.getModelMixin());
    clone.setAttribute('position', {
      x: data.positionX,
      y: data.positionY,
      z: positionZ
    });

    const rotation = data.randomFacing ? Math.random() * 360 : data.facing;
    clone.setAttribute('rotation', `0 ${rotation} 0`);

    // Add common attributes
    clone.classList.add('autocreated');
    clone.setAttribute('data-no-transform', '');
    clone.setAttribute('data-layer-name', 'Cloned Model • ' + data.model);

    this.el.appendChild(clone);
    this.createdEntities.push(clone);
  },

  getModelMixin: function () {
    const data = this.data;
    if (data.modelsArray && data.modelsArray.length > 0) {
      return data.modelsArray[
        Math.floor(Math.random() * data.modelsArray.length)
      ];
    }
    return data.model;
  },

  randPlacedElements: function (streetLength, spacing, count, offset) {
    const correctedSpacing = Math.max(1, spacing);
    const start = -streetLength / 2 + correctedSpacing / 2;
    const end = streetLength / 2 - correctedSpacing / 2;

    // Calculate positions with offset
    const len = Math.floor((end - start) / correctedSpacing) + 1;
    const positions = Array(len)
      .fill()
      .map((_, idx) => {
        // Apply the offset similar to fixed mode
        return start + (idx + offset) * correctedSpacing;
      });

    // Randomly select positions
    return positions.sort(() => 0.5 - Math.random()).slice(0, count);
  }
});
