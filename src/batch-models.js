/* global AFRAME, THREE, ImageBitmap */

import { releaseSharedSource } from './sharedTextureSources';

// Automatic runtime batching of repeated gltf-model entities.
//
// - Deferral: when a scene will be batched, createEntities sets `sceneEl._batchingEnabled =
//   true` and gltf-model.update() holds each GLB load for two ticks (see its comment).
//   batchModels waits that same settle, then markDeferredLoads() walks the live DOM —
//   catching entities a component mints during its own init, not just the ones in the scene
//   JSON — groups by `gltf-model` src, and flips `deferLoad = true` on the N-1 non-reference
//   members of every all-safe group so they never download/parse. It then
//   sets `sceneEl._batchGroupingDone = true` and emits "batch-grouping-done" to release the
//   held components: refs load, deferred ones skip. The gate makes the order of the two
//   independent two-tick windows irrelevant (a held load only proceeds after grouping).
// - `batchModels(sceneEl)` then waits for every non-deferred model to load, filters to
//   entities whose components are only in BATCH_SAFE_COMPONENTS, groups by `gltf-model` src,
//   and for each group >= 2 builds one THREE.BatchedMesh per material from the reference
//   model (members[0]).
// - Per-member: addInstance(geometryId) x sub-mesh-count, setMatrixAt(instanceId,
//   memberWorld . subMeshLocal). Slot visibility seeded from effective visibility
//   (local AND ancestor chain) since the slot lives under batchRootEl, outside the
//   member's parent chain.
// - Members are stripped at batch time via `el.components['gltf-model'].removeMesh()`
//   (lighter than .remove(): no removers fired, no mixer cleanup). The mesh is detached
//   and the tree is walked with disposeNode. Resources the BatchedMesh actually renders
//   (members[0]'s materials, textures, ImageBitmaps, and geometries) are flagged with
//   _batchKeepAlive so disposeUtils.disposeNode skips them. Every other duplicate
//   (members[1+]'s materials/textures/geometries, plus the non-rendered nodes from
//   members[0]'s tree) is freed immediately. Inflator-spawned entities reparented under
//   sceneEl (waypoints, spawn-points, media-*, etc.) stay alive across batching.
// - Exception: `.clickable` members in runtime keep their mesh tree (hidden) so the
//   A-Frame runtime cursor can raycast them. The cursor doesn't yet resolve BatchedMesh
//   hits to entities via batchId.
// - processKeyGroup classifies an entity as unsafe when its gltf-model has
//   `usedFakeEl=true` (an in-place inflator like audio/uv-scroll/reflection-probe/
//   particle-emitter wrapped a mesh node in a FakeEntity) or `mixer` (loop-animation):
//   either case binds runtime behaviour to nodes the strip would dispose.
// - Each member stores `_batchSlots` + `_batchGroup` (back-reference to the group object)
//   on object3D.userData; the group tracks `activeMemberCount`. When removeMember drops
//   the count to 0, teardownBuiltGroup disposes the BatchedMesh, disposes the kept-alive
//   resources (no mesh tree holds them anymore), and splices the group out of
//   sceneEl._batchModelsBuilt.
// - `_batchLocalBbox` (one Box3 per group, computed from the geometries) is stashed on
//   every member so the editor's OrientedBoxHelper can size selection/hover boxes without
//   reading the (gone) mesh tree.
// - A scene-level capture-phase `componentchanged`/`componentinitialized` listener handles
//   transforms and visible on any descendant (A-Frame emits non-bubbling componentchanged,
//   so capture phase is required). It re-bakes matrices and applies effective visibility
//   onto the slots, since three.js's transform/visibility cascade doesn't reach slots
//   parented under batchRootEl.
// - When a non-safe component initializes on a batched entity, popMember calls
//   removeMember (drops the slot and, if it was the last one, tears down the group)
//   then triggers `el.components['gltf-model'].update()` to reload the GLB. Once
//   model-loaded fires, the entity is a normal unbatched gltf-model with the new
//   component applied to the fresh mesh.
// - Every skip reason is logged with [batch-models] prefix.
//
// BVH ownership:
// - gltf-model-plus does NOT build BVHs anymore.
// - Batched groups: computeBoundsTree is called on the BatchedMesh (covers every instance).
// - Unbatched entities (blocking components, lone instance, skin/morph skip reasons):
//   batchModels walks them and builds BVHs on their original mesh.
// - In runtime (no AFRAME.INSPECTOR), also build BVHs on `.clickable` entities — both
//   unbatched ones and batched ones whose hidden mesh is kept around for the cursor.
// - Reloaded entities (popMember → update()) get a fresh BVH from `onLateModelLoaded`.

const BATCH_SAFE_COMPONENTS = new Set([
  'position',
  'rotation',
  'scale',
  'visible',
  'shadow',
  'gltf-model',
  'gltf-part'
]);

// Below this triangle count, BVH build + traversal + memory cost outweighs the gain over
// three.js's linear raycast in Mesh.raycast.
const MIN_TRIANGLES_FOR_BVH = 500;

