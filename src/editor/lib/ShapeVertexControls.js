/* global AFRAME, THREE */

import Events from './Events';
import {
  MIDPOINT_RADIUS_RATIO,
  clampHandleRadius,
  decidePress,
  hitTestHandles,
  metresPerPixel
} from './shapeEditRules.js';

/**
 * ShapeVertexControls — direct manipulation handles for a shape's vertices.
 *
 * WHAT IT IS. One handle per vertex of the selected shape, plus (later) a ghost
 * handle on each edge midpoint. Handles are screen-constant, live in
 * `sceneHelpers`, and are attached and detached from the editor's selection.
 *
 * WHY IT IS AN Object3D. Two things come from the base class and neither has a
 * good substitute. First, `viewport.js` freezes the camera by subscribing to
 * `mouseDown`/`mouseUp` on a controls INSTANCE — these are EventDispatcher
 * events, not DOM events, so a plain class dispatching on the canvas would
 * reach zero listeners and the camera would orbit under a claimed drag (on
 * touch that flip is the only orbit defence there is). Second,
 * `updateMatrixWorld(force)` is the codebase's own per-frame hook for a
 * screen-constant helper — the transform gizmo sizes itself there — and using
 * it deletes a standalone animation loop along with the frame-ordering bug such
 * a loop has against the render traversal. MeasureLineControls is the in-repo
 * precedent for both.
 *
 * FRAME BINDING. The object carries the shape's world matrix rather than being
 * parented to the shape entity. Handle positions are then literally the vertex
 * data, in the shape's own frame; and the selection box — which is sized from
 * the shape's whole subtree — is not blown out by screen-constant handles that
 * grow as you zoom away.
 *
 * INVARIANTS. Two, and both have cost real defects when they were broken:
 *
 *   1. `abortGesture()` NEVER executes a history command. It is called from
 *      every cancel path, including from inside a selection change fired by
 *      another command's execute(), so a command here re-enters History from
 *      within History. The commit lives on the pointerup release path alone.
 *   2. ALL gesture state is cleared BEFORE any command runs. History emits
 *      `historychanged` synchronously from execute(), so any consumer reacting
 *      to it runs inside our own execute() call; clearing first is what makes a
 *      commit unable to be undone by its own side effects.
 *
 * And one non-subscription that is load-bearing: this layer subscribes to NO
 * history event. `historychanged` fires on execute() exactly as it does on
 * undo(), with no discriminator, so a handler that aborted on it would revert
 * every commit the moment it was made.
 *
 * STATE AND LIFETIMES. Every field below is bounded by attach()/detach().
 * `AFRAME.INSPECTOR.opened` is NOT a lifetime — it gates the handlers that ARM
 * something (press, hover, delete) and never the handlers that TEAR DOWN, since
 * closing the editor emits nothing and deselects nothing, so a gated teardown
 * handler would strand a gesture in flight rather than end it.
 *
 *   this.shapeEl        the arm switch for the per-frame hook; last thing
 *                       attach() sets, first thing detach() clears
 *   handle pool         built at attach, torn down at detach, resized in place
 *                       on a structural change so hover/active styling survives
 *   vertexEls           the ordered vertex elements; re-read on a STRUCTURAL
 *                       change only — never on `shape-geometry-changed`, which
 *                       fires on every frame of a drag
 *   claimed             set when a press is taken; abortGesture() is its only
 *                       clear
 *   _pressWasClaimed    a latch outliving `claimed` across the up-sequence,
 *                       read by the click/dblclick suppression and nothing else
 *   pressGeneration     bumped on EVERY pointerdown the window capture sees
 *   lastRecordedPressId stamped only on a press we actually recorded; the two
 *                       differ exactly when the last press was not ours
 *   _prevMatrixWorld    seeded at attach, so the first frame does not read a
 *                       spurious whole-shape move against an identity matrix
 */

// Handles draw above the shape's x-ray overlay and its readout arcs (both 999)
// and below the transform gizmo (Infinity, which is the ceiling — nothing can
// be drawn above it, so in the small region where a handle and a gizmo arrow
// overlap the arrow is drawn on top of the handle that would win the press).
const HANDLE_RENDER_ORDER = 1000;

