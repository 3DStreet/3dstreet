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
      oneOf: ['drive-lane', 'bus-lane', 'mobility-lane', 'footpath']
    },
    width: {
      type: 'number'
    },
    length: {
      type: 'number'
    },
    direction: {
      type: 'string',
      default: 'outbound',
      oneOf: ['inbound', 'outbound']
    },
    surface: {
      type: 'string',
      default: 'asphalt',
      oneOf: ['asphalt', 'concrete', 'grass', 'dirt', 'gravel', 'sand']
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
    this.depth = 0.1;
    this.elevation = 0;
    //
  },
  update: function (oldData) {
    const data = this.data;
    // if oldDate is not the same as data, then update the entity
    if (oldData.type !== data.type) {
      // TODO: this needs to use deep equal, will not work like this
    }
    this.clearGeometry();
    this.generateGeometry(data);
  },
  generateGeometry(data) {
    // create box geometry and apply to this entity
    const geometry = new THREE.BoxGeometry(data.width, data.length, this.depth);
    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.5
    });
    const mesh = new THREE.Mesh(geometry, material);
    this.el.setObject3D('mesh', mesh);
  },
  clearGeometry() {
    // remove the geometry from the entity
    this.el.removeObject3D('mesh');
  }
});
