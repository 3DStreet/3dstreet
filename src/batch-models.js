/* global AFRAME, THREE, ImageBitmap */

import { releaseSharedSource } from './sharedTextureSources';

// Automatic runtime batching of repeated gltf-model and gltf-part entities.
//
// - Deferral (gltf-model only): when a scene will be batched, createEntities sets
//   `sceneEl._batchingEnabled = true` and gltf-model.update() parks its GLB load until
//   batchModels signals grouping is done. gltf-part is never deferred — it already parses
//   each GLB once via its own module-level cache.
// - `batchModels(sceneEl)` waits a few ticks for the DOM to settle (entities are minted by a
//   chain of components, each initializing a tick after its parent), then markDeferredLoads()
//   walks the live DOM, groups gltf-model duplicates by src, and flips `deferLoad = true` on
//   the N-1 non-reference members of every all-safe group so they never download/parse. It
//   sets `sceneEl._batchGroupingDone = true` and emits "batch-grouping-done" to release the
//   parked gltf-model components: refs load, deferred ones skip.
// - It then waits for every non-deferred model to load, filters to entities whose components
//   are all in BATCH_SAFE_COMPONENTS, groups by batch key (gltf-model src, or gltf-part
//   src+part), and for each group >= 2 builds one THREE.BatchedMesh per material from the
//   reference member (members[0]).
// - Per-member: addInstance(geometryId) x sub-mesh-count, setMatrixAt(instanceId,
//   memberWorld . subMeshLocal). Slot visibility seeded from effective visibility
//   (local AND ancestor chain) since the slot lives under batchRootEl, outside the
//   member's parent chain.
// - Members are stripped at batch time via a per-provider strip (see getBatchProvider):
//   gltf-model.removeMesh() detaches the mesh and walks the tree with disposeNode, sparing
//   members[0]'s rendered resources (tagged _batchKeepAlive) and freeing the duplicates;
//   gltf-part detaches the mesh and disposes only its per-instance geometry, keeping the
//   material (shared with the gltf-part module cache and other instances of the part).
// - Exception: `.clickable` members in runtime keep their mesh tree (hidden) so the
//   A-Frame runtime cursor can raycast them. The cursor doesn't yet resolve BatchedMesh
//   hits to entities via batchId.
// - processKeyGroup classifies an entity as unsafe only when it carries a component outside
//   BATCH_SAFE_COMPONENTS (getBlockingComponents); those load/render unbatched.
// - Each member stores `_batchSlots` + `_batchGroup` (back-reference to the group object)
//   on object3D.userData; the group tracks `activeMemberCount`. When removeMember drops
//   the count to 0, teardownBuiltGroup disposes the BatchedMesh and, for gltf-model groups
//   (which own their resources), the kept-alive resources, then splices the group out of
//   sceneEl._batchModelsBuilt. gltf-part groups own nothing extra — materials are
//   cache-shared and per-instance geometries were freed at strip.
// - `_batchLocalBbox` (one Box3 per group, computed from the geometries) is stashed on
//   every member so the editor's OrientedBoxHelper can size selection/hover boxes without
//   reading the (gone) mesh tree.
// - A scene-level capture-phase `componentchanged`/`componentinitialized` listener handles
//   transforms and visible on any descendant (A-Frame emits non-bubbling componentchanged,
//   so capture phase is required). It re-bakes matrices and applies effective visibility
//   onto the slots, since three.js's transform/visibility cascade doesn't reach slots
//   parented under batchRootEl.
// - When a non-safe component initializes on a batched entity, popMember calls removeMember
//   (drops the slot and, if it was the last one, tears down the group) then calls the
//   provider's reload() to rebuild the original mesh, so the new component runs unbatched.
// - removeMember hides each slot (setVisibleAt false) and parks its id on the group's
//   freeInstanceIds pool for reuse — NOT deleteInstance, whose deleted ids make getVisibleAt /
//   setMatrixAt and the three-mesh-bvh accelerated raycast throw "Invalid instanceId". Duplicates
//   added AFTER the batch pass (editor clone / layer reorder recreate entities) come through
//   onLateModelLoaded unbatched; trackLateUnbatched tallies them per key and, past
//   LATE_BATCH_THRESHOLD, repackLateUnbatched folds them into the matching group — or builds a
//   fresh one — reusing parked slots and growing capacity with setInstanceCount only when the
//   pool is empty, so a long editor session doesn't accrete unbatched draw calls or holes.
// - Every skip reason is logged with [batch-models] prefix.
//
// BVH: BatchedMesh.computeBoundsTree() and ensureOriginalBvh() are no-ops unless three-mesh-
// bvh is integrated (BufferGeometry.prototype.computeBoundsTree). When it is, batched groups
// get a BVH on the BatchedMesh and unbatched / runtime-`.clickable` entities get one on their
// original mesh.

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

