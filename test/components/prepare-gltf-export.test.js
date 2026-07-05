import { beforeAll, describe, expect, it } from 'vitest';
// The editor's exporter copy: the npm `three` package, NOT window.THREE (A-Frame's bundled
// super-three). Importing it here mirrors production, where the two copies coexist and the
// exporter from one serializes objects built by the other.
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter';

// batch-models references the global THREE that A-Frame's build installs on window. Import
// A-Frame first so those globals exist, then the modules under test. These run in a real
// Chromium (browser mode) because THREE.BatchedMesh allocates data textures and behaves
// like production only in a real browser.
let batch;
let prepareSceneForGltfExport;
let THREE;

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  THREE = window.THREE;
  window.STREET = window.STREET || {};
  batch = await import('../../src/batch-models.js');
  ({ prepareSceneForGltfExport } =
    await import('../../src/editor/lib/prepareGltfExport.js'));
  window.AFRAME.emitReady?.();
});

// A root holding one BatchedMesh (2 box instances) and two member object3Ds carrying the
// _batchSlots batch-models leaves on batched entities — the state a batched scene is in
// when the user hits export.
function makeBatchedScene() {
  const root = new THREE.Scene();
  const geometry = new THREE.BoxGeometry();
  geometry.name = 'box-sub-mesh';
  const material = new THREE.MeshBasicMaterial();
  const batchedMesh = new THREE.BatchedMesh(2, 256, 512, material);
  batchedMesh.userData.batchIdToEl = [];
  batchedMesh.userData.freeInstanceIds = [];
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
    memberRoot.userData._batchSlots = [
      { batchedMesh, instanceId, localMatrix, geometry }
    ];
    members.push(memberRoot);
  }
  return { root, batchedMesh, members, geometry, material };
}

// Strip the Object3D.pivot property from every node, simulating a scene built by a
// super-three build that predates the pivot feature — the production state that made
// three r184's GLTFExporter crash with "Cannot read properties of undefined (reading 'x')".
function stripPivots(root) {
  root.traverse((node) => delete node.pivot);
}

function exportGltf(root) {
  return new Promise((resolve, reject) => {
    new GLTFExporter().parse(root, resolve, reject, { binary: false });
  });
}

describe('expandBatchedMeshesForExport', () => {
  it('creates export-only meshes per slot and hides the BatchedMesh', () => {
    const { root, batchedMesh, members, geometry, material } =
      makeBatchedScene();
    const restore = batch.expandBatchedMeshesForExport(root);

    expect(batchedMesh.visible).toBe(false);
    for (const memberRoot of members) {
      const temps = memberRoot.children.filter((c) => c.isMesh);
      expect(temps).toHaveLength(1);
      const temp = temps[0];
      expect(temp.geometry).toBe(geometry);
      expect(temp.material).toBe(material);
      expect(temp.matrixAutoUpdate).toBe(false);
      expect(
        temp.matrix.equals(memberRoot.userData._batchSlots[0].localMatrix)
      ).toBe(true);
      // Renderer/raycaster never see the temp mesh; only the exporter (which
      // ignores layers) does.
      expect(temp.layers.mask).toBe(0);
    }

    restore();
    expect(batchedMesh.visible).toBe(true);
    for (const memberRoot of members) {
      expect(memberRoot.children.filter((c) => c.isMesh)).toHaveLength(0);
    }
    restore(); // idempotent — a second call must not double-toggle anything
    expect(batchedMesh.visible).toBe(true);
  });

  it('expands a single member root whose BatchedMesh lives outside it', () => {
    const { batchedMesh, members } = makeBatchedScene();
    const restore = batch.expandBatchedMeshesForExport(members[0]);
    expect(members[0].children.filter((c) => c.isMesh)).toHaveLength(1);
    expect(batchedMesh.visible).toBe(true); // not under the export root — untouched
    restore();
    expect(members[0].children.filter((c) => c.isMesh)).toHaveLength(0);
  });
});

describe('prepareSceneForGltfExport + GLTFExporter (production pairing)', () => {
  it('reproduces the "reading \'x\'" crash on a pivot-less scene without prep', async () => {
    const { root } = makeBatchedScene();
    stripPivots(root);
    await expect(exportGltf(root)).rejects.toThrow(/reading 'x'/);
  });

  it('exports a batched, pivot-less scene once prepared, then restores', async () => {
    const { root, batchedMesh, members } = makeBatchedScene();
    stripPivots(root);

    const restore = prepareSceneForGltfExport(root);
    const gltf = await exportGltf(root);
    restore();

    // One node per member, each carrying the expanded mesh as a child; the hidden
    // BatchedMesh (merged capacity blob) must not be exported.
    const meshNodes = (gltf.nodes || []).filter((n) => n.mesh !== undefined);
    expect(meshNodes).toHaveLength(2);
    expect(meshNodes.every((n) => n.name === 'box-sub-mesh')).toBe(true);
    // Slot-local transform survives via the node matrix.
    expect(meshNodes[0].matrix?.[13]).toBe(1); // translation.y of slot 0
    expect(meshNodes[1].matrix?.[13]).toBe(2); // translation.y of slot 1

    // Scene is back to its renderable state.
    expect(batchedMesh.visible).toBe(true);
    for (const memberRoot of members) {
      expect(memberRoot.children.filter((c) => c.isMesh)).toHaveLength(0);
    }
  });
});
