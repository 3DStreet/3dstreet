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
    console.log('bro');
    this.geometry.translate(0, -data.height / 2, 0);
  }
});

AFRAME.registerComponent('street-segment', {
  schema: {
    type: {
      type: 'string',
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
  },
  update: function (oldData) {
    const data = this.data;
    // if oldData is same as current data, then don't update
    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
    }
    this.clearMesh();
    this.calculateHeight(data.elevation);
    this.tempXPosition = this.el.getAttribute('position').x;
    this.el.setAttribute('position', { x: this.tempXPosition, y: this.height });
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

    this.el.setAttribute('shadow', '');

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
