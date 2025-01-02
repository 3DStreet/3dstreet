/* global AFRAME */

import { getMaterials } from '../editor/components/components/CustomizeColorWidget';

AFRAME.registerComponent('custom-colors', {
  schema: {
    type: 'string'
  },
  update() {
    const materials = getMaterials(this.el.object3D);
    const customColorMapping = {};
    this.data
      .replaceAll(' ', '')
      .split(';')
      .forEach((entry) => {
        // Skip unnamed
        if (entry === '') return;
        const [mat, color] = entry.split(':');
        customColorMapping[mat] = color;
      });

    materials.forEach((material) => {
      if (customColorMapping[material.name] !== undefined) {
        material.color.set(customColorMapping[material.name]);
      } else {
        // Reset to default, no tint
        material.color.set(material.userData.origColor);
      }
    });
  },
  init() {
    if (this.el.getObject3D('mesh')) {
      this.update();
    } else {
      this.el.addEventListener('model-loaded', () => {
        this.update();
      });
    }
  },
  remove() {
    const materials = getMaterials(this.el.object3D);
    materials.forEach((material) => {
      // Reset to default, no tint
      material.color.set(material.userData.origColor);
    });
  }
});
