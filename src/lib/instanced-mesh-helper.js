/* global AFRAME, THREE */

/**
 * Loads a model from an A-Frame mixin by creating a temporary entity,
 * waiting for the model to load, extracting the Object3D, then cleaning up.
 *
 * @param {string} mixinId - The mixin ID to load
 * @returns {Promise<{object3D: THREE.Object3D, scale: {x,y,z}}>} The loaded model and mixin scale
 */
export function loadMixinModel(mixinId) {
  return new Promise((resolve, reject) => {
    const scene = document.querySelector('a-scene');
    if (!scene) {
      reject(new Error('No a-scene found'));
      return;
    }

    const tempEntity = document.createElement('a-entity');
    tempEntity.setAttribute('visible', false);
    tempEntity.setAttribute('mixin', mixinId);

    const onModelLoaded = () => {
      // Get the mesh object3D set by gltf-model or gltf-part
      const mesh = tempEntity.getObject3D('mesh');
      if (!mesh) {
        cleanup();
        reject(new Error(`No mesh found for mixin: ${mixinId}`));
        return;
      }

      // Clone the mesh so we own it
      const clonedMesh = mesh.clone(true);

      // Get scale from the mixin (may be set by mixin attributes)
      const scale = tempEntity.object3D.scale.clone();

      cleanup();
      resolve({ object3D: clonedMesh, scale });
    };

    const cleanup = () => {
      tempEntity.removeEventListener('model-loaded', onModelLoaded);
      if (tempEntity.parentNode) {
        tempEntity.parentNode.removeChild(tempEntity);
      }
    };

    // Timeout after 30 seconds
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout loading model for mixin: ${mixinId}`));
    }, 30000);

    tempEntity.addEventListener('model-loaded', () => {
      clearTimeout(timeout);
      onModelLoaded();
    });

    scene.appendChild(tempEntity);
  });
}

/**
 * Creates a THREE.Group containing InstancedMesh(es) from a source Object3D.
 * Traverses the source to find all Mesh children, creating one InstancedMesh per unique mesh.
 *
 * @param {THREE.Object3D} sourceObject - The source model (from loadMixinModel)
 * @param {{x,y,z}} mixinScale - Scale from the mixin
 * @param {Array<{position: {x,y,z}, rotation: {x,y,z}}>} instances - Instance placements
 * @returns {THREE.Group} Group containing the InstancedMesh(es)
 */
export function createInstancedGroup(sourceObject, mixinScale, instances) {
  const group = new THREE.Group();
  const count = instances.length;

  if (count === 0) return group;

  // Collect all meshes from the source
  const meshes = [];
  sourceObject.traverse((child) => {
    if (child.isMesh) {
      meshes.push(child);
    }
  });

  if (meshes.length === 0) return group;

  // For each mesh in the source model, create an InstancedMesh
  meshes.forEach((sourceMesh) => {
    const instancedMesh = new THREE.InstancedMesh(
      sourceMesh.geometry,
      sourceMesh.material,
      count
    );
    instancedMesh.castShadow = true;
    instancedMesh.receiveShadow = false;

    // Compute the local transform of this mesh relative to the source root
    // This handles multi-mesh models where sub-meshes have their own transforms
    const meshLocalMatrix = new THREE.Matrix4();
    if (sourceMesh.parent && sourceMesh.parent !== sourceObject) {
      // Get the full transform chain from sourceObject down to this mesh
      sourceMesh.updateWorldMatrix(true, false);
      sourceObject.updateWorldMatrix(true, false);
      meshLocalMatrix.copy(sourceObject.matrixWorld).invert();
      meshLocalMatrix.multiply(sourceMesh.matrixWorld);
    } else {
      meshLocalMatrix.compose(
        sourceMesh.position,
        sourceMesh.quaternion,
        sourceMesh.scale
      );
    }

    const tempMatrix = new THREE.Matrix4();
    const instancePosition = new THREE.Vector3();
    const instanceQuaternion = new THREE.Quaternion();
    const instanceScale = new THREE.Vector3();
    const euler = new THREE.Euler();
    const scaleVec = new THREE.Vector3(mixinScale.x, mixinScale.y, mixinScale.z);

    for (let i = 0; i < count; i++) {
      const inst = instances[i];

      instancePosition.set(inst.position.x, inst.position.y, inst.position.z);
      euler.set(
        THREE.MathUtils.degToRad(inst.rotation.x),
        THREE.MathUtils.degToRad(inst.rotation.y),
        THREE.MathUtils.degToRad(inst.rotation.z)
      );
      instanceQuaternion.setFromEuler(euler);
      instanceScale.copy(scaleVec);

      // Build the instance transform: position * rotation * scale * meshLocalMatrix
      tempMatrix.compose(instancePosition, instanceQuaternion, instanceScale);
      tempMatrix.multiply(meshLocalMatrix);

      instancedMesh.setMatrixAt(i, tempMatrix);
    }

    instancedMesh.instanceMatrix.needsUpdate = true;
    group.add(instancedMesh);
  });

  return group;
}

/**
 * Disposes all InstancedMesh resources in a group.
 *
 * @param {THREE.Group} group - The instanced group to dispose
 */
export function disposeInstancedGroup(group) {
  if (!group) return;
  group.traverse((child) => {
    if (child.isInstancedMesh) {
      child.dispose();
      // Don't dispose geometry/material since they may be shared with the source model
    }
  });
}
