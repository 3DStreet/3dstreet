/* global AFRAME */

/*
<a-entity street-way="source: xyz">
    <a-entity street-segment="type: drive-lane; surface: asphalt; color: white; width: 3; length: 150"></a-entity>
    <a-entity street-segment="type: bus-lane; surface: asphalt; color: red; width: 3; length: 150"></a-entity>
    <a-entity street-segment="type: bike-lane; surface: asphalt; color: green; width: 2; length: 150"></a-entity>
    <a-entity street-segment="type: sidewalk; surface: concrete; color: white; width: 6; length: 150"></a-entity>
</a-entity>
*/

AFRAME.registerGeometry('below-box', {
  schema: {
    depth: { default: 1, min: 0 },
    height: { default: 1, min: 0 },
    width: { default: 1, min: 0 },
    segmentsHeight: { default: 1, min: 1, max: 20, type: 'int' },
    segmentsWidth: { default: 1, min: 1, max: 20, type: 'int' },
    segmentsDepth: { default: 1, min: 1, max: 20, type: 'int' }
  },

  init: function (data) {
    this.geometry = new THREE.BoxGeometry(
      data.width,
      data.height,
      data.depth,
      data.segmentsWidth,
      data.segmentsHeight,
      data.segmentsDepth
    );
    this.geometry.translate(0, -data.height / 2, 0);
  }
});

