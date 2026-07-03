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

  it('folds each post-load duplicate into an existing group immediately (threshold 1)', () => {
    const sceneEl = fakeSceneEl();
    const { bm, geometryId, geometry } = makeBatchedMesh(2); // undersized: forces a grow
    const group = makeGroup(bm, geometryId, geometry, sceneEl);
    sceneEl._batchModelsBuilt.push(group);

    const els = [];
    for (let i = 0; i < 4; i++) {
      const el = fakeGltfEl(sceneEl);
      els.push(el);
      batch._test.trackLateUnbatched(el); // each add folds right away — nothing accumulates
      expect(batch.isBatched(el)).toBe(true);
      expect(sceneEl._lateUnbatched.has('x.glb')).toBe(false); // pending cleared after each fold
    }

    expect(group.activeMemberCount).toBe(4);
    expect(bm.instanceCount).toBe(4);
    expect(bm.maxInstanceCount).toBe(4); // grew from 2 via setInstanceCount
    expect(
      els.every((e) => e.object3D.userData._batchSlots?.length === 1)
    ).toBe(true);
    expect(els.every((e) => e._removeMesh.mock.calls.length === 1)).toBe(true);
  });

  it('keeps a lone duplicate of a not-yet-batched key pending until a second appears', () => {
    const sceneEl = fakeSceneEl(); // no existing group for x.glb
    const el = fakeGltfEl(sceneEl);
    batch._test.trackLateUnbatched(el); // 1 candidate, no group -> needs >= 2 to form one

    expect(batch.isBatched(el)).toBe(false);
    expect(sceneEl._lateUnbatched.get('x.glb').size).toBe(1); // held pending, not dropped
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

describe('batch-models shadow flag capture', () => {
  // A gltf-model-like ref: a Group root (as A-Frame's mesh object3D is) holding one Mesh.
  // The shadow component sets castShadow/receiveShadow on the Mesh, never on the Group root.
  function refMeshWith(cast, receive) {
    const root = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial()
    );
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    root.add(mesh);
    root.updateMatrixWorld(true);
    return root;
  }

  it('copies castShadow/receiveShadow from the sub-mesh, not the Group root', () => {
    const refMesh = refMeshWith(true, true);
    const { castShadow, receiveShadow } = batch._test.collectRefSubMeshes(
      refMesh,
      refMesh.matrixWorld
    );
    // Group root defaults both to false; reading true proves we captured the child mesh.
    expect(castShadow).toBe(true);
    expect(receiveShadow).toBe(true);
  });

  it('preserves a shadow-off sub-mesh (does not force flags on)', () => {
    const refMesh = refMeshWith(false, false);
    const { castShadow, receiveShadow } = batch._test.collectRefSubMeshes(
      refMesh,
      refMesh.matrixWorld
    );
    expect(castShadow).toBe(false);
    expect(receiveShadow).toBe(false);
  });
});

describe('batch-models skinned mesh batching', () => {
  // A skinned box with a real one-bone skeleton (BoxGeometry + the skinIndex/skinWeight a rigged
  // GLB carries). Bound while everything sits at the origin — so the bone's inverse-bind is
  // identity — then optionally posed and/or placed, mirroring a GLB authored+bound at the origin
  // and later positioned in the scene. `posePos` moves the bone AFTER bind (a resting pose that
  // differs from the bind pose); `worldPos` moves the whole root (scene placement). The final
  // refresh uses updateWorldMatrix (like batchModels) NOT updateMatrixWorld — the latter would
  // refresh SkinnedMesh.bindMatrixInverse and mask the stale-inverse path the bake recomputes.
  function skinnedRoot({ posePos, worldPos } = {}) {
    const geometry = new THREE.BoxGeometry();
    const n = geometry.attributes.position.count;
    const skinIndex = new Uint16Array(n * 4);
    const skinWeight = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) skinWeight[i * 4] = 1; // fully weighted to bone 0
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute(skinIndex, 4)
    );
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute(skinWeight, 4)
    );
    const bone = new THREE.Bone();
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial());
    const root = new THREE.Group();
    root.add(bone);
    root.add(mesh);
    root.updateMatrixWorld(true); // bone at origin
    mesh.bind(new THREE.Skeleton([bone])); // boneInverses = identity, bindMatrix = identity
    if (posePos) bone.position.copy(posePos);
    if (worldPos) root.position.copy(worldPos);
    root.updateWorldMatrix(true, true);
    return root;
  }

  it('batches a static skinned mesh by default', () => {
    // Static-rigged model (e.g. a car with wheel bones we never animate): the SkinnedMesh
    // used to be skipped outright; with BATCH_SKINNED_MESHES on it's collected like any mesh.
    expect(batch.BATCH_SKINNED_MESHES).toBe(true);
    const { materialGroups, skipReasons } = batch._test.collectRefSubMeshes(
      skinnedRoot(),
      new THREE.Matrix4()
    );
    expect(skipReasons).toEqual([]);
    expect(materialGroups.size).toBe(1);
  });

  it('drops skinIndex/skinWeight from the baked geometry, keeping position', () => {
    const { materialGroups } = batch._test.collectRefSubMeshes(
      skinnedRoot(),
      new THREE.Matrix4()
    );
    const [{ geometry }] = [...materialGroups.values()][0];
    expect(geometry.getAttribute('position')).toBeTruthy();
    expect(geometry.getAttribute('skinIndex')).toBeUndefined();
    expect(geometry.getAttribute('skinWeight')).toBeUndefined();
  });

  it('bakes the resting bone pose into the vertices (not the bind pose)', () => {
    // Bind at the origin, then translate the sole bone +5 in y: every vertex (fully weighted to
    // it) must move +5. This is the whole point — a posed rig renders its pose, not the T-pose.
    const { materialGroups } = batch._test.collectRefSubMeshes(
      skinnedRoot({ posePos: new THREE.Vector3(0, 5, 0) }),
      new THREE.Matrix4()
    );
    const [{ geometry }] = [...materialGroups.values()][0];
    geometry.computeBoundingBox();
    // BoxGeometry spans y ∈ [-0.5, 0.5]; after the +5 bone it must be ~[4.5, 5.5].
    expect(geometry.boundingBox.min.y).toBeCloseTo(4.5, 3);
    expect(geometry.boundingBox.max.y).toBeCloseTo(5.5, 3);
  });

  it('bakes to mesh-local space when the entity is placed far from the origin', () => {
    // Regression: with a stale bindMatrixInverse the bake produced WORLD coords, and the slot
    // matrix then double-applied the placement (a model 100 units out rendered at 200 and
    // vanished). The baked box must stay near its own local origin, not the +100 world offset.
    const root = skinnedRoot({ worldPos: new THREE.Vector3(100, 0, 0) });
    const { materialGroups } = batch._test.collectRefSubMeshes(
      root,
      root.matrixWorld
    );
    const [{ geometry }] = [...materialGroups.values()][0];
    geometry.computeBoundingBox();
    expect(geometry.boundingBox.max.x).toBeLessThan(2);
    expect(geometry.boundingBox.min.x).toBeGreaterThan(-2);
  });

  it('bakes each skinned sub-mesh on its own (no shared-geometry memo)', () => {
    // Baking depends on each node's skeleton pose, so two sub-meshes sharing a source geometry
    // yield distinct baked geometries — batchGroup's addGeometry dedup keys on identity, so this
    // just means two registered geometries, which is correct (they could be posed differently).
    const root = skinnedRoot();
    const shared = root.children.find((c) => c.isSkinnedMesh);
    const twin = new THREE.SkinnedMesh(shared.geometry, shared.material);
    twin.bind(shared.skeleton);
    root.add(twin);
    root.updateWorldMatrix(true, true);
    const { materialGroups } = batch._test.collectRefSubMeshes(
      root,
      new THREE.Matrix4()
    );
    const entries = [...materialGroups.values()][0];
    expect(entries.length).toBe(2);
    expect(entries[0].geometry).not.toBe(entries[1].geometry);
  });
});

