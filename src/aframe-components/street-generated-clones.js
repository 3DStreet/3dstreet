/* global AFRAME */
import { createRNG } from '../lib/rng';

AFRAME.registerComponent('street-generated-clones', {
  multiple: true,
  schema: {
    // Common properties
    modelsArray: { type: 'array' }, // For random selection from multiple models
    positionX: { default: 0, type: 'number' },
    positionY: { default: 0, type: 'number' },
    facing: { default: 0, type: 'number' }, // Y Rotation in degrees
    seed: { default: 0, type: 'int' }, // random seed for random and randomFacing mode
    randomFacing: { default: false, type: 'boolean' },
    direction: { type: 'string', oneOf: ['none', 'inbound', 'outbound'] }, // not used if facing defined?

    // Mode-specific properties
    mode: { default: 'fixed', oneOf: ['fixed', 'random', 'single', 'fit'] },

    // Spacing for fixed, random and fit modes
    spacing: {
      default: 15,
      type: 'number',
      if: { mode: ['fixed', 'random', 'fit'] }
    }, // minimum distance between objects

    // Fixed mode properties
    cycleOffset: { default: 0.5, type: 'number', if: { mode: ['fixed'] } }, // offset as a fraction of spacing, only for fixed

    // Random mode properties
    count: { default: 1, type: 'number', if: { mode: ['random'] } },

    // Single mode properties
    justify: {
      default: 'middle',
      oneOf: ['start', 'middle', 'end'],
      if: { mode: ['single'] }
    },
    padding: { default: 4, type: 'number', if: { mode: ['single'] } },

    // Fit mode properties
    justifyWidth: {
      default: 'center',
      oneOf: ['left', 'center', 'right'],
      if: { mode: ['fit'] }
    }
  },

  init: function () {
    this.createdEntities = [];
    this.length = this.el.getAttribute('street-segment')?.length;
    this.width = this.el.getAttribute('street-segment')?.width;

    this.el.addEventListener('segment-length-changed', (event) => {
      this.length = event.detail.newLength;
      this.update();
    });

    this.el.addEventListener('segment-width-changed', (event) => {
      this.width = event.detail.newWidth;
      this.update();
    });
  },

  remove: function () {
    this.createdEntities.forEach((entity) => entity.remove());
    this.createdEntities.length = 0; // Clear the array
  },

  detach: function () {
    const commands = [];
    commands.push([
      'componentremove',
      { entity: this.el, component: this.attrName }
    ]);
    let entityObjToPushAtTheEnd = null; // so that the entity is selected after executing the multi command
    this.createdEntities.forEach((entity) => {
      const position = entity.getAttribute('position');
      const rotation = entity.getAttribute('rotation');
      const entityObj = {
        parentEl: this.el,
        mixin: entity.getAttribute('mixin'),
        'data-layer-name': entity
          .getAttribute('data-layer-name')
          .replace('Cloned Model', 'Detached Model'),
        components: {
          position: { x: position.x, y: position.y, z: position.z },
          rotation: { x: rotation.x, y: rotation.y, z: rotation.z }
        }
      };
      if (AFRAME.INSPECTOR?.selectedEntity === entity) {
        entityObjToPushAtTheEnd = entityObj;
      } else {
        commands.push(['entitycreate', entityObj]);
      }
    });
    if (entityObjToPushAtTheEnd !== null) {
      commands.push(['entitycreate', entityObjToPushAtTheEnd]);
    }
    AFRAME.INSPECTOR.execute('multi', commands);
  },

  update: function (oldData) {
    // Always get the current width from the segment
    this.width = this.el.getAttribute('street-segment')?.width || 0;

    if (!this.length) {
      return;
    }
    // Early return if data is not yet initialized
    if (!this.data) {
      return;
    }
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
      case 'fit':
        this.generateFit();
        break;
    }
  },

  generateFixed: function () {
    const data = this.data;
    const correctedSpacing = Math.max(1, data.spacing);
    const numClones = Math.floor(this.length / correctedSpacing);

    for (let i = 0; i < numClones; i++) {
      const positionZ =
        this.length / 2 - (i + data.cycleOffset) * correctedSpacing;
      this.createClone(positionZ);
    }
  },

  generateRandom: function () {
    const data = this.data;
    const positions = this.randPlacedElements(
      this.length,
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
      positionZ = this.length / 2 - data.padding;
    } else if (data.justify === 'end') {
      positionZ = -this.length / 2 + data.padding;
    }

    this.createClone(positionZ);
  },

  generateFit: function () {
    const data = this.data;
    const models = data.modelsArray;
    let cumulativeZ = this.length / 2;
    let modelIndex = 0;

    // measure of the building model along the street's z axis
    const buildingWidths = {
      SM3D_Bld_Mixed_4fl: 5.251,
      SM3D_Bld_Mixed_Double_5fl: 10.9041,
      SM3D_Bld_Mixed_4fl_2: 5.309,
      SM3D_Bld_Mixed_5fl: 5.903,
      SM3D_Bld_Mixed_Corner_4fl: 5.644,
      SM_Bld_House_Preset_03_1800: 20,
      SM_Bld_House_Preset_08_1809: 20,
      SM_Bld_House_Preset_09_1845: 20,
      'arched-building-01': 9.191,
      'arched-building-02': 11.19,
      'arched-building-03': 13.191,
      'arched-building-04': 15.191,
      seawall: 15
    };

    // These are approximate depths for how far buildings extend from their placement point
    // measure of the building model along the street's x axis
    const buildingDepths = {
      SM3D_Bld_Mixed_4fl: 6,
      SM3D_Bld_Mixed_Double_5fl: 6,
      SM3D_Bld_Mixed_4fl_2: 6,
      SM3D_Bld_Mixed_5fl: 6,
      SM3D_Bld_Mixed_Corner_4fl: 6,
      SM_Bld_House_Preset_03_1800: 20,
      SM_Bld_House_Preset_08_1809: 20,
      SM_Bld_House_Preset_09_1845: 20,
      'arched-building-01': 10,
      'arched-building-02': 10,
      'arched-building-03': 10,
      'arched-building-04': 10
    };

    // Use stored segment width to calculate justified X position
    const segmentWidth = this.width || 0;

    while (cumulativeZ > -this.length / 2) {
      const mixinId = models[modelIndex % models.length];
      const buildingWidth = buildingWidths[mixinId] || 10;
      const buildingDepth = buildingDepths[mixinId] || 0;

      if (cumulativeZ - buildingWidth < -this.length / 2) {
        break;
      }

      // Calculate X position based on justifyWidth
      let positionX = data.positionX;
      if (data.justifyWidth === 'left') {
        // Left justify: place building so its right edge aligns with left edge of segment
        positionX = data.positionX - segmentWidth / 2 + buildingDepth / 2;
      } else if (data.justifyWidth === 'right') {
        // Right justify: place building so its left edge aligns with right edge of segment
        positionX = data.positionX + segmentWidth / 2 - buildingDepth / 2;
      }
      // Center is default, uses data.positionX as is

      this.createClone(cumulativeZ - buildingWidth / 2, mixinId, positionX);

      cumulativeZ -= buildingWidth + data.spacing;
      modelIndex++;
    }
  },

  createClone: function (positionZ, mixinId, positionX) {
    const data = this.data;
    if (!mixinId) {
      mixinId = this.getModelMixin();
    }
    const clone = document.createElement('a-entity');

    clone.setAttribute('mixin', mixinId);
    clone.setAttribute('position', {
      x: positionX !== undefined ? positionX : data.positionX,
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
    if (!this.rng) return data.modelsArray[0]; // this is a hack but it works for now
    return data.modelsArray[Math.floor(this.rng() * data.modelsArray.length)];
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
