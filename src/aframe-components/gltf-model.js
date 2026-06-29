/* global AFRAME, THREE, ImageBitmap */
import { disposeNode } from '../disposeUtils';
import { acquireSharedSource } from '../sharedTextureSources';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { noteSrcLoad, srcLoadCount } from '../batch-models';

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
        const hash = json.images?.[sourceIndex]?.extras?.imageHash;
        if (!hash || !sceneEl) return texture;
        const registry =
          sceneEl._sharedTextureSources ||
          (sceneEl._sharedTextureSources = new Map());
        const entityId = component?.el?.id;
        const canonical = acquireSharedSource(registry, hash, texture.source);
        const entry = registry.get(hash);
        // Remember the hash on the canonical Source so the GLB clone cache can re-acquire it
        // (keeping the Source refcount balanced) when it clones this texture for a new instance.
        canonical._sharedSourceHash = hash;
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

// Parse a GLB once per src and keep the pristine parsed scene as a clone template (cache +
// in-flight promise, both scene-scoped on sceneEl). Every instance — including the first —
// clones from this pristine template, so the template is never mutated: the per-instance
// material conversion in gltfLoaded runs on an independent copy. Templates are disposed on
// the next "newScene" (clones own their own copies / hold their own Source refcounts).
function loadParsedGltf(loader, sceneEl, src, onProgress) {
  let cache = sceneEl._gltfSceneCache;
  if (!cache) {
    cache = sceneEl._gltfSceneCache = new Map();
    // Registered after the current scene's newScene already fired (this runs from a model
    // load, after batchModels' gate), so it disposes this scene's templates when the NEXT
    // scene loads, then the cache repopulates for that scene.
    sceneEl.addEventListener('newScene', () => {
      for (const entry of cache.values()) entry.scene.traverse(disposeNode);
      cache.clear();
    });
  }
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

    // Drop the current mesh before (re)loading.
    this.removeMesh();

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
        const usePhong = false; // set to true to convert all materials to MeshPhongMaterial
        const convertedMaterials = new Map();
        self.model.traverse((node) => {
          if (node.isMesh) {
            const materials = Array.isArray(node.material)
              ? node.material
              : [node.material];
            for (let i = 0; i < materials.length; i++) {
              const mat = materials[i];
              if (mat.isMeshBasicMaterial) continue;
              if (usePhong) {
                if (!mat.isMeshStandardMaterial) continue; // catches both Standard and Physical
              } else {
                if (!mat.isMeshPhysicalMaterial) continue;
              }
              let newMat = convertedMaterials.get(mat);
              if (!newMat) {
                if (usePhong) {
                  newMat = new THREE.MeshPhongMaterial();
                  // Base material properties (name, opacity, side, etc.) via manual copy
                  // since MeshPhongMaterial.copy() expects a Phong source
                  newMat.name = mat.name;
                  newMat.color.copy(mat.color);
                  newMat.map = mat.map;
                  newMat.lightMap = mat.lightMap;
                  newMat.lightMapIntensity = mat.lightMapIntensity;
                  newMat.aoMap = mat.aoMap;
                  newMat.aoMapIntensity = mat.aoMapIntensity;
                  newMat.emissive.copy(mat.emissive);
                  newMat.emissiveIntensity = mat.emissiveIntensity;
                  newMat.emissiveMap = mat.emissiveMap;
                  newMat.bumpMap = mat.bumpMap;
                  newMat.bumpScale = mat.bumpScale;
                  newMat.normalMap = mat.normalMap;
                  newMat.normalMapType = mat.normalMapType;
                  newMat.normalScale.copy(mat.normalScale);
                  newMat.displacementMap = mat.displacementMap;
                  newMat.displacementScale = mat.displacementScale;
                  newMat.displacementBias = mat.displacementBias;
                  newMat.alphaMap = mat.alphaMap;
                  newMat.envMap = mat.envMap;
                  if (mat.envMapRotation) {
                    newMat.envMapRotation.copy(mat.envMapRotation);
                  }
                  newMat.envMapIntensity = mat.envMapIntensity ?? 1;
                  newMat.wireframe = mat.wireframe ?? false;
                  newMat.flatShading = mat.flatShading ?? false;
                  newMat.fog = mat.fog ?? true;
                  // Inherited from Material base
                  newMat.opacity = mat.opacity;
                  newMat.transparent = mat.transparent;
                  newMat.side = mat.side;
                  newMat.shadowSide = mat.shadowSide;
                  newMat.alphaTest = mat.alphaTest;
                  newMat.visible = mat.visible;
                  newMat.depthTest = mat.depthTest;
                  newMat.depthWrite = mat.depthWrite;
                  // Convert roughness to shininess (rough=0 → shiny=100, rough=1 → shiny=0)
                  if (mat.roughness !== undefined) {
                    newMat.shininess = (1 - mat.roughness) * 100;
                  }
                } else {
                  newMat = new THREE.MeshStandardMaterial();
                  newMat.copy(mat);
                }
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
    // {once} and bails on the isConnected check, so nothing to clean up here.
    this.removeMesh();
  },

  removeMesh: function () {
    if (!this.model) return;
    this.el.removeObject3D('mesh');
    this.model.traverse(disposeNode);
    this.model = null;
  }
};

delete AFRAME.components['gltf-model'];
AFRAME.registerComponent('gltf-model', gltfModelPlus);
