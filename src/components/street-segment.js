/* global AFRAME */

/*
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
      type: 'int',
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
        surface: 'asphalt'
      },
      'bike-lane': {
        surface: 'asphalt'
      },
      sidewalk: {
        surface: 'sidewalk'
      },
      'parking-lane': {
        surface: 'concrete'
      },
      divider: {
        surface: 'hatched'
      },
      grass: {
        surface: 'grass'
      }
    };
    // if preset is not found, then use default preset
    if (!presets[preset]) {
      preset = 'drive-lane';
    }
    this.el.setAttribute('street-segment', 'surface', presets[preset].surface);
  },
  update: function (oldData) {
    const data = this.data;
    // if oldData is same as current data, then don't update
    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
    }
    // if oldData is defined AND the "preset" property has changed, then update
    if (oldData.preset !== undefined && oldData.preset !== data.preset) {
      this.applyPreset(data.preset, true);
      return;
    }
    this.clearMesh();
    this.calculateHeight(data.elevation);
    this.el.object3D.position.y = this.calculateYPosition(data.elevation); // Direct Object3D manipulation
    this.generateMesh(data);
  },
  // for streetmix elevation number values of -1, 0, 1, 2, calculate heightLevel in three.js meters units
  calculateHeight: function (elevation) {
    const heightLevels = [0.2, 0.4, 0.6];
    if (elevation === -1) {
      this.height = 0.2;
      return;
    }
    this.height = heightLevels[elevation];
    return;
  },
  calculateYPosition: function (elevation) {
    let positionY;
    if (elevation === 0) {
      positionY = -0.1;
    } else if (elevation === 2) {
      positionY = 0.1;
    } else if (elevation === 1) {
      positionY = 0;
    } else if (elevation === -1) {
      positionY = -0.2;
    }
    return positionY;
  },
  clearMesh: function () {
    // remove the geometry from the entity
    this.el.removeAttribute('geometry');
    this.el.removeAttribute('material');
  },
  remove: function () {
    this.clearMesh();
  },
  generateMesh: function (data) {
    // create geometry
    this.el.setAttribute(
      'geometry',
      `primitive: box; 
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
      hatched: 'hatched-base'
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

    this.el.setAttribute('shadow', 'cast: false');

    return;
  },
  calculateTextureRepeat: function (length, width, textureSourceId) {
    // calculate the repeatCount for the material
    let repeatX = 0.3; // drive-lane, bus-lane, bike-lane
    let repeatY = length / 6;
    let offsetX = 0.55;
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
    // still need to support hatched-base
    // how to handle different surface materials from streetmix
    return [repeatX, repeatY, offsetX];
  }
});
