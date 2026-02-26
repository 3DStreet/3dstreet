/* global AFRAME, STREET */
import { createRNG } from '../lib/rng';
import {
  loadMixinModel,
  createInstancedGroup,
  disposeInstancedGroup
} from '../lib/instanced-mesh-helper';

// Helper function to get base rotation from catalog
function getBaseRotationFromCatalog(mixinId) {
  // Find the model in the catalog
  const catalogEntry = STREET.catalog?.find((entry) => entry.id === mixinId);
  // Return baseRotation if found, otherwise default to 0
  return catalogEntry?.baseRotation || 0;
}

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
    this.cloneSpecs = [];
    this.instancedGroups = [];
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
    // Remove instanced groups from object3D and dispose
    this.instancedGroups.forEach((group) => {
      this.el.object3D.remove(group);
      disposeInstancedGroup(group);
    });
    this.instancedGroups.length = 0;
    this.cloneSpecs.length = 0;
    // Also remove any legacy entities (for backward compat during transition)
    this.createdEntities.forEach((entity) => entity.remove());
    this.createdEntities.length = 0;
  },

  detach: function () {
    const commands = [];
    commands.push([
      'componentremove',
      { entity: this.el, component: this.attrName }
    ]);
    this.cloneSpecs.forEach((spec) => {
      const entityObj = {
        parentEl: this.el,
        mixin: spec.mixinId,
        'data-layer-name': 'Detached Model • ' + spec.mixinId,
        components: {
          position: {
            x: spec.position.x,
            y: spec.position.y,
            z: spec.position.z
          },
          rotation: {
            x: spec.rotation.x,
            y: spec.rotation.y,
            z: spec.rotation.z
          }
        }
      };
      commands.push(['entitycreate', entityObj]);
    });
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

    // Clear existing instances
    this.remove();

    // Collect clone specs based on mode
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

    // Build instanced meshes from collected specs
    this.buildInstancedMeshes();
  },

  generateFixed: function () {
    const data = this.data;
    const correctedSpacing = Math.max(1, data.spacing);
    const numClones = Math.floor(this.length / correctedSpacing);

    for (let i = 0; i < numClones; i++) {
      const positionZ =
        this.length / 2 - (i + data.cycleOffset) * correctedSpacing;
      this.addCloneSpec(positionZ);
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
      this.addCloneSpec(positionZ);
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

    this.addCloneSpec(positionZ);
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
      seawall: 15,
      'sp-prop-mixeduse-2L-29ft': 8.84, // ~29ft converted to meters
      'sp-prop-mixeduse-2L-30ft': 9.14, // ~30ft converted to meters
      'sp-prop-mixeduse-3L-18ft': 5.49, // ~18ft converted to meters
      'sp-prop-mixeduse-3L-22ft': 6.71, // ~22ft converted to meters
      'sp-prop-mixeduse-3L-23ft-corner': 7.01, // ~23ft converted to meters
      'sp-prop-mixeduse-3L-42ft': 12.8, // ~42ft converted to meters
      'sp-prop-mixeduse-3L-78ft-corner': 23.77, // ~78ft converted to meters
      'sp-prop-sf-2L-64ft': 19.5,
      'sp-prop-sf-2L-62ft': 18.9,
      'sp-prop-sf-1L-62ft': 18.9,
      'sp-prop-sf-1L-41ft': 12.5,
      'sp-prop-townhouse-3L-20ft': 6.1,
      'sp-prop-townhouse-3L-23ft': 7.01,
      'sp-prop-bigbox-1L-220ft': 67, // ~220ft converted to meters
      'sp-prop-bigbox-1L-291ft': 88.7, // ~291ft converted to meters
      'sp-prop-parking-3L-155ft': 47.2, // ~155ft converted to meters
      'sp-prop-parking-3L-97ft-centered': 29.6, // ~97ft converted to meters
      'sp-prop-gov-3L-61ft': 18.6 // ~61ft converted to meters
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
      'arched-building-04': 10,
      'sp-prop-mixeduse-2L-29ft': 16, // Typical mixed-use depth
      'sp-prop-mixeduse-2L-30ft': 16,
      'sp-prop-mixeduse-3L-18ft': 8,
      'sp-prop-mixeduse-3L-22ft': 7.2,
      'sp-prop-mixeduse-3L-23ft-corner': 7.09, // Corner buildings slightly deeper
      'sp-prop-mixeduse-3L-42ft': 16.42,
      'sp-prop-mixeduse-3L-78ft-corner': 27.3, // Corner buildings slightly deeper
      'sp-prop-sf-2L-64ft': 15.22,
      'sp-prop-sf-2L-62ft': 18.36,
      'sp-prop-sf-1L-62ft': 24.27,
      'sp-prop-sf-1L-41ft': 10.15,
      'sp-prop-townhouse-3L-20ft': 10.22,
      'sp-prop-townhouse-3L-23ft': 10.22,
      'sp-prop-bigbox-1L-220ft': 44.79,
      'sp-prop-bigbox-1L-291ft': 79,
      'sp-prop-parking-3L-155ft': 43.14,
      'sp-prop-parking-3L-97ft-centered': 43.14,
      'sp-prop-gov-3L-61ft': 16.23
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

      this.addCloneSpec(cumulativeZ - buildingWidth / 2, mixinId, positionX);

      cumulativeZ -= buildingWidth + data.spacing;
      modelIndex++;
    }
  },

  addCloneSpec: function (positionZ, mixinId, positionX) {
    const data = this.data;
    if (!mixinId) {
      mixinId = this.getModelMixin();
    }

    // Get base rotation from catalog
    const baseRotation = getBaseRotationFromCatalog(mixinId);

    let rotationY = data.facing + baseRotation;
    if (data.direction === 'inbound') {
      rotationY = 0 + data.facing + baseRotation;
    }
    if (data.direction === 'outbound') {
      rotationY = 180 - data.facing + baseRotation;
    }
    if (data.randomFacing) {
      rotationY = this.rng() * 360 + baseRotation;
    }

    this.cloneSpecs.push({
      mixinId: mixinId,
      position: {
        x: positionX !== undefined ? positionX : data.positionX,
        y: data.positionY,
        z: positionZ
      },
      rotation: { x: 0, y: rotationY, z: 0 }
    });
  },

  buildInstancedMeshes: function () {
    // Group specs by mixinId
    const groups = {};
    this.cloneSpecs.forEach((spec) => {
      if (!groups[spec.mixinId]) {
        groups[spec.mixinId] = [];
      }
      groups[spec.mixinId].push(spec);
    });

    const mixinIds = Object.keys(groups);
    if (mixinIds.length === 0) return;

    // Load all unique models and create instanced meshes
    const promises = mixinIds.map((mixinId) => {
      return loadMixinModel(mixinId)
        .then(({ object3D, scale }) => {
          const instances = groups[mixinId];
          const group = createInstancedGroup(object3D, scale, instances);
          group.name = 'instanced-' + mixinId;
          this.el.object3D.add(group);
          this.instancedGroups.push(group);
        })
        .catch((err) => {
          console.error(
            `[street-generated-clones] Failed to load model for ${mixinId}:`,
            err
          );
        });
    });

    Promise.all(promises).then(() => {
      this.el.emit('clones-generated', { count: this.cloneSpecs.length });
    });
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
