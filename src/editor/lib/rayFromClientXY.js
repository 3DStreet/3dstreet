/* global AFRAME, THREE */

// Cursor client coordinates → a world-space picking ray through the inspector
// camera. This is the prefix every cursor-driven pick in the editor repeats:
// canvas rect → NDC → Raycaster.setFromCamera. What each caller does with the
// ray afterwards (intersect the scene, intersect a plane) is its own business,
// so only the prefix lives here.
//
// The camera is read fresh on every call rather than cached: the orthographic
// toggle swaps AFRAME.INSPECTOR.camera by object reference, so a cached
// reference silently goes stale (and keeps returning rays for the camera the
// user is no longer looking through).
//
// Returns null when the scene, canvas or camera is not available yet. The Ray
// it returns is shared scratch, valid only until the next call — copy it if it
// has to outlive the current handler.

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

export function rayFromClientXY(clientX, clientY) {
  const canvas = AFRAME.scenes[0]?.canvas;
  const camera = AFRAME.INSPECTOR?.camera;
  if (!canvas || !camera) return null;
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    (2 * (clientX - rect.left)) / rect.width - 1,
    -((2 * (clientY - rect.top)) / rect.height - 1)
  );
  raycaster.setFromCamera(ndc, camera);
  return raycaster.ray;
}
