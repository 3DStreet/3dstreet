AFRAME.registerComponent('anisotropy', {
  schema: { default: 0 }, // default 0 will apply max anisotropy according to hardware
  dependencies: ['material', 'geometry'],
  init: function () {
    this.maxAnisotropy = this.el.sceneEl.renderer.capabilities.getMaxAnisotropy();
    // console.log('this.maxAnisotropy', this.maxAnisotropy);

    ['model-loaded', 'materialtextureloaded'].forEach(evt =>
      this.el.addEventListener(evt, () => {
        const mesh = this.el.getObject3D('mesh');
        // console.log('mesh', mesh);

        var anisotropyTargetValue = this.data;
        anisotropyTargetValue = +anisotropyTargetValue || 0; // https://stackoverflow.com/questions/7540397/convert-nan-to-0-in-javascript
        // console.log('anisotropyTargetValue', anisotropyTargetValue);

        if (anisotropyTargetValue === 0) {
          anisotropyTargetValue = this.maxAnisotropy;
          // console.log('anisotropyTargetValue', anisotropyTargetValue);
        }

        mesh.traverse((object) => {
          if (object.isMesh === true && object.material.map !== null) {
            // console.log('object', object);
            // console.log('object.material.map.anisotropy', object.material.map.anisotropy);
            object.material.map.anisotropy = anisotropyTargetValue;
            // console.log('object.material.map.anisotropy', object.material.map.anisotropy);
            object.material.map.needsUpdate = true;
          }
        });
      }, false)
    );
  }
});