// Per-entity cap on how long batchModels waits for a model to settle before proceeding
// without it, so one hung load can't block the whole batching flow indefinitely.
const LOAD_TIMEOUT_MS = 30000;

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
  // Mark autocreated so the scene serializer (json-utils_1.1.js) skips it; otherwise
  // the batch root leaks into saved scene JSON, AI-chat context, and MCP scene dumps.
  el.classList.add('autocreated');
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

// Per-src tally of how many gltf-model entities will parse each src this scene, so the 2nd+
// loader of a src clones a parsed template instead of re-parsing. gltf-model.update() bumps it
// via noteSrcLoad — before the gated loads — so a whole duplicate group is counted before any
// of it loads, letting even the first loader of a non-batchable group clone one parsed
// template. markDeferredLoads/the release paths keep the count to entities that actually parse
// (decrement on defer → batch slot, increment on release). createEntities resets it when a new
// scene starts. Module-scoped so the component and batchModels share it without threading it
// through every call.
const srcLoadCounts = new Map();

export function noteSrcLoad(src) {
  if (src) srcLoadCounts.set(src, (srcLoadCounts.get(src) || 0) + 1);
}

export function srcLoadCount(src) {
  return srcLoadCounts.get(src) || 0;
}

export function resetSrcLoadCounts() {
  srcLoadCounts.clear();
}

function adjustSrcLoadCount(src, delta) {
  if (!src) return;
  const n = (srcLoadCounts.get(src) || 0) + delta;
  if (n > 0) srcLoadCounts.set(src, n);
  else srcLoadCounts.delete(src);
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
        // This member won't parse (it'll be a batch slot), so drop it from the per-src load
        // tally — leaving the count to entities that actually parse.
        adjustSrcLoadCount(comp.data, -1);
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
    // Safety net: a load that never settles (hung fetch, stuck Draco worker) would otherwise
    // block Promise.all in batchModels forever and never release the batch-grouping-done gate.
    const timer = setTimeout(() => {
      console.warn(
        `[batch-models] ${describeEl(el)} model load did not settle in ${LOAD_TIMEOUT_MS}ms; proceeding without it`
      );
      done();
    }, LOAD_TIMEOUT_MS);
    const done = () => {
      clearTimeout(timer);
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

export async function waitForAllModelsLoaded() {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve));
  }
  const rootEl = document.getElementById('street-container');
  const gltfEntities = Array.from(rootEl.querySelectorAll(BATCHABLE_SELECTOR));
  if (gltfEntities.length > 0) {
    const isDeferred = (el) => !!el.components?.['gltf-model']?.deferLoad;
    await Promise.all(
      gltfEntities.filter((el) => !isDeferred(el)).map(waitForModelLoaded)
    );
  }
}
globalThis.waitForAllModelsLoaded = waitForAllModelsLoaded;

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
function collectRefSubMeshes(refMesh, refWorldMatrix) {
  // Build each sub-mesh's localMatrix relative to the ENTITY's world matrix (refWorldMatrix),
  // not the mesh's — batchGroup composes every slot as `el.object3D.matrixWorld · localMatrix`,
  // so the reference frame must be the entity. For a gltf-model the mesh is the scene root
  // (identity local), so mesh.matrixWorld === entity.matrixWorld and it makes no difference;
  // but a gltf-part mesh carries its own local transform (e.g. a 90° X-rotation that stands a
  // Character upright), and using mesh.matrixWorld here would cancel it out — laying the
  // Character back down. Callers already refreshed the full scene graph, so these are current.
  const refInv = new THREE.Matrix4().copy(refWorldMatrix).invert();
  const materialGroups = new Map(); // material -> [{ geometry, localMatrix }]
  const skipReasons = [];

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

  return { materialGroups, skipReasons };
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

// Grow a BatchedMesh's instance capacity if `additional` new instances wouldn't fit. Every
// slot id in [0, maxInstanceCount) is either active, a reusable freed hole, or unallocated,
// so (maxInstanceCount - instanceCount) is exactly how many addInstance calls fit without
// growing. At build time capacity is sized exactly, so this never grows there — it only kicks
// in when repackLateUnbatched folds more members in than the group was originally built for.
function ensureInstanceCapacity(batchedMesh, additional) {
  const needed = batchedMesh.instanceCount + additional;
  if (needed > batchedMesh.maxInstanceCount) {
    batchedMesh.setInstanceCount(needed);
  }
}

// Slot one member into every BatchedMesh of the group from the persisted templates:
// addInstance (reusing a freed hole id or a fresh slot), bake the member's world matrix,
// seed effective visibility, wire the raycast back-reference, and record the slot on the
// entity. Shared by build (batchGroup) and late-add (addLateMember) so both mint identical
// slots. Assumes el.object3D.userData._batchSlots exists.
function addMemberToBatchedMeshes(group, el) {
  const worldMatrix = new THREE.Matrix4();
  const slots = el.object3D.userData._batchSlots;
  const visible = computeEffectiveVisible(el.object3D);
  for (const { batchedMesh, entries } of group.batchedMeshes) {
    // Reuse hidden slots freed by removeMember before allocating new ones. Reused slots stay
    // "active" (just invisible), which is why removeMember hides rather than deletes: a
    // deleted instanceId makes BatchedMesh.getVisibleAt / setMatrixAt (and the three-mesh-bvh
    // accelerated raycast) throw "Invalid instanceId" mid-raycast. A freed slot may have held
    // a different sub-mesh's geometry, so setGeometryIdAt re-points it.
    const freeIds = batchedMesh.userData.freeInstanceIds;
    const reuseCount = Math.min(freeIds.length, entries.length);
    ensureInstanceCapacity(batchedMesh, entries.length - reuseCount);
    for (const { geometryId, localMatrix, geometry } of entries) {
      let instanceId;
      if (freeIds.length > 0) {
        instanceId = freeIds.pop();
        batchedMesh.setGeometryIdAt(instanceId, geometryId);
        batchedMesh.setVisibleAt(instanceId, visible);
      } else {
        instanceId = batchedMesh.addInstance(geometryId);
        if (!visible) batchedMesh.setVisibleAt(instanceId, false);
      }
      worldMatrix.multiplyMatrices(el.object3D.matrixWorld, localMatrix);
      batchedMesh.setMatrixAt(instanceId, worldMatrix);
      batchedMesh.userData.batchIdToEl[instanceId] = el;
      slots.push({ batchedMesh, instanceId, localMatrix, geometry });
    }
  }
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

  const { materialGroups, skipReasons } = collectRefSubMeshes(
    refMesh,
    members[0].object3D.matrixWorld
  );
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

  const object3DKeys = [];
  // Per BatchedMesh, the templates needed to slot in a member: the geometryId already
  // registered in that BatchedMesh, the sub-mesh's entity-local matrix, and a back-reference
  // to the original geometry (for consumers like subtract-mesh). Persisted on the group so
  // late-added members (addMemberToBatchedMeshes) fold in with the exact geometry / material /
  // local frame the reference member established here at build.
  const batchedMeshes = [];

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
    // Instance ids freed by removeMember (hidden, not deleted), available for reuse by a later
    // addMemberToBatchedMeshes before growing the buffer. See removeMember for why we hide
    // rather than deleteInstance.
    batched.userData.freeInstanceIds = [];
    const geometryIdByGeometry = new Map();
    const templateEntries = entries.map(({ geometry, localMatrix }) => {
      let geometryId = geometryIdByGeometry.get(geometry);
      if (geometryId === undefined) {
        geometryId = batched.addGeometry(geometry);
        geometryIdByGeometry.set(geometry, geometryId);
      }
      return { geometryId, localMatrix, geometry };
    });
    batchRootEl.setObject3D(object3DKey, batched);
    object3DKeys.push(object3DKey);
    batchedMeshes.push({ batchedMesh: batched, entries: templateEntries });
  }

  const group = {
    batchRootEl,
    object3DKeys,
    batchedMeshes,
    localBbox,
    members,
    key,
    keepAlive,
    ownsResources,
    activeMemberCount: members.length
  };

  // Seed every member's slots from the templates — the same path late-added members take.
  for (const el of members) {
    el.object3D.userData._batchSlots = el.object3D.userData._batchSlots || [];
    el.object3D.userData._batchLocalBbox = localBbox;
    addMemberToBatchedMeshes(group, el);
  }
  for (const { batchedMesh } of batchedMeshes) {
    batchedMesh.computeBoundsTree?.();
  }

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

// Arm batching for the scene about to be created, before any entity is minted. When batching is
// enabled, tells gltf-model to hold its GLB load so batchModels can group every [gltf-model] in
// the live DOM — including entities other components create during their own init — before
// deciding which duplicates to skip-load. _batchGroupingDone is the per-load gate batchModels
// flips (and emits "batch-grouping-done") once that decision is made. The per-src tally is reset
// for every new scene (batched or not): gltf-model.update bumps it as entities are created and
// batchModels reads it to decide cloning. batchModels then runs on the "newScene" event.
export function beginBatching(sceneEl, batchingEnabled) {
  sceneEl._batchingEnabled = batchingEnabled;
  sceneEl._batchGroupingDone = false;
  resetSrcLoadCounts();
  // Signal a new scene is loading. gltf-model listens to drop the PREVIOUS scene's clone
  // templates (its listener, added mid-scene, catches the next begin-batching). Emitted for
  // every scene load, batched or not, so cross-scene cleanup always happens.
  sceneEl.emit('begin-batching');
  // Open the grouping gate ourselves once this scene's entities are minted: createEntities
  // (our only caller) emits "newScene" when its pass finishes, and batchModels then groups
  // every [gltf-model]/[gltf-part] and releases the parked loads. Arming the gate-opener here
  // — rather than relying on the editor's onNewScene — keeps parked gltf-model loads from
  // hanging forever in an editor-free core bundle. Guarded so we only arm it when batching
  // is actually on (the park itself is gated on `_batchingEnabled`).
  if (batchingEnabled) {
    sceneEl.addEventListener('newScene', () => batchModels(sceneEl), {
      once: true
    });
  }
}

export async function batchModels(sceneEl) {
  if (!sceneEl) return [];
  const rootEl = document.getElementById('street-container');

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
        // It will parse after all — put it back in the per-src tally.
        adjustSrcLoadCount(comp.data, +1);
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
      // It will parse after all — put it back in the per-src tally.
      adjustSrcLoadCount(comp.data, +1);
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
    // Batch-slot release on removal is NOT done from a child-detached listener: it doesn't
    // reliably reach the scene (a managed-street teardown detaches the whole subtree, then
    // street-generated clearEntities removes the already-disconnected members, so their
    // child-detached never bubbles). Instead gltf-model / gltf-part call removeMember /
    // untrackLateUnbatched from their component remove(), which A-Frame fires during the
    // entity's own disconnectedCallback for any document-disconnection.
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

  // The initial batch pass is complete. gltf-model listens to drop this scene's clone templates
  // in runtime (the scene is final); the editor keeps them for the session.
  sceneEl.emit('initial-batching-done');

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
  trackLateUnbatched(el);
}

// Entities added AFTER the initial batch pass (editor clone / layer-reorder recreate them,
// or a component mints them post-load) come through onLateModelLoaded unbatched — each its
// own draw call and GPU upload. We tally these per batch key and, at the threshold, fold them
// into the matching group (or, for a not-yet-batched key, build a fresh group once a 2nd
// duplicate appears), so an editor session doesn't accumulate unbatched duplicates. The repack
// (a matrix refresh + setInstanceCount grow + N addInstance) measures only a few ms, so we fold
// eagerly at 1 — a pasted copy batches immediately. Raise it only to coalesce bursts if a scene
// ever spawns many post-load clones in a single tick.
const LATE_BATCH_THRESHOLD = 1;

// The batch key is stashed on object3D.userData so untrackLateUnbatched can find an entity's
// pending set at detach time — by then A-Frame's disconnectedCallback has already removed the
// entity's components (so getBatchKey/getBatchProvider would read nothing), but userData
// survives.
function trackLateUnbatched(el) {
  const key = getBatchKey(el);
  if (!key) return;
  // Only entities that could actually batch: a component outside BATCH_SAFE_COMPONENTS means
  // it must stay unbatched (same rule markDeferredLoads / processKeyGroup apply). This also
  // keeps a just-popped member (popMember added an unsafe component) from being re-folded.
  if (getBlockingComponents(el).length > 0) return;
  const sceneEl = el.sceneEl;
  if (!sceneEl) return;
  const map = sceneEl._lateUnbatched || (sceneEl._lateUnbatched = new Map());
  let set = map.get(key);
  if (!set) map.set(key, (set = new Set()));
  set.add(el);
  el.object3D.userData._lateUnbatchedKey = key;
  if (set.size >= LATE_BATCH_THRESHOLD) repackLateUnbatched(sceneEl, key);
}

function untrackLateUnbatched(sceneEl, el) {
  const key = el?.object3D?.userData?._lateUnbatchedKey;
  if (!key) return;
  delete el.object3D.userData._lateUnbatchedKey;
  const set = sceneEl?._lateUnbatched?.get(key);
  if (!set) return;
  set.delete(el);
  if (set.size === 0) sceneEl._lateUnbatched.delete(key);
}

function findBuiltGroup(sceneEl, key) {
  return sceneEl._batchModelsBuilt?.find((group) => group.key === key) || null;
}

// Fold the pending unbatched entities for `key` into a batch. If a group already exists it
// gains each candidate as a new member (reusing freed slots / growing capacity as needed);
// otherwise, with >= 2 candidates, a fresh group is built. Candidates that raced away
// (detached, already batched, lost their mesh, or grew an unsafe component) are dropped. The
// whole key's pending set is cleared afterward — folded members are now batched, and any
// dropped ones are gone or unbatchable; fresh duplicates start a new set.
function repackLateUnbatched(sceneEl, key) {
  const set = sceneEl._lateUnbatched?.get(key);
  if (!set) return;

  const candidates = [];
  for (const el of set) {
    if (
      !el.parentNode ||
      isBatched(el) ||
      !el.getObject3D('mesh') ||
      getBlockingComponents(el).length > 0
    ) {
      continue;
    }
    candidates.push(el);
  }

  const group = findBuiltGroup(sceneEl, key);
  // Need >= 2 to form a NEW group; if one already exists, even a single candidate folds in.
  const canBatch = candidates.length > 0 && (group || candidates.length >= 2);
  if (!canBatch) {
    // Nothing to do yet. Keep the set only if there are still-live candidates that might reach
    // the threshold later (e.g. 1 candidate, no existing group); otherwise drop the stale set.
    if (candidates.length === 0) sceneEl._lateUnbatched.delete(key);
    return;
  }

  // Matrices must be current before we read each member's world matrix (a backgrounded tab
  // throttles the render loop, staling matrixWorld).
  sceneEl.object3D.updateWorldMatrix(true, true);

  if (group) {
    for (const el of candidates) addLateMember(group, el);
    console.log(
      `[batch-models] late-batched ${candidates.length} into "${key}" (${group.activeMemberCount} members)`
    );
  } else {
    const built = batchGroup(getOrCreateBatchRoot(), key, candidates);
    if (built) {
      sceneEl._batchModelsBuilt = (sceneEl._batchModelsBuilt || []).concat(
        built
      );
      console.log(
        `[batch-models] late-built group "${key}" (${candidates.length} members)`
      );
    }
    // If batchGroup bailed (skinned/morph/multi-material), the candidates are unbatchable —
    // dropped below so we don't retry on every future add.
  }

  for (const el of candidates) delete el.object3D.userData._lateUnbatchedKey;
  sceneEl._lateUnbatched.delete(key);
}

// Add one already-loaded entity to an existing group: slot it into every BatchedMesh from the
// group's templates, mark it batched, and strip (or, for a runtime .clickable, hide) its now-
// redundant mesh — the same end state batchGroup leaves its members in, minus the model-loaded
// re-emit (this entity already fired model-loaded on its own load).
function addLateMember(group, el) {
  el.object3D.userData._batchSlots = el.object3D.userData._batchSlots || [];
  el.object3D.userData._batchLocalBbox = group.localBbox;
  el.object3D.userData._batchGroup = group;
  addMemberToBatchedMeshes(group, el);
  setStatus(el, true);
  const gltfComp = el.components['gltf-model'];
  if (gltfComp) gltfComp.deferLoad = false;
  if (!AFRAME.INSPECTOR && el.classList.contains('clickable')) {
    const mesh = el.getObject3D('mesh');
    if (mesh) mesh.visible = false;
  } else {
    getBatchProvider(el)?.strip();
  }
  group.members.push(el);
  group.activeMemberCount++;
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

// Release an entity from batching when it's removed. This is the single cleanup entry point
// (called from gltf-model / gltf-part remove()): if the entity is a built batch member, free its
// slots and, if it was the group's last member, tear down the BatchedMesh; otherwise it may be a
// not-yet-batched late candidate, so drop it from the tally. Each freed slot is hidden
// (setVisibleAt false) and its id pushed onto the group's freeInstanceIds pool, so a later
// addMemberToBatchedMeshes — e.g. a duplicate folded in by repackLateUnbatched — reuses that id
// instead of growing the buffer; repeated remove/add cycles reclaim slots rather than leak holes.
// We deliberately hide rather than deleteInstance: a deleted instanceId makes
// BatchedMesh.getVisibleAt / setMatrixAt and the three-mesh-bvh accelerated raycast throw
// "Invalid instanceId" mid-raycast. Also clears the raycast mapping so a removed/reparented
// entity no longer raycasts to a detached object3D.
export function removeMember(el) {
  if (!isBatched(el)) {
    untrackLateUnbatched(el?.sceneEl, el);
    return false;
  }
  const slots = el.object3D.userData._batchSlots;
  for (const { batchedMesh, instanceId } of slots) {
    batchedMesh.setVisibleAt(instanceId, false);
    if (batchedMesh.userData.batchIdToEl) {
      delete batchedMesh.userData.batchIdToEl[instanceId];
    }
    batchedMesh.userData.freeInstanceIds.push(instanceId);
  }
  const group = el.object3D.userData._batchGroup;
  delete el.object3D.userData._batchSlots;
  delete el.object3D.userData._batchStatus;
  delete el.object3D.userData._batchLocalBbox;
  delete el.object3D.userData._batchGroup;
  console.log(
    `[batch-models] removed ${describeEl(el)} (${slots.length} slot(s))`
  );
  if (group) {
    // Drop the detached entity from the members list so a group kept alive across many
    // late-add / remove cycles doesn't accumulate stale entity references.
    const idx = group.members.indexOf(el);
    if (idx >= 0) group.members.splice(idx, 1);
  }
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

// Internals exposed only for unit tests (test/components/batch-models.test.js); not part of
// the module's public API. Kept in one object so the named-export surface stays intentional.
export const _test = {
  addMemberToBatchedMeshes,
  ensureInstanceCapacity,
  trackLateUnbatched,
  untrackLateUnbatched,
  repackLateUnbatched,
  LATE_BATCH_THRESHOLD
};
