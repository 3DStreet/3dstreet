/* global THREE */
// Fading part of a THREE.BatchedMesh: the instances of a batch that lie
// outside the open group are drawn faded, the ones inside it are not.
//
// Batching (batch-models.js) merges every copy of a model into one draw, so a
// batch can hold instances on both sides of the group, and members fold into
// an existing batch without an event. The split is therefore made per
// instance and per render, and only inside the editor's render window:
//
// - The batch itself (the "source") gets a custom sort for that render that
//   keeps only its inside instances when it is drawn for the window's camera.
//   For any other camera (the shadow pass) it keeps everything, so shadows
//   are unchanged.
// - A second BatchedMesh (the "view") is attached as the source's child for
//   that render. It draws the outside instances with a faded copy of the
//   batch material, from the source's own geometry and instance data.
//
// The view shares data through BatchedMesh fields that are private to three.js
// (the SHARED_FIELDS below), re-bound from the source at every render so it
// never relies on when three replaces them (growing a batch recreates its
// textures). They are checked at run time together with the three.js
// revision, and a batch they do not fit is left unfaded, with one warning.
// docs/groups.md describes the dependency.
//
// A view owns only its own indirect texture and draw arrays. It never calls
// BatchedMesh.dispose(), which would dispose the geometry and textures it
// borrows from the live source.

// The three.js revision the shared fields were written against.
export const SUPPORTED_THREE_REVISION = '184';

const SHARED_FIELDS = [
  '_instanceInfo',
  '_geometryInfo',
  '_geometryCount',
  '_geometryInitialized',
  '_matricesTexture',
  '_colorsTexture',
  '_maxInstanceCount'
];

function sortOpaque(a, b) {
  return a.z - b.z;
}

function sortTransparent(a, b) {
  return b.z - a.z;
}

function noRaycast() {}

/**
 * Fades batches per instance, for one render window at a time.
 *
 * `isOutside(el)` says whether an instance's entity is outside the open
 * group. `fadedMaterial(material)` returns the faded material to draw it
 * with.
 */
export class BatchFade {
  constructor({
    isOutside,
    fadedMaterial,
    threeRevision = THREE.REVISION
  } = {}) {
    this.isOutside = isOutside;
    this.fadedMaterial = fadedMaterial;
    this.supported = threeRevision === SUPPORTED_THREE_REVISION;
    this.warned = false;
    // source -> its view, kept across renders and changes of open group.
    this.views = new Map();
    // Batches left unfaded for the rest of the session: a view that threw.
    this.leftUnfaded = new WeakSet();
    // What this render window changed, undone by finish().
    this.attached = [];
    this.sorted = [];
    this.camera = null;

    const batchFade = this;
    // `this` is the batch being drawn (three calls customSort on it).
    this.keepInside = function (list, camera) {
      batchFade.filter(this, list, camera, false);
    };
    this.keepOutside = function (list, camera) {
      batchFade.filter(this, list, camera, true);
    };
  }

  warn(message) {
    if (this.warned) return;
    this.warned = true;
    console.warn(`[groups] ${message}; its outside instances stay unfaded.`);
  }

  /**
   * Whether `source` draws any instance outside the open group. Visible,
   * active instances only: a parked instance draws nothing.
   */
  hasOutsideInstance(source) {
    const info = source._instanceInfo;
    const els = source._batchIdToEl;
    for (let i = 0; i < info.length; i++) {
      const entry = info[i];
      if (entry.active && entry.visible && els[i] && this.isOutside(els[i])) {
        return true;
      }
    }
    return false;
  }

  // Would drawing `source`'s instance data fail? three indexes its geometry
  // list by each active instance's geometry index while it builds a draw
  // list, and a throw half-way would leave its shared render list dirty for
  // the next batch drawn in the same frame.
  valid(source) {
    const geometryCount = source._geometryInfo.length;
    const info = source._instanceInfo;
    for (let i = 0; i < info.length; i++) {
      const entry = info[i];
      if (entry.active && !(entry.geometryIndex < geometryCount)) return false;
    }
    return true;
  }

  supports(source) {
    if (!this.supported) {
      this.warn(
        `three.js r${THREE.REVISION} is not the revision batch fading was written for`
      );
      return false;
    }
    if (!Array.isArray(source._batchIdToEl)) return false;
    for (const field of SHARED_FIELDS) {
      if (!(field in source)) {
        this.warn(`a batch has no ${field}`);
        return false;
      }
    }
    return true;
  }

