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

  // setup raycaster
  pickingRaycaster.set(
    camera.position,
    pickingVector
      .set(nX, nY, 1)
      .unproject(camera)
      .sub(camera.position)
      .normalize()
  );

  // shoot ray
  const intersects = pickingRaycaster.intersectObject(pickingPlane);
  // in case of no result
  if (intersects.length === 0) {
    console.warn('Picking raycaster got 0 results.');
    return new THREE.Vector3();
  }

  return intersects[0].point;
}
