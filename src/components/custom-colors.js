/* global AFRAME */
import { getMaterials } from '../editor/components/components/CustomizeColorWidget';
const styleParser = AFRAME.utils.styleParser;

AFRAME.registerComponent('custom-colors', {
  schema: {
    type: 'string',
    parse: styleParser.parse,
    stringify: styleParser.stringify
  },
  update() {
    // Save the original color values if not done already
    if (this.origMaterialMap.size === 0) {
      this.el.object3D.traverse((node) => {
        if (node.material) {
          this.origMaterialMap.set(
            node.material.uuid,
            node.material.color.clone()
          );
        }
      });
    }

    const materials = getMaterials(this.el.object3D);
    console.log(this.el, materials);
    materials.forEach((material) => {
      if (this.data[material.name] !== undefined) {
        material.color.set(this.data[material.name]);
      } else {
        // Reset to default, no tint
        material.color.set(this.origMaterialMap.get(material.uuid));
      }
    });
  },
  updateMaterials() {
    this.update();
  },
  init() {
    this.origMaterialMap = new Map();
    this.updateMaterials = this.updateMaterials.bind(this);
    if (this.el.getObject3D('mesh')) {
      this.update();
    } else {
      this.el.addEventListener('model-loaded', this.updateMaterials);
    }
  },
  remove() {
    console.log('component removed');
    this.el.removeEventListener('model-loaded', this.updateMaterials);
    const materials = getMaterials(this.el.object3D);
    materials.forEach((material) => {
      // Reset to default, no tint
      material.color.set(this.origMaterialMap.get(material.uuid));
    });
  }
});
