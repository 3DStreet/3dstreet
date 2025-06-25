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
      default: 5000,
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
    groundEntity.setAttribute('position', '0 -0.1 0');

    // Create simple grass material that respects depth
    const leavesMaterial = new THREE.MeshLambertMaterial({
      color: 0x6aa84f,
      side: THREE.DoubleSide,
      alphaTest: 0.3,
      depthWrite: true,
      depthTest: true
    });

    // Create instanced grass mesh
    const dummy = new THREE.Object3D();
    const geometry = new THREE.PlaneGeometry(0.1, 1, 1, 4);
    geometry.translate(0, 0.5, 0);

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
    this.stageEntity.appendChild(groundEntity);
    this.stageEntity.setObject3D('grass', instancedMesh);

    this.el.appendChild(this.stageEntity);
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
    this.stageEntity.setAttribute(
      'geometry',
      `primitive: box; width: ${size}; height: 0.2; depth: ${size}`
    );
    this.stageEntity.setAttribute(
      'material',
      `src: #${textureId}; roughness: 0.8; repeat: ${repeatX} ${repeatY}; color: #ffffff`
    );
    this.stageEntity.setAttribute('position', '0 -0.1 0');

    this.el.appendChild(this.stageEntity);
  },

  removeStage: function () {
    if (this.stageEntity) {
      this.el.removeChild(this.stageEntity);
      this.stageEntity = null;
    }
  },

  remove: function () {
    this.removeStage();
  }
});
