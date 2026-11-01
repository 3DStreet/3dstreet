/* global AFRAME, THREE */

// Unlit surfaces that still show the sun's shadow (#2123).
//
// Photographic surfaces (a dropped image plane, later the 3D Tiles) already
// carry real-world lighting, so they draw unlit: lighting them again washes
// them out. But an unlit MeshBasicMaterial can never show a shadow: three.js
// only hands the shadow maps to lit material types. So this is a
// MeshLambertMaterial whose fragment shader skips all lighting and outputs
// the plain unlit colour, darkened where the mesh is in shadow. It matches
// `flat` exactly when the mesh does not receive shadows.
//
// The `shadow` component stays the one switch: `receive` sets the mesh's
// receiveShadow, which three.js passes as a per-object uniform, so toggling
// it never recompiles. Every material made here shares one program.

// How much a full shadow darkens the photo. The photo's own shadows are
// partly lit by sky light, so a black shadow would read as a hole.
export const UNLIT_SHADOW_STRENGTH = 0.75;

const PROGRAM_KEY = 'flat-shadow-v1';

// Each entry must match three's meshlambert fragment shader exactly; if a
// three.js upgrade changes it, patchShader throws instead of silently
// rendering a lit surface (covered by test/components/flat-shadow.test.js).
const REPLACEMENTS = [
  [
    '#include <shadowmap_pars_fragment>',
    '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>'
  ],
  ['#include <lights_lambert_fragment>', ''],
  ['#include <lights_fragment_begin>', ''],
  ['#include <lights_fragment_maps>', ''],
  ['#include <lights_fragment_end>', ''],
  ['#include <aomap_fragment>', ''],
  ['#include <envmap_fragment>', ''],
  [
    'vec3 outgoingLight = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse + totalEmissiveRadiance;',
    `vec3 outgoingLight = diffuseColor.rgb * mix( 1.0, getShadowMask(), ${UNLIT_SHADOW_STRENGTH.toFixed(3)} );`
  ]
];

export function patchShader(shader) {
  for (const [from, to] of REPLACEMENTS) {
    if (!shader.fragmentShader.includes(from)) {
      throw new Error(
        `flat-shadow: three.js shader changed, missing "${from}"`
      );
    }
    shader.fragmentShader = shader.fragmentShader.replace(from, to);
  }
}

/** A MeshLambertMaterial that renders unlit apart from received shadows. */
export function createFlatShadowMaterial(params) {
  const material = new THREE.MeshLambertMaterial(params);
  material.onBeforeCompile = patchShader;
  material.customProgramCacheKey = () => PROGRAM_KEY;
  return material;
}

/**
 * Swap every unlit (MeshBasicMaterial) mesh under `object` to flat-shadow and
 * make it receive shadows, e.g. a 3D Tiles tile as it loads. Base material
 * state (transparency, opacity, side, depth, vertex colours) carries over;
 * textures move to the new material, so whoever disposes the mesh's material
 * later still frees them. The old material is disposed here.
 */
export function receiveShadowsOnUnlit(object) {
  object.traverse((node) => {
    const old = node.isMesh && node.material;
    if (!old?.isMeshBasicMaterial) return;
    const material = createFlatShadowMaterial();
    THREE.Material.prototype.copy.call(material, old);
    material.color.copy(old.color);
    material.map = old.map;
    material.alphaMap = old.alphaMap;
    material.fog = old.fog;
    material.wireframe = old.wireframe;
    node.material = material;
    node.receiveShadow = true;
    old.dispose();
  });
}

// Same schema and update path as A-Frame's built-in `flat` shader, so
// `material="shader: flat-shadow"` is a drop-in for it.
AFRAME.registerShader('flat-shadow', {
  schema: {
    color: { type: 'color' },
    fog: { default: true },
    offset: { type: 'vec2', default: { x: 0, y: 0 } },
    repeat: { type: 'vec2', default: { x: 1, y: 1 } },
    src: { type: 'map' },
    wireframe: { default: false },
    wireframeLinewidth: { default: 2 },
    toneMapped: { default: true }
  },

  init: function (data) {
    this.materialData = { color: new THREE.Color() };
    getMaterialData(data, this.materialData);
    this.material = createFlatShadowMaterial(this.materialData);
  },

  update: function (data) {
    getMaterialData(data, this.materialData);
    for (const key in this.materialData) {
      this.material[key] = this.materialData[key];
    }
    AFRAME.utils.material.updateMap(this, data);
  }
});

function getMaterialData(data, materialData) {
  materialData.color.set(data.color);
  materialData.fog = data.fog;
  materialData.wireframe = data.wireframe;
  materialData.toneMapped = data.toneMapped;
  materialData.wireframeLinewidth = data.wireframeLinewidth;
  return materialData;
}
