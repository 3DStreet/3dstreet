/* global AFRAME */

// a-frame component to generate cloned models along a street with random z position
// this moves logic from aframe-streetmix-parsers into this component
AFRAME.registerComponent('street-generated-random', {
  multiple: true,
  schema: {
    model: {
      type: 'string'
    },
    modelsArray: {
      type: 'array'
    },
    length: {
      // length in meters of linear path to fill with clones
      type: 'number'
    },
    count: {
      // number of clones to create with random z
      default: 1,
      type: 'number'
    },
    placeLength: {
      // length of the place for each model in meters
      default: 1,
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
    facing: {
      default: 0, // this is a Y Rotation value in degrees -- UI could offer a dropdown with options for 0, 90, 180, 270
      type: 'number'
    },
    randomFacing: {
      // if true, facing is ignored and a random Y Rotation is applied to each clone
      default: false,
      type: 'boolean'
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

    // Calculate number of places needed based on length and objLength
    const randPlaces = this.randPlacedElements(
      data.length,
      data.placeLength,
      data.count
    );

    // Create clones
    randPlaces.forEach((randPosZ) => {
      const clone = document.createElement('a-entity');
      clone.setAttribute('mixin', this.getRandomMixin());
      clone.setAttribute('position', {
        x: data.positionX,
        y: data.positionY,
        z: randPosZ
      });
      if (data.randomFacing) {
        clone.setAttribute('rotation', `0 ${Math.random() * 360} 0`);
      } else {
        clone.setAttribute('rotation', `0 ${data.facing} 0`);
      }
      clone.classList.add('autocreated');
      // clone.setAttribute('data-ignore-raycaster', ''); // i still like clicking to zoom to individual clones, but instead this should show the generated-fixed clone settings
      clone.setAttribute('data-no-transform', '');
      clone.setAttribute('data-layer-name', 'Cloned Model • ' + data.model);

      this.el.appendChild(clone);
      this.createdEntities.push(clone);
    });
  },
  getRandomMixin: function () {
    const data = this.data;
    if (data.modelsArray && data.modelsArray.length > 0) {
      return data.modelsArray[
        Math.floor(Math.random() * data.modelsArray.length)
      ];
    }
    return data.model;
  },
  randPlacedElements: function (streetLength, placeLength, count) {
    // Calculate start and end positions
    const start = -streetLength / 2 + placeLength / 2;
    const end = streetLength / 2 - placeLength / 2;

    // Calculate number of possible positions
    const len = Math.floor((end - start) / placeLength) + 1;

    // Generate array of evenly spaced positions
    const positions = Array(len)
      .fill()
      .map((_, idx) => start + idx * placeLength);

    // Randomly shuffle positions
    const shuffledPositions = positions.sort(() => 0.5 - Math.random());

    // Return only requested number of positions
    return shuffledPositions.slice(0, count);
  }
});
