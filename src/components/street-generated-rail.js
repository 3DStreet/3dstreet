/* global AFRAME */

AFRAME.registerComponent('street-generated-rail', {
  schema: {
    length: {
      // length in meters of linear path to fill with rail
      type: 'number'
    },
    gauge: {
      // spacing in millimeters between rails
      type: 'int',
      default: 1435, // standard gauge in mm
      oneOf: [1435, 1067]
    }
  },
  init: function () {
    this.createdEntities = [];
  },
  remove: function () {
    this.createdEntities.forEach((entity) => entity.remove());
    this.createdEntities.length = 0; // Clear the array
  },
  update: function (oldData) {
    // Clean up old entities
    this.createdEntities.forEach((entity) => entity.remove());
    this.createdEntities.length = 0; // Clear the array

    const clone = document.createElement('a-entity');
    clone.setAttribute('data-layer-name', 'Cloned Railroad Tracks');
    clone.setAttribute('position', '0 -0.2 0');
    const railsPosX = this.data.gauge / 2 / 1000;
    clone.append(this.createRailsElement(this.data.length, railsPosX));
    clone.append(this.createRailsElement(this.data.length, -railsPosX));
    clone.setAttribute('data-no-transform', '');
    clone.setAttribute('data-ignore-raycaster', '');

    this.el.appendChild(clone);
    this.createdEntities.push(clone);
  },
  createRailsElement: function (length, railsPosX) {
    const placedObjectEl = document.createElement('a-entity');
    const railsGeometry = {
      primitive: 'box',
      depth: length,
      width: 0.1,
      height: 0.2
    };
    const railsMaterial = {
      // TODO: Add environment map for reflection on metal rails
      color: '#8f8f8f',
      metalness: 1,
      emissive: '#828282',
      emissiveIntensity: 0.5,
      roughness: 0.1
    };
    placedObjectEl.setAttribute('geometry', railsGeometry);
    placedObjectEl.setAttribute('material', railsMaterial);
    placedObjectEl.setAttribute('data-layer-name', 'Rail');
    placedObjectEl.setAttribute('data-no-transform', '');
    placedObjectEl.setAttribute('data-ignore-raycaster', '');
    placedObjectEl.setAttribute('position', railsPosX + ' 0.2 0'); // position="1.043 0.100 -3.463"

    return placedObjectEl;
  }
});
