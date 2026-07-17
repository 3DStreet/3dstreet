/* global AFRAME, THREE, ImageBitmap */
import { disposeNode } from '../disposeUtils';
import { acquireSharedSource, sharedSourceKey } from '../sharedTextureSources';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import {
  noteSrcLoad,
  srcLoadCount,
  removeMember,
  BATCHING_ENABLED
} from '../batch-models';

// Share one decoded THREE.Source across textures (within and across GLBs) that embed the
// byte-identical image. The server bakes images[].extras.imageHash; GLTFLoader.loadImageSource
// surfaces image extras on texture.userData, and at that point the Texture has only just been
// created — it has NOT reached the renderer. Pointing texture.source at a scene-scoped canonical
// here means three.js uploads the image once and never sees a post-upload source swap (which is
// what triggered "glTexStorage2D: Texture is immutable" — re-uploading onto an already-immutable
// GL texture). This covers every texture that flows through loadImageSource — plain ImageBitmap,
// WebP/AVIF, and KTX2/Basis (GLTFTextureBasisUExtension routes through loadTextureImage →
// loadImageSource too; compressed sources have no ImageBitmap to close, but the Source — and thus
// the single GPU upload — is shared all the same).
//
// acquireSharedSource refcounts the canonical so its decoded ImageBitmap is closed only when the
// last referencing texture is disposed (release sites: disposeUtils, batch teardown, material
// swaps). The registry lives on sceneEl so it is scoped to the scene's lifetime.
class GLTFSharedTextureSourceExtension {
  constructor(parser, sceneEl, component) {
    this.parser = parser;
    this.name = 'shared_texture_source';
    const original = parser.loadImageSource.bind(parser);
    const json = parser.json;
    parser.loadImageSource = (sourceIndex, loader) =>
      original(sourceIndex, loader).then((texture) => {
        if (!sceneEl) return texture;
        // The registry key is the server imageHash when present (cross-GLB dedup), else a
        // per-Source synthetic key so a non-hashed ImageBitmap is still refcounted — otherwise a
        // clone sharing it (see cloneGltfScene) gets its bitmap closed out from under it by the
        // first disposal (sibling clone or the pristine template), washing it white. A synthetic
        // key is unique per Source, so it never takes the cross-GLB redirect branch below.
        const hash = sharedSourceKey(
          texture.source,
          json.images?.[sourceIndex]?.extras?.imageHash
        );
        if (!hash) return texture;
        const registry =
          sceneEl._sharedTextureSources ||
          (sceneEl._sharedTextureSources = new Map());
        const entityId = component?.el?.id;
        const entry = acquireSharedSource(registry, hash, texture.source);
        const canonical = entry.source;
        // Remember the hash on the canonical Source so the GLB clone cache can re-acquire it
        // (keeping the Source refcount balanced) when it clones this texture for a new instance.
        canonical._sharedSourceHash = hash;
        // entry.source === texture.source only when this call just created the entry.
        if (canonical === texture.source) {
          // First model to load this image: remember which entity/glb decoded the canonical Source
          // so a later reuse can report where it came from.
          entry.entityId = entityId;
          entry.src = component?.data;
        } else {
          // A previous glb already decoded this image: redirect to its canonical Source (one GPU
          // upload across both) and drop our own freshly-decoded copy. Safe to close now — this
          // texture has never been uploaded, so nothing references the discarded Source.
          // Only log genuine cross-entity reuse (same entity re-loading its own image is noise).
          if (entry.entityId !== entityId) {
            // hash is "<formatTag>:<sourceHash>" (see server glb-processing tagImageHashes).
            const [fmt, digest = ''] = hash.split(':');
            console.log(
              `[shared-texture] reuse image ${fmt} ${digest.slice(0, 8)} ` +
                `in #${entityId} (${component?.data}) ` +
                `from #${entry.entityId} (${entry.src}), now ${entry.refCount} texture(s)`
            );
          }
          const own = texture.source?.data;
          texture.source = canonical;
          if (
            own instanceof ImageBitmap &&
            !own._sharedSource &&
            !own._batchKeepAlive
          ) {
            own.close?.();
          }
        }
        return texture;
      });
  }
}

