// Camera utility functions for snapshot feature

/**
 * Get the current camera state including position, rotation, and zoom
 * @returns {Object} Camera state object with position, rotation, and zoom
 */
export function getCurrentCameraState() {
  const camera = AFRAME.scenes[0].camera;
  if (!camera) {
    console.error('No camera found in scene');
    return null;
  }

  return {
    position: {
      x: camera.position.x,
      y: camera.position.y,
      z: camera.position.z
    },
    rotation: {
      x: camera.rotation.x,
      y: camera.rotation.y,
      z: camera.rotation.z
    },
    // For perspective camera, we'll store FOV as "zoom"
    zoom: camera.fov || 60,
    type: camera.type
  };
}

/**
 * Set camera to a specific state
 * @param {Object} cameraState - Camera state object with position, rotation, and zoom
 */
export function setCameraState(cameraState) {
  if (!cameraState) return;

  const camera = AFRAME.scenes[0].camera;
  if (!camera) {
    console.error('No camera found in scene');
    return;
  }

  // Set position
  if (cameraState.position) {
    camera.position.set(
      cameraState.position.x,
      cameraState.position.y,
      cameraState.position.z
    );
  }

  // Set rotation
  if (cameraState.rotation) {
    camera.rotation.set(
      cameraState.rotation.x,
      cameraState.rotation.y,
      cameraState.rotation.z
    );
  }

  // Set zoom/FOV if applicable
  if (cameraState.zoom && camera.fov !== undefined) {
    camera.fov = cameraState.zoom;
    camera.updateProjectionMatrix();
  }

  // Update camera
  camera.updateMatrixWorld();
}
