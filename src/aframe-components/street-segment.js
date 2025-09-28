/* global AFRAME */

/*
<a-entity street-way="source: xyz">
    <a-entity street-segment="type: drive-lane; surface: asphalt; color: white; width: 3; length: 150"></a-entity>
    <a-entity street-segment="type: bus-lane; surface: asphalt; color: red; width: 3; length: 150"></a-entity>
    <a-entity street-segment="type: bike-lane; surface: asphalt; color: green; width: 2; length: 150"></a-entity>
    <a-entity street-segment="type: sidewalk; surface: concrete; color: white; width: 6; length: 150"></a-entity>
</a-entity>
*/

const COLORS = {
  red: '#ff9393',
  blue: '#00b6b6',
  green: '#adff83',
  yellow: '#f7d117',
  lightGray: '#dddddd',
  white: '#ffffff',
  brown: '#664B00'
};
STREET.colors = COLORS;

const TYPES = {
  'drive-lane': {
    type: 'drive-lane',
    color: COLORS.white,
    surface: 'asphalt',
    level: 0,
    generated: {
      clones: [
        {
          mode: 'random',
          modelsArray:
            'sedan-rig, box-truck-rig, self-driving-waymo-car, suv-rig, motorbike',
          spacing: 7.3,
          count: 4
        }
      ]
    }
  },
  'bus-lane': {
    type: 'bus-lane',
    surface: 'asphalt',
    color: COLORS.red,
    level: 0,
    generated: {
      clones: [
        {
          mode: 'random',
          modelsArray: 'bus',
          spacing: 15,
          count: 1
        }
      ],
      stencil: [
        {
          modelsArray: 'word-only, word-taxi, word-bus',
          spacing: 40,
          padding: 10
        }
      ]
    }
  },
  'bike-lane': {
    type: 'bike-lane',
    color: COLORS.green,
    surface: 'asphalt',
    level: 0,
    generated: {
      stencil: [
        {
          modelsArray: 'bike-arrow',
          cycleOffset: 0.3,
          spacing: 20
        }
      ],
      clones: [
        {
          mode: 'random',
          modelsArray:
            'cyclist-cargo, cyclist1, cyclist2, cyclist3, cyclist-dutch, cyclist-kid, ElectricScooter_1',
          spacing: 2.03,
          count: 4
        }
      ]
    }
  },
  sidewalk: {
    type: 'sidewalk',
    surface: 'sidewalk',
    color: COLORS.white,
    level: 1,
    direction: 'none',
    generated: {
      pedestrians: [
        {
          density: 'normal'
        }
      ]
    }
  },
  'parking-lane': {
    surface: 'concrete',
    color: COLORS.lightGray,
    level: 0,
    generated: {
      clones: [
        {
          mode: 'random',
          modelsArray: 'sedan-rig, self-driving-waymo-car, suv-rig',
          spacing: 6,
          count: 6
        }
      ],
      stencil: [
        {
          modelsArray: 'parking-t',
          cycleOffset: 1,
          spacing: 6
        }
      ]
    }
  },
  divider: {
    surface: 'hatched',
    color: COLORS.white,
    level: 0
  },
  grass: {
    surface: 'grass',
    color: COLORS.white,
    level: -1
  },
  rail: {
    surface: 'asphalt',
    color: COLORS.white,
    level: 0,
    generated: {
      clones: [
        {
          mode: 'random',
          modelsArray: 'tram',
          spacing: 15,
          count: 2
        }
      ],
      rail: [
        {
          gauge: 1435
        }
      ]
    }
  },
  building: {
    type: 'building',
    surface: 'concrete',
    color: COLORS.white,
    level: 0,
    generated: {
      clones: [
        {
          mode: 'fit',
          modelsArray:
            'SM3D_Bld_Mixed_4fl, SM3D_Bld_Mixed_Corner_4fl, SM3D_Bld_Mixed_5fl',
          spacing: 0
        }
      ]
    }
  }
};
STREET.types = TYPES;

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
        'rail',
        'building'
      ]
    },
    width: {
      type: 'number',
      min: 0
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
        'cracked-asphalt',
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
    this.types = TYPES; // default segment types
  },
  generateComponentsFromSegmentObject: function (segmentObject) {
    // use global preset data to create the generated components for a given segment type
    const componentsToGenerate = segmentObject.generated;

    // for each of clones, stencils, rail, pedestrians, etc.
    if (componentsToGenerate?.clones?.length > 0) {
      componentsToGenerate.clones.forEach((clone, index) => {
        this.el.setAttribute(`street-generated-clones__${index + 1}`, {
          mode: clone.mode,
          modelsArray: clone.modelsArray,
          length: this.data.length,
          spacing: clone.spacing,
          direction: this.data.direction,
          count: clone.count
        });
      });
    }

    if (componentsToGenerate?.stencil?.length > 0) {
      componentsToGenerate.stencil.forEach((clone, index) => {
        this.el.setAttribute(`street-generated-stencil__${index + 1}`, {
          modelsArray: clone.modelsArray,
          length: this.data.length,
          spacing: clone.spacing,
          direction: clone.direction ?? this.data.direction,
          padding: clone.padding,
          cycleOffset: clone.cycleOffset
        });
      });
    }

    if (componentsToGenerate?.pedestrians?.length > 0) {
      componentsToGenerate.pedestrians.forEach((pedestrian, index) => {
        this.el.setAttribute(`street-generated-pedestrians__${index + 1}`, {
          segmentWidth: this.data.width,
          density: pedestrian.density,
          length: this.data.length,
          direction: this.data.direction
        });
      });
    }

    if (componentsToGenerate?.striping?.length > 0) {
      componentsToGenerate.striping.forEach((stripe, index) => {
        this.el.setAttribute(`street-generated-striping__${index + 1}`, {
          striping: stripe.striping,
          segmentWidth: this.data.width,
          length: this.data.length,
          positionY: stripe.positionY ?? 0.05, // Default to 0.05 if not specified
          side: stripe.side ?? 'left', // Default to left if not specified
          facing: stripe.facing ?? 0 // Default to 0 if not specified
        });
      });
    }

    if (componentsToGenerate?.rail?.length > 0) {
      componentsToGenerate.rail.forEach((rail, index) => {
        this.el.setAttribute(`street-generated-rail__${index + 1}`, {
          gauge: rail.gauge,
          length: this.data.length
        });
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
    const changedProps = Object.keys(dataDiff);

    // regenerate components if only type has changed
    if (changedProps.length === 1 && changedProps.includes('type')) {
      let typeObject = this.types[this.data.type];
      this.updateGeneratedComponentsList(); // if components were created through streetmix or streetplan import
      this.remove();
      this.generateComponentsFromSegmentObject(typeObject); // add components for this type
      this.updateSurfaceFromType(typeObject); // update surface color, surface, level
    }
    // propagate change of direction to generated components is solo changed
    if (changedProps.includes('direction')) {
      this.updateGeneratedComponentsList(); // if components were created through streetmix or streetplan import
      for (const componentName of this.generatedComponents) {
        this.el.setAttribute(componentName, 'direction', this.data.direction);
      }
    }
    // propagate change of length to generated components is solo changed
    if (changedProps.includes('length')) {
      this.updateGeneratedComponentsList(); // if components were created through streetmix or streetplan import
      for (const componentName of this.generatedComponents) {
        this.el.setAttribute(componentName, 'length', this.data.length);
      }
    }
    this.clearMesh();
    this.height = this.calculateHeight(data.level);
    this.tempXPosition = this.el.getAttribute('position').x;
    this.tempZPosition = this.el.getAttribute('position').z;
    this.el.setAttribute('position', {
      x: this.tempXPosition,
      y: this.height,
      z: this.tempZPosition
    });
    this.generateMesh(data);
    // if width was changed, trigger re-justification of all street-segments by the managed-street
    if (changedProps.includes('width')) {
      this.el.emit('segment-width-changed', {
        oldWidth: oldData.width,
        newWidth: data.width
      });
    }
    // if length was changed, trigger re-justification of all street-segments by the managed-street
    if (changedProps.includes('length')) {
      this.el.emit('segment-length-changed', {
        oldLength: oldData.length,
        newLength: data.length
      });
    }
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
    this.generatedComponents.length = 0;
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
      'cracked-asphalt': 'asphalt-texture',
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
      repeatX = width / 8;
      repeatY = length / 8;
      offsetX = 0;
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
    } else if (textureSourceId === 'asphalt-texture') {
      repeatX = width / 8;
      repeatY = length / 8;
      offsetX = 0;
    } else if (textureSourceId === 'hatched-base') {
      repeatX = 1;
      repeatY = length / 4;
      offsetX = 0;
    }
    return [repeatX, repeatY, offsetX];
  }
});

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
