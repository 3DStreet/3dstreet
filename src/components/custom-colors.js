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
      const materialMap = new Map();
      this.el.object3D.traverse((node) => {
        if (node.material) {
          // Duplicate the materials to avoid sharing references across entities
          if (!materialMap.has(node.material.uuid)) {
            materialMap.set(node.material.uuid, node.material.clone());
          }
          node.material = materialMap.get(node.material.uuid);

          this.origMaterialMap.set(
            node.material.uuid,
            node.material.color.clone()
          );
        }
      });
    }

    const materials = getMaterials(this.el.object3D);
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
  resetAndUpdateMaterials() {
    this.origMaterialMap.clear();
    this.updateMaterials();
  },
  init() {
    this.origMaterialMap = new Map();
    this.resetAndUpdateMaterials = this.resetAndUpdateMaterials.bind(this);

    // Models that are components of larger models trigger this event instead of model-loaded.
    // This also will fire when the selected model is changed.
    this.el.addEventListener('object3dset', this.resetAndUpdateMaterials);

    if (this.el.getObject3D('mesh')) {
      this.update();
    } else {
      this.updateMaterials = this.updateMaterials.bind(this);
      this.el.addEventListener('model-loaded', this.updateMaterials, {
        once: true
      });
    }
  },
  remove() {
    this.el.removeEventListener('object3dset', this.resetAndUpdateMaterials);
    const materials = getMaterials(this.el.object3D);
    materials.forEach((material) => {
      // Reset to default, no tint
      material.color.set(this.origMaterialMap.get(material.uuid));
    });
  }
});
