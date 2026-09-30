// While a group is open for editing, everything outside it is drawn at a fifth
// of its own opacity, so the group reads as the thing being worked on. Its
// members, and the editor's own helpers, are drawn normally.
//
// Nothing about the scene is changed to do this:
//
// - Ordinary meshes are drawn with a faded copy of their material, swapped in
//   for the main render only (inside the editor's render window) and swapped
//   back as soon as it is drawn. Anything reading a material outside that
//   window (batching, exporters, the serializer) sees the original. The copy
//   is found from the material the mesh holds at that moment, so a material
//   replaced or given a texture later is picked up on the next frame.
// - Batches holding instances on both sides of the group are split per
//   instance for that render (attenuateBatches.js).
// - The reference map layers fade through their own opacity path, by a
//   presentation factor (tested/reference-layer-presentation.js), because
//   their tile materials must keep their identity for tile fading.
// - Gaussian splats fade through their own opacity.
//
// Content that arrives while the group is open is classified as it arrives,
// before it is first drawn. Captures and exports run with the original
// appearance: see withOriginalAppearanceSync and withOriginalAppearance.
// Visibility is never touched, so hidden content stays hidden.

import { BatchAttenuation } from './attenuateBatches.js';
import { setPresentationFactor } from '../../../tested/reference-layer-presentation.js';
import { debugLog } from '../../../shared/utils/debug.js';

/** Opacity of content outside the open group, relative to its own. */
export const OUTSIDE_OPACITY = 0.2;

// The scene content that can be outside a group. Editor helpers live
// elsewhere (the helper scene), and are left at full strength.
const CONTENT_ROOT_IDS = [
  'street-container',
  'reference-layers',
  'environment'
];
// Faded only through their own opacity, never per mesh.
const MAP_LAYERS = ['google-maps-aerial', 'tiled-basemap', 'osm-buildings'];
// Scene changes that can bring new content, and ones that can take it away.
const ARRIVALS = ['object3dset', 'child-attached', 'model-loaded'];
const REMOVALS = ['object3dremove', 'child-detached'];

function isMapLayer(el) {
  return MAP_LAYERS.some(
    (name) => el.components?.[name] || el.hasAttribute?.(name)
  );
}

function isDrawable(node) {
  return !!(
    node.material &&
    (node.isMesh || node.isLine || node.isPoints || node.isSprite)
  );
}

function isSplatMesh(node) {
  return !!node.el && node.el.components?.splat?.splatMesh === node;
}

// A shader that draws its own colour ignores a material's opacity, so it
// can only be faded if it reads an opacity uniform.
function canFade(material) {
  return !material.isShaderMaterial || !!material.uniforms?.opacity;
}

// The editor's one attenuation, for the capture and export wrappers below.
let installed = null;

/**
 * Run `fn` with the scene in its original appearance and return its value:
 * for a synchronous render that is read back (a screenshot). Nestable.
 */
export function withOriginalAppearanceSync(fn) {
  const attenuation = installed;
  if (!attenuation) return fn();
  attenuation.suspend();
  try {
    return fn();
  } finally {
    attenuation.resume();
  }
}

/**
 * Await `fn` with the scene in its original appearance: for an export, which
 * reads materials across awaits. Nestable, and safe to overlap: the scene is
 * faded again once the last one finishes, if a group is still open then.
 */
export async function withOriginalAppearance(fn) {
  const attenuation = installed;
  if (!attenuation) return fn();
  attenuation.suspend();
  try {
    return await fn();
  } finally {
    attenuation.resume();
  }
}

