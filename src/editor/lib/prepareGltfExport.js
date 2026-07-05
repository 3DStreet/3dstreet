import { expandBatchedMeshesForExport } from '../../batch-models';

// Put `root` (a scene or a single entity's object3D) into an exportable state for
// GLTFExporter: expand BatchedMesh members back into ordinary meshes. Returns an
// idempotent restore() that callers MUST invoke from both the exporter's onDone
// and onError callbacks.
export function prepareSceneForGltfExport(root) {
  return expandBatchedMeshesForExport(root);
}