  /**
   * In the render window for `camera`: split `source` if it has instances
   * outside the open group. Returns true when it did.
   */
  prepare(source, camera) {
    if (this.leftUnfaded.has(source) || !this.supports(source)) return false;
    if (!this.hasOutsideInstance(source)) return false;
    if (!this.valid(source)) {
      this.warn('a batch has an instance with no geometry');
      return false;
    }
    const view = this.viewFor(source);
    if (!view) return false;
    this.camera = camera;

    source.customSort = this.keepInside;
    this.sorted.push(source);
    source.add(view);
    view.updateMatrixWorld(true);
    this.attached.push(view);
    return true;
  }

  // The source's view, re-bound to the source's current data (and rebuilt
  // when the source has grown past it).
  viewFor(source) {
    let view = this.views.get(source);
    if (view && view.maxInstanceCount < source.maxInstanceCount) {
      this.retireView(view);
      view = null;
    }
    if (!view) {
      view = new THREE.BatchedMesh(source.maxInstanceCount, 0, 0);
      // Only its own draw list is ever uploaded; the placeholders the
      // constructor made for the rest are replaced below.
      view._matricesTexture.dispose();
      view.name = 'group-scope-outside-view';
      view.raycast = noRaycast;
      view.castShadow = false;
      // It joins the scene after three's matrix update; its pose is copied.
      view.matrixAutoUpdate = false;
      view.frustumCulled = false;
      view.sortObjects = true;
      view.customSort = this.keepOutside;
      const batchFade = this;
      view.onBeforeRender = function () {
        try {
          THREE.BatchedMesh.prototype.onBeforeRender.apply(this, arguments);
        } catch (error) {
          // Thrown while three draws, outside any handler of ours: contain
          // it, and draw that batch unfaded from the next render on.
          batchFade.leftUnfaded.add(source);
          console.error('[groups] fading a batch failed:', error);
        }
      };
      this.views.set(source, view);
    }
    view.geometry = source.geometry;
    for (const field of SHARED_FIELDS) view[field] = source[field];
    view.material = this.fadedMaterial(source.material);
    view.perObjectFrustumCulled = source.perObjectFrustumCulled;
    view.receiveShadow = source.receiveShadow;
    view.renderOrder = source.renderOrder;
    view.layers.mask = source.layers.mask;
    // Relative to the source, which is its parent while attached.
    view.matrix.identity();
    return view;
  }

  // In a batch's draw: keep the instances on one side of the group, in the
  // order three would draw them. Anything but the window's camera (the
  // shadow pass) keeps the source's full list.
  filter(batch, list, camera, outside) {
    try {
      if (camera !== this.camera) {
        if (!outside) {
          list.sort(batch.material.transparent ? sortTransparent : sortOpaque);
        }
        return;
      }
      const source = outside ? batch.parent : batch;
      const els = source._batchIdToEl;
      let kept = 0;
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const el = els[item.index];
        if ((!!el && this.isOutside(el)) === outside) list[kept++] = item;
      }
      list.length = kept;
      list.sort(batch.material.transparent ? sortTransparent : sortOpaque);
    } catch (error) {
      // Leave the list as three built it rather than break the render.
      console.error('[groups] sorting a faded batch failed:', error);
    }
  }

  /** End of the render window: detach views and custom sorts. */
  finish() {
    for (const view of this.attached) view.removeFromParent();
    for (const source of this.sorted) {
      if (source.customSort === this.keepInside) source.customSort = null;
    }
    this.attached.length = 0;
    this.sorted.length = 0;
    this.camera = null;
  }

  retireView(view) {
    view.removeFromParent();
    view._indirectTexture.dispose();
    for (const [source, v] of this.views) {
      if (v === view) this.views.delete(source);
    }
  }

  /** Retire every view. */
  retireAll() {
    for (const view of [...this.views.values()]) this.retireView(view);
  }

  /** Retire the view of every batch `inScene(source)` rejects. */
  retireDetached(inScene) {
    for (const [source, view] of [...this.views]) {
      if (!inScene(source)) this.retireView(view);
    }
  }
}
