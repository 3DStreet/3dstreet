/* global THREE */
// The editor's per-frame window: work that must see this frame's final
// transforms and land before this frame is drawn.
//
// It runs in the main scene's onBeforeRender / onAfterRender. Inside
// renderer.render three first updates every matrixWorld (scene.updateMatrixWorld,
// which also lays out the gizmos in sceneHelpers), then calls
// scene.onBeforeRender, then builds the render lists and draws, then calls
// scene.onAfterRender. Every writer of the frame (component ticks, then system
// ticks such as a gizmo drag) has run by then, so work registered here reads
// current matrices without an extra matrix pass and without depending on system
// registration order. Anything a callback poses after the traversal must call
// that object's own updateMatrixWorld(true).
//
// Callbacks are isolated from each other and from the render: three requests the
// next animation frame only after the loop callback returns, so one exception
// escaping here would stop the editor's render loop for good.

const installed = new WeakMap();

/**
 * Where each piece of the groups code runs in the window (`register`'s
 * `order`; lower runs first). Each step reads what an earlier one wrote in the
 * same render.
 *
 * Before the render:
 * - `groupBounds`: re-measure the boxes of the groups that are drawn.
 * - `groupHelpers`: re-pose the selection and hover boxes of a group that
 *   moved or turned as a whole.
 * - `groupMarkers`: place the center markers at this frame's centers.
 * - `openGroupOutline`: pose the open group's outline and scrim around this
 *   frame's box.
 * - `outsideFade`: swap the faded materials in, last before drawing.
 *
 * After the render:
 * - `outsideFadeEnd`: swap the original materials back, before
 * - `openGroupEntry`: the step of opening a group that waits for the first
 *   render showing the outline.
 */
export const FRAME_ORDER = Object.freeze({
  groupBounds: 20,
  groupHelpers: 25,
  groupMarkers: 30,
  openGroupOutline: 40,
  outsideFade: 50,
  outsideFadeEnd: -10,
  openGroupEntry: 0
});

/**
 * `maxConsecutiveThrows` for a per-frame pass that catches per item: a throw
 * that still reaches the window this many frames running is a defect in the
 * pass itself, not in one item.
 */
export const PER_ITEM_PASS_MAX_THROWS = 5;

/**
 * Install the frame window on `sceneEl`'s scene once and return its registry.
 * Later calls return the same registry.
 */
export function installEditorFrame(sceneEl) {
  let frame = installed.get(sceneEl);
  if (!frame) {
    frame = new EditorFrame(sceneEl);
    installed.set(sceneEl, frame);
  }
  return frame;
}

function inspectorOpen() {
  return globalThis.AFRAME?.INSPECTOR?.opened === true;
}

const NO_FRAME_YET = Symbol('no frame yet');

class EditorFrame {
  constructor(sceneEl) {
    this.sceneEl = sceneEl;
    this.before = [];
    this.after = [];
    this.lastFrameTime = NO_FRAME_YET;
    this.renderIsFirstOfFrame = false;
    this.nextSeq = 0;
    // Reused for every call, so the window allocates nothing per frame.
    this.context = { camera: null, firstOfFrame: false };

    const scene = sceneEl.object3D;
    const defaults = THREE.Object3D.prototype;
    const previousBefore =
      scene.onBeforeRender !== defaults.onBeforeRender
        ? scene.onBeforeRender
        : null;
    const previousAfter =
      scene.onAfterRender !== defaults.onAfterRender
        ? scene.onAfterRender
        : null;
    if (previousBefore || previousAfter) {
      console.warn(
        '[editorFrame] the scene already had render hooks; they now run after the editor frame window.'
      );
    }

    const frame = this;
    scene.onBeforeRender = function (renderer, s, camera) {
      frame.runBefore(camera);
      previousBefore?.apply(this, arguments);
    };
    scene.onAfterRender = function (renderer, s, camera) {
      frame.runAfter(camera);
      previousAfter?.apply(this, arguments);
    };
  }

  /**
   * Register `callback(context)` for the render window. `context` is one
   * shared object: the render's `camera`, and `firstOfFrame`.
   *
   * - `phase`: 'before' (in onBeforeRender, before the render lists are built)
   *   or 'after' (in onAfterRender, once drawing is done).
   * - `order`: lower runs first; equal orders run in registration order.
   * - `everyRender`: run on every render rather than once per frame. A frame
   *   can render the scene more than once (a screenshot is a second render);
   *   once-per-frame work runs on the first render of each frame only.
   * - `maxConsecutiveThrows`: a callback that throws on this many consecutive
   *   calls is unregistered. The default of 1 suits one-shot work; a callback
   *   that catches per item and retries on the next frame may allow more.
   *
   * Returns a function that unregisters the callback.
   */
  register(
    callback,
    {
      phase = 'before',
      order = 0,
      everyRender = false,
      maxConsecutiveThrows = 1
    } = {}
  ) {
    const entry = {
      callback,
      order,
      seq: this.nextSeq++,
      everyRender,
      maxConsecutiveThrows,
      consecutiveThrows: 0,
      removed: false
    };
    const list = phase === 'after' ? 'after' : 'before';
    // Copy on write: a pass already iterating the old list is unaffected.
    this[list] = [...this[list], entry].sort(
      (a, b) => a.order - b.order || a.seq - b.seq
    );
    return () => this.unregister(entry, list);
  }

  unregister(entry, list) {
    if (entry.removed) return;
    entry.removed = true;
    this[list] = this[list].filter((e) => e !== entry);
  }

  runBefore(camera) {
    if (!inspectorOpen()) return;
    const time = this.sceneEl.time;
    // Without a clock every render counts as a new frame.
    const first = time === undefined || time !== this.lastFrameTime;
    this.lastFrameTime = time;
    this.renderIsFirstOfFrame = first;
    this.run('before', camera, first);
  }

  runAfter(camera) {
    if (!inspectorOpen()) return;
    this.run('after', camera, this.renderIsFirstOfFrame);
  }

  run(list, camera, firstOfFrame) {
    const context = this.context;
    context.camera = camera;
    context.firstOfFrame = firstOfFrame;
    const entries = this[list];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.removed || (!entry.everyRender && !firstOfFrame)) continue;
      try {
        entry.callback(context);
        entry.consecutiveThrows = 0;
      } catch (error) {
        entry.consecutiveThrows++;
        const giveUp = entry.consecutiveThrows >= entry.maxConsecutiveThrows;
        if (giveUp) this.unregister(entry, list);
        if (giveUp || entry.consecutiveThrows === 1) {
          console.error(
            giveUp
              ? '[editorFrame] a frame callback threw and was unregistered:'
              : '[editorFrame] a frame callback threw; it will be retried next frame:',
            error
          );
        }
      }
    }
  }
}