AFRAME.registerComponent('street-segment', {
  schema: {
    type: {
      type: 'string', // value not used by component, used in React app instead
      oneOf: [
        'drive-lane',
        'bus-lane',
        'bike-lane',
        'sidewalk',
        'parking-lane',
        'divider',
        'grass',
        'rail'
      ]
    },
    width: {
      type: 'number'
    },
    length: {
      type: 'number'
    },
    level: {
      type: 'int',
      default: 0
    },
    direction: {
      type: 'string',
      oneOf: ['none', 'inbound', 'outbound']
    },
    surface: {
      type: 'string',
      default: 'asphalt',
      oneOf: [
        'asphalt',
        'concrete',
        'grass',
        'sidewalk',
        'gravel',
        'sand',
        'none',
        'solid'
      ]
    },
    color: {
      type: 'color'
    }
  },
  init: function () {
    this.height = 0.2; // default height of segment surface box
    this.generatedComponents = [];
    this.types = window.STREET.types; // default segment types
  },
  createGeneratedComponentsFromType: function (typeObject) {
    // use global preset data to create the generated components for a given segment type
    const componentsToGenerate = typeObject.generated;

    // for each of clones, stencils, rail, pedestrians, etc.
    if (componentsToGenerate?.clones?.length > 0) {
      componentsToGenerate.clones.forEach((clone, index) => {
        if (clone?.modelsArray?.length > 0) {
          this.el.setAttribute(
            `street-generated-clones__${index}`,
            `mode: ${clone.mode}; modelsArray: ${clone.modelsArray}; length: ${this.data.length}; spacing: ${clone.spacing}; direction: ${this.data.direction}; count: ${clone.count};`
          );
        } else {
          this.el.setAttribute(
            `street-generated-clones__${index}`,
            `mode: ${clone.mode}; model: ${clone.model}; length: ${this.data.length}; spacing: ${clone.spacing}; direction: ${this.data.direction}; count: ${clone.count};`
          );
        }
      });
    }
    if (componentsToGenerate?.stencil?.length > 0) {
      componentsToGenerate.stencil.forEach((clone, index) => {
        if (clone?.stencils?.length > 0) {
          this.el.setAttribute(
            `street-generated-stencil__${index}`,
            `stencils: ${clone.stencils}; length: ${this.data.length}; spacing: ${clone.spacing}; facing: 0; padding: ${clone.padding};`
          );
        } else {
          this.el.setAttribute(
            `street-generated-stencil__${index}`,
            `model: ${clone.model}; length: ${this.data.length}; spacing: ${clone.spacing}; facing: 0; count: ${clone.count};`
          );
        }
      });
    }
    if (componentsToGenerate?.pedestrians?.length > 0) {
      componentsToGenerate.pedestrians.forEach((pedestrian, index) => {
        this.el.setAttribute(
          `street-generated-pedestrians__${index}`,
          `segmentWidth: ${this.data.width}; density: ${pedestrian.density}; length: ${this.data.length}; direction: ${this.data.direction};`
        );
      });
    }
  },
  updateSurfaceFromType: function (typeObject) {
    // update color, surface, level from segment type preset
    this.el.setAttribute(
      'street-segment',
      `surface: ${typeObject.surface}; color: ${typeObject.color}; level: ${typeObject.level};`
    ); // to do: this should be more elegant to check for undefined and set default values
  },
  updateGeneratedComponentsList: function () {
    // get all components on entity with prefix 'street-generated'
    let generatedComponentList = [];
    const components = this.el.components;
    for (const componentName in components) {
      if (componentName.startsWith('street-generated')) {
        generatedComponentList.push(componentName);
      }
    }
    this.generatedComponents = generatedComponentList;
  },
  update: function (oldData) {
    const data = this.data;
    const dataDiff = AFRAME.utils.diff(oldData, data);
    // if oldData is same as current data, then don't update
    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
    }
    // regenerate components if only type has changed
    if (
      Object.keys(dataDiff).length === 1 &&
      Object.keys(dataDiff).includes('type')
    ) {
      let typeObject = this.types[this.data.type];
      this.updateGeneratedComponentsList(); // if components were created through streetmix or streetplan import
      this.remove();
      this.createGeneratedComponentsFromType(typeObject); // add components for this type
      this.updateSurfaceFromType(typeObject); // update surface color, surface, level
    }
    this.clearMesh();
    this.height = this.calculateHeight(data.level);
    this.tempXPosition = this.el.getAttribute('position').x;
    this.el.setAttribute('position', { x: this.tempXPosition, y: this.height });
    this.generateMesh(data);
  },
  // for streetmix elevation number values of -1, 0, 1, 2, calculate heightLevel in three.js meters units
  calculateHeight: function (elevationLevel) {
    const stepLevel = 0.15;
    if (elevationLevel <= 0) {
      return stepLevel;
    }
    return stepLevel * (elevationLevel + 1);
  },
  clearMesh: function () {
    // remove the geometry from the entity
    this.el.removeAttribute('geometry');
    this.el.removeAttribute('material');
  },
  remove: function () {
    this.clearMesh();

    this.generatedComponents.forEach((componentName) => {
      this.el.removeAttribute(componentName);
    });
  },
  generateMesh: function (data) {
    // create geometry
    this.el.setAttribute(
      'geometry',
      `primitive: below-box; 
          height: ${this.height}; 
          depth: ${data.length};
          width: ${data.width};`
    );

    // create a lookup table to convert UI shortname into A-Frame img id's
    const textureMaps = {
      asphalt: 'seamless-road',
      concrete: 'seamless-bright-road',
      grass: 'grass-texture',
      sidewalk: 'seamless-sidewalk',
      gravel: 'compacted-gravel-texture',
      sand: 'sandy-asphalt-texture',
      hatched: 'hatched-base',
      none: 'none',
      solid: ''
    };
    let textureSourceId = textureMaps[data.surface];

    // calculate the repeatCount for the material
    let [repeatX, repeatY, offsetX] = this.calculateTextureRepeat(
      data.length,
      data.width,
      textureSourceId
    );

    this.el.setAttribute(
      'material',
      `src: #${textureMaps[data.surface]};
        roughness: 0.8;
        repeat: ${repeatX} ${repeatY};
        offset: ${offsetX} 0;
        color: ${data.color}`
    );

    this.el.setAttribute('shadow', '');

    this.el.setAttribute(
      'material',
      'visible',
      textureMaps[data.surface] !== 'none'
    );

    return;
  },
  calculateTextureRepeat: function (length, width, textureSourceId) {
    // calculate the repeatCount for the material
    let repeatX = 0.3; // drive-lane, bus-lane, bike-lane
    let repeatY = length / 6;
    let offsetX = 0.55; // we could get rid of this using cropped texture for asphalt
    if (textureSourceId === 'seamless-bright-road') {
      repeatX = 0.6;
      repeatY = 15;
    } else if (textureSourceId === 'seamless-sandy-road') {
      repeatX = width / 30;
      repeatY = length / 30;
      offsetX = 0;
    } else if (textureSourceId === 'seamless-sidewalk') {
      repeatX = width / 2;
      repeatY = length / 2;
      offsetX = 0;
    } else if (textureSourceId === 'grass-texture') {
      repeatX = width / 4;
      repeatY = length / 6;
      offsetX = 0;
    } else if (textureSourceId === 'hatched-base') {
      repeatX = 1;
      repeatY = length / 4;
      offsetX = 0;
    }
    return [repeatX, repeatY, offsetX];
  }
});
