// Camera utility functions for snapshot feature
import * as THREE from 'three';

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

  // World-space pose: during drive/WebXR the render camera is nested
  // inside #cameraRig and its local transform is near-identity (the rig
  // carries the real vantage). The editor camera is scene-parented, so
  // world == local there and this changes nothing for edit/view.
  camera.updateMatrixWorld();
  const position = new THREE.Vector3();
  camera.getWorldPosition(position);
  const rotation = new THREE.Euler().setFromRotationMatrix(
    camera.matrixWorld,
    camera.rotation.order
  );

  return {
    position: {
      x: position.x,
      y: position.y,
      z: position.z
    },
    rotation: {
      x: rotation.x,
      y: rotation.y,
      z: rotation.z
    },
    // For perspective camera, we'll store FOV as "zoom"
    zoom: camera.fov || 60,
    type: camera.type
  };
}

/**
 * Serialize a camera state into a compact URL-hash param value
 * (`px,py,pz,rx,ry,rz,fov`) for camera vantage deep links like
 * `#/scenes/UUID?camera=…`. Decoded by decodeCameraStateFromParam in
 * set-loader-from-hash. Rounded — cm position / ~0.006° rotation — to keep
 * the URL short; well beyond visual precision either way.
 * @param {Object} cameraState - Camera state with position, rotation, zoom
 * @returns {string|null} Param value, or null if the state is unusable
 */
export function encodeCameraStateToParam(cameraState) {
  const { position, rotation } = cameraState || {};
  const values = [
    position?.x,
    position?.y,
    position?.z,
    rotation?.x,
    rotation?.y,
    rotation?.z,
    cameraState?.zoom ?? 60
  ];
  if (!values.every(Number.isFinite)) return null;
  return values.map((v, i) => Number(v.toFixed(i < 3 ? 2 : 4))).join(',');
}

/**
 * Parse a `camera` hash-param value back into a camera state object.
 * @param {string} param - Value produced by encodeCameraStateToParam
 * @returns {Object|null} Camera state, or null if malformed
 */
export function decodeCameraStateFromParam(param) {
  if (typeof param !== 'string') return null;
  const values = param.split(',').map(Number);
  if (values.length !== 7 || !values.every(Number.isFinite)) return null;
  const [px, py, pz, rx, ry, rz, fov] = values;
  return {
    position: { x: px, y: py, z: pz },
    rotation: { x: rx, y: ry, z: rz },
    zoom: fov,
    type: 'PerspectiveCamera'
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