const COLOR_NORMAL = '#1faaf2'; // the selection-box blue: reads as "editor affordance"
const COLOR_HOVER = '#7fd4ff';
const MIDPOINT_OPACITY = 0.45;

// The invalid signal's second channel: the x-ray overlay's opacity oscillates,
// so the state reads by MOTION and survives on a shape whose own colour is
// already the invalid red. Eased rather than square and well short of full
// amplitude — a fast full-amplitude flash on an always-on-top line covering a
// large part of the viewport sits on the general flash threshold.
const PULSE_HZ = 1.6;
const PULSE_MIN = 0.3;
const PULSE_MAX = 0.7;

export class ShapeVertexControls extends THREE.Object3D {
  constructor() {
    super();

    // The matrix is written from the shape every frame, never derived from
    // position/rotation/scale.
    this.matrixAutoUpdate = false;

    this.shapeEl = null;
    this.vertexEls = [];
    this.vertexHandles = [];
    this.midpointHandles = [];
    this.hoveredHandle = null;
    this.activeVertexEl = null;

    this.claimed = false;
    this._pressWasClaimed = false;
    this.pressGeneration = 0;
    this.lastRecordedPressId = -1;
    this.pressX = 0;
    this.pressY = 0;
    this.pressWasHandle = false;
    this.pressHit = null;
    this.lastCursorX = 0;
    this.lastCursorY = 0;
    this.lastPointerType = null;
    this._capturedPointerId = null;

    this._invalidSignalOn = false;
    this._invalidFlashTimer = null;
    this._wasOpen = false;
    this._lastChildCount = -1;
    this._prevMatrixWorld = new THREE.Matrix4();

    // Per-frame scratch, hoisted so the hook allocates nothing.
    this._tmpV = new THREE.Vector3();
    this._tmpCamPos = new THREE.Vector3();
    this._hitList = [];

    // One unit sphere and three materials shared by every handle: a handle's
    // size is a per-frame scale and its state is a material swap, so there is
    // nothing per-handle to build or dispose.
    this._sphere = new THREE.SphereGeometry(1, 12, 12);
    this._matNormal = new THREE.MeshBasicMaterial({
      color: COLOR_NORMAL,
      depthTest: false
    });
    this._matHover = new THREE.MeshBasicMaterial({
      color: COLOR_HOVER,
      depthTest: false
    });
    this._matMidpoint = new THREE.MeshBasicMaterial({
      color: COLOR_NORMAL,
      depthTest: false,
      transparent: true,
      opacity: MIDPOINT_OPACITY
    });

    this.handleGroup = new THREE.Group();
    this.add(this.handleGroup);

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onSuppressClaimed = this._onSuppressClaimed.bind(this);
    this._onSuppressLatched = this._onSuppressLatched.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onStructuralChange = this._onStructuralChange.bind(this);
  }

  // --- lifecycle ---------------------------------------------------------

  attach(shapeEl) {
    if (this.shapeEl === shapeEl) return;
    if (this.shapeEl) this.detach();
    if (!shapeEl || !shapeEl.components || !shapeEl.components.shape) return;

    this._readVertexEls(shapeEl);
    this._syncPool();

    // Seed the previous-frame matrix from the shape as it is NOW. Without the
    // seed the first frame compares a live matrix against an identity one and
    // reports a whole-shape move that never happened — on every attach, for any
    // shape not sitting at the world origin.
    shapeEl.object3D.updateWorldMatrix(true, false);
    this._prevMatrixWorld.copy(shapeEl.object3D.matrixWorld);
    this._lastChildCount = shapeEl.children.length;

    this._addListeners();
    Events.on('shapevertexstructurechanged', this._onStructuralChange);

    this._wasOpen = !!AFRAME.INSPECTOR?.opened;
    // Last, because writing it is what arms the per-frame hook.
    this.shapeEl = shapeEl;
  }

  detach() {
    if (!this.shapeEl) return;
    this.abortGesture();
    this.setActiveVertex(null);
    if (this._invalidFlashTimer) {
      clearTimeout(this._invalidFlashTimer);
      this._invalidFlashTimer = null;
    }
    this._removeListeners();
    Events.removeListener(
      'shapevertexstructurechanged',
      this._onStructuralChange
    );

    const shapeEl = this.shapeEl;
    this.shapeEl = null; // disarms the per-frame hook
    this._pressWasClaimed = false;
    this._lastChildCount = -1;
    this.hoveredHandle = null;
    this._teardownPool();
    this.vertexEls.length = 0;

    // The commonest reason for a detach is a selection change, and one route to
    // that is the shape itself being deleted — by which point the component has
    // disposed its materials. Resolve fresh and skip if it is gone.
    const shape = shapeEl?.components?.shape;
    if (shape && !shape.destroyed) {
      shape.setInvalidSignal(false);
      shape.endEditGesture();
    }
    this._invalidSignalOn = false;
  }

  dispose() {
    this.detach();
    this._sphere.dispose();
    this._matNormal.dispose();
    this._matHover.dispose();
    this._matMidpoint.dispose();
  }

  // --- handle pool -------------------------------------------------------

  _readVertexEls(shapeEl) {
    this.vertexEls.length = 0;
    const children = shapeEl.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.components && child.components['shape-vertex']) {
        this.vertexEls.push(child);
      }
    }
  }

  _makeHandle(material) {
    const mesh = new THREE.Mesh(this._sphere, material);
    mesh.renderOrder = HANDLE_RENDER_ORDER;
    this.handleGroup.add(mesh);
    return mesh;
  }

  // Grow or shrink the pool IN PLACE. The mesh objects survive, which is what
  // keeps hover and active styling from being destroyed by a structural edit
  // that did not touch the handle in question.
  _syncPool() {
    const n = this.vertexEls.length;
    while (this.vertexHandles.length < n) {
      this.vertexHandles.push(this._makeHandle(this._matNormal));
    }
    while (this.vertexHandles.length > n) {
      const mesh = this.vertexHandles.pop();
      if (mesh === this.hoveredHandle) this.hoveredHandle = null;
      this.handleGroup.remove(mesh);
    }
  }

  _teardownPool() {
    for (const mesh of this.vertexHandles) this.handleGroup.remove(mesh);
    for (const mesh of this.midpointHandles) this.handleGroup.remove(mesh);
    this.vertexHandles.length = 0;
    this.midpointHandles.length = 0;
  }

  // A structural change is an insert or a remove — never a position change.
  // It arrives two ways because neither is sufficient alone: the child-count
  // compare catches edits made from outside this layer, and the notification
  // catches the insert/remove round-trip a count compare cannot see.
  _onStructuralChange(shapeEl) {
    if (shapeEl !== this.shapeEl) return;
    this._invalidateVertexCache();
  }

  _invalidateVertexCache() {
    this._readVertexEls(this.shapeEl);
    this._syncPool();
    this._lastChildCount = this.shapeEl.children.length;
    if (this.activeVertexEl && !this.vertexEls.includes(this.activeVertexEl)) {
      this.setActiveVertex(null);
    }
  }

  // --- per-frame ---------------------------------------------------------

  updateMatrixWorld(force) {
    if (this.shapeEl) {
      const open = !!AFRAME.INSPECTOR?.opened;
      // Closing the inspector emits nothing and deselects nothing, so detach()
      // never runs — this hook is the ONLY thing still running that can notice.
      // That is why it is armed on shapeEl alone and tests `opened` inside.
      if (this._wasOpen && !open) this.abortGesture();
      this._wasOpen = open;
      if (open) {
        // Refresh the source explicitly rather than relying on this object
        // being traversed after the shape's own subtree, which is only true
        // because of the order helpers happen to be added to the scene.
        this.shapeEl.object3D.updateWorldMatrix(true, false);
        this.matrix.copy(this.shapeEl.object3D.matrixWorld);
        this._perFrame();
      }
    }
    super.updateMatrixWorld(force);
  }

  // Runs up to twice per rendered frame — `sceneHelpers` is traversed by the
  // WebGL renderer and again by the CSS2D one — so every step here has to be
  // idempotent. Recomputes are naturally so; the pulse reads a clock rather
  // than advancing a counter; the matrix compare stores what it just read.
  _perFrame() {
    const shapeObj = this.shapeEl.object3D;

    if (this.shapeEl.children.length !== this._lastChildCount) {
      this._invalidateVertexCache();
    }

    const camera = AFRAME.INSPECTOR?.camera;
    const canvas = this._canvas();
    if (camera && canvas) {
      camera.getWorldPosition(this._tmpCamPos);
      const viewportH = canvas.clientHeight;
      for (let i = 0; i < this.vertexHandles.length; i++) {
        const el = this.vertexEls[i];
        const mesh = this.vertexHandles[i];
        if (!el) continue;
        mesh.position.copy(el.object3D.position);
        this._tmpV.copy(mesh.position).applyMatrix4(this.matrix);
        const mpp = metresPerPixel(
          camera,
          this._tmpV.distanceTo(this._tmpCamPos),
          viewportH
        );
        mesh.scale.setScalar(clampHandleRadius(mpp));
      }
    }

    if (this._invalidSignalOn) {
      const shape = this.shapeEl.components?.shape;
      if (shape) shape.setInvalidPulse(pulseOpacity(performance.now()));
    }

    if (!this._prevMatrixWorld.equals(shapeObj.matrixWorld)) {
      this._prevMatrixWorld.copy(shapeObj.matrixWorld);
      // The shape moved as a whole — by the gizmo, by a parent layer, or by an
      // undo of either. Whichever it was, the sub-selection no longer means
      // what it did.
      this.setActiveVertex(null);
    }
  }

  // The world-space radius a handle is currently drawn at, back-converted to
  // screen pixels. The hit radius has to match what the user can SEE, so it is
  // the rendered (clamped) radius rather than the unclamped target.
  _screenRadiusPx(worldRadius, worldPosition, camera, viewportH) {
    const mpp = metresPerPixel(
      camera,
      worldPosition.distanceTo(this._tmpCamPos),
      viewportH
    );
    return mpp > 0 ? worldRadius / mpp : 0;
  }

  // Vertex handles first, then midpoint ghosts: an overlap is resolved by test
  // order, which is the whole of the priority rule.
  _hitTest(clientX, clientY) {
    const camera = AFRAME.INSPECTOR?.camera;
    const canvas = this._canvas();
    if (!camera || !canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const viewportH = canvas.clientHeight;
    camera.getWorldPosition(this._tmpCamPos);

    const list = this._hitList;
    let n = 0;
    n = this._pushHitEntries(
      list,
      n,
      this.vertexHandles,
      'vertex',
      1,
      camera,
      viewportH
    );
    n = this._pushHitEntries(
      list,
      n,
      this.midpointHandles,
      'midpoint',
      MIDPOINT_RADIUS_RATIO,
      camera,
      viewportH
    );
    list.length = n;

    const hit = hitTestHandles(list, camera, rect, clientX, clientY);
    return hit === -1 ? null : list[hit];
  }

  // Fills the shared hit list without allocating: the entry objects and their
  // world vectors are reused across calls, which matters because this runs on
  // every pointermove over the canvas.
  _pushHitEntries(list, at, meshes, kind, radiusRatio, camera, viewportH) {
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      if (!mesh.visible) continue;
      let entry = list[at];
      if (!entry) {
        entry = list[at] = { world: new THREE.Vector3() };
      }
      mesh.getWorldPosition(entry.world);
      entry.kind = kind;
      entry.index = i;
      entry.mesh = mesh;
      entry.screenRadiusPx = this._screenRadiusPx(
        mesh.scale.x * radiusRatio,
        entry.world,
        camera,
        viewportH
      );
      at++;
    }
    return at;
  }

  // --- styling -----------------------------------------------------------

  _setHovered(mesh) {
    if (this.hoveredHandle === mesh) return;
    this.hoveredHandle = mesh;
    this._applyStyles();
  }

  _applyStyles() {
    for (const mesh of this.vertexHandles) {
      mesh.material =
        mesh === this.hoveredHandle ? this._matHover : this._matNormal;
    }
  }

  // The active vertex has one setter and nothing else writes it. The sub-object
  // selection it represents does not survive a whole-shape move, a structural
  // edit, or a detach.
  setActiveVertex(el) {
    if (this.activeVertexEl === el) return;
    this.activeVertexEl = el;
    this._applyStyles();
  }

  // --- listeners ---------------------------------------------------------

  _addListeners() {
    // Window CAPTURE throughout: a listener added later on the same element
    // does not get priority over an earlier one even with capture:true, so only
    // an ancestor capture listener can pre-empt the canvas listeners of the
    // A-Frame cursor, the transform gizmo and the camera controls.
    window.addEventListener('pointerdown', this._onPointerDown, true);
    window.addEventListener('pointermove', this._onPointerMove, true);
    window.addEventListener('pointerup', this._onPointerUp, true);
    window.addEventListener('pointercancel', this._onPointerCancel, true);
    // The mouse and touch families, not just pointer events: the A-Frame
    // cursor, the raycaster and both camera-control classes all listen on
    // mousedown/touchstart, and stopping a pointerdown does nothing to a
    // separately-dispatched mousedown.
    window.addEventListener('mousedown', this._onSuppressClaimed, true);
    window.addEventListener('touchstart', this._onSuppressClaimed, true);
    window.addEventListener('mouseup', this._onSuppressClaimed, true);
    window.addEventListener('touchend', this._onSuppressClaimed, true);
    // click and dblclick read the LATCH, not `claimed`: the release path clears
    // `claimed` three events before click arrives. Suppressing them matters
    // because a double-click on the canvas teleports the camera even when it
    // hits nothing — so clicking an already-active handle twice would fly the
    // view away mid-edit.
    window.addEventListener('click', this._onSuppressLatched, true);
    window.addEventListener('dblclick', this._onSuppressLatched, true);
    window.addEventListener('blur', this._onBlur);
  }

  _removeListeners() {
    window.removeEventListener('pointerdown', this._onPointerDown, true);
    window.removeEventListener('pointermove', this._onPointerMove, true);
    window.removeEventListener('pointerup', this._onPointerUp, true);
    window.removeEventListener('pointercancel', this._onPointerCancel, true);
    window.removeEventListener('mousedown', this._onSuppressClaimed, true);
    window.removeEventListener('touchstart', this._onSuppressClaimed, true);
    window.removeEventListener('mouseup', this._onSuppressClaimed, true);
    window.removeEventListener('touchend', this._onSuppressClaimed, true);
    window.removeEventListener('click', this._onSuppressLatched, true);
    window.removeEventListener('dblclick', this._onSuppressLatched, true);
    window.removeEventListener('blur', this._onBlur);
  }

  _canvas() {
    return AFRAME.INSPECTOR?.container ?? AFRAME.scenes?.[0]?.canvas ?? null;
  }

  _onSuppressClaimed(event) {
    if (!AFRAME.INSPECTOR?.opened) return;
    if (!this.claimed) return;
    event.preventDefault();
    event.stopPropagation();
  }

  _onSuppressLatched(event) {
    if (!AFRAME.INSPECTOR?.opened) return;
    if (!this._pressWasClaimed) return;
    event.preventDefault();
    event.stopPropagation();
  }

  _onPointerDown(event) {
    // Both of these describe "the most recent pointerdown this listener saw",
    // so neither may survive a press that was not recorded — which is why they
    // are ahead of every return, the `opened` gate included. If the counter
    // stopped advancing with the editor shut, an ordinary canvas click in the
    // viewer would still satisfy the release-side equality and clear the active
    // vertex behind the user's back.
    this.pressGeneration++;
    this._pressWasClaimed = false;

    const inspectorOpen = !!AFRAME.INSPECTOR?.opened;
    const targetIsCanvas = event.target === this._canvas();
    const isPrimaryButton = event.button === 0 && event.isPrimary !== false;
    // The reducer's 'ignore' branch, short-circuited here so the hit test below
    // never runs for a press on the sidebar or the layers panel. Leaving the
    // trash button and every other DOM control to work untouched is the same
    // condition.
    if (!inspectorOpen || !targetIsCanvas || !isPrimaryButton) return;

    // Recorded before any decision to claim: the empty-canvas clear reads these
    // coordinates on presses that are deliberately never claimed.
    this.pressX = event.clientX;
    this.pressY = event.clientY;
    this.lastRecordedPressId = this.pressGeneration;

    const hit = this._hitTest(event.clientX, event.clientY);
    this.pressHit = hit;
    this.pressWasHandle = !!hit;

    const decision = decidePress({
      inspectorOpen,
      targetIsCanvas,
      isPrimaryButton,
      handleHit: !!hit,
      pressPickOk: this._pressPickOk(event, hit)
    });
    if (decision !== 'claim') return; // selection and orbit proceed as normal

    this._claimPress(event, hit);
  }

  // Whether the press has a usable anchor to drag from. There is no plane to
  // pick against until dragging exists, so every handle press qualifies.
  _pressPickOk() {
    return true;
  }

  _claimPress(event, hit) {
    this.claimed = true;
    this._pressWasClaimed = true;
    event.preventDefault();
    event.stopPropagation();
    const canvas = this._canvas();
    if (canvas && event.pointerId !== undefined) {
      try {
        canvas.setPointerCapture(event.pointerId);
        this._capturedPointerId = event.pointerId;
      } catch {
        this._capturedPointerId = null;
      }
    }
    // Freezes the camera controls. On touch this is the only orbit defence
    // there is — the touch path is gated solely on that flag.
    this.dispatchEvent({ type: 'mouseDown' });
  }

  _onPointerMove(event) {
    if (!AFRAME.INSPECTOR?.opened) return;
    if (event.target !== this._canvas()) return;
    this.lastCursorX = event.clientX;
    this.lastCursorY = event.clientY;
    this.lastPointerType = event.pointerType || null;
    if (this.claimed) return;
    const hit = this._hitTest(event.clientX, event.clientY);
    this._setHovered(hit && hit.kind === 'vertex' ? hit.mesh : null);
  }

  // Teardown, so it is NOT gated on the inspector being open — a gesture in
  // flight when the editor closes has to end, and closing is exactly when no
  // event arrives to end it.
  _onPointerUp() {
    if (this.claimed) {
      this.abortGesture();
    }
  }

  _onPointerCancel() {
    this.abortGesture();
  }

  _onBlur() {
    this.abortGesture();
  }

  // --- gesture teardown --------------------------------------------------

  /**
   * End whatever gesture is in flight and leave nothing behind — no red shape,
   * no frozen camera, no held pointer capture, no orphaned listener.
   *
   * Executes NO history command, ever. Seven of its callers are not a release
   * (cancel, canvas-leave, blur, Esc, detach, dispose, the per-frame hook's
   * editor-closed edge), and one of those runs from inside another command's
   * execute(). The commit lives on the release path alone.
   *
   * State is cleared ABOVE the pointer-capture release, because releasing a
   * capture throws when the pointer is already gone — which is precisely the
   * lost-pointer case the capture exists for, and a throw there would strand
   * the state this function is the sole owner of.
   */
  abortGesture() {
    if (!this.claimed) return;

    const shape = this.shapeEl?.components?.shape;
    if (shape && !shape.destroyed) {
      shape.setInvalidSignal(false);
      shape.endEditGesture();
    }
    this._invalidSignalOn = false;

    this.claimed = false;
    this.pressHit = null;

    this.dispatchEvent({ type: 'mouseUp' });

    // Last, so a throw here can strand nothing.
    const id = this._capturedPointerId;
    this._capturedPointerId = null;
    if (id !== null) {
      const canvas = this._canvas();
      try {
        if (canvas?.hasPointerCapture(id)) canvas.releasePointerCapture(id);
      } catch {
        // The pointer is already gone; the capture went with it.
      }
    }
  }
}

// A raised cosine between PULSE_MIN and PULSE_MAX, read from a clock so that
// calling it twice in one frame gives the same answer.
export function pulseOpacity(nowMs) {
  const t = nowMs / 1000;
  const eased = 0.5 * (1 - Math.cos(2 * Math.PI * PULSE_HZ * t));
  return PULSE_MIN + (PULSE_MAX - PULSE_MIN) * eased;
}

export default ShapeVertexControls;
