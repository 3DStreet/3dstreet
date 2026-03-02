/* global AFRAME */
import { createRNG } from '../lib/rng';
import {
  loadMixinModel,
  createInstancedGroup,
  disposeInstancedGroup
} from '../lib/instanced-mesh-helper';

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
    this.cloneSpecs = [];
    this.instancedGroups = [];
    this.densityFactors = {
      empty: 0,
      sparse: 0.03,
      normal: 0.125,
      dense: 0.25
    };
    this.length = this.el.getAttribute('street-segment')?.length;
    this.el.addEventListener('segment-length-changed', (event) => {
      this.length = event.detail.newLength;
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
        'data-layer-name': 'Detached Pedestrian',
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
    const data = this.data;
    if (!this.length) {
      return;
    }
    // Early return if data is not yet initialized
    if (!this.data) {
      return;
    }

    // Handle seed initialization
    if (this.data.seed === 0) {
      const newSeed = Math.floor(Math.random() * 1000000) + 1;
      this.el.setAttribute(this.attrName, 'seed', newSeed);
      return;
    }

    // Create seeded RNG
    this.rng = createRNG(this.data.seed);

    // Clean up old instances
    this.remove();

    // Calculate x position range based on segment width
    const xRange = {
      min: -(0.37 * data.segmentWidth),
      max: 0.37 * data.segmentWidth
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

    // Collect pedestrian specs
    for (let i = 0; i < totalPedestrians; i++) {
      const position = {
        x: this.getRandomArbitrary(xRange.min, xRange.max),
        y: data.positionY,
        z: zPositions[i]
      };

      // Set model variant using seeded random
      const variantNumber = this.getRandomIntInclusive(1, 16);
      const mixinId = `char${variantNumber}`;

      // Set rotation based on direction and seeded random
      let rotationY = 0;
      if (data.direction === 'none') {
        if (this.rng() < 0.5) {
          rotationY = 180;
        }
      } else if (data.direction === 'outbound') {
        rotationY = 180;
      }

      this.cloneSpecs.push({
        mixinId: mixinId,
        position: position,
        rotation: { x: 0, y: rotationY, z: 0 }
      });
    }

    // Build instanced meshes from collected specs
    this.buildInstancedMeshes();
  },

  buildInstancedMeshes: function () {
    // When ?instancing=off is in the URL, fall back to individual entities
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('instancing') === 'off') {
      this.buildEntityClones();
      return;
    }

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
            `[street-generated-pedestrians] Failed to load model for ${mixinId}:`,
            err
          );
        });
    });

    Promise.all(promises).then(() => {
      this.el.emit('pedestrians-generated', {
        count: this.cloneSpecs.length
      });
    });
  },

  buildEntityClones: function () {
    this.cloneSpecs.forEach((spec) => {
      const entity = document.createElement('a-entity');
      entity.setAttribute('mixin', spec.mixinId);
      entity.setAttribute('position', spec.position);
      entity.setAttribute('rotation', spec.rotation);
      this.el.appendChild(entity);
      this.createdEntities.push(entity);
    });
    this.el.emit('pedestrians-generated', {
      count: this.cloneSpecs.length
    });
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
