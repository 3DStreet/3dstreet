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
            "https://images.unsplash.com/photo-1544829728-e5cb9eedc20e?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxleHBsb3JlLWZlZWR8OHx8fGVufDB8fHx8&w=1000&q=80",
            //"https://upload.wikimedia.org/wikipedia/commons/thumb/a/a2/Goat_Peak%2C_Cascades.jpg/1920px-Goat_Peak%2C_Cascades.jpg",
            
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

// AFRAME.registerSystem('refraction-component', {
// schema: {
//     // the nearest distance of the FOV of the camera
//     near: {type: 'number', default: 1},
//     // the furthest distance of the FOV of the camera
//     far: {type: 'number', default: 200},
//     // the camera's resolution
//     resolution: {type: 'number', default: 256},
//     // how often should the registered entities be updated
//     tickrate: {type: 'number', default: 10}
// },
// init: function() {
//     console.log("refraction-component");
//     this.isPlaying = true                          
//     this.entities = [];                                          // Keep the supported entities in an array
//     this.refractionCamera = null                                 // reference to the cube camera providing the envMap
//     this.el.addEventListener("camera-set-active",                // each time the camera changes, the cube camera needs to change its position to the new camera
//                             (e)=> this.getCameraPosition())
// },
// getCameraPosition: function() {
//     this.camera = document.querySelector('[camera]')          
//     if(!this.camera) {
//         this.camera = document.querySelector('a-camera')
//     }
//     this.cameraPos = this.camera ? this.camera.getAttribute('position') : null
// },
// throttledTick: function(t, dt) {
//     if (!this.isPlaying) return                                                 // if the system is paused, don't update anything
//     if(!this.refractionCamera){return};                                         // no cube camera, return
//     if (this.cameraPos) {                                                       // need to follow the camera, but not rotate. adding as a child and updating rotation is way laggier than this. Tried SO: 29586422 but to no avail.
//     this.refractionCamera.position.set(this.cameraPos.x, this.cameraPos.y, this.cameraPos.z);
//     }
//     this.refractionCamera.update(this.el.renderer, this.el.sceneEl.object3D)   //update the camera
    
//     for (let i = 0; i < this.entities.length; i++){
//     this.updateTexture(this.entities[i])                                     // update entities
//     }
// },
// updateTexture(entity) {
//     let mesh = entity.getObject3D("mesh")
//     if (mesh) {
//         mesh.material.envMap = this.refractionCamera.renderTarget.texture     // use the cubemap's camera texture as an envMap
//     }
// },
// update: function(oldData) {
//     let data = this.data;
//     this.tick =  AFRAME.utils.throttleTick(this.throttledTick, data.tickrate, this)
//     this.addCubeCamera()
// },
// pause: function() {
//     this.isPlaying = false
// }, 
// play: function() {
//     this.isPlaying = true
// },
// addCubeCamera() {
//     let data = this.data
//     if (this.refractionCamera) delete this.refractionCamera
//     this.refractionCamera = new THREE.CubeCamera(data.near, data.far, data.resolution);  // create the camera which will be providing the cubemap
//     this.refractionCamera.renderTarget.texture.mapping = THREE.CubeRefractionMapping;    // multiple options here - https://threejs.org/docs/#api/constants/Textures
//     this.el.object3D.add(this.refractionCamera);                                         // add the camera to the scene
// },
// remove: function() {
//     if (this.refractionCamera) { 
//     delete this.refractionCamera
//     this.el.object3D.remove(this.refractionCamera);
//     }
// },
// registerMe: function(el) {
//     if (this.entities.length === 0) this.addCubeCamera() // if there is no cube camera - create it for our first entity !
//     this.entities.push(el);                              // add our new friend to the entities array
// },
// unregisterMe: function(el) {
//     var index = this.entities.indexOf(el);
//     this.entities.splice(index, 1);                      // remove the entity from the array
//     if (this.entities.length === 0) this.remove();       // if nobody needs us, why should we keep the scene busy
// }
// });

// AFRAME.registerComponent('refraction-component', {
// init: function() {
//     console.log("refraction-component");
//     this.system.registerMe(this.el);
// },
// remove: function() {
//     this.system.unregisterMe(this.el);
//     this.mesh.material.envMap = null;
// }
// });