const BATCH_GROUP_NAME_PREFIX = 'batch:';
const BATCH_ROOT_ID = 'batch-models-root';

function setStatus(el, batched, reason) {
  el.object3D.userData._batchStatus = reason
    ? { batched: batched, reason: reason }
    : { batched: batched };
}

export function getBatchStatus(el) {
  return el?.object3D?.userData?._batchStatus || null;
}

// Create (once) an a-entity under #street-container that owns all BatchedMeshes via
// setObject3D. setObject3D sets `obj.el = batchRootEl` on each BatchedMesh, which is what
// A-Frame's raycaster uses to keep an intersection. Without an .el, intersections get
// filtered out before cursor events fire and the editor raycaster never triggers on
// batched geometry. The SceneGraph sidebar filters this entity out by id.
function getOrCreateBatchRoot() {
  let el = document.getElementById(BATCH_ROOT_ID);
  if (el) return el;
  const sceneContainer = document.getElementById('street-container');
  if (!sceneContainer) {
    throw new Error('[batch-models] #street-container is missing');
  }
  el = document.createElement('a-entity');
  el.id = BATCH_ROOT_ID;
  sceneContainer.appendChild(el);
  return el;
}

// Entities batch-models can fold into a BatchedMesh: gltf-model (its own component) and
// gltf-part (a named sub-mesh of a shared GLB, usually applied via a mixin). querySelectorAll
// matches both attributes, including the mixin-applied ones.
const BATCHABLE_SELECTOR = '[gltf-model], [gltf-part]';

// Per-entity batching adapter abstracting the two providers' differences:
// - key: identical key ⇒ identical geometry + material ⇒ batchable together. Kept distinct
//   between providers (gltf-part is prefixed) so a group is always homogeneous.
// - ownsResources: gltf-model clones own their geometry AND materials, so teardown disposes
//   them. gltf-part shares its material with the module-level MODELS cache (and every
//   non-batched instance of the part), so we must NOT dispose materials — only the
//   per-instance geometry, which strip() handles.
// - strip: detach the original mesh once it's folded into the BatchedMesh.
// - reload: rebuild the original mesh (popMember, when an unsafe component forces unbatching).
function getBatchProvider(el) {
  const gltfModel = el.components?.['gltf-model'];
  if (gltfModel) {
    return {
      kind: 'gltf-model',
      key: el.getAttribute('gltf-model'),
      ownsResources: true,
      strip: () => gltfModel.removeMesh(),
      reload: () => gltfModel.update()
    };
  }
  const gltfPart = el.components?.['gltf-part'];
  if (gltfPart) {
    const { src, part } = gltfPart.data;
    return {
      kind: 'gltf-part',
      key: src && part ? `part|${src}|${part}` : null,
      ownsResources: false,
      strip: () => stripGltfPartMesh(el),
      reload: () => gltfPart.update()
    };
  }
  return null;
}

// Strip a gltf-part member's mesh once it's in the BatchedMesh: dispose its per-instance
// geometry (gltf-part clones the geometry per entity), but NOT its material — that's shared
// with the gltf-part MODELS cache and other instances of the part.
function stripGltfPartMesh(el) {
  const mesh = el.getObject3D('mesh');
  if (!mesh) return;
  el.removeObject3D('mesh');
  mesh.traverse((node) => {
    if (node.isMesh && node.geometry) node.geometry.dispose();
  });
}

function getBatchKey(el) {
  return getBatchProvider(el)?.key ?? null;
}

// Walk the live DOM after gltf-model's two-tick hold has let it settle, group by
// gltf-model src, and flip `deferLoad = true` on the N-1 non-reference members of every
// all-safe duplicate group so they never download/parse — batchModels owns them as batch
// slots. Reading the live DOM means entities a component mints during its own init are
// grouped and deferred too, not just the ones present in the scene JSON.
//
// Only defers entities whose components are all in BATCH_SAFE_COMPONENTS; anything with a
// blocking component would be unbatched anyway and must load. .clickable is intentionally
// not gated here — in editor every member is stripped so deferral is fine, and in runtime
// batchModels releases them before processKeyGroup runs. After classifying each group's
// loaded ref, batchModels keeps the rest deferred (the group will batch) or releases them
// via `gltfComp.deferLoad = false; .update()` (ref had usedFakeEl, a mixer, or inflator
// removers, or the entity is runtime .clickable).
function markDeferredLoads(gltfEntities) {
  const groups = new Map();
  for (const el of gltfEntities) {
    // Only gltf-model has a deferrable load; gltf-part already parses each GLB once via its
    // own module cache, so it's never deferred (batchModels just groups it once loaded).
    if (!el.components?.['gltf-model']) continue;
    const key = getBatchKey(el);
    if (typeof key !== 'string' || !key) continue;
    if (getBlockingComponents(el).length > 0) continue; // not batch-safe → must load
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  }
  let deferredCount = 0;
  let groupsWithDeferred = 0;
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    groupsWithDeferred++;
    for (let i = 1; i < members.length; i++) {
      const comp = members[i].components['gltf-model'];
      if (comp) {
        comp.deferLoad = true;
        deferredCount++;
      }
    }
  }
  if (deferredCount) {
    console.log(
      `[batch-models] deferring ${deferredCount} GLB load(s) across ${groupsWithDeferred} src(s)`
    );
  }
}

function getBlockingComponents(el) {
  const blocking = [];
  for (const name in el.components) {
    if (!BATCH_SAFE_COMPONENTS.has(name)) blocking.push(name);
  }
  return blocking;
}

function waitForModelLoaded(el) {
  // Resolve immediately if the load already settled — a model-loaded (mesh present) or a
  // model-error (no mesh) may have fired before we got here, e.g. a fast 403. Relying only
  // on the events would miss those and hang Promise.all forever.
  const comp = el.components?.['gltf-model'] || el.components?.['gltf-part'];
  if (el.getObject3D('mesh') || comp?._loadSettled) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('model-loaded', onEvent);
      el.removeEventListener('model-error', onEvent);
      resolve();
    };
    const onEvent = (event) => {
      if (event.target !== el) return; // event from a child entity, ignore
      done();
    };
    el.addEventListener('model-loaded', onEvent);
    el.addEventListener('model-error', onEvent);
  });
}

function describeEl(el) {
  return el.id ? `#${el.id}` : el.tagName.toLowerCase();
}

function ensureOriginalBvh(el) {
  // three-mesh-bvh isn't integrated in this project, so BufferGeometry has no
  // computeBoundsTree — nothing to accelerate, skip entirely.
  if (typeof THREE.BufferGeometry.prototype.computeBoundsTree !== 'function') {
    return;
  }
  const mesh = el.getObject3D('mesh');
  if (!mesh) return;
  let built = 0;
  let skipped = 0;
  mesh.traverse((node) => {
    if (!node.isMesh || !node.geometry || node.geometry.boundsTree) return;
    const index = node.geometry.index;
    const triCount =
      (index ? index.count : node.geometry.attributes.position.count) / 3;
    if (triCount < MIN_TRIANGLES_FOR_BVH) {
      skipped++;
      return;
    }
    try {
      node.geometry.computeBoundsTree();
      built++;
    } catch (error) {
      console.warn(
        `[batch-models] failed to compute BVH on ${node.name || 'unnamed'}:`,
        error
      );
    }
  });
  if (built || skipped) {
    console.log(
      `[batch-models] BVH on ${describeEl(el)}: built ${built}, skipped ${skipped} (< ${MIN_TRIANGLES_FOR_BVH} tris)`
    );
  }
}

function getSrc(el) {
  const src = getBatchKey(el) || '';
  return src.startsWith('data:') ? 'data:...' : src;
}

// Group this model's sub-meshes by material, keyed by material reference.
//
// THREE.Cache caches only the downloaded bytes — every GLTFLoader.load() re-parses and
// creates fresh Material / BufferGeometry / Mesh instances with new uuids. So two entities
// loading the same src end up with DIFFERENT material instances. We only traverse the
// reference member (members[0]), so all material references here come from a single load
// and the Map keys are consistent. Other members' materials are never read; the BatchedMesh
// renders every instance with the reference material. Any per-instance material divergence
// (tint, texture swap, material-values) would therefore be lost — which is why the
// BATCH_SAFE_COMPONENTS allowlist must keep excluding components that mutate materials.
function collectRefSubMeshes(refMesh) {
  // Callers already refresh the full scene graph; trust refMesh.matrixWorld.
  const refInv = new THREE.Matrix4().copy(refMesh.matrixWorld).invert();
  const materialGroups = new Map(); // material -> [{ geometry, localMatrix }]
  const skipReasons = [];
  const localMatrix = new THREE.Matrix4();

  refMesh.traverse((node) => {
    if (!node.isMesh) return;
    if (node.isSkinnedMesh) {
      skipReasons.push(`skinned mesh "${node.name}"`);
      return;
    }
    if (node.morphTargetInfluences && node.morphTargetInfluences.length > 0) {
      skipReasons.push(`morph targets on "${node.name}"`);
      return;
    }
    if (Array.isArray(node.material)) {
      skipReasons.push(`multi-material mesh "${node.name}"`);
      return;
    }
    if (!node.geometry || !node.geometry.attributes.position) {
      skipReasons.push(`empty geometry on "${node.name}"`);
      return;
    }
    const material = node.material;
    if (!materialGroups.has(material)) materialGroups.set(material, []);
    const group = materialGroups.get(material);
    if (node.isInstancedMesh) {
      // EXT_mesh_gpu_instancing: expand each GPU instance into its own entry so the
      // BatchedMesh renders them individually (BatchedMesh can't nest InstancedMesh).
      const instanceMatrix = new THREE.Matrix4();
      const worldMatrix = new THREE.Matrix4();
      for (let i = 0; i < node.count; i++) {
        node.getMatrixAt(i, instanceMatrix);
        worldMatrix.multiplyMatrices(node.matrixWorld, instanceMatrix);
        group.push({
          geometry: node.geometry,
          localMatrix: new THREE.Matrix4().multiplyMatrices(refInv, worldMatrix)
        });
      }
    } else {
      group.push({
        geometry: node.geometry,
        localMatrix: new THREE.Matrix4().multiplyMatrices(
          refInv,
          node.matrixWorld
        )
      });
    }
  });

  return { materialGroups, skipReasons, localMatrix };
}

// Mark every resource the BatchedMesh references (members[0]'s materials, their textures
// and underlying ImageBitmaps, and the geometries we addGeometry'd) with _batchKeepAlive
// so disposeUtils.disposeNode skips dispose / ImageBitmap.close. We rely on this both
// when batchGroup strips each member's mesh tree at batch time and when teardownBuiltGroup
// later disposes the resources explicitly.
function markRefMeshResources(materialGroups) {
  const withUserData = new Set();
  const imageBitmaps = new Set();
  const mark = (obj) => {
    obj.userData._batchKeepAlive = true;
    withUserData.add(obj);
  };
  for (const [material, entries] of materialGroups) {
    mark(material);
    for (const propName in material) {
      const tex = material[propName];
      if (!tex?.isTexture) continue;
      mark(tex);
      const image = tex.source?.data;
      if (image instanceof ImageBitmap) {
        image._batchKeepAlive = true;
        imageBitmaps.add(image);
      }
    }
    for (const { geometry } of entries) mark(geometry);
  }
  return { withUserData, imageBitmaps };
}

// Compute the AABB of the model in entity-local space so the editor's OrientedBoxHelper
// can draw a selection/hover box without relying on the (stripped) mesh tree. localMatrix
// from collectRefSubMeshes is each sub-mesh's transform in refMesh's local space — the
// same space the BatchedMesh uses for slot matrices — so this bbox lines up after
// multiplying by entity.matrixWorld.
function computeBatchLocalBbox(materialGroups) {
  const bbox = new THREE.Box3();
  const tmp = new THREE.Box3();
  for (const [, entries] of materialGroups) {
    for (const { geometry, localMatrix } of entries) {
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      tmp.copy(geometry.boundingBox).applyMatrix4(localMatrix);
      bbox.union(tmp);
    }
  }
  return bbox;
}

function batchGroup(batchRootEl, key, members) {
  const src = getSrc(members[0]);
  const refMesh = members[0].getObject3D('mesh');
  if (!refMesh) {
    console.log(
      `[batch-models] not batched "${key}": reference member has no mesh (src: ${src})`
    );
    return null;
  }

  const { materialGroups, skipReasons } = collectRefSubMeshes(refMesh);
  if (skipReasons.length > 0) {
    console.log(
      `[batch-models] not batched "${key}" (${members.length} members): ${skipReasons.join(', ')} (src: ${src})`
    );
    return null;
  }
  if (materialGroups.size === 0) {
    console.log(
      `[batch-models] not batched "${key}": no batchable sub-meshes (src: ${src})`
    );
    return null;
  }

  // gltf-model clones own their resources, so we tag the ref's materials/textures/geometries
  // _batchKeepAlive (disposeNode spares them at strip) and dispose them at teardown. gltf-part
  // shares its material with the module cache, so there's nothing to keep alive or dispose —
  // strip() frees only the per-instance geometry.
  const ownsResources = getBatchProvider(members[0])?.ownsResources ?? true;
  const keepAlive = ownsResources
    ? markRefMeshResources(materialGroups)
    : { withUserData: new Set(), imageBitmaps: new Set() };
  const localBbox = computeBatchLocalBbox(materialGroups);

  for (const el of members) {
    if (!el.object3D.userData._batchSlots) {
      el.object3D.userData._batchSlots = [];
    }
    el.object3D.userData._batchLocalBbox = localBbox;
  }

  const object3DKeys = [];

  for (const [material, entries] of materialGroups) {
    // Dedupe geometries: EXT_mesh_gpu_instancing expands to many entries sharing a
    // single geometry, and gltf scenes can reuse a geometry across sibling meshes.
    // Only allocate BatchedMesh storage (and call addGeometry) once per unique ref.
    const uniqueGeometries = new Set();
    for (const { geometry } of entries) uniqueGeometries.add(geometry);
    let vertexCount = 0;
    let indexCount = 0;
    for (const geometry of uniqueGeometries) {
      vertexCount += geometry.attributes.position.count;
      indexCount += geometry.index
        ? geometry.index.count
        : geometry.attributes.position.count;
    }
    const maxInstances = members.length * entries.length;
    const batched = new THREE.BatchedMesh(
      maxInstances,
      vertexCount,
      indexCount,
      material
    );
    const object3DKey = `${BATCH_GROUP_NAME_PREFIX}${key}:${material.uuid}`;
    batched.name = object3DKey;
    batched.userData.batchIdToEl = [];
    const geometryIdByGeometry = new Map();
    const geometryIds = entries.map(({ geometry }) => {
      let id = geometryIdByGeometry.get(geometry);
      if (id === undefined) {
        id = batched.addGeometry(geometry);
        geometryIdByGeometry.set(geometry, id);
      }
      return id;
    });

    const worldMatrix = new THREE.Matrix4();
    for (const el of members) {
      entries.forEach(({ localMatrix, geometry }, idx) => {
        const instanceId = batched.addInstance(geometryIds[idx]);
        worldMatrix.multiplyMatrices(el.object3D.matrixWorld, localMatrix);
        batched.setMatrixAt(instanceId, worldMatrix);
        if (!computeEffectiveVisible(el.object3D)) {
          batched.setVisibleAt(instanceId, false);
        }
        batched.userData.batchIdToEl[instanceId] = el;
        // `geometry` lets consumers (e.g. subtract-mesh) read the original
        // sub-mesh vertices without having to dig into the BatchedMesh.
        el.object3D.userData._batchSlots.push({
          batchedMesh: batched,
          instanceId,
          localMatrix,
          geometry
        });
      });
    }

    batched.computeBoundsTree?.();
    batchRootEl.setObject3D(object3DKey, batched);
    object3DKeys.push(object3DKey);
  }

  const group = {
    batchRootEl,
    object3DKeys,
    members,
    key,
    keepAlive,
    ownsResources,
    activeMemberCount: members.length
  };

  // For each member, either strip the mesh tree or hide it in place:
  // - .clickable in runtime: keep the mesh hidden. A-Frame's runtime cursor (raycaster
  //   with `objects: .clickable`) doesn't yet resolve BatchedMesh hits back to entities
  //   via batchId, so it needs the original geometry as the raycast target. ensureOriginalBvh
  //   below will accelerate it.
  // - everyone else: removeMesh() detaches the mesh and walks the tree with disposeNode.
  //   Resources the BatchedMesh references (members[0]'s, tagged with _batchKeepAlive) are
  //   spared; everything else (duplicate materials/textures/geometries on members[1+], and
  //   non-rendered sub-meshes on members[0]) is freed. removeMesh() does NOT run inflator
  //   removers, so reparented entities under sceneEl stay alive.
  const inEditor = !!AFRAME.INSPECTOR;
  for (const el of members) {
    // Clear the deferLoad flag on every batched member: those still flagged would
    // otherwise be permanently batched-with-no-mesh, and a future popMember →
    // reload() must be free to actually load. (gltf-part has no deferLoad — no-op.)
    const gltfComp = el.components['gltf-model'];
    if (gltfComp) gltfComp.deferLoad = false;
    el.object3D.userData._batchGroup = group;
    setStatus(el, true);
    if (!inEditor && el.classList.contains('clickable')) {
      const mesh = el.getObject3D('mesh');
      if (mesh) mesh.visible = false;
    } else {
      getBatchProvider(el)?.strip();
    }
    // Deferred members never got their own model-loaded; emit one now so
    // listeners that need to wait for batch completion (e.g. subtract-mesh
    // resolving cutter readiness) can proceed via _batchSlots.
    el.emit('model-loaded', { format: 'gltf-batched', model: null });
  }

  console.log(
    `[batch-models] batched "${key}": ${members.length} members, ${materialGroups.size} draw call(s) (src: ${src})`
  );

  return group;
}

// Effective visibility = local visible AND every ancestor's visible. Three.js does this
// cascade implicitly during render for normally-parented objects, but a batched slot
// lives under batchRootEl, not under the member's parent chain — so we have to compute
// it ourselves before pushing to setVisibleAt.
function computeEffectiveVisible(object3D) {
  let n = object3D;
  while (n) {
    if (!n.visible) return false;
    n = n.parent;
  }
  return true;
}

// Sync batched slots on transform / visible changes anywhere in the tree. Listens at the
// scene root in capture phase because:
// - Slots live under batchRootEl, not under the member's parent chain, so an ancestor's
//   transform or visibility change doesn't propagate via three.js cascade.
// - A-Frame emits componentchanged with bubbles=false (aframe/src/core/component.js),
//   so a default-mode listener on sceneEl gets nothing from descendants. The capture
//   phase still happens for non-bubbling events.
// On a transform change, walk evt.target's subtree and re-bake each batched member's
// matrix into its slot. On a visible change, walk and apply effective visibility to each
// batched member's slots.
const TRACKED_TRANSFORM_COMPONENTS = new Set(['position', 'rotation', 'scale']);
const tmpWorldMatrix = new THREE.Matrix4();
function onSceneComponentChanged(evt) {
  const name = evt.detail.name;
  const sceneEl = evt.currentTarget;
  if (!sceneEl._batchModelsBuilt?.length) return;
  const root = evt.target;
  // A non-safe component added at runtime to a batched entity (one that swaps materials,
  // mutates geometry, or otherwise needs the original mesh) is incompatible with batching.
  // popMember drops the slot and reloads the GLB so the unsafe component runs against a
  // fresh, unbatched mesh. Subsequent scene loads naturally skip batching for the entity
  // because the unsafe component is now classified as a blocking component.
  if (
    evt.type === 'componentinitialized' &&
    !BATCH_SAFE_COMPONENTS.has(name) &&
    isBatched(root)
  ) {
    popMember(root);
  }
  if (name === 'visible') {
    applyEffectiveVisibility(root);
    for (const el of root.querySelectorAll(BATCHABLE_SELECTOR)) {
      applyEffectiveVisibility(el);
    }
    return;
  }
  if (TRACKED_TRANSFORM_COMPONENTS.has(name)) syncBatchedSubtree(root);
}

// Re-bake batched slots in `el`'s subtree from current matrixWorld. Exported so callers
// like TransformControls.objectChange can sync slots smoothly per frame, bypassing the
// 200ms throttle on componentchanged.
export function syncBatchedSubtree(el) {
  if (!el) return;
  // Refresh ancestors + descendants so every batched member's matrixWorld is fresh
  // before we read it.
  el.object3D.updateWorldMatrix(true, true);
  syncBatchedSlots(el);
  for (const descendant of el.querySelectorAll(BATCHABLE_SELECTOR)) {
    syncBatchedSlots(descendant);
  }
}

function syncBatchedSlots(el) {
  const slots = el.object3D?.userData?._batchSlots;
  if (!slots?.length) return;
  for (const { batchedMesh, instanceId, localMatrix } of slots) {
    tmpWorldMatrix.multiplyMatrices(el.object3D.matrixWorld, localMatrix);
    batchedMesh.setMatrixAt(instanceId, tmpWorldMatrix);
  }
}

function applyEffectiveVisibility(el) {
  const slots = el.object3D?.userData?._batchSlots;
  if (!slots?.length) return;
  const effective = computeEffectiveVisible(el.object3D);
  for (const { batchedMesh, instanceId } of slots) {
    batchedMesh.setVisibleAt(instanceId, effective);
  }
}

// Process all entities sharing one batch key: classify each, build the BatchedMesh if
// >=2 are batchable, mark every bail as unbatched, and run BVH on the unbatched set.
// Caller must have awaited model-loaded and refreshed world matrices.
function processKeyGroup(key, entities) {
  const members = [];
  const unbatched = new Set();
  for (const el of entities) {
    let reason = null;
    const blocking = getBlockingComponents(el);
    if (blocking.length > 0) reason = `has components [${blocking.join(', ')}]`;
    if (reason) {
      console.log(
        `[batch-models] not batched ${describeEl(el)}: ${reason} (src: ${getSrc(el)})`
      );
      setStatus(el, false, reason);
      unbatched.add(el);
    } else {
      members.push(el);
    }
  }

  const batchRootEl = getOrCreateBatchRoot();
  let built = null;
  if (members.length < 2) {
    if (members.length === 1) {
      const reason = 'only 1 instance';
      console.log(
        `[batch-models] not batched "${key}": ${reason} (src: ${getSrc(members[0])})`
      );
      setStatus(members[0], false, reason);
      unbatched.add(members[0]);
    }
  } else {
    built = batchGroup(batchRootEl, key, members);
    if (!built) {
      // batchGroup bailed (skin / morph / multi-material / empty geometry).
      for (const el of members) {
        setStatus(el, false, 'batch aborted (skin/morph/multi-material/empty)');
        unbatched.add(el);
      }
    }
  }

  // Editor inspector raycasts every unbatched entity, so accelerate them all here. In
  // runtime, only `.clickable` entities are raycast targets — those get BVHs from the
  // post-batch loop in batchModels.
  if (AFRAME.INSPECTOR) {
    for (const el of unbatched) ensureOriginalBvh(el);
  }
  return built;
}

export async function batchModels(sceneEl) {
  if (!sceneEl) return [];
  const rootEl = document.getElementById('street-container') || sceneEl;

  // Wait for the DOM to fully populate before grouping. Entities are minted by a chain of
  // components — managed-street → street-segment → street-generated-* → cloned gltf-model —
  // and each level initializes one tick after its parent. The chain is at most ~4 levels
  // deep on this app, so 5 ticks covers it. Held gltf-model components (see their update())
  // park on the "batch-grouping-done" signal until we open the gate below, so this longer
  // wait just widens the window; their deferLoad is still read after grouping is final.
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve));
  }

  const gltfEntities = Array.from(rootEl.querySelectorAll(BATCHABLE_SELECTOR));
  markDeferredLoads(gltfEntities);

  // Grouping decided: release every held gltf-model. Non-deferred ones load now;
  // deferred ones stay parked as batch slots until batchModels classifies them below.
  sceneEl._batchGroupingDone = true;
  sceneEl.emit('batch-grouping-done');

  if (gltfEntities.length === 0) return [];

  // Skip deferred entities in the wait — model-loaded will never fire for them. After we
  // classify each group's loaded ref, we either keep them deferred (group will batch) or
  // flip `component.deferLoad = false; component.update()` so each gets its own parse.
  const isDeferred = (el) => !!el.components?.['gltf-model']?.deferLoad;
  await Promise.all(
    gltfEntities.filter((el) => !isDeferred(el)).map(waitForModelLoaded)
  );

  // Decide which deferred members to release before batching. Two reasons to release:
  //   1. The group's loaded ref needs per-instance state (in-place fakeEl inflator, mixer,
  //      or createEntityAndReparent inflators that should re-spawn at each instance's
  //      worldPosition). If the ref load failed (no mesh), release defensively so deferred
  //      ones don't sit forever as ghost members.
  //   2. The member is .clickable in runtime: batchGroup keeps its hidden original mesh
  //      around as the runtime cursor's raycast target, so it has to be loaded.
  const inEditor = !!AFRAME.INSPECTOR;
  const groupsByKey = new Map();
  for (const el of gltfEntities) {
    const key = getBatchKey(el);
    if (!key) continue;
    if (!groupsByKey.has(key)) groupsByKey.set(key, []);
    groupsByKey.get(key).push(el);
  }
  for (const entities of groupsByKey.values()) {
    if (!entities.some(isDeferred)) continue;
    const ref = entities.find(
      (el) => !isDeferred(el) && el.getObject3D('mesh')
    );
    const groupNeedsLoad = !ref;
    for (const el of entities) {
      const comp = el.components['gltf-model'];
      if (!comp?.deferLoad) continue;
      // some entities are referenced by component and expect the mesh
      const isRuntimeClickable =
        !inEditor && el.classList.contains('clickable');
      if (groupNeedsLoad || isRuntimeClickable) {
        comp.deferLoad = false;
        comp.update();
      }
    }
  }
  await Promise.all(
    gltfEntities.filter((el) => !isDeferred(el)).map(waitForModelLoaded)
  );

  // If the tab was backgrounded during load, the render loop was throttled and
  // matrixWorld can be stale. Walk ancestors + descendants from the scene root so the
  // matrices we read below (for member world matrices and the reference model's
  // sub-mesh local matrices) are correct.
  sceneEl.object3D.updateWorldMatrix(true, true);

  // Group by key. Missing-key entities have no model to load — just log + status, no BVH.
  const groups = new Map();
  for (const el of gltfEntities) {
    const key = getBatchKey(el);
    if (!key) {
      const reason = 'no gltf-model src';
      console.log(`[batch-models] not batched ${describeEl(el)}: ${reason}`);
      setStatus(el, false, reason);
      continue;
    }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(el);
  }

  const built = [];
  for (const [key, entities] of groups) {
    const result = processKeyGroup(key, entities);
    if (result) built.push(result);
  }

  // Release any member still deferred but not batched: its group bailed (skinned/morph/
  // multi-material/no-ref-mesh) so it will never get a slot — load it individually,
  // otherwise it stays mesh-less forever.
  for (const el of gltfEntities) {
    const comp = el.components?.['gltf-model'];
    if (comp?.deferLoad && !isBatched(el)) {
      comp.deferLoad = false;
      comp.update();
    }
  }

  // In runtime (no inspector), `.clickable` entities are raycast targets via class even
  // while they sit inside a batch — give them BVHs too. ensureOriginalBvh is idempotent,
  // so re-covering already-BVH'd unbatched entities here is harmless.
  if (!inEditor) {
    for (const el of gltfEntities) {
      if (el.classList.contains('clickable')) ensureOriginalBvh(el);
    }
  }

  // Track built groups on sceneEl: the scene-level componentchanged listener early-outs
  // when this is empty, and removeMember splices a group out once its last member is gone.
  const existing = sceneEl._batchModelsBuilt || [];
  sceneEl._batchModelsBuilt = existing.concat(built);

  // Register (once) a listener that catches gltf-model entities created AFTER the initial
  // batch pass — typically from the editor's entityclone command. They don't get auto-
  // added to an existing batch (could regress the group), but they need a BVH so the
  // editor raycaster / runtime .clickable cursor still hits accelerated geometry.
  if (!sceneEl._batchLateListenerAdded) {
    sceneEl.addEventListener('model-loaded', onLateModelLoaded);
    // child-detached bubbles up to the scene; release any batch slots owned by
    // a detached entity (or its descendants) so the raycaster mapping
    // (`batchedMesh.userData.batchIdToEl[instanceId]`) doesn't keep pointing at
    // a now-detached object3D and crash hover/select handlers.
    sceneEl.addEventListener('child-detached', onLateChildDetached);
    // componentchanged is emitted with bubbles=false, but the capture phase still
    // visits ancestors. Listening with { capture: true } lets one hook on sceneEl
    // see every entity's transform / visible change; we then walk evt.target's
    // subtree to re-sync batched descendants whose slots live under batchRootEl.
    // Also listen for componentinitialized: A-Frame's first-time component init
    // (e.g. setAttribute('visible', false) on an entity that had no `visible`
    // attribute) emits componentinitialized rather than componentchanged
    // (aframe/src/core/component.js: initComponent vs callUpdateHandler).
    sceneEl.addEventListener('componentchanged', onSceneComponentChanged, {
      capture: true
    });
    sceneEl.addEventListener('componentinitialized', onSceneComponentChanged, {
      capture: true
    });
    sceneEl._batchLateListenerAdded = true;
  }

  return built;
}

