/* global AFRAME */
import { createRNG } from '../lib/rng';

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
    seed: { default: 0, type: 'int' }, // random seed for random and randomFacing mode
    randomFacing: { default: false, type: 'boolean' },
    direction: { type: 'string', oneOf: ['none', 'inbound', 'outbound'] }, // not used if facing defined?

    // Mode-specific properties
    mode: { default: 'fixed', oneOf: ['fixed', 'random', 'single'] },

    // Spacing for fixed and random modes
    spacing: { default: 15, type: 'number' }, // minimum distance between objects

    // Fixed mode properties
    cycleOffset: { default: 0.5, type: 'number' }, // offset as a fraction of spacing, only for fixed

    // Random mode properties
    count: { default: 1, type: 'number' },

    // Single mode properties
    justify: { default: 'middle', oneOf: ['start', 'middle', 'end'] },
    padding: { default: 4, type: 'number' }
  },

  init: function () {
    this.createdEntities = [];
  },

  remove: function () {
    this.createdEntities.forEach((entity) => entity.remove());
    this.createdEntities.length = 0; // Clear the array
  },

  /**
   * Detaches all generated entities from the component's control.
   * - Removes the 'autocreated' class from each entity
   * - Clears the createdEntities array
   * - Removes the component from the parent element
   * This allows the entities to persist independently after the component is removed.
   */
  detach: function () {
    // Store the parent element for later use
    const parentEl = this.el;

    // Process each created entity
    this.createdEntities.forEach((entity) => {
      // Remove the autocreated class to prevent cleanup by other systems
      entity.classList.remove('autocreated');
      entity.removeAttribute('data-no-transform');

      // Optional: Update the layer name to reflect independent status
      const currentLayerName = entity.getAttribute('data-layer-name');
      if (currentLayerName) {
        entity.setAttribute(
          'data-layer-name',
          currentLayerName.replace('Cloned Model', 'Detached Model')
        );
      }
    });

    // Clear the createdEntities array without removing the actual entities
    this.createdEntities.length = 0;

    // Remove the component from the parent element
    parentEl.removeAttribute(this.attrName);
  },

  update: function (oldData) {
    // If mode is random or randomFacing and seed is 0, generate a random seed and return,
    // the update will be called again because of the setAttribute.
    if (this.data.mode === 'random' || this.data.randomFacing) {
      if (this.data.seed === 0) {
        const newSeed = Math.floor(Math.random() * 1000000) + 1; // Add 1 to avoid seed 0
        this.el.setAttribute(this.attrName, 'seed', newSeed);
        return;
      }
      // Always recreate RNG when update is called to be sure we end of with the same clones positions for a given seed
      this.rng = createRNG(this.data.seed);
    }

    // Clear existing entities
    this.remove();

    // Generate new entities based on mode
    switch (this.data.mode) {
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
      data.count
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
    const mixinId = this.getModelMixin();
    const clone = document.createElement('a-entity');

    clone.setAttribute('mixin', mixinId);
    clone.setAttribute('position', {
      x: data.positionX,
      y: data.positionY,
      z: positionZ
    });

    let rotationY = data.facing;
    if (data.direction === 'inbound') {
      rotationY = 0 + data.facing;
    }
    if (data.direction === 'outbound') {
      rotationY = 180 - data.facing;
    }
    if (data.randomFacing) {
      rotationY = this.rng() * 360;
    }
    clone.setAttribute('rotation', `0 ${rotationY} 0`);

    // Add common attributes
    clone.classList.add('autocreated');
    clone.setAttribute('data-no-transform', '');
    clone.setAttribute('data-layer-name', 'Cloned Model • ' + mixinId);
    clone.setAttribute('data-parent-component', this.attrName);

    this.el.appendChild(clone);
    this.createdEntities.push(clone);
  },

  getModelMixin: function () {
    const data = this.data;
    if (data.modelsArray && data.modelsArray.length > 0) {
      return data.modelsArray[Math.floor(this.rng() * data.modelsArray.length)];
    }
    return data.model;
  },

  randPlacedElements: function (streetLength, spacing, count) {
    const correctedSpacing = Math.max(1, spacing);
    const start = -streetLength / 2 + correctedSpacing / 2;
    const end = streetLength / 2 - correctedSpacing / 2;

    // Calculate positions with offset
    const len = Math.floor((end - start) / correctedSpacing) + 1;
    const positions = Array(len)
      .fill()
      .map((_, idx) => {
        // Apply the offset similar to fixed mode
        return start + idx * correctedSpacing;
      });
    // Use seeded random for shuffling
    for (let i = positions.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [positions[i], positions[j]] = [positions[j], positions[i]];
    }

    return positions.slice(0, count);
  }
});
