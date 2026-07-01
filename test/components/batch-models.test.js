import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// batch-models references the global THREE that A-Frame's build installs on window, and
// AFRAME.INSPECTOR. Import A-Frame first so those globals exist, then the module under test.
// These run in a real Chromium (browser mode) because THREE.BatchedMesh — the whole point of
// these tests — allocates data textures and behaves like production only in a real browser.
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

// Runtime (not editor) so addLateMember strips via the provider rather than hiding.
beforeEach(() => {
  window.AFRAME.INSPECTOR = null;
});

// A real BatchedMesh holding one box geometry, ready for addInstance(geometryId).
function makeBatchedMesh(maxInstances) {
  const bm = new THREE.BatchedMesh(
    maxInstances,
    256,
    512,
    new THREE.MeshBasicMaterial()
  );
  bm.userData.batchIdToEl = [];
  bm.userData.freeInstanceIds = [];
  const geometry = new THREE.BoxGeometry();
  const geometryId = bm.addGeometry(geometry);
  return { bm, geometryId, geometry };
}

// A group with a single BatchedMesh whose one template entry is an identity local matrix.
function makeGroup(bm, geometryId, geometry, sceneEl, overrides = {}) {
  return {
    batchRootEl: { sceneEl },
    object3DKeys: ['batch:test'],
    batchedMeshes: [
      {
        batchedMesh: bm,
        entries: [{ geometryId, localMatrix: new THREE.Matrix4(), geometry }]
      }
    ],
    localBbox: new THREE.Box3(),
    members: [],
    key: 'x.glb',
    keepAlive: { withUserData: new Set(), imageBitmaps: new Set() },
    ownsResources: false,
    activeMemberCount: 0,
    ...overrides
  };
}

// Minimal entity: just an object3D with a slot array. Enough for addMemberToBatchedMeshes.
function fakeEl() {
  const object3D = new THREE.Object3D();
  object3D.updateMatrixWorld();
  object3D.userData._batchSlots = [];
  return { object3D, tagName: 'A-ENTITY' };
}

// A gltf-model-ish entity accepted by getBatchKey / getBlockingComponents / the repack filter.
function fakeGltfEl(sceneEl, { blocking = [], hasMesh = true } = {}) {
  const object3D = new THREE.Object3D();
  object3D.updateMatrixWorld();
  const removeMesh = vi.fn();
  const components = {
    'gltf-model': {
      data: 'x.glb',
      deferLoad: false,
      removeMesh,
      update: vi.fn()
    }
  };
  for (const name of blocking) components[name] = {};
  const mesh = hasMesh
    ? new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
    : null;
  return {
    object3D,
    components,
    sceneEl,
    tagName: 'A-ENTITY',
    parentNode: {},
    classList: { contains: () => false },
    getAttribute: (name) => (name === 'gltf-model' ? 'x.glb' : null),
    getObject3D: (type) => (type === 'mesh' ? mesh : undefined),
    _removeMesh: removeMesh
  };
}

function fakeSceneEl() {
  const object3D = new THREE.Object3D();
  object3D.updateMatrixWorld();
  return { object3D, _batchModelsBuilt: [] };
}

describe('batch-models slot reclamation (tier 2)', () => {
  it('removeMember hides the slot, parks it for reuse, and keeps the group alive', () => {
    const { bm, geometryId, geometry } = makeBatchedMesh(2);
    const sceneEl = fakeSceneEl();
    const group = makeGroup(bm, geometryId, geometry, sceneEl);
    sceneEl._batchModelsBuilt.push(group);

    const m1 = fakeEl();
    const m2 = fakeEl();
    for (const m of [m1, m2]) {
      m.object3D.userData._batchGroup = group;
      batch._test.addMemberToBatchedMeshes(group, m);
    }
    group.members.push(m1, m2);
    group.activeMemberCount = 2;
    expect(bm.instanceCount).toBe(2);

    const id1 = m1.object3D.userData._batchSlots[0].instanceId;
    expect(batch.removeMember(m1)).toBe(true);

    // Hidden, not deleted: the id stays valid (getVisibleAt must not throw) and is parked.
    expect(bm.userData.freeInstanceIds).toContain(id1);
    expect(bm.getVisibleAt(id1)).toBe(false);
    expect(bm.instanceCount).toBe(2); // still active — reclaimed via our own pool, not deleteInstance
    expect(group.members).toEqual([m2]); // detached member spliced out
    expect(group.activeMemberCount).toBe(1);
    expect(m1.object3D.userData._batchSlots).toBeUndefined();
    expect(sceneEl._batchModelsBuilt).toContain(group); // not torn down yet
  });

  it('removeMember disposes the BatchedMesh and drops the group when the last member goes', () => {
    const { bm, geometryId, geometry } = makeBatchedMesh(2);
    const sceneEl = fakeSceneEl();
    const rootObjs = { 'batch:test': bm };
    const group = makeGroup(bm, geometryId, geometry, sceneEl, {
      batchRootEl: {
        sceneEl,
        getObject3D: (k) => rootObjs[k],
        removeObject3D: (k) => delete rootObjs[k]
      }
    });
    sceneEl._batchModelsBuilt.push(group);

    const m1 = fakeEl();
    m1.object3D.userData._batchGroup = group;
    batch._test.addMemberToBatchedMeshes(group, m1);
    group.members.push(m1);
    group.activeMemberCount = 1;

    const disposeSpy = vi.spyOn(bm, 'dispose');
    expect(batch.removeMember(m1)).toBe(true);

    expect(group.activeMemberCount).toBe(0);
    expect(disposeSpy).toHaveBeenCalled();
    expect(rootObjs['batch:test']).toBeUndefined(); // removed from the batch root
    expect(sceneEl._batchModelsBuilt).not.toContain(group);
  });
});

