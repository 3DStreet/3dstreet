/* global AFRAME, THREE */
import { MeshSurfaceSampler } from 'three/examples/jsm/math/MeshSurfaceSampler';
import { createRNG } from '../lib/rng';

// Maximum number of blades regardless of area/density — a quality cap so large
// slabs or high density don't tank mobile / integrated GPUs.
const MAX_BLADES = 25000;

// Shared GLSL value-noise helper used by the wind vertex shader.
const SIMPLE_NOISE = `
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

/**
 * street-generated-grass
 *
 * An instanced, wind-animated field of grass blades scattered over the surface
 * of a host A-Frame geometry primitive (box, circle, cylinder, plane, sphere,
 * etc.). It follows the canonical street-generated-* managed children pattern
 * (see street-generated-clones.js): the blades live on an `autocreated` child
 * entity that the serializer skips, so only this component's config
 * (`{ density, grassHeight, ... }`) is saved and the field is regenerated
 * deterministically on load — never 25k entities.
 *
 * A box is the common case — a lawn slab / median — so it is special-cased to
 * grow grass on its top face only (straight up), otherwise the box reads as a
 * fur-covered block (see #1768). Every other primitive uses Three's
 * MeshSurfaceSampler over the host's real mesh, so blades cover it uniformly and
 * each blade aligns its local +Y to the sampled surface normal (radial on a
 * cylinder, fur on a sphere). It rebuilds when the host geometry changes, so
 * editing the primitive or its dimensions in the first-class geometry controls
 * keeps the lawn matched.
 *
 * See docs/host-generator-pattern.md for the host + generator pattern.
 */
AFRAME.registerComponent('street-generated-grass', {
  schema: {
    // Blades per square meter of host area; the actual count is area-scaled and
    // capped at MAX_BLADES. min: 0 keeps all numeric inputs non-negative.
    density: { default: 10, type: 'number', min: 0 },
    grassHeight: { default: 1.0, type: 'number', min: 0 },
    grassWidth: { default: 0.1, type: 'number', min: 0 },
    color: { default: '#6aa84f', type: 'color' },
    // Random seed for blade layout. 0 means "pick one and persist it" so the
    // layout is stable across reloads even though blades regenerate from config.
    seed: { default: 0, type: 'int', min: 0 }
  },

  init: function () {
    this.createdEntities = [];
    this.instancedMesh = null;
    this.uniforms = null;
    // Rebuild when the host box geometry changes (e.g. the user edits
    // width/depth/height in the first-class geometry controls).
    this.onComponentChanged = (e) => {
      if (e.detail.name === 'geometry') {
        this.update();
      }
    };
    this.el.addEventListener('componentchanged', this.onComponentChanged);
  },

  update: function (oldData) {
    // Seed handling mirrors street-generated-clones: if unseeded, pick a stable
    // seed and persist it (setAttribute re-triggers update), so the layout is
    // identical across reloads.
    if (this.data.seed === 0) {
      const newSeed = Math.floor(Math.random() * 1000000) + 1;
      this.el.setAttribute(this.attrName, 'seed', newSeed);
      return;
    }

    // Cheap path: only the color changed → recolor in place instead of rebuilding
    // the whole instanced mesh. oldData is undefined when we call update()
    // manually (geometry change), which correctly forces a full rebuild.
    if (
      this.instancedMesh &&
      oldData &&
      oldData.color !== this.data.color &&
      oldData.density === this.data.density &&
      oldData.grassHeight === this.data.grassHeight &&
      oldData.grassWidth === this.data.grassWidth &&
      oldData.seed === this.data.seed
    ) {
      this.instancedMesh.material.color.set(this.data.color);
      return;
    }

    this.clearEntities();
    this.generateGrass();
  },

  generateGrass: function () {
    const data = this.data;

    // Seeded layout so reloads regenerate identical placement from config. The
    // sampler (non-box path) consumes this rng too (setRandomGenerator), so the
    // whole scatter is deterministic per seed.
    const rng = createRNG(data.seed);

    // A box is grown on its top face only (a lawn slab, not a fur-covered block,
    // see #1768); every other primitive scatters over its whole surface via
    // MeshSurfaceSampler. below-box is a box whose top face is translated to the
    // local origin, so it gets the same top-only treatment with topY = 0.
    const geometry = this.el.getAttribute('geometry') || {};
    const isBox =
      geometry.primitive === 'box' || geometry.primitive === 'below-box';

    let sampler = null;
    let area;
    let width;
    let depth;
    let topY;
    if (isBox) {
      width = geometry.width || 40;
      depth = geometry.depth || 40;
      // Regular box is centered (top at +height/2); below-box has its top at the
      // local origin.
      topY =
        geometry.primitive === 'below-box' ? 0 : (geometry.height || 0) / 2;
      area = width * depth;
    } else {
      // getObject3D('mesh') is the THREE.Mesh the A-Frame geometry component
      // builds; it may not exist yet on an early call, in which case the
      // componentchanged listener rebuilds once the geometry is ready.
      const hostMesh = this.el.getObject3D('mesh');
      if (!hostMesh || !hostMesh.geometry) return;
      sampler = new MeshSurfaceSampler(hostMesh)
        .setRandomGenerator(rng)
        .build();
      // The sampler's cumulative-area distribution ends at the mesh's total
      // surface area, so density (blades per m²) stays meaningful per primitive.
      const distribution = sampler.distribution;
      area = distribution[distribution.length - 1] || 0;
    }

    const count = Math.max(
      1,
      Math.min(MAX_BLADES, Math.round(data.density * area))
    );

    const uniforms = {
      time: { value: 0 },
      grassHeight: { value: data.grassHeight }
    };

    const leavesMaterial = new THREE.MeshLambertMaterial({
      color: new THREE.Color(data.color),
      side: THREE.DoubleSide
    });

    // Inject a wind animation into the vertex shader. Blades sway more toward the
    // tip (uv.y) and each blade gets a unique phase from its instance position.
    leavesMaterial.onBeforeCompile = function (shader) {
      shader.uniforms.time = uniforms.time;
      shader.uniforms.grassHeight = uniforms.grassHeight;

      shader.vertexShader = shader.vertexShader.replace(
        '#include <common>',
        `#include <common>
        uniform float time;
        uniform float grassHeight;

        ${SIMPLE_NOISE}`
      );

      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>

        vec4 instancePosition = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);

        float t = time * 2.;
        vec2 noiseCoord = instancePosition.xz * 0.1 + transformed.xz * 0.5 + vec2(0., t);
        float noise = smoothNoise(noiseCoord);
        noise = pow(noise * 0.5 + 0.5, 2.) * 2.;

        float dispPower = 1. - cos( uv.y * 3.1416 * 0.5 );
        float displacement = noise * ( 0.3 * dispPower * grassHeight );
        transformed.z -= displacement;`
      );
    };

    const geometryBlade = new THREE.PlaneGeometry(
      data.grassWidth,
      data.grassHeight,
      1,
      4
    );
    geometryBlade.translate(0, data.grassHeight / 2, 0);

    const instancedMesh = new THREE.InstancedMesh(
      geometryBlade,
      leavesMaterial,
      count
    );

    const dummy = new THREE.Object3D();
    if (isBox) {
      // Blades stand straight up, scattered across the top face only.
      for (let i = 0; i < count; i++) {
        dummy.position.set((rng() - 0.5) * width, topY, (rng() - 0.5) * depth);
        dummy.scale.setScalar(0.5 + rng() * 0.5);
        dummy.rotation.y = rng() * Math.PI;
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
      }
    } else {
      const samplePos = new THREE.Vector3();
      const sampleNormal = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < count; i++) {
        sampler.sample(samplePos, sampleNormal);
        dummy.position.copy(samplePos);
        // Align blade local +Y to the surface normal so blades stand off the
        // surface (radial on a cylinder, fur on a sphere), then add a random
        // spin about that normal so they don't all face the same way.
        dummy.quaternion.setFromUnitVectors(up, sampleNormal);
        dummy.rotateY(rng() * Math.PI * 2);
        dummy.scale.setScalar(0.5 + rng() * 0.5);
        dummy.updateMatrix();
        instancedMesh.setMatrixAt(i, dummy.matrix);
      }
    }
    instancedMesh.instanceMatrix.needsUpdate = true;
    // InstancedMesh defaults to a unit bounding sphere; recompute it so frustum
    // culling uses the real grass-field extent and doesn't cull the whole field.
    instancedMesh.computeBoundingSphere();

    // Wrap the mesh in an autocreated child entity so the SceneGraph shows it as
    // managed and the serializer skips it (regenerated rather than saved).
    const grassEntity = document.createElement('a-entity');
    grassEntity.classList.add('autocreated');
    grassEntity.setAttribute('data-no-transform', '');
    // The grass is not independently selectable: clicks fall through to the host
    // primitive (the box), whose sidebar carries the grass settings. Mirrors
    // street-generated-rail / street-ground.
    grassEntity.setAttribute('data-ignore-raycaster', '');
    grassEntity.setAttribute('data-layer-name', 'Animated Grass');
    grassEntity.setAttribute('data-parent-component', this.attrName);
    grassEntity.setObject3D('grass', instancedMesh);

    this.el.appendChild(grassEntity);
    this.createdEntities.push(grassEntity);
    this.instancedMesh = instancedMesh;
    this.uniforms = uniforms;
  },

  // Drive the wind from A-Frame's tick (not window.requestAnimationFrame) so the
  // animation pauses with the scene, drives correctly under WebXR, and never runs
  // multiple competing loops.
  tick: function (time) {
    if (this.uniforms) {
      this.uniforms.time.value = time / 1000;
    }
  },

  clearEntities: function () {
    // Dispose GPU resources before detaching so repeated add/remove doesn't leak.
    if (this.instancedMesh) {
      this.instancedMesh.geometry.dispose();
      this.instancedMesh.material.dispose();
      this.instancedMesh = null;
    }
    this.uniforms = null;
    this.createdEntities.forEach((entity) => {
      if (entity.parentNode) entity.remove();
    });
    this.createdEntities.length = 0;
  },

  // "Detach" from the autocreated-child sidebar simply stops managing the field
  // by removing this component (the instanced mesh is procedural and has no
  // independent serializable form, unlike cloned model entities).
  detach: function () {
    AFRAME.INSPECTOR.execute('componentremove', {
      entity: this.el,
      component: this.attrName
    });
  },

  remove: function () {
    this.el.removeEventListener('componentchanged', this.onComponentChanged);
    this.clearEntities();
  }
});