export class ScopeAttenuation {
  /**
   * `editorFrame` is the editor's render window; `onFirstAttenuatedFrame
   * (generation)` is called at the end of the first render drawn faded after
   * each apply().
   */
  constructor({ sceneEl, editorFrame, onFirstAttenuatedFrame = () => {} }) {
    this.sceneEl = sceneEl;
    this.editorFrame = editorFrame;
    this.onFirstAttenuatedFrame = onFirstAttenuatedFrame;

    this.enabled = false;
    // Set when a render window failed: isolation goes on unfaded.
    this.broken = false;
    this.suspendDepth = 0;
    this.scopeEl = null;
    this.scopeId = null;
    this.generation = null;
    this.firstFramePending = false;

    // What is outside the open group.
    this.meshes = new Set();
    this.batches = new Set();
    this.splats = new Set();
    this.needsPrune = false;
    // Splats faded now: splat -> { original, applied }.
    this.fadedSplats = new Map();
    // Per-entity inside/outside answers for batch instances, per scope.
    this.outsideByEl = new WeakMap();

    // Faded copies, kept across scopes so reopening compiles nothing new:
    // original material -> record, and material array -> array of copies.
    this.fadedByMaterial = new WeakMap();
    this.fadedByArray = new WeakMap();
    this.fadedRecords = new Set();
    this.unfadeable = new WeakSet();

    // The render window's swaps, undone at its end: mesh, original, ...
    this.swapped = [];
    this.windowFaded = false;

    this.batchAttenuation = new BatchAttenuation({
      isOutside: (el) => this.isOutside(el),
      fadedMaterial: (material) => this.fadedMaterial(material)
    });

    this.unregister = [];
    this.onArrival = (event) => this.arrived(event);
    this.onRemoval = () => {
      this.needsPrune = true;
    };
    this.onNewScene = () => this.newScene();
    sceneEl.addEventListener('newScene', this.onNewScene);
    installed = this;
  }

  dispose() {
    this.restore();
    this.sceneEl.removeEventListener('newScene', this.onNewScene);
    this.releaseCopies();
    if (installed === this) installed = null;
  }

  // ---------------------------------------------------------- scope changes

  /** Fade everything outside `groupEl`. */
  apply(groupEl, generation) {
    this.restore();
    if (this.broken || !groupEl?.isConnected) return;
    this.enabled = true;
    this.generation = generation;
    this.scopeId = groupEl.id;
    this.classifyAll(groupEl);
    this.listen();
    this.firstFramePending = true;
    if (!this.suspendDepth) this.present();
    debugLog(
      '[groups] fading outside the open group:',
      this.meshes.size,
      'meshes,',
      this.batches.size,
      'batches,',
      this.splats.size,
      'splats'
    );
  }

  /**
   * Fade everything outside `groupEl` instead of the group faded now, in one
   * step: nothing outside either is drawn unfaded in between, and the map
   * layers and the splats outside both are left as they are. Splats inside
   * `groupEl` get their own opacity back. With nothing faded now, as apply().
   */
  switchTo(groupEl, generation) {
    if (!this.enabled || !groupEl?.isConnected) {
      this.apply(groupEl, generation);
      return;
    }
    this.revertWindow();
    this.generation = generation;
    this.scopeId = groupEl.id;
    // Fades the splats outside groupEl that are not faded yet.
    this.classifyAll(groupEl);
    for (const [splat, record] of this.fadedSplats) {
      if (this.splats.has(splat)) continue;
      if (splat.opacity === record.applied) splat.opacity = record.original;
      this.fadedSplats.delete(splat);
    }
    this.firstFramePending = true;
  }

  /** Put everything back as it was. Faded copies are kept for reuse. */
  restore() {
    this.revertWindow();
    if (!this.enabled) return;
    this.enabled = false;
    this.firstFramePending = false;
    this.unlisten();
    this.unpresent();
    this.forget();
    this.scopeEl = null;
    this.scopeId = null;
  }

  forget() {
    this.meshes.clear();
    this.batches.clear();
    this.splats.clear();
    this.outsideByEl = new WeakMap();
    this.needsPrune = false;
  }

  newScene() {
    this.restore();
    this.releaseCopies();
  }

  releaseCopies() {
    for (const record of [...this.fadedRecords]) record.release();
    this.fadedByArray = new WeakMap();
    this.batchAttenuation.retireDetached();
  }

  // Frame callbacks and scene listeners exist only while a group is faded,
  // so with no group open this costs nothing per frame.
  listen() {
    const frame = this.editorFrame;
    this.unregister.push(
      frame.register((context) => this.fadeWindow(context), {
        order: 50,
        everyRender: true
      }),
      // Before the entry schedule's own after-render step (order 0).
      frame.register(() => this.endWindow(), {
        phase: 'after',
        order: -10,
        everyRender: true
      })
    );
    for (const type of ARRIVALS) {
      this.sceneEl.addEventListener(type, this.onArrival);
    }
    for (const type of REMOVALS) {
      this.sceneEl.addEventListener(type, this.onRemoval);
    }
  }

