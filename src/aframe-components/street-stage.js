AFRAME.registerComponent('street-stage', {
  schema: {
    preset: {
      type: 'string',
      default: 'grass',
      oneOf: ['grass', 'asphalt', 'concrete', 'sidewalk', 'gravel', 'sand']
    },
    size: {
      type: 'number',
      default: 50
    },
    density: {
      type: 'number',
      default: 25000,
      if: { preset: ['grass'] }
    },
    grassWidth: {
      type: 'number',
      default: 0.1,
      if: { preset: ['grass'] }
    },
    grassHeight: {
      type: 'number',
      default: 1.0,
      if: { preset: ['grass'] }
    }
  },

  init: function () {
    this.stageEntity = null;
    this.setupStage();
  },

  update: function (oldData) {
    if (
      oldData.preset !== this.data.preset ||
      oldData.size !== this.data.size ||
      oldData.density !== this.data.density
    ) {
      this.removeStage();
      this.setupStage();
    }
  },

  setupStage: function () {
    const data = this.data;

    // Surface to texture mapping from street-segment.js
    const textureMaps = {
      asphalt: 'seamless-road',
      concrete: 'seamless-bright-road',
      grass: 'grass-texture',
      sidewalk: 'seamless-sidewalk',
      gravel: 'compacted-gravel-texture',
      sand: 'sandy-asphalt-texture'
    };

    switch (data.preset) {
      case 'grass':
        this.createGrassStage();
        break;
      default:
        this.createSurfaceStage(textureMaps[data.preset]);
        break;
    }
  },

  createGrassStage: function () {
    const size = this.data.size;
    const density = this.data.density;
    const grassWidth = this.data.grassWidth;
    const grassHeight = this.data.grassHeight;

    // Create ground box with grass texture
    const groundEntity = document.createElement('a-entity');
    groundEntity.setAttribute(
      'geometry',
      `primitive: box; width: ${size}; height: 0.2; depth: ${size}`
    );
    groundEntity.setAttribute(
      'material',
      `src: #grass-texture; roughness: 0.8; repeat: ${size / 4} ${size / 6}; color: #ffffff`
    );
    groundEntity.setAttribute('shadow', 'receive: true');
    groundEntity.setAttribute('position', '0 -0.1 0');

    // Create animated grass shader with wind effects
    const simpleNoise = `
      float N (vec2 st) {
          return fract( sin( dot( st.xy, vec2(12.9898,78.233 ) ) ) *  43758.5453123);
      }
      
      float smoothNoise( vec2 ip ){
          vec2 lv = fract( ip );
        vec2 id = floor( ip );
        
        lv = lv * lv * ( 3. - 2. * lv );
        
        float bl = N( id );
        float br = N( id + vec2( 1, 0 ));
        float b = mix( bl, br, lv.x );
        
        float tl = N( id + vec2( 0, 1 ));
        float tr = N( id + vec2( 1, 1 ));
        float t = mix( tl, tr, lv.x );
        
        return mix( b, t, lv.y );
      }
    `;

    const uniforms = {
      time: {
        value: 0
      },
      grassHeight: {
        value: grassHeight
      }
    };

    // Use MeshLambertMaterial with custom vertex shader for wind animation
    const leavesMaterial = new THREE.MeshLambertMaterial({
      color: 0x6aa84f,
      side: THREE.DoubleSide,
      alphaTest: 0.3,
      depthWrite: true,
      depthTest: true
    });

    // Override the vertex shader to add wind animation
    leavesMaterial.onBeforeCompile = function (shader) {
      shader.uniforms.time = uniforms.time;
      shader.uniforms.grassHeight = uniforms.grassHeight;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float time;
        uniform float grassHeight;
        
        ${simpleNoise}`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        
        // Get the world position of this instance
        vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        
        float t = time * 2.;
        // Use instance position to create unique noise per blade
        vec2 noiseCoord = instancePosition.xz * 0.1 + transformed.xz * 0.5 + vec2(0., t);
        float noise = smoothNoise(noiseCoord);
        noise = pow(noise * 0.5 + 0.5, 2.) * 2.;
        
        float dispPower = 1. - cos( uv.y * 3.1416 * 0.5 );
        float displacement = noise * ( 0.3 * dispPower * grassHeight );
        transformed.z -= displacement;`
      );
    };

    // Create instanced grass mesh
    const dummy = new THREE.Object3D();
    const geometry = new THREE.PlaneGeometry(grassWidth, grassHeight, 1, 4);
    geometry.translate(0, grassHeight / 2, 0);

    const instancedMesh = new THREE.InstancedMesh(
      geometry,
      leavesMaterial,
      density
    );

    // Position grass blades randomly
    for (let i = 0; i < density; i++) {
      dummy.position.set(
        (Math.random() - 0.5) * size,
        0,
        (Math.random() - 0.5) * size
      );

      dummy.scale.setScalar(0.5 + Math.random() * 0.5);
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.updateMatrix();
      instancedMesh.setMatrixAt(i, dummy.matrix);
    }

    // Create stage entity
    this.stageEntity = document.createElement('a-entity');
    this.stageEntity.setAttribute('data-layer-name', 'Grass');
    this.stageEntity.setAttribute('class', 'autocreated');

    // Create grass surface sub-entity
    groundEntity.setAttribute('data-layer-name', 'Grass Surface');
    groundEntity.setAttribute('class', 'autocreated');

    this.stageEntity.appendChild(groundEntity);
    this.stageEntity.setObject3D('grass', instancedMesh);

    // Store references for animation
    this.uniforms = uniforms;
    this.clock = new THREE.Clock();

    this.el.appendChild(this.stageEntity);

    // Start animation loop
    this.animateGrass();
  },

  createSurfaceStage: function (textureId) {
    const size = this.data.size;

    // Calculate texture repeat based on surface type (from street-segment.js)
    let repeatX, repeatY;
    const preset = this.data.preset;

    if (preset === 'asphalt') {
      repeatX = size * 0.3;
      repeatY = size / 6;
    } else if (preset === 'concrete') {
      repeatX = size * 0.6;
      repeatY = 15;
    } else if (preset === 'sidewalk') {
      repeatX = size / 2;
      repeatY = size / 2;
    } else if (preset === 'gravel' || preset === 'sand') {
      repeatX = size / 4;
      repeatY = size / 4;
    } else {
      repeatX = size / 4;
      repeatY = size / 4;
    }

    // Create ground box with appropriate surface texture
    this.stageEntity = document.createElement('a-entity');
    this.stageEntity.setAttribute('data-layer-name', 'Stage');
    this.stageEntity.setAttribute('class', 'autocreated');
    this.stageEntity.setAttribute(
      'geometry',
      `primitive: box; width: ${size}; height: 0.2; depth: ${size}`
    );
    this.stageEntity.setAttribute(
      'material',
      `src: #${textureId}; roughness: 0.8; repeat: ${repeatX} ${repeatY}; color: #ffffff`
    );
    this.stageEntity.setAttribute('shadow', 'receive: true');
    this.stageEntity.setAttribute('position', '0 -0.1 0');

    this.el.appendChild(this.stageEntity);
  },

  animateGrass: function () {
    if (this.uniforms && this.clock) {
      this.uniforms.time.value = this.clock.getElapsedTime();
      requestAnimationFrame(() => this.animateGrass());
    }
  },

  removeStage: function () {
    if (this.stageEntity) {
      this.el.removeChild(this.stageEntity);
      this.stageEntity = null;
    }

    // Stop grass animation
    this.uniforms = null;
    this.clock = null;
  },

  remove: function () {
    this.removeStage();
  }
});
