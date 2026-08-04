/* global AFRAME, THREE */

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import useStore from '@/store';
import Events from './Events';
import { intersectPlaneOrNull } from './intersectPlaneOrNull.js';
import { rayFromClientXY } from './rayFromClientXY.js';
import {
  CLICK_MOVE_THRESHOLD,
  MIDPOINT_RADIUS_RATIO,
  clampHandleRadius,
  decidePress,
  hitTestHandles,
  metresPerPixel,
  preExistingClosePairs,
  rayPlaneHitIsUsable,
  resolveDragRelease,
  trashButtonOffset,
  validateVertexDelete,
  validateVertexEdit
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
const COLOR_ACTIVE = '#ffffff';
const MIDPOINT_OPACITY = 0.45;
// The active handle is a white core inside a blue rim, so "which vertex is
// active" and "the shape is invalid" read independently of each other.
const ACTIVE_RIM_RATIO = 1.25;

// ms — how long the shape stays red after a refused delete. A blocked delete
// comes from a button click or a keypress, neither of which is a gesture, so
// none of the gesture exits would ever clear it: it needs an owner of its own.
const INVALID_FLASH_MS = 900;

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
    this._gesture = null;
    this._pendingGesture = null;
    this.lastCursorX = 0;
    this.lastCursorY = 0;
    this.lastPointerType = null;
    this._capturedPointerId = null;

    this._invalidSignalOn = false;
    this._invalidFlashTimer = null;
    this._trashObject = null;
    this._trashInner = null;
    this._wasOpen = false;
    this._lastChildCount = -1;
    this._prevMatrixWorld = new THREE.Matrix4();

    // Per-frame scratch, hoisted so the hook allocates nothing.
    this._tmpV = new THREE.Vector3();
    this._tmpCamPos = new THREE.Vector3();
    this._tmpNormal = new THREE.Vector3();
    this._tmpPoints = [];
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
    this._matActive = new THREE.MeshBasicMaterial({
      color: COLOR_ACTIVE,
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

    // The rim behind the active handle's white core. One mesh, moved onto
    // whichever handle is active, rather than a second mesh per handle.
    this._activeRim = new THREE.Mesh(this._sphere, this._matNormal);
    this._activeRim.renderOrder = HANDLE_RENDER_ORDER;
    this._activeRim.visible = false;
    this.handleGroup.add(this._activeRim);

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onPointerCancel = this._onPointerCancel.bind(this);
    this._onSuppressClaimed = this._onSuppressClaimed.bind(this);
    this._onSuppressLatched = this._onSuppressLatched.bind(this);
    this._onBlur = this._onBlur.bind(this);
    this._onGestureLost = this._onGestureLost.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onTrashClick = this._onTrashClick.bind(this);
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

    this._buildTrashButton();
    this._addListeners();
    Events.on('shapevertexstructurechanged', this._onStructuralChange);
    useStore.getState().setShapeVertexEditActive(true);

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
    useStore.getState().setShapeVertexEditActive(false);
    this._teardownTrashButton();
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
    this._matActive.dispose();
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
      this._updateActiveRim();
      this._updateTrashButton(camera, canvas);
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
    for (let i = 0; i < this.vertexHandles.length; i++) {
      const mesh = this.vertexHandles[i];
      const isActive =
        this.activeVertexEl && this.vertexEls[i] === this.activeVertexEl;
      mesh.material = isActive
        ? this._matActive
        : mesh === this.hoveredHandle
          ? this._matHover
          : this._matNormal;
      // The active core draws inside its own rim.
      mesh.renderOrder = isActive
        ? HANDLE_RENDER_ORDER + 1
        : HANDLE_RENDER_ORDER;
    }
  }

  // The active vertex has one setter and nothing else writes it. The sub-object
  // selection it represents does not survive a whole-shape move, a structural
  // edit, or a detach.
  setActiveVertex(el) {
    if (this.activeVertexEl === el) return;
    this.activeVertexEl = el;
    if (!el && this._trashObject) this._trashObject.visible = false;
    this._applyStyles();
  }

  // --- the delete button -------------------------------------------------

  // A DOM button rendered through the CSS2D layer rather than a mesh in the
  // scene. Three things fall out of that and all of them are wanted: it is
  // never a raycast target, so it cannot compete with the handles for a press;
  // a press on it does not reach the canvas at all, so it cannot turn into a
  // vertex drag on a touch screen where drift is near-certain; and native click
  // semantics already give "commits on release inside, cancels outside".
  _buildTrashButton() {
    // TWO elements, and the split is mandatory rather than tidy: CSS2DRenderer
    // assigns style.transform on the OUTER element every render pass, so
    // anything we wrote there would be erased each frame. The offset lives on
    // an inner wrapper the renderer never touches.
    const outer = document.createElement('div');
    outer.style.pointerEvents = 'none';

    const inner = document.createElement('button');
    inner.type = 'button';
    inner.title = 'Delete vertex';
    inner.setAttribute('aria-label', 'Delete vertex');
    // The CSS2D container is pointer-events:none, so this is the only live
    // element in it.
    inner.style.pointerEvents = 'auto';
    inner.style.cssText +=
      ';display:flex;align-items:center;justify-content:center;' +
      'width:24px;height:24px;padding:0;border:none;border-radius:4px;' +
      'cursor:pointer;background:rgba(0,0,0,0.7);color:#fff;';
    inner.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
      'stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>' +
      '<path d="M10 11v6M14 11v6"/></svg>';
    inner.addEventListener('click', this._onTrashClick);
    outer.appendChild(inner);

    this._trashInner = inner;
    this._trashObject = new CSS2DObject(outer);
    this._trashObject.visible = false;
    this.add(this._trashObject);
  }

  _teardownTrashButton() {
    if (!this._trashObject) return;
    this._trashInner.removeEventListener('click', this._onTrashClick);
    const element = this._trashObject.element;
    if (element.parentNode) element.parentNode.removeChild(element);
    this.remove(this._trashObject);
    this._trashObject = null;
    this._trashInner = null;
  }

  _updateTrashButton(camera, canvas) {
    if (!this._trashObject) return;
    const mesh = this._activeHandle();
    if (!mesh) {
      this._trashObject.visible = false;
      return;
    }
    this._trashObject.position.copy(mesh.position);

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    this._tmpV.copy(mesh.position).applyMatrix4(this.matrix);
    const radiusPx = this._screenRadiusPx(
      mesh.scale.x,
      this._tmpV,
      camera,
      height
    );
    this._tmpV.project(camera);
    const offset = trashButtonOffset(
      radiusPx,
      (this._tmpV.x * 0.5 + 0.5) * width,
      (-this._tmpV.y * 0.5 + 0.5) * height,
      width,
      height
    );
    if (!offset) {
      this._trashObject.visible = false;
      return;
    }
    this._trashObject.visible = true;
    this._trashInner.style.transform = `translate(${offset.dx}px, ${offset.dy}px)`;
  }

  _updateActiveRim() {
    const mesh = this._activeHandle();
    if (!mesh) {
      this._activeRim.visible = false;
      return;
    }
    this._activeRim.visible = true;
    this._activeRim.position.copy(mesh.position);
    this._activeRim.scale.setScalar(mesh.scale.x * ACTIVE_RIM_RATIO);
  }

  _activeHandle() {
    if (!this.activeVertexEl) return null;
    const i = this.vertexEls.indexOf(this.activeVertexEl);
    return i === -1 ? null : this.vertexHandles[i];
  }

  _onTrashClick(event) {
    event.preventDefault();
    event.stopPropagation();
    this._deleteActiveVertex();
  }

  // --- delete ------------------------------------------------------------

  _deleteActiveVertex() {
    const vertexEl = this.activeVertexEl;
    if (!vertexEl) return;
    const index = this.vertexEls.indexOf(vertexEl);
    if (index === -1) {
      this.setActiveVertex(null);
      return;
    }

    if (!validateVertexDelete(this._localPoints(), this._isClosed(), index)) {
      // Both refusals — a delete that would make the ring cross itself, and one
      // that would leave fewer than two vertices — say so the same way. They
      // are the same button, the same click and the same outcome, and a silent
      // no-op on one of them reads as a broken button rather than a refusal.
      // The vertex stays, and stays active.
      this._flashRefusal();
      return;
    }

    this.setActiveVertex(null);
    try {
      AFRAME.INSPECTOR.execute('shapevertexremove', { vertexEl });
    } catch (error) {
      console.error('Shape vertex delete failed', error);
    }
  }

  _flashRefusal() {
    this._setInvalidSignal(true); // also cancels any flash already running
    this._invalidFlashTimer = setTimeout(() => {
      this._invalidFlashTimer = null;
      this._setInvalidSignal(false);
    }, INVALID_FLASH_MS);
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
    window.addEventListener('keyup', this._onKeyUp, true);
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
    window.removeEventListener('keyup', this._onKeyUp, true);
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
      pressPickOk: this._preparePress(event, hit)
    });
    if (decision !== 'claim') return; // selection and orbit proceed as normal

    this._claimPress(event, hit);
  }

  // --- the drag ----------------------------------------------------------

  // Build the gesture a claimed press would run, and report whether it is
  // viable. A gesture with no usable grab anchor must never be entered: the
  // offset would be undefined and the first move would fling the vertex.
  _preparePress(event, hit) {
    this._pendingGesture = null;
    if (!hit) return true; // nothing to prepare; the reducer decides on the hit
    if (hit.kind !== 'vertex') return true;

    const vertexEl = this.vertexEls[hit.index];
    if (!vertexEl) return false;
    const shapeObj = this.shapeEl.object3D;
    const local = vertexEl.object3D.position;

    // The drag plane is the shape's own horizontal plane at this vertex's
    // height, so a vertex slides within the shape rather than off it.
    this._tmpNormal
      .set(0, 1, 0)
      .applyQuaternion(shapeObj.quaternion)
      .normalize();
    this._tmpV.set(0, local.y, 0).applyMatrix4(this.matrix);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
      this._tmpNormal,
      this._tmpV
    );

    const hitWorld = this._pickOnPlane(
      event.clientX,
      event.clientY,
      plane,
      this._tmpNormal
    );
    if (!hitWorld) return false;

    const points = this._localPoints();
    this._pendingGesture = {
      mode: 'vertex',
      vertexEl,
      index: hit.index,
      plane,
      planeNormal: this._tmpNormal.clone(),
      // Where in the vertex the user grabbed, so it does not jump to the
      // cursor on the first move.
      grabOffset: local.clone().sub(shapeObj.worldToLocal(hitWorld)),
      preDragLocalPos: local.clone(),
      lastValidLocalPos: null,
      exemptPairs: preExistingClosePairs(points),
      isDrag: false,
      transientEl: null
    };
    return true;
  }

  // The cursor ray's meeting point with `plane`, or null when there is no
  // usable one. A grazing ray is treated as a MISS rather than as its own case:
  // intersectPlane happily returns a point kilometres away when the camera is
  // nearly edge-on to the plane, and holding still is the right response to
  // both.
  _pickOnPlane(clientX, clientY, plane, planeNormal) {
    const ray = rayFromClientXY(clientX, clientY);
    if (!ray) return null;
    if (!rayPlaneHitIsUsable(ray.direction, planeNormal)) return null;
    return intersectPlaneOrNull(clientX, clientY, plane);
  }

  // The shape's vertex positions in its own frame — the array the pure rules
  // take. Reused rather than rebuilt, since this runs on every drag frame.
  _localPoints() {
    const pts = this._tmpPoints;
    pts.length = this.vertexEls.length;
    for (let i = 0; i < this.vertexEls.length; i++) {
      pts[i] = this.vertexEls[i].object3D.position;
    }
    return pts;
  }

  _isClosed() {
    const shape = this.shapeEl?.components?.shape;
    return !!shape && shape.data.closed && this.vertexEls.length >= 3;
  }

  _dragMove(event) {
    const g = this._gesture;
    const shape = this.shapeEl?.components?.shape;
    if (!g || !shape) return;

    if (!g.isDrag) {
      const moved = Math.hypot(
        event.clientX - this.pressX,
        event.clientY - this.pressY
      );
      if (moved <= CLICK_MOVE_THRESHOLD) return;
      g.isDrag = true;
      shape.beginEditGesture();
    }

    const hitWorld = this._pickOnPlane(
      event.clientX,
      event.clientY,
      g.plane,
      g.planeNormal
    );
    if (!hitWorld) return; // hold where it is; never snap to the scene origin

    const local = this.shapeEl.object3D
      .worldToLocal(hitWorld)
      .add(g.grabOffset);
    // A raw object3D write rather than setAttribute: the shape's own system
    // polls vertex positions every tick, so the tube, the angle readouts, the
    // area label and the sidebar rows all track the drag for free. The
    // COMMITTED value goes through a command on release.
    g.vertexEl.object3D.position.copy(local);

    const valid = validateVertexEdit(
      this._localPoints(),
      this._isClosed(),
      g.index,
      g.exemptPairs
    );
    if (valid) {
      if (g.lastValidLocalPos) g.lastValidLocalPos.copy(local);
      else g.lastValidLocalPos = local.clone();
    }
    this._setInvalidSignal(!valid);
  }

  // The single owner of the invalid signal on this side. Writes through to the
  // component only on a change, so a drag spent inside an invalid stretch is
  // not re-setting the same colour every frame.
  _setInvalidSignal(on) {
    // Whoever sets the signal next takes ownership of clearing it, so a drag
    // begun during a refused-delete flash does not have the flash's timeout
    // clear it out from under the drag — and a second refused delete restarts
    // the flash rather than stacking a second timer on it.
    if (this._invalidFlashTimer) {
      clearTimeout(this._invalidFlashTimer);
      this._invalidFlashTimer = null;
    }
    if (this._invalidSignalOn === !!on) return;
    this._invalidSignalOn = !!on;
    const shape = this.shapeEl?.components?.shape;
    if (shape && !shape.destroyed) shape.setInvalidSignal(!!on);
  }

  _claimPress(event, hit) {
    this._gesture = this._pendingGesture;
    this._pendingGesture = null;
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
    this._addGestureListeners();
    // Freezes the camera controls. On touch this is the only orbit defence
    // there is — the touch path is gated solely on that flag.
    this.dispatchEvent({ type: 'mouseDown' });
  }

  // A release over the browser's own chrome — the URL bar, devtools, a second
  // monitor — delivers no pointerup at all, which would leave the shape red,
  // the camera frozen and the vertex snapping to the cursor on re-entry. The
  // pointer capture makes that rare and these make it survivable.
  _addGestureListeners() {
    const canvas = this._canvas();
    if (!canvas) return;
    canvas.addEventListener('mouseleave', this._onGestureLost);
    canvas.addEventListener('touchleave', this._onGestureLost);
    canvas.addEventListener('touchcancel', this._onGestureLost);
  }

  _removeGestureListeners() {
    const canvas = this._canvas();
    if (!canvas) return;
    canvas.removeEventListener('mouseleave', this._onGestureLost);
    canvas.removeEventListener('touchleave', this._onGestureLost);
    canvas.removeEventListener('touchcancel', this._onGestureLost);
  }

  _onGestureLost() {
    this.abortGesture();
  }

  _onPointerMove(event) {
    // The drag branch runs first and is ungated: it only exists while a gesture
    // the user genuinely started is in flight, which is a narrower bound than
    // the editor being open.
    if (this.claimed) {
      this._guard(() => this._dragMove(event));
      return;
    }
    if (!AFRAME.INSPECTOR?.opened) return;
    if (event.target !== this._canvas()) return;
    this.lastCursorX = event.clientX;
    this.lastCursorY = event.clientY;
    this.lastPointerType = event.pointerType || null;
    const hit = this._hitTest(event.clientX, event.clientY);
    this._setHovered(hit && hit.kind === 'vertex' ? hit.mesh : null);
  }

  // Teardown, so it is NOT gated on the inspector being open — a gesture in
  // flight when the editor closes has to end, and closing is exactly when no
  // event arrives to end it.
  _onPointerUp(event) {
    if (this.claimed) {
      this._guard(() => this._releaseGesture());
      return;
    }

    // Clicking empty space clears the active vertex. This branch is a
    // BEHAVIOUR rather than teardown, so unlike the rest of this handler it
    // does check that the editor is open — otherwise an ordinary click in the
    // viewer would clear the sub-selection behind the user's back, and it would
    // be gone when they came back.
    if (!AFRAME.INSPECTOR?.opened) return;
    if (!this.activeVertexEl) return;
    if (event.target !== this._canvas()) return;
    // The listener is on the window, so it fires for a release anywhere in the
    // document — the sidebar, the layers panel, the delete button itself. Those
    // presses never reach the press record, so without this the release would
    // be judged against the PREVIOUS canvas press. That matters: pointerup is
    // dispatched before click, so a spurious clear here would hide the delete
    // button before its own click fired — silently swallowing the delete the
    // user just asked for.
    if (this.pressGeneration !== this.lastRecordedPressId) return;
    if (this.pressWasHandle) return;
    const moved = Math.hypot(
      event.clientX - this.pressX,
      event.clientY - this.pressY
    );
    if (moved > CLICK_MOVE_THRESHOLD) return; // a drag: an orbit, not a click
    this.setActiveVertex(null);
  }

  // Esc and Delete on window CAPTURE, which is the codebase's own way of
  // getting ahead of the global shortcuts — they listen on the window's bubble
  // phase, and a listener added later on the same target does not win.
  _onKeyUp(event) {
    if (isTextFieldFocused()) return;

    if (event.key === 'Escape' || event.keyCode === 27) {
      // Arm 1 — cancel a drag in flight. Teardown, so it is not gated on the
      // editor being open. The vertex goes back to where the drag started and
      // nothing commits: Esc means cancel, and cancel means it did not happen.
      // The active vertex is deliberately NOT also cleared — one Esc, one
      // effect, and a second Esc then clears it.
      if (this.claimed) {
        this.abortGesture();
        event.stopPropagation();
        return;
      }
      // Arms 2 and 3 ARE gated. With the editor shut the layer is still
      // attached, so an ungated arm 2 would clear the active vertex from a
      // press in the viewer — and stopPropagation at window capture swallows
      // Esc app-wide, where modals and dialogs are listening for it.
      if (!AFRAME.INSPECTOR?.opened) return;
      // Arm 2 — clear the active vertex.
      if (this.activeVertexEl) {
        this.setActiveVertex(null);
        event.stopPropagation();
        return;
      }
      // Arm 3 — nothing of ours left; fall through and let Esc deselect.
      return;
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (!AFRAME.INSPECTOR?.opened) return;
      // Swallowed whenever the handles are up, whether or not a vertex is
      // active. Gating on "a vertex is active" would let the SECOND Delete —
      // after the first one cleared the active vertex — reach the editor's
      // whole-shape delete and its confirm dialog, one reflexive Enter from
      // losing the shape. With no active vertex this is a deliberate, silent
      // no-op.
      event.preventDefault();
      event.stopPropagation();
      if (this.activeVertexEl) this._guard(() => this._deleteActiveVertex());
    }
  }

  // The one place a vertex edit reaches history. Everything else — cancel,
  // blur, Esc, detach, the editor closing — goes through abortGesture(), which
  // executes no command at all.
  _releaseGesture() {
    const g = this._gesture;
    if (!g || !g.isDrag) {
      // A click rather than a drag: the vertex becomes the active one, which is
      // what puts the delete button on screen and points the Delete key at it.
      const vertexEl = g?.vertexEl ?? null;
      this.abortGesture();
      if (vertexEl) this.setActiveVertex(vertexEl);
      return;
    }

    const final = g.vertexEl.object3D.position.clone();
    const finalValid = validateVertexEdit(
      this._localPoints(),
      this._isClosed(),
      g.index,
      g.exemptPairs
    );
    const release = resolveDragRelease({
      preDrag: g.preDragLocalPos,
      lastValid: g.lastValidLocalPos,
      finalValid,
      final
    });
    const vertexEl = g.vertexEl;
    const oldValue = vecToString(g.preDragLocalPos);
    const value = vecToString(release.value);
    const action = release.action;

    // Tear everything down BEFORE the command runs. History emits
    // `historychanged` synchronously from execute(), so any consumer reacting
    // to it runs inside our own execute() call — clearing first is what stops a
    // commit being undone by its own side effects. The raw revert abortGesture
    // performs is not wasted work either: it is what makes the pre-command
    // state exactly `oldValue`, so undo lands where it should.
    this.abortGesture();

    if (action !== 'commit') return;
    try {
      AFRAME.INSPECTOR.execute('shapevertexmove', {
        entity: vertexEl,
        component: 'position',
        value,
        oldValue,
        noSelectEntity: true
      });
    } catch (error) {
      console.error('Shape vertex move failed', error);
    }
  }

  // A handler that throws must not strand a claimed gesture: the shape would
  // stay red, the camera dead and every later press consumed.
  _guard(fn) {
    try {
      fn();
    } catch (error) {
      console.error('Shape vertex gesture failed', error);
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

    const g = this._gesture;
    if (g) {
      if (g.transientEl) {
        // Nothing was ever committed for an insert that did not land.
        g.transientEl.remove();
      } else if (g.isDrag) {
        g.vertexEl.object3D.position.copy(g.preDragLocalPos);
      }
    }

    const shape = this.shapeEl?.components?.shape;
    if (shape && !shape.destroyed) {
      shape.setInvalidSignal(false);
      shape.endEditGesture();
    }
    this._invalidSignalOn = false;

    this.claimed = false;
    this.pressHit = null;
    this._gesture = null;
    this._pendingGesture = null;
    this._removeGestureListeners();

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

// Keys typed into a text field belong to the field, not to the canvas. Same
// test the draw tool applies before acting on Esc.
function isTextFieldFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

// A-Frame's position attribute takes an "x y z" string; the command family
// stores exactly what it is handed, so this is also what undo restores.
function vecToString(v) {
  return `${v.x} ${v.y} ${v.z}`;
}

// A raised cosine between PULSE_MIN and PULSE_MAX, read from a clock so that
// calling it twice in one frame gives the same answer.
export function pulseOpacity(nowMs) {
  const t = nowMs / 1000;
  const eased = 0.5 * (1 - Math.cos(2 * Math.PI * PULSE_HZ * t));
  return PULSE_MIN + (PULSE_MAX - PULSE_MIN) * eased;
}

export default ShapeVertexControls;