function onLateModelLoaded(evt) {
  const el = evt.target;
  if (!el.parentNode) return;
  if (el.object3D?.userData?._batchStatus) return; // already classified by batchModels
  setStatus(el, false, 'added post-batch');
  const inEditor = !!AFRAME.INSPECTOR;
  if (inEditor || el.classList.contains('clickable')) {
    ensureOriginalBvh(el);
  }
}

function onLateChildDetached(evt) {
  const el = evt.detail?.el;
  if (!el) return;
  if (isBatched(el)) removeMember(el);
  // A removed subtree may contain multiple batched descendants.
  for (const descendant of el.querySelectorAll(BATCHABLE_SELECTOR)) {
    if (isBatched(descendant)) removeMember(descendant);
  }
}

// Disposes the BatchedMesh and the resources we kept alive for it. Called from
// removeMember when the last member of a group is detached. After this runs, no JS holder
// for the model's GLB-loaded materials/textures/geometries exists — they'd otherwise leak
// GPU memory since the entities' mesh trees were stripped at batch time.
function teardownBuiltGroup(group) {
  const { batchRootEl, object3DKeys, keepAlive, ownsResources } = group;
  for (const key of object3DKeys) {
    const batched = batchRootEl.getObject3D(key);
    batchRootEl.removeObject3D(key);
    if (batched?.isBatchedMesh) batched.dispose();
  }
  // gltf-part groups don't own their resources: materials are shared with the module-level
  // MODELS cache (and may be reused by the next scene), and per-instance geometries were
  // already disposed by strip(). Nothing else to free.
  if (!ownsResources) return;
  for (const obj of keepAlive.withUserData) {
    delete obj.userData._batchKeepAlive;
    // Account for this group's use of any shared Source so its bitmap is closed on the last
    // reference (release closes + unregisters only when refcount hits zero).
    if (obj.isTexture) {
      const img = obj.source?.data;
      if (img instanceof ImageBitmap && img._sharedSource) {
        releaseSharedSource(img);
      }
    }
    obj.dispose?.();
  }
  for (const img of keepAlive.imageBitmaps) {
    delete img._batchKeepAlive;
    // Shared canonicals are freed via releaseSharedSource above; the ones left here are this
    // group's own (non-shared) bitmaps, safe to close outright.
    if (img._sharedSource) continue;
    img.close?.();
  }
}

export function isBatched(el) {
  return !!el?.object3D?.userData?._batchSlots?.length;
}

// All batched members are stripped (no original mesh), so popMember can't restore the
// original in place. Drop the slot and trigger a fresh GLB load; once model-loaded fires
// the entity is a normal unbatched gltf-model with the new (unsafe) component applied.
export function popMember(el) {
  if (!isBatched(el)) return false;
  const provider = getBatchProvider(el);
  console.log(
    `[batch-models] popping ${describeEl(el)}: dropping slot + reloading`
  );
  removeMember(el);
  provider?.reload();
  return true;
}

// Release an entity's batch slots and, if it was the last member of the group, tear down
// the BatchedMesh. Hides the slots and clears the raycast mapping so a removed/reparented
// entity no longer raycasts to a detached object3D. The slot is left as a hole —
// reclaiming it would require hole-aware repacking, which we don't do here.
export function removeMember(el) {
  if (!isBatched(el)) return false;
  const slots = el.object3D.userData._batchSlots;
  for (const { batchedMesh, instanceId } of slots) {
    batchedMesh.setVisibleAt(instanceId, false);
    if (batchedMesh.userData.batchIdToEl) {
      delete batchedMesh.userData.batchIdToEl[instanceId];
    }
  }
  const group = el.object3D.userData._batchGroup;
  delete el.object3D.userData._batchSlots;
  delete el.object3D.userData._batchStatus;
  delete el.object3D.userData._batchLocalBbox;
  delete el.object3D.userData._batchGroup;
  console.log(
    `[batch-models] removed ${describeEl(el)} (${slots.length} slot(s))`
  );
  if (group && --group.activeMemberCount === 0) {
    teardownBuiltGroup(group);
    const sceneEl = group.batchRootEl.sceneEl;
    if (sceneEl?._batchModelsBuilt) {
      const idx = sceneEl._batchModelsBuilt.indexOf(group);
      if (idx >= 0) sceneEl._batchModelsBuilt.splice(idx, 1);
    }
    console.log(`[batch-models] tore down empty group "${group.key}"`);
  }
  return true;
}
