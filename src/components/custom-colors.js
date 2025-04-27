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
    // If the mesh has not been traversed, duplicate the materials so that we can avoid
    // accidental shared references, i.e. changing one material changes materials across multiple entities
    if (!this.hasOrigColor) {
      const materialMap = new Map();
      this.el.object3D.traverse((node) => {
        if (node.material) {
          if (!materialMap.has(node.material.uuid)) {
            materialMap.set(node.material.uuid, node.material.clone());
          }
          node.material = materialMap.get(node.material.uuid);
        }
      });
    }

    const materials = getMaterials(this.el.object3D);
    materials.forEach((material) => {
      if (!material.userData.origColor) {
        material.userData.origColor = material.color.clone();
        this.hasOrigColor = true;
      }
      if (this.data[material.name] !== undefined) {
        material.color.set(this.data[material.name]);
      } else {
        // Reset to original
        material.color.set(material.userData.origColor);
      }
    });
  },
  updateMaterials() {
    this.update();
  },
  resetAndUpdateMaterials() {
    this.hasOrigColor = false;
    this.updateMaterials();
  },
  init() {
    this.hasOrigColor = false;
    this.resetAndUpdateMaterials = this.resetAndUpdateMaterials.bind(this);

    // Models that are components of larger models trigger this event instead of model-loaded.
    // This also will fire when the selected model is changed.
    this.el.addEventListener('object3dset', this.resetAndUpdateMaterials);
    if (this.el.getObject3D('mesh')) {
      this.update();
    }
  },
  remove() {
    this.el.removeEventListener('object3dset', this.resetAndUpdateMaterials);
    const materials = getMaterials(this.el.object3D);
    materials.forEach((material) => {
      // Reset to original
      material.color.set(material.userData.origColor);
    });
  }
});
