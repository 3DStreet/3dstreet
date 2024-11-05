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
      oneOf: ['drive-lane', 'bus-lane', 'bike-lane', 'sidewalk', 'parking']
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
      type: 'color',
      default: '#00ff00'
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
  },
  update: function (oldData) {
    const data = this.data;
    // if oldDate is same as current data, then don't update
    if (AFRAME.utils.deepEqual(oldData, data)) {
      return;
      // TODO: this needs to use deep equal, will not work like this
    }
    // this.clearGeometry();
    this.calculateHeight(data.elevation);
    this.el.setAttribute(
      'position',
      'y',
      this.calculateYPosition(data.elevation)
    );
    this.generateGeometry(data);
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
  clearGeometry: function () {
    // remove the geometry from the entity
    this.el.removeAttribute('geometry');
    this.el.removeAttribute('material');
    // this.el.removeObject3D('mesh');
  },
  remove: function () {
    this.clearGeometry();
  },
  generateGeometry: function (data) {
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
      `src: #${textureMaps[this.data.surface]}; roughness: 0.8; repeat: 0.3 25; offset: 0.55 0`
    );

    // if (repeatCount.length !== 0) {
    //   segmentEl.setAttribute(
    //     'material',
    //     `repeat: ${repeatCount[0]} ${repeatCount[1]}`
    //   );
    // }

    return;

    // // create box geometry and apply to this entity
    // const geometry = new THREE.BoxGeometry(data.width, data.length, this.depth);
    // const material = new THREE.MeshBasicMaterial({
    //   color: 0x00ff00,
    //   transparent: true,
    //   opacity: 0.5
    // });
    // const mesh = new THREE.Mesh(geometry, material);
    // this.el.setObject3D('mesh', mesh);
  }
});