  unlisten() {
    this.unregister.forEach((undo) => undo());
    this.unregister = [];
    for (const type of ARRIVALS) {
      this.sceneEl.removeEventListener(type, this.onArrival);
    }
    for (const type of REMOVALS) {
      this.sceneEl.removeEventListener(type, this.onRemoval);
    }
  }

  // ------------------------------------------------------ captures, exports

  suspend() {
    if (this.suspendDepth++ > 0) return;
    this.revertWindow();
    if (this.enabled) this.unpresent();
  }

  resume() {
    if (--this.suspendDepth > 0) return;
    // From the state now, not the state at suspend: the group may have
    // closed (or another opened) meanwhile.
    if (this.enabled) this.present();
  }

  // The fades that are not per render: map layers and splats.
  present() {
    setPresentationFactor(OUTSIDE_OPACITY);
    for (const splat of this.splats) this.fadeSplat(splat);
  }

  unpresent() {
    setPresentationFactor(1);
    for (const [splat, record] of this.fadedSplats) {
      // Unless something else has set it since.
      if (splat.opacity === record.applied) splat.opacity = record.original;
    }
    this.fadedSplats.clear();
  }

  fadeSplat(splat) {
    if (this.fadedSplats.has(splat)) return;
    const original = splat.opacity;
    const applied = original * OUTSIDE_OPACITY;
    splat.opacity = applied;
    this.fadedSplats.set(splat, { original, applied });
  }

  // ---------------------------------------------------------- classifying

  /** Is `el`, a batched entity, outside the open group? */
  isOutside(el) {
    let outside = this.outsideByEl.get(el);
    if (outside === undefined) {
      outside = !!this.scopeEl && !this.scopeEl.contains(el);
      this.outsideByEl.set(el, outside);
    }
    return outside;
  }

  classifyAll(groupEl) {
    this.forget();
    this.scopeEl = groupEl;
    for (const id of CONTENT_ROOT_IDS) {
      const root = document.getElementById(id);
      if (root?.object3D && !isMapLayer(root)) this.classify(root.object3D);
    }
  }

  // Record what is drawn under `object`, which is outside the open group,
  // skipping the group itself and the map layers.
  classify(object) {
    const scopeObject = this.scopeEl.object3D;
    const stack = [object];
    while (stack.length) {
      const node = stack.pop();
      if (node === scopeObject) continue;
      if (node.userData?.source === 'INSPECTOR') continue;
      if (node.el?.object3D === node && isMapLayer(node.el)) continue;
      if (isSplatMesh(node)) {
        this.splats.add(node);
        if (this.enabled && !this.suspendDepth) this.fadeSplat(node);
        continue;
      }
      if (node.isBatchedMesh && Array.isArray(node._batchIdToEl)) {
        this.batches.add(node);
      } else if (isDrawable(node)) {
        this.meshes.add(node);
      }
      for (let i = 0; i < node.children.length; i++) {
        stack.push(node.children[i]);
      }
    }
  }

  // New content: classify it now, before it is first drawn.
  arrived(event) {
    const scopeEl = this.scopeId
      ? document.getElementById(this.scopeId)
      : this.scopeEl;
    // The open group is being moved (it is recreated with the same id).
    if (!scopeEl) return;
    if (scopeEl !== this.scopeEl) {
      this.unpresent();
      this.classifyAll(scopeEl);
      if (!this.suspendDepth) this.present();
      return;
    }
    const el =
      event.type === 'child-attached' ? event.detail?.el : event.target;
    if (el?.object3D && this.isContentOutside(el)) this.classify(el.object3D);
  }

  // Is `el` scene content outside the open group and not in a map layer?
  isContentOutside(el) {
    for (let node = el; node && node !== this.sceneEl; node = node.parentNode) {
      if (node === this.scopeEl || isMapLayer(node)) return false;
      if (CONTENT_ROOT_IDS.includes(node.id)) return true;
    }
    return false;
  }

  // Drop what has left the scene.
  prune() {
    this.needsPrune = false;
    const scene = this.sceneEl.object3D;
    const inScene = (object) => {
      let node = object;
      while (node.parent) node = node.parent;
      return node === scene;
    };
    for (const set of [this.meshes, this.batches, this.splats]) {
      for (const object of set) if (!inScene(object)) set.delete(object);
    }
    this.batchAttenuation.retireDetached(inScene);
  }

