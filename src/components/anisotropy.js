
AFRAME.registerComponent('af', {
  dependencies: ['material', 'geometry'],
  init: function () {
    this.el.addEventListener('materialtextureloaded', () => {
      this.el.getObject3D('mesh').material.map.anisotropy = 4;
      this.el.getObject3D('mesh').material.map.needsUpdate = true;
      // console.log("anisotropy applied");
    });
  }
});

// work in progress, updated anisotropy component
// TODO: test; document; map.anisotropy = renderer.capabilities.getMaxAnisotropy();
AFRAME.registerComponent('anisotropy', {
  schema: { default: 16 },
  dependencies: ['material', 'geometry'],
  init: function () {
    console.log(this.el.sceneEl.renderer.capabilities.getMaxAnisotropy());

    this.el.addEventListener('materialtextureloaded', () => {
      // this should instead take the data value from the component instead of `4`
      this.el.getObject3D('mesh').material.map.anisotropy = 4;
      this.el.getObject3D('mesh').material.map.needsUpdate = true;
      // console.log("anisotropy applied");
    });
  }
});