describe('batch-models capacity (tier 3 primitives)', () => {
  it('ensureInstanceCapacity grows only when the additions would not fit', () => {
    const { bm } = makeBatchedMesh(2);
    batch._test.ensureInstanceCapacity(bm, 2); // 0 + 2 <= 2
    expect(bm.maxInstanceCount).toBe(2);
    batch._test.ensureInstanceCapacity(bm, 3); // 0 + 3 > 2
    expect(bm.maxInstanceCount).toBe(3);
  });

  it('addMemberToBatchedMeshes reuses a parked slot before growing capacity', () => {
    const { bm, geometryId, geometry } = makeBatchedMesh(2);
    const sceneEl = fakeSceneEl();
    const group = makeGroup(bm, geometryId, geometry, sceneEl);

    const m1 = fakeEl();
    const m2 = fakeEl();
    for (const m of [m1, m2]) {
      m.object3D.userData._batchGroup = group;
      batch._test.addMemberToBatchedMeshes(group, m);
    }
    group.members.push(m1, m2);
    group.activeMemberCount = 2;
    expect(bm.instanceCount).toBe(2);
    expect(bm.maxInstanceCount).toBe(2);

    // Free m1's slot, then add a fresh member: it must reuse the parked slot, not grow.
    const freedId = m1.object3D.userData._batchSlots[0].instanceId;
    batch.removeMember(m1);
    expect(bm.userData.freeInstanceIds).toEqual([freedId]);

    const m3 = fakeEl();
    batch._test.addMemberToBatchedMeshes(group, m3);
    expect(m3.object3D.userData._batchSlots[0].instanceId).toBe(freedId); // reused
    expect(bm.getVisibleAt(freedId)).toBe(true); // re-shown
    expect(bm.maxInstanceCount).toBe(2); // no growth — parked slot reused
    expect(bm.userData.freeInstanceIds.length).toBe(0);

    // Now over capacity: must grow via setInstanceCount.
    const m4 = fakeEl();
    batch._test.addMemberToBatchedMeshes(group, m4);
    expect(bm.maxInstanceCount).toBe(3);
  });
});

describe('batch-models late-batch tally (tier 3)', () => {
  it('does not track entities carrying a blocking component', () => {
    const sceneEl = fakeSceneEl();
    batch._test.trackLateUnbatched(
      fakeGltfEl(sceneEl, { blocking: ['loop-animation'] })
    );
    expect(sceneEl._lateUnbatched?.get('x.glb')).toBeUndefined();
  });

  it('accumulates duplicates but does not fold below the threshold', () => {
    const sceneEl = fakeSceneEl();
    const { bm, geometryId, geometry } = makeBatchedMesh(8);
    const group = makeGroup(bm, geometryId, geometry, sceneEl);
    sceneEl._batchModelsBuilt.push(group);

    for (let i = 0; i < batch._test.LATE_BATCH_THRESHOLD - 1; i++) {
      batch._test.trackLateUnbatched(fakeGltfEl(sceneEl));
    }
    expect(sceneEl._lateUnbatched.get('x.glb').size).toBe(
      batch._test.LATE_BATCH_THRESHOLD - 1
    );
    expect(group.activeMemberCount).toBe(0); // nothing folded yet
  });

  it('folds pending duplicates into an existing group at the threshold', () => {
    const sceneEl = fakeSceneEl();
    const { bm, geometryId, geometry } = makeBatchedMesh(2); // undersized on purpose
    const group = makeGroup(bm, geometryId, geometry, sceneEl);
    sceneEl._batchModelsBuilt.push(group);

    const els = [];
    for (let i = 0; i < batch._test.LATE_BATCH_THRESHOLD; i++) {
      const el = fakeGltfEl(sceneEl);
      els.push(el);
      batch._test.trackLateUnbatched(el);
    }

    const n = batch._test.LATE_BATCH_THRESHOLD;
    expect(group.activeMemberCount).toBe(n);
    expect(bm.instanceCount).toBe(n);
    expect(bm.maxInstanceCount).toBe(n); // grew from 2 via setInstanceCount
    expect(
      els.every((e) => e.object3D.userData._batchSlots?.length === 1)
    ).toBe(true);
    expect(els.every((e) => batch.isBatched(e))).toBe(true);
    expect(els.every((e) => e._removeMesh.mock.calls.length === 1)).toBe(true);
    expect(sceneEl._lateUnbatched.has('x.glb')).toBe(false); // pending cleared
  });

  it('untrackLateUnbatched drops a pending entity and clears its key', () => {
    const sceneEl = fakeSceneEl();
    const el = fakeGltfEl(sceneEl);
    batch._test.trackLateUnbatched(el);
    expect(sceneEl._lateUnbatched.get('x.glb').size).toBe(1);
    expect(el.object3D.userData._lateUnbatchedKey).toBe('x.glb');

    batch._test.untrackLateUnbatched(sceneEl, el);
    expect(sceneEl._lateUnbatched.has('x.glb')).toBe(false);
    expect(el.object3D.userData._lateUnbatchedKey).toBeUndefined();
  });
});
