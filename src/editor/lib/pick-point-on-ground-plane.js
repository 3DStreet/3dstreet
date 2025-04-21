const pickingPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(1000000, 1000000),
  new THREE.MeshBasicMaterial()
);
pickingPlane.rotation.x = -Math.PI / 2;
pickingPlane.updateMatrixWorld();
const pickingVector = new THREE.Vector3();
const pickingRaycaster = new THREE.Raycaster();

export default function pickPointOnGroundPlane(args) {
  // API
  const x = args.x;
  const y = args.y;
  let nX = args.normalizedX;
  let nY = args.normalizedY;
  const canvas = args.canvas;
  const camera = args.camera;

  // get normalized 2D coordinates
  if (nX === undefined || nY === undefined) {
    const viewport = canvas.getBoundingClientRect();
    nX = (2 * (x - viewport.left)) / viewport.width - 1;
    nY = -((2 * (y - viewport.top)) / viewport.height - 1);
  }

  if (camera.isOrthographicCamera) {
    console.log('is ortho');
    // For orthographic camera:
    // Start position should be on the near plane
    const start = new THREE.Vector3(
      (nX * (camera.right - camera.left)) / 2,
      0, // Y is now 0 since we're working with a ground plane
      (-nY * (camera.top - camera.bottom)) / 2 // Y coordinate becomes Z because of the rotation
    ).add(camera.position);

    // Direction is still the same - aligned with camera's view direction
    const direction = new THREE.Vector3(0, -1, 0) // Changed to point down toward ground plane
      .normalize();

    pickingRaycaster.set(start, direction);
  } else {
    // Original perspective camera code
    pickingRaycaster.set(
      camera.position,
      pickingVector
        .set(nX, nY, 1)
        .unproject(camera)
        .sub(camera.position)
        .normalize()
    );
  }

  // shoot ray
  const intersects = pickingRaycaster.intersectObject(pickingPlane);
  // in case of no result
  if (intersects.length === 0) {
    console.warn('Picking raycaster got 0 results.');
    return new THREE.Vector3();
  }

  return intersects[0].point;
}