describe('batch-models geometry-material (stencil) provider', () => {
  // A stencil-like entity: geometry (plane) + material (shared atlas texture) + atlas-uvs (the
  // per-stencil UV cell) + a single plane mesh. `atlasSrc` is the resolved material src (a DOM
  // <img> asset in production); `cell` is the atlas-uvs data that distinguishes stencils.
  function fakeStencilEl({
    atlasSrc = { id: 'stencils-atlas', nodeType: 1 },
    cell = { totalRows: 4, totalColumns: 4, column: 3, row: 2 },
    geometryData = { primitive: 'plane', width: 1, height: 1 },
    material,
    position = [0, 0, 0],
    extraComponents = {}
  } = {}) {
    const object3D = new THREE.Object3D();
    object3D.position.set(...position);
    const mat = material || new THREE.MeshBasicMaterial({ transparent: true });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), mat);
    object3D.add(mesh);
    object3D.updateMatrixWorld(true);
    const components = {
      geometry: { data: geometryData },
      material: { data: { src: atlasSrc, transparent: true } },
      'atlas-uvs': { data: cell },
      ...extraComponents
    };
    return {
      object3D,
      components,
      tagName: 'A-ENTITY',
      classList: { contains: () => false },
      getObject3D: (type) => (type === 'mesh' ? mesh : undefined),
      emit: () => {},
      _mesh: mesh
    };
  }

  // A batch root that just stores object3Ds, enough for batchMergedByMaterial.
  function fakeBatchRoot() {
    const objs = {};
    return {
      setObject3D: (k, o) => {
        objs[k] = o;
      },
      getObject3D: (k) => objs[k],
      removeObject3D: (k) => delete objs[k],
      _objs: objs
    };
  }

  it('recognizes a geometry+material stencil, sharing (not owning) resources', () => {
    const provider = batch._test.getBatchProvider(fakeStencilEl());
    expect(provider.kind).toBe('geometry-material');
    expect(provider.mergeByMaterial).toBe(true);
    expect(provider.ownsResources).toBe(false);
    expect(provider.clonesMaterial).toBe(true);
  });

  it('groups by material alone — same atlas keys together across different cells', () => {
    const a = batch._test.stencilGroupKey(fakeStencilEl());
    const differentCell = batch._test.stencilGroupKey(
      fakeStencilEl({
        cell: { totalRows: 4, totalColumns: 4, column: 3, row: 3 }
      })
    );
    expect(differentCell).toBe(a); // one atlas → one group
    const otherAtlas = batch._test.stencilGroupKey(
      fakeStencilEl({ atlasSrc: { id: 'markings-atlas', nodeType: 1 } })
    );
    expect(otherAtlas).not.toBe(a); // a second atlas → its own group
  });

  it('separates geometry signatures by atlas cell within a group', () => {
    const cellA = batch._test.stencilGeometrySignature(fakeStencilEl());
    const cellAAgain = batch._test.stencilGeometrySignature(fakeStencilEl());
    expect(cellAAgain).toBe(cellA);
    const cellB = batch._test.stencilGeometrySignature(
      fakeStencilEl({
        cell: { totalRows: 4, totalColumns: 4, column: 3, row: 3 }
      })
    );
    expect(cellB).not.toBe(cellA);
  });

  it('treats geometry/material/atlas-uvs/polygon-offset as non-blocking for a stencil', () => {
    const el = fakeStencilEl({
      extraComponents: { 'polygon-offset': { data: {} }, shadow: { data: {} } }
    });
    expect(batch._test.getBlockingComponents(el)).toEqual([]);
  });

  it('clones the material AND its textures, but shares the underlying Source', () => {
    const texture = new THREE.Texture();
    const source = texture.source;
    const material = new THREE.MeshBasicMaterial({ map: texture });
    const clone = batch._test.cloneMaterialWithTextures(material);
    expect(clone).not.toBe(material);
    expect(clone.map).not.toBe(texture); // own Texture object...
    expect(clone.map.source).toBe(source); // ...but the shared refcounted Source
  });

  it('hides the original mesh on strip and restores it on reload', () => {
    const el = fakeStencilEl();
    const provider = batch._test.getBatchProvider(el);
    provider.strip();
    expect(el._mesh.visible).toBe(false);
    provider.reload();
    expect(el._mesh.visible).toBe(true);
  });

  it('singleBatchableSubMesh returns the lone quad, rejects multi-mesh', () => {
    const single = fakeStencilEl();
    expect(batch._test.singleBatchableSubMesh(single.object3D)).toBe(
      single._mesh
    );
    single.object3D.add(
      new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial())
    );
    expect(batch._test.singleBatchableSubMesh(single.object3D)).toBeNull();
  });

  it('merges a whole atlas into ONE BatchedMesh — one geometry per distinct cell, one instance per member', () => {
    const cellA = { totalRows: 4, totalColumns: 4, column: 3, row: 2 };
    const cellB = { totalRows: 4, totalColumns: 4, column: 3, row: 3 };
    // Three stencils sharing one atlas: two of cell A, one of cell B.
    const members = [
      fakeStencilEl({ cell: cellA, position: [0, 0, 0] }),
      fakeStencilEl({ cell: cellA, position: [2, 0, 0] }),
      fakeStencilEl({ cell: cellB, position: [4, 0, 0] })
    ];
    const root = fakeBatchRoot();
    const group = batch._test.batchMergedByMaterial(
      root,
      'geomat|atlas',
      members
    );

    expect(group).toBeTruthy();
    expect(group.heterogeneous).toBe(true);
    const bm = group.batchedMeshes[0].batchedMesh;
    expect(bm.instanceCount).toBe(3); // one instance per member
    expect(bm._geometryCount).toBe(2); // deduped: cell A shared, cell B distinct
    expect(group.ownedMaterials.length).toBe(1); // single cloned atlas material

    for (const m of members) {
      expect(batch.isBatched(m)).toBe(true);
      expect(m.object3D.userData._batchSlots).toHaveLength(1);
      expect(m._mesh.visible).toBe(false); // original hidden in place
      expect(m.object3D.userData._batchLocalBbox).toBeTruthy(); // per-member selection box
    }
  });

  it('does not merge when fewer than two members are batchable', () => {
    const root = fakeBatchRoot();
    expect(
      batch._test.batchMergedByMaterial(root, 'geomat|atlas', [fakeStencilEl()])
    ).toBeNull();
  });

  it('pops a batched member when a batch-defining component changes (mixin/atlas-uvs swap)', () => {
    const cellA = { totalRows: 4, totalColumns: 4, column: 3, row: 2 };
    const members = [
      fakeStencilEl({ cell: cellA, position: [0, 0, 0] }),
      fakeStencilEl({ cell: cellA, position: [2, 0, 0] }),
      fakeStencilEl({ cell: cellA, position: [4, 0, 0] })
    ];
    const root = fakeBatchRoot();
    const sceneEl = fakeSceneEl();
    root.sceneEl = sceneEl;
    const group = batch._test.batchMergedByMaterial(
      root,
      'geomat|atlas',
      members
    );
    sceneEl._batchModelsBuilt.push(group);

    const swapped = members[0];
    expect(batch.isBatched(swapped)).toBe(true);
    expect(swapped._mesh.visible).toBe(false);

    // Simulate A-Frame firing componentchanged for atlas-uvs (a mixin swap changed the cell).
    batch._test.onSceneComponentChanged({
      type: 'componentchanged',
      detail: { name: 'atlas-uvs' },
      currentTarget: sceneEl,
      target: swapped
    });

    // Popped: dropped from the batch and its now-updated original mesh is shown again.
    expect(batch.isBatched(swapped)).toBe(false);
    expect(swapped._mesh.visible).toBe(true);
    expect(group.activeMemberCount).toBe(2);
    // Untouched members stay batched.
    expect(batch.isBatched(members[1])).toBe(true);
    expect(batch.isBatched(members[2])).toBe(true);
  });

  it('does not pop on a batch-defining change to an UNBATCHED entity', () => {
    const el = fakeStencilEl();
    const sceneEl = fakeSceneEl();
    // A built group must exist or the listener early-outs; use an unrelated empty-ish marker.
    sceneEl._batchModelsBuilt.push({ key: 'other' });
    batch._test.onSceneComponentChanged({
      type: 'componentchanged',
      detail: { name: 'atlas-uvs' },
      currentTarget: sceneEl,
      target: el
    });
    expect(batch.isBatched(el)).toBe(false); // no-op, no throw
    expect(el._mesh.visible).toBe(true); // never hidden
  });
});