  // ------------------------------------------------------ faded materials

  /** The faded copy of `material` (or of each material in an array). */
  fadedMaterial(material) {
    if (Array.isArray(material)) return this.fadedArray(material);
    return this.fadedSingle(material);
  }

  fadedArray(materials) {
    let copies = this.fadedByArray.get(materials);
    if (!copies || copies.length !== materials.length) {
      copies = new Array(materials.length);
      this.fadedByArray.set(materials, copies);
    }
    for (let i = 0; i < materials.length; i++) {
      copies[i] = this.fadedSingle(materials[i]);
    }
    return copies;
  }

  fadedSingle(original) {
    if (!canFade(original)) {
      if (!this.unfadeable.has(original)) {
        this.unfadeable.add(original);
        debugLog('[groups] left unfaded, a shader with no opacity:', original);
      }
      return original;
    }
    let record = this.fadedByMaterial.get(original);
    if (!record) record = this.copyMaterial(original);
    const copy = record.copy;
    // The original was changed (a texture loaded, a define set): copy again.
    if (record.version !== original.version || record.map !== original.map) {
      copy.copy(original);
      this.prepareCopy(copy, original);
      record.version = original.version;
      record.map = original.map;
    }
    // Values three changes without a new version, which components animate.
    if (original.color) copy.color.copy(original.color);
    if (original.emissive) copy.emissive.copy(original.emissive);
    copy.opacity = original.opacity * OUTSIDE_OPACITY;
    // Keep cutouts' holes: their alpha test is scaled with their opacity.
    copy.alphaTest = original.alphaTest * OUTSIDE_OPACITY;
    if (original.isShaderMaterial) {
      copy.uniforms.opacity.value =
        original.uniforms.opacity.value * OUTSIDE_OPACITY;
    }
    return copy;
  }

  copyMaterial(original) {
    const copy = original.clone();
    this.prepareCopy(copy, original);
    const record = {
      copy,
      version: original.version,
      map: original.map,
      release: () => {
        original.removeEventListener('dispose', record.release);
        this.fadedByMaterial.delete(original);
        this.fadedRecords.delete(record);
        copy.dispose();
      }
    };
    // A copy lives as long as its original.
    original.addEventListener('dispose', record.release);
    this.fadedByMaterial.set(original, record);
    this.fadedRecords.add(record);
    return record;
  }

  prepareCopy(copy, original) {
    // Shader hooks are not copied by three; the copy must draw the same way
    // (they may share uniforms with the original, such as a wind clock).
    copy.onBeforeCompile = original.onBeforeCompile;
    copy.customProgramCacheKey = original.customProgramCacheKey;
    copy.transparent = true;
    // A faded surface must not hide what lies behind it.
    copy.depthWrite = false;
    copy.needsUpdate = true;
  }

  // ---------------------------------------------------------- render window

  // Start of a render: swap faded copies in. Every swap made is undone if
  // anything throws, and fading stops for the session; the group stays open.
  fadeWindow(context) {
    // A render that never reached its end left its swaps in place.
    this.revertWindow();
    if (!this.enabled || this.suspendDepth) return;
    if (this.needsPrune) this.prune();
    try {
      for (const mesh of this.meshes) {
        const original = mesh.material;
        if (!original) continue;
        const faded = this.fadedMaterial(original);
        if (faded === original) continue;
        this.swapped.push(mesh, original);
        mesh.material = faded;
      }
      for (const source of this.batches) {
        this.batchAttenuation.prepare(source, context.camera);
      }
    } catch (error) {
      this.revertWindow();
      this.fail();
      throw error;
    }
    this.windowFaded = true;
  }

  // End of a render: swap the originals back.
  endWindow() {
    const faded = this.windowFaded;
    this.revertWindow();
    if (faded && this.firstFramePending) {
      this.firstFramePending = false;
      this.onFirstAttenuatedFrame(this.generation);
    }
  }

  revertWindow() {
    const swapped = this.swapped;
    for (let i = swapped.length - 2; i >= 0; i -= 2) {
      swapped[i].material = swapped[i + 1];
    }
    swapped.length = 0;
    this.batchAttenuation.finish();
    this.windowFaded = false;
  }

  // The editor frame reports the error and drops the window callback.
  fail() {
    this.restore();
    this.broken = true;
  }
}
