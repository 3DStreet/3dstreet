import { expandBatchedMeshesForExport } from '../../batch-models';

// The editor bundles its own copy of three (the npm `three` package) for GLTFExporter,
// while the scene graph is built by the super-three bundled inside the A-Frame script the
// app loads. three r184's GLTFExporter branches on `object.pivot !== null` into a pivot
// container path that immediately reads `pivot.x` — but objects created by a super-three
// build without the Object3D.pivot feature leave the property undefined, so EVERY node
// takes that branch and export dies on the first one with
// "TypeError: Cannot read properties of undefined (reading 'x')". Normalizing the missing
// property to null (what a pivot-aware Object3D constructor sets) keeps those nodes on the
// regular path. Harmless where super-three does have pivot: the value is already null.
function normalizePivots(root) {
  root.traverse((node) => {
    if (node.pivot === undefined) node.pivot = null;
  });
}

// Put `root` (a scene or a single entity's object3D) into an exportable state for
// GLTFExporter: expand BatchedMesh members back into ordinary meshes and paper over the
// super-three / npm-three Object3D.pivot mismatch. Returns an idempotent restore()
// that callers MUST invoke from both the exporter's onDone and onError callbacks.
export function prepareSceneForGltfExport(root) {
  const restore = expandBatchedMeshesForExport(root);
  // After expansion so the temporary meshes are normalized too.
  normalizePivots(root);
  return restore;
}
