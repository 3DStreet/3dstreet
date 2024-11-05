/* global AFRAME */

/*
Some next steps:
- convert streetmix parser to use street-segment instead of ground mixins defined in asset.js

<a-entity street-way="source: streetmix path">
    <a-entity street-segment="preset: drive-lane; width: 3; length: 150"></a-entity>
    <a-entity street-segment="preset: bus-lane; width: 6; length: 150"></a-entity>
</a-entity>
    */

AFRAME.registerComponent('street-segment', {
  schema: {
    preset: {
      type: 'string',
      default: 'drive-lane',
      oneOf: ['drive-lane', 'bus-lane', 'bike-lane', 'sidewalk', 'parking-lane']
    },
    width: {
      type: 'number'
    },
    length: {
      type: 'number'
    },
    elevation: {
      type: 'number',
      default: 0
    },
    direction: {
      type: 'string',
      default: 'outbound',
      oneOf: ['inbound', 'outbound']
    },
    surface: {
      type: 'string',
      default: 'asphalt',
      oneOf: ['asphalt', 'concrete', 'grass', 'sidewalk', 'gravel', 'sand']
    },
    color: {
      type: 'color'
    },
    spawn: {
      // objects to spawn, model clone
      type: 'array',
      default: ['transit', 'cars', 'trucks']
    },
    spawnDensity: {
      type: 'number' // x objects per segment
    }
  },
  init: function () {
    this.height = 0.2; // default height of segment surface box
    // parse preset into default surface, color
    this.applyPreset(this.data.preset);
  },
  applyPreset: function (preset) {
    // parse preset into
    // default surface, color
    const presets = {
      'drive-lane': {
        surface: 'asphalt'
      },
      'bus-lane': {
        surface: 'asphalt',
        color: '#ff9393'
      },
      'surface-red bus-lane': {
        // legacy output from processSegments
        surface: 'asphalt',
        color: '#ff9393'
      },
      'bike-lane': {
        surface: 'asphalt',
        color: '#adff83'
      },
      'surface-green bike-lane': {
        // legacy output from processSegments
        surface: 'asphalt',
        color: '#adff83'
      },
      sidewalk: {
        surface: 'sidewalk'
      },
      'parking-lane': {
        surface: 'concrete'
      },
      'bright-lane': {
        // legacy output for 'parking-lane' from processSegments
        surface: 'concrete'
      }
    };
    // if preset is not found, then use default preset
    if (!presets[preset]) {
      preset = 'drive-lane';
    }
    this.el.setAttribute('street-segment', 'surface', presets[preset].surface);
    if (presets[preset].color) {
      this.el.setAttribute('street-segment', 'color', presets[preset].color);
    } else {
      this.el.setAttribute('street-segment', 'color', '#ffffff');
    }
  },
  update: function (oldData) {
    const data = this.data;
    // if oldData is same as current data, then don't update
    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
    }
    // if oldData is defined AND the "preset" property has changed, then update
    if (oldData.preset !== undefined && oldData.preset !== data.preset) {
      this.applyPreset(data.preset);
      return;
    }
    this.clearMesh();
    this.calculateHeight(data.elevation);
    this.el.setAttribute(
      'position',
      'y',
      this.calculateYPosition(data.elevation)
    );
    this.generateMesh(data);
  },
  // for streetmix elevation number values of -1, 0, 1, 2, calculate heightLevel in three.js meters units
  calculateHeight: function (elevation) {
    const heightLevels = [0.2, 0.4, 0.6];
    if (elevation === -1) {
      this.height = 0;
      return;
    }
    this.height = heightLevels[elevation];
    return;
  },
  calculateYPosition: function (elevation) {
    let positionY;
    if (this.data.elevation === 0) {
      positionY = -0.1;
    } else if (elevation === 2) {
      positionY = 0.1;
    } else {
      positionY = 0;
    }
    return positionY;
  },
  clearMesh: function () {
    // remove the geometry from the entity
    this.el.removeAttribute('geometry');
    this.el.removeAttribute('material');
    // this.el.removeObject3D('mesh');
  },
  remove: function () {
    this.clearMesh();
  },
  generateMesh: function (data) {
    // create a lookup table for the material presets
    const textureMaps = {
      asphalt: 'seamless-road',
      concrete: 'seamless-bright-road',
      grass: 'grass-texture',
      sidewalk: 'seamless-sidewalk',
      gravel: 'compacted-gravel-texture',
      sand: 'sandy-asphalt-texture'
    };
    //    this.el.setAttribute('mixin', this.data.preset);

    // set the material based on the textureMap
    let textureSourceId = textureMaps[this.data.surface];
    console.log('textureSourceId', textureSourceId);

    this.el.setAttribute(
      'geometry',
      `primitive: box; 
        height: ${this.height}; 
        depth: ${this.data.length};
        width: ${this.data.width};`
    );

    this.el.setAttribute(
      'material',
      `src: #${textureMaps[this.data.surface]};
        roughness: 0.8;
        repeat: 0.3 25;
        offset: 0.55 0;
        color: ${this.data.color}`
    );

    // TODO: fix repeating values (depends on surface value chosen)
    // if (repeatCount.length !== 0) {
    //   segmentEl.setAttribute(
    //     'material',
    //     `repeat: ${repeatCount[0]} ${repeatCount[1]}`
    //   );
    // }
    return;
  }
});