// Clone a parsed GLB scene for a new instance. Mirrors the original's resource-sharing
// topology (geometries/materials/textures shared across the same meshes as the parse) so
// disposal behaves identically to a fresh parse, while skipping the expensive work of
// re-parsing: no GLB download, no draco decode, no image decode, no accessor→geometry build.
// Each instance gets its own geometry (clone copies the already-decoded buffers), its own
// materials (so per-instance mutation is safe), and its own Texture objects that SHARE the
// canonical THREE.Source (one GPU upload, one decoded image), with acquireSharedSource
// bumping the Source refcount so disposal stays balanced.
function cloneGltfScene(scene, sceneEl) {
  let skinned = false;
  scene.traverse((n) => {
    if (n.isSkinnedMesh) skinned = true;
  });
  // SkeletonUtils.clone rebinds skeletons; plain clone(true) is enough otherwise.
  const root = skinned ? skeletonClone(scene) : scene.clone(true);

  const registry = sceneEl?._sharedTextureSources;
  const geomCache = new Map();
  const matCache = new Map();
  const texCache = new Map();
  const cloneTexture = (t) => {
    let ct = texCache.get(t);
    if (ct) return ct;
    ct = t.clone(); // shares .source with the canonical
    const hash = ct.source?._sharedSourceHash;
    if (hash && registry) acquireSharedSource(registry, hash, ct.source);
    texCache.set(t, ct);
    return ct;
  };
  const cloneMaterial = (m) => {
    let cm = matCache.get(m);
    if (cm) return cm;
    cm = m.clone(); // shares texture refs; replaced below with per-instance textures
    for (const prop in cm) {
      if (cm[prop]?.isTexture) cm[prop] = cloneTexture(m[prop]);
    }
    matCache.set(m, cm);
    return cm;
  };
  root.traverse((node) => {
    if (node.geometry) {
      let g = geomCache.get(node.geometry);
      if (!g) {
        g = node.geometry.clone();
        geomCache.set(node.geometry, g);
      }
      node.geometry = g;
    }
    if (node.material) {
      node.material = Array.isArray(node.material)
        ? node.material.map(cloneMaterial)
        : cloneMaterial(node.material);
    }
  });
  return root;
}

// Dispose the pristine clone templates (their geometry, and the Source refcounts they hold).
// Called from the batching-lifecycle listeners wired in the gltf-model init, not from any
// scene-load event — see there for when it fires in editor vs runtime.
function disposeGltfTemplates(sceneEl) {
  const cache = sceneEl._gltfSceneCache;
  if (!cache) return;
  for (const entry of cache.values()) entry.scene.traverse(disposeNode);
  cache.clear();
}

// Parse a GLB once per src and keep the pristine parsed scene as a clone template (cache +
// in-flight promise, both scene-scoped on sceneEl). Every instance — including the first —
// clones from this pristine template, so the template is never mutated: the per-instance
// material conversion in gltfLoaded runs on an independent copy. Templates are freed by
// disposeGltfTemplates (see the gltf-model init): dropped when the next scene starts batching,
// and in runtime also when the current batch pass finishes; the editor keeps them for the
// session so pastes / library drags clone without re-parsing.
function loadParsedGltf(loader, sceneEl, src, onProgress) {
  const cache =
    sceneEl._gltfSceneCache || (sceneEl._gltfSceneCache = new Map());
  if (cache.has(src)) return Promise.resolve(cache.get(src));
  const loading =
    sceneEl._gltfLoadingPromises || (sceneEl._gltfLoadingPromises = new Map());
  if (loading.has(src)) return loading.get(src);
  const promise = new Promise((resolve, reject) => {
    loader.load(
      src,
      (gltfModel) => {
        const entry = {
          scene: gltfModel.scene || gltfModel.scenes[0],
          animations: gltfModel.animations
        };
        cache.set(src, entry);
        loading.delete(src);
        resolve(entry);
      },
      onProgress,
      (err) => {
        loading.delete(src);
        reject(err);
      }
    );
  });
  loading.set(src, promise);
  return promise;
}

export const gltfModelPlus = {
  schema: { type: 'model' },

  init: function () {
    const self = this;
    const gltfSystem = this.el.sceneEl.systems['gltf-model'];
    const dracoLoader = gltfSystem.getDRACOLoader();
    const meshoptDecoder = gltfSystem.getMeshoptDecoder();
    const ktxLoader = gltfSystem.getKTX2Loader();
    this.model = null;
    this.loader = new THREE.GLTFLoader();
    // Set true by batchModels when this entity is a duplicate it owns as a batch slot:
    // loadModel() never runs for it (no download/parse), and batchModels releases it via
    // `el.components['gltf-model'].deferLoad = false; .update()` if the group turns out
    // unbatchable. See update() for how the initial defer decision is coordinated.
    this.deferLoad = false;
    // While a batching scene is loading, update() parks the load until batchModels emits
    // "batch-grouping-done"; this guards against registering that listener twice.
    this._batchPending = false;
    // Wire the clone-template cache disposal to the batching lifecycle (once per scene). Driven
    // by batch-models events rather than scene-load events so the behavior is consistent.
    // - begin-batching: fires when the NEXT scene starts (this listener is added during the
    //   current scene's createEntities, after its begin-batching already fired), so it drops the
    //   PREVIOUS scene's templates — editor and runtime alike.
    // - initial-batching-done: fires at the end of the current batch pass. In runtime the scene
    //   is final, so drop the templates now to free the parsed geometry; the editor keeps them so
    //   later clones (paste, library drag) skip the re-parse.
    const sceneEl = this.el.sceneEl;
    if (!sceneEl._gltfTemplateDisposalWired) {
      sceneEl._gltfTemplateDisposalWired = true;
      sceneEl.addEventListener('begin-batching', () =>
        disposeGltfTemplates(sceneEl)
      );
      sceneEl.addEventListener('initial-batching-done', () => {
        if (!AFRAME.INSPECTOR) disposeGltfTemplates(sceneEl);
      });
    }
    this.loader.register(
      (parser) =>
        new GLTFSharedTextureSourceExtension(parser, self.el.sceneEl, self)
    );
    if (dracoLoader) {
      this.loader.setDRACOLoader(dracoLoader);
    }
    if (meshoptDecoder) {
      this.ready = meshoptDecoder.then(function (meshoptDecoder) {
        self.loader.setMeshoptDecoder(meshoptDecoder);
      });
    } else {
      this.ready = Promise.resolve();
    }
    if (ktxLoader) {
      this.loader.setKTX2Loader(ktxLoader);
    }
  },

  update: function () {
    // batch-models marks duplicate-glb entities for deferred load. We skip the GLTFLoader
    // work here; batch-models either flips this.deferLoad and calls update() to release the
    // load or never (the entity remains a slot-only batch host).
    if (this.deferLoad) {
      return;
    }

    // Tally this entity against its src once, here at its first (non-deferred) update — before
    // the gated GLB loads — so a whole duplicate group is counted before any of it loads (see
    // noteSrcLoad / loadModel's clone decision).
    if (!this._srcCounted) {
      this._srcCounted = true;
      noteSrcLoad(this.data);
    }

    // When the scene will be batched, don't load yet: park until batchModels has grouped the
    // live DOM and decided which duplicates to defer. It waits for the DOM to settle, then
    // flips sceneEl._batchGroupingDone and emits "batch-grouping-done" — so the deferLoad we
    // read in finish() is final. Entities created after grouping (gate already done) fall
    // through and load immediately.
    const sceneEl = this.el.sceneEl;
    if (
      sceneEl._batchingEnabled &&
      !sceneEl._batchGroupingDone &&
      !this._batchPending
    ) {
      this._batchPending = true;
      const finish = () => {
        this._batchPending = false;
        if (this.deferLoad) return; // batchModels claimed us as a batch slot
        // entity removed while parked: a grandparent may be detached, so el.isConnected can
        // be false even when el.parentNode is still set
        if (this.el.isConnected === false) return;
        // component removed/replaced while parked (removeAttribute or a mixin swap): A-Frame
        // already ran this instance's remove() and detached it from el.components, so loading
        // now would attach an orphan mesh no remove path will ever dispose.
        if (this.el.components['gltf-model'] !== this) return;
        this.loadModel();
      };
      sceneEl.addEventListener('batch-grouping-done', finish, { once: true });
      return;
    }

    this.loadModel();
  },

  loadModel: function () {
    const self = this;
    const el = this.el;
    const src = this.data;

    this.remove();

    if (!src) {
      return;
    }

    // Cleared now, set true once the load settles (model-loaded or model-error). batchModels'
    // waitForModelLoaded reads it so a load that settled before it started listening (e.g. a
    // fast 403) doesn't hang Promise.all.
    this._loadSettled = false;

    this.ready.then(function () {
      self.el.emit('model-loading', { src });
      function gltfLoaded(gltfModel) {
        if (src !== self.data) {
          return;
        }
        el.emit('model-downloaded');
        self.model = gltfModel.scene || gltfModel.scenes[0];
        self.model.animations = gltfModel.animations;
        el.setObject3D('mesh', self.model);

        // Downgrade MeshPhysicalMaterial to MeshStandardMaterial for better performance.
        // Extensions like KHR_materials_specular cause the GLTFLoader to create
        // MeshPhysicalMaterial which is more expensive to render.
        const convertedMaterials = new Map();
        self.model.traverse((node) => {
          if (node.isMesh) {
            const materials = Array.isArray(node.material)
              ? node.material
              : [node.material];
            for (let i = 0; i < materials.length; i++) {
              const mat = materials[i];
              if (mat.isMeshBasicMaterial) continue;
              if (!mat.isMeshPhysicalMaterial) continue;
              let newMat = convertedMaterials.get(mat);
              if (!newMat) {
                newMat = new THREE.MeshStandardMaterial();
                newMat.copy(mat);
                mat.dispose();
                convertedMaterials.set(mat, newMat);
              }
              if (Array.isArray(node.material)) {
                node.material[i] = newMat;
              } else {
                node.material = newMat;
              }
            }
          }
        });

        convertedMaterials.clear();

        self._loadSettled = true;
        el.emit('model-loaded', { format: 'gltf', model: self.model });
      }
      function onProgress(evt) {
        el.emit('progress', { originalEvent: evt });
      }
      function gltfFailed(error) {
        el.emit('model-downloaded');
        console.error(error, src);
        const message =
          error && error.message ? error.message : 'Failed to load glTF model';
        console.warn(message);
        self._loadSettled = true;
        el.emit('model-error', { format: 'gltf', src: src });
      }
      // The 2nd+ loader of a src clones a pristine template parsed once by loadParsedGltf
      // instead of re-parsing (skips re-download, draco/image decode and accessor→geometry
      // build). The first loader parses the GLB directly.
      const cacheOn = !globalThis.__gltfCacheDisabled;
      if (cacheOn && srcLoadCount(src) >= 2) {
        loadParsedGltf(self.loader, el.sceneEl, src, onProgress)
          .then((entry) => {
            if (src !== self.data) return;
            const scene = cloneGltfScene(entry.scene, el.sceneEl);
            gltfLoaded({
              scene,
              scenes: [scene],
              animations: entry.animations
            });
          })
          .catch(gltfFailed);
      } else {
        self.loader.load(src, gltfLoaded, onProgress, gltfFailed);
      }
    });
  },

  remove: function () {
    // A pending batch park (if any) is harmless: its "batch-grouping-done" handler is
    // {once} and bails on the ownership / isConnected checks (removeAttribute detaches this
    // instance from el.components, entity detach flips isConnected), so nothing to clean up here.
    //
    // batch-models' removal cleanup runs HERE, not from a child-detached listener. A-Frame
    // calls component.remove() during the entity's disconnectedCallback for ANY document-
    // disconnection — including every descendant of a removed subtree — whereas child-detached
    // doesn't reliably reach the scene (a managed-street teardown detaches the whole subtree,
    // then street-generated clearEntities removes the already-disconnected members, so their
    // child-detached never bubbles). removeMember frees a built member's slot or drops a pending
    // late-batch candidate from the tally. Without this a batched instance stays visible and its
    // now-parentless object3D crashes the editor's hover box.
    //
    // removeMesh() runs BEFORE removeMember(): on last-member teardown removeMember clears the
    // _batchKeepAlive tags and releases the reference member's shared texture Sources. Doing it
    // first would leave disposeNode's guards no longer firing, so removeMesh() would release the
    // same Sources a second time. With this order a kept mesh (runtime .clickable reference
    // member) still carries the tags when disposeNode walks it, so its shared Sources are spared
    // and released exactly once by teardown.
    this.removeMesh();
    removeMember(this.el);
  },

  removeMesh: function () {
    if (!this.model) return;
    this.el.removeObject3D('mesh');
    this.model.traverse(disposeNode);
    this.model = null;
  }
};

// Static feature gate: swap in the defer-and-clone component at registration time.
if (BATCHING_ENABLED) {
  delete AFRAME.components['gltf-model'];
  AFRAME.registerComponent('gltf-model', gltfModelPlus);
}
