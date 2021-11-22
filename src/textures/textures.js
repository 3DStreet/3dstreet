if (typeof AFRAME === 'undefined') {
    throw new Error('Component attempted to register before AFRAME was available.');
}

AFRAME.registerComponent("glassreflection", {
    init: function() {
      console.log("glassreflection");
      var targetCube = new THREE.WebGLRenderTargetCube(512, 512);
      var renderer = this.el.sceneEl.renderer;

      this.el.addEventListener("model-loaded", e => {
        let mesh = this.el.getObject3D("mesh");
        
        var texture = new THREE.TextureLoader().load(
            //resource URl
            "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Goat_Peak%2C_Cascades.jpg/1920px-Goat_Peak%2C_Cascades.jpg",
            
            //onload callback
            function() {
                var cubeTex = targetCube.fromEquirectangularTexture(renderer, texture);
                mesh.traverse(function(el) {
                    console.log(el);
                    if (el.material) {
                        el.material.envMap = cubeTex.texture;
                        el.material.envMap.intensity = 3;
                        el.material.needsUpdate = true;
                    }
                });
                renderer.toneMapping = THREE.ACESFilmicToneMapping;
                renderer.outputEncoding = THREE.sRGBEncoding;
            },

            //onProgress callback currently not supported
	        undefined,
            
            //onError callback
            function ( err ) {
                console.error('An error was thrown in glassreflection.');
            }
        );
    });
    }
});