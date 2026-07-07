import { beforeAll, describe, expect, it } from 'vitest';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

let batch;
let THREE;

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  THREE = window.THREE;
  window.STREET = window.STREET || {};
  batch = await import('../../src/batch-models.js');
  window.AFRAME.emitReady?.();
});

// Same shape as batched-mesh-export.test.js: one BatchedMesh with 2 box instances
// and two member object3Ds carrying _batchSlots.
function makeBatchedScene() {
  const root = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  geometry.name = 'box-sub-mesh';
  const material = new THREE.MeshBasicMaterial();
  const batchedMesh = new THREE.BatchedMesh(2, 256, 512, material);
  batchedMesh._batchIdToEl = [];
  batchedMesh._freeInstanceIds = [];
  const geometryId = batchedMesh.addGeometry(geometry);
  root.add(batchedMesh);

  const members = [];
  for (let i = 0; i < 2; i++) {
    const memberRoot = new THREE.Object3D();
    memberRoot.position.set(i * 4, 0, 0);
    root.add(memberRoot);
    memberRoot.updateMatrixWorld(true);
    const localMatrix = new THREE.Matrix4().makeTranslation(0, 1 + i, 0);
    const instanceId = batchedMesh.addInstance(geometryId);
    batchedMesh.setMatrixAt(
      instanceId,
      new THREE.Matrix4().multiplyMatrices(memberRoot.matrixWorld, localMatrix)
    );
    memberRoot._batchSlots = [
      { batchedMesh, instanceId, localMatrix, geometry }
    ];
    members.push(memberRoot);
  }
  return { root, batchedMesh, members };
}

function exportGltf(root) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, { binary: false });
  });
}

// The AR-ready export hides rigged entities by setting object3D.visible = false
// (filterRiggedEntities in AppMenu.jsx) BEFORE the batch expansion runs. Members
// hidden that way must not get a recreated mesh, and must not appear in the export.
describe('expandBatchedMeshesForExport + hidden members', () => {
  it('does not recreate meshes for hidden member roots', () => {
    const { members } = makeBatchedScene();
    members[1].visible = false;

    const restore = batch.expandBatchedMeshesForExport(members[1].parent);
    expect(members[0].children.filter((c) => c.isMesh)).toHaveLength(1);
    expect(members[1].children.filter((c) => c.isMesh)).toHaveLength(0);
    restore();
    expect(members[0].children.filter((c) => c.isMesh)).toHaveLength(0);
  });

  it('exports only the visible member', async () => {
    const { root, members } = makeBatchedScene();
    members[1].visible = false;

    const restore = batch.expandBatchedMeshesForExport(root);
    const gltf = await exportGltf(root);
    restore();

    const meshNodes = (gltf.nodes || []).filter((n) => n.mesh !== undefined);
    expect(meshNodes).toHaveLength(1);
    expect(meshNodes[0].matrix?.[13]).toBe(1); // slot 0's local translation.y
  });
});
