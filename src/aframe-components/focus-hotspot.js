/* global AFRAME, THREE */
// focus-hotspot: author-placed clickable regions for the Viewer.
//
// A hotspot is any entity carrying this component, typically a
// semitransparent massing block over part of the geospatial layer, but any
// mesh (GLB, primitive, splat placeholder) works. In viewer mode the
// `focus-hotspot` system raycasts the pointer against registered hotspots:
// hovering highlights the mesh and shows a pointer cursor, clicking glides
// the camera to the hotspot (honoring an author-set `focus-camera-pose`
// vantage) and opens the FocusHotspotPanel overlay with the layer name as
// title plus the author's description. "Back to overview" returns to the
// camera pose the visitor had before their first hotspot click.
//
// Behaviors, not settings: see-through ("ghost") hotspots breathe gently
// to invite a click and hide themselves while focused so the detail they
// cover is unobstructed; opaque hotspots rely on the hover highlight and
// stay visible. Ghost = the author gave it a transparent material.
//
// The system is the single pointer owner: components never bind their own
// listeners, so N hotspots still cost one raycast per throttled pointer
// move. Hotspots are a Play feature ("Play means the experience is live"):
// interaction, the pulse and the pointer cursor are gated to an active play
// session in control mode `viewer`, and Stop/Reset tear focus down through
// the same play-mode events vehicles honor. Idle viewer mode is a static
// scene. In the editor the selection raycaster owns the mouse, and
// drive/fly own the camera. Entry point doc: docs/focus-hotspots.md.
import useStore from '../store.js';

const HOVER_OPACITY_BOOST = 0.25;
const HOVER_EMISSIVE = new THREE.Color('#4fc3f7');
const HOVER_EMISSIVE_INTENSITY = 0.5;
const PULSE_PERIOD_MS = 2000;
// Peak opacity added on top of the author's base (a 0.35 ghost breathes to
// ~0.7): large enough to read as an invitation, not a flicker.
const PULSE_AMPLITUDE = 0.35;
const CLICK_SLOP_PX = 6;
const HOVER_THROTTLE_MS = 40;

AFRAME.registerComponent('focus-hotspot', {
  schema: {
    enabled: { default: true },
    description: { type: 'string', default: '' }
  },

  init() {
    this.hovered = false;
    // [{ material, opacity, transparent, emissive, emissiveIntensity }]
    this.materialStates = [];
    this._materialsDirty = true;
    this._markMaterialsDirty = this._markMaterialsDirty.bind(this);
    this._onComponentChanged = (evt) => {
      if (evt.detail.name === 'material') this._markMaterialsDirty();
    };
    this.el.addEventListener('object3dset', this._markMaterialsDirty);
    this.el.addEventListener('model-loaded', this._markMaterialsDirty);
    this.el.addEventListener('componentchanged', this._onComponentChanged);
    this.system.register(this);
  },

  remove() {
    this.el.removeEventListener('object3dset', this._markMaterialsDirty);
    this.el.removeEventListener('model-loaded', this._markMaterialsDirty);
    this.el.removeEventListener('componentchanged', this._onComponentChanged);
    this.resetMaterials();
    this.system.unregister(this);
  },

  _markMaterialsDirty() {
    // Forget the captured base values (an author editing material
    // color/opacity in the editor, a model swapping its mesh) without
    // writing them back: `componentchanged` fires after A-Frame has already
    // applied the author's new value to the live material, so a restore
    // here would overwrite the edit with the stale capture. Effects are
    // never live in the editor, so there is nothing to undo.
    this.materialStates = [];
    this._materialsDirty = true;
  },

  _captureMaterials() {
    const seen = new Set();
    const states = [];
    this.el.object3D.traverse((node) => {
      if (!node.isMesh || !node.material) return;
      const materials = Array.isArray(node.material)
        ? node.material
        : [node.material];
      for (const material of materials) {
        if (seen.has(material)) continue;
        seen.add(material);
        states.push({
          material,
          opacity: material.opacity,
          transparent: material.transparent,
          emissive: material.emissive ? material.emissive.clone() : null,
          emissiveIntensity: material.emissiveIntensity
        });
      }
    });
    this.materialStates = states;
    this._materialsDirty = false;
  },

  // See-through hotspot (any material the author made transparent): it
  // breathes in the viewer and hides itself while focused.
  isGhost() {
    if (this._materialsDirty) this._captureMaterials();
    return this.materialStates.some((s) => s.transparent && s.opacity < 1);
  },

  setHovered(hovered) {
    if (this.hovered === hovered) return;
    this.hovered = hovered;
    if (this._materialsDirty) this._captureMaterials();
    for (const state of this.materialStates) {
      const material = state.material;
      if (!state.emissive) continue;
      if (hovered) {
        material.emissive.copy(HOVER_EMISSIVE);
        material.emissiveIntensity = HOVER_EMISSIVE_INTENSITY;
      } else {
        material.emissive.copy(state.emissive);
        material.emissiveIntensity = state.emissiveIntensity;
      }
    }
    if (!hovered) this._applyOpacity(0);
  },

  // Called by the system every frame while viewer interaction is active.
  tickEffects(time) {
    if (this._materialsDirty) this._captureMaterials();
    let delta = 0;
    if (this.hovered) {
      delta = HOVER_OPACITY_BOOST;
    } else {
      // 0..PULSE_AMPLITUDE breathing wave (no-op on opaque materials).
      delta =
        (PULSE_AMPLITUDE / 2) *
        (1 + Math.sin((time / PULSE_PERIOD_MS) * Math.PI * 2));
    }
    this._applyOpacity(delta);
  },

  // Restore untouched author materials (leaving the viewer, or removal).
  resetMaterials() {
    this.hovered = false;
    for (const state of this.materialStates) {
      const material = state.material;
      material.opacity = state.opacity;
      if (state.emissive) {
        material.emissive.copy(state.emissive);
        material.emissiveIntensity = state.emissiveIntensity;
      }
    }
  },

  _applyOpacity(delta) {
    for (const state of this.materialStates) {
      // Only breathe/boost materials the author made see-through; opaque
      // hotspot meshes keep their look and rely on the emissive highlight.
      if (!state.transparent || state.opacity >= 1) continue;
      state.material.opacity = Math.min(1, state.opacity + delta);
    }
  }
});

AFRAME.registerSystem('focus-hotspot', {
  init() {
    this.hotspots = new Set();
    this.hoveredComponent = null;
    this.focusedEl = null;
    // Camera pose captured at the visitor's FIRST hotspot click; "Back to
    // overview" returns here, however many hotspots were visited since.
    this.overviewCameraState = null;
    this._effectsActive = false;
    this._raycaster = new THREE.Raycaster();
    this._pointerNdc = new THREE.Vector2();
    this._downXY = null;
    this._lastHoverAt = 0;

    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._bindCanvas = this._bindCanvas.bind(this);
    if (this.sceneEl.canvas) {
      this._bindCanvas();
    } else {
      this.sceneEl.addEventListener('render-target-loaded', this._bindCanvas, {
        once: true
      });
    }

    // Any play boundary ends the visitor interaction: unhide, unhighlight,
    // close the panel, drop the overview stash. Start clears too so a
    // session never inherits a focused hotspot; Reset is a fresh run (the
    // viewer-start system moves the camera back to the start). Leaving
    // viewer control mode (editor reopens, drive/fly starts) does the same.
    const clear = () => this.clearFocus();
    this.sceneEl.addEventListener('play-mode-start', clear);
    this.sceneEl.addEventListener('play-mode-stop', clear);
    this.sceneEl.addEventListener('play-mode-reset', clear);
    this.sceneEl.addEventListener('mode-changed', (evt) => {
      if (evt.detail.to !== 'viewer') this.clearFocus();
    });

    // Playable capability: an enabled hotspot is something for Start to
    // do (viewer presentation makes it clickable), so the Play UI lights
    // up and the author can try the visitor experience without leaving
    // the editor. Read off the DOM rather than this.hotspots so the
    // editor's playable re-check (MutationObserver + entityupdate) sees
    // toggles the moment they land. Deferred to scene `loaded`: this
    // system is registered before mode-manager, and A-Frame inits
    // systems in registration order, so the registry doesn't exist yet
    // at init time.
    const registerPlayable = () => {
      this.sceneEl.systems['mode-manager']?.registerPlayableCheck(
        'focus-hotspot',
        () =>
          Array.from(this.sceneEl.querySelectorAll('[focus-hotspot]')).some(
            (el) => el.components?.['focus-hotspot']?.data?.enabled
          )
      );
    };
    if (this.sceneEl.hasLoaded) {
      registerPlayable();
    } else {
      this.sceneEl.addEventListener('loaded', registerPlayable, { once: true });
    }
  },

  _bindCanvas() {
    const canvas = this.sceneEl.canvas;
    if (!canvas) return;
    this._canvas = canvas;
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointerup', this._onPointerUp);
  },

  register(component) {
    this.hotspots.add(component);
  },

  unregister(component) {
    this.hotspots.delete(component);
    if (this.hoveredComponent === component) this.hoveredComponent = null;
    if (this.focusedEl === component.el) this.clearFocus();
  },

  hasHotspots() {
    return this.hotspots.size > 0;
  },

  // Live only during an active play session in control mode `viewer`:
  // inactive in idle viewer mode (static scene), in the editor (selection
  // raycaster owns the mouse) and while drive/fly borrow the camera. Paused
  // play keeps hotspots live: the visitor froze the traffic, not the tour.
  isInteractive() {
    return (
      !!this.sceneEl.systems['play-mode']?.isPlaying &&
      this.sceneEl.systems['mode-manager']?.getMode() === 'viewer' &&
      !useStore.getState().isInspectorEnabled
    );
  },

  tick(time) {
    const active = this.isInteractive();
    if (!active) {
      if (this._effectsActive) {
        for (const component of this.hotspots) component.resetMaterials();
        this._setPointerCursor(false);
        this.hoveredComponent = null;
        this._effectsActive = false;
      }
      return;
    }
    this._effectsActive = true;
    for (const component of this.hotspots) {
      if (!component.data.enabled) continue;
      if (component.el === this.focusedEl && component.isGhost()) continue;
      component.tickEffects(time);
    }
  },

  _onPointerMove(evt) {
    if (evt.timeStamp - this._lastHoverAt < HOVER_THROTTLE_MS) return;
    this._lastHoverAt = evt.timeStamp;
    if (!this.isInteractive() || !this.hasHotspots()) {
      this._setHovered(null);
      return;
    }
    this._setHovered(this._pick(evt));
  },

  _onPointerDown(evt) {
    this._downXY = { x: evt.clientX, y: evt.clientY };
  },

  _onPointerUp(evt) {
    const down = this._downXY;
    this._downXY = null;
    if (!down || !this.isInteractive() || !this.hasHotspots()) return;
    // A press that traveled is an orbit/pan gesture, not a click.
    if (
      Math.abs(evt.clientX - down.x) > CLICK_SLOP_PX ||
      Math.abs(evt.clientY - down.y) > CLICK_SLOP_PX
    ) {
      return;
    }
    const component = this._pick(evt);
    if (component) this.focusHotspot(component.el);
  },

  _pick(evt) {
    const canvas = this._canvas;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    this._pointerNdc.set(
      ((evt.clientX - rect.left) / rect.width) * 2 - 1,
      -((evt.clientY - rect.top) / rect.height) * 2 + 1
    );
    const camera = this.sceneEl.camera;
    if (!camera) return null;
    this._raycaster.setFromCamera(this._pointerNdc, camera);

    const targets = [];
    for (const component of this.hotspots) {
      if (!component.data.enabled) continue;
      // A hidden focused hotspot must not swallow clicks on what's behind it.
      if (!component.el.object3D.visible) continue;
      targets.push(component.el.object3D);
    }
    if (!targets.length) return null;
    const hits = this._raycaster.intersectObjects(targets, true);
    for (const hit of hits) {
      let node = hit.object;
      while (node) {
        if (node.el && node.el.components['focus-hotspot']) {
          return node.el.components['focus-hotspot'];
        }
        node = node.parent;
      }
    }
    return null;
  },

  _setHovered(component) {
    if (this.hoveredComponent === component) return;
    if (this.hoveredComponent) this.hoveredComponent.setHovered(false);
    this.hoveredComponent = component;
    if (component) component.setHovered(true);
    this._setPointerCursor(!!component);
  },

  _setPointerCursor(on) {
    if (this._canvas) this._canvas.style.cursor = on ? 'pointer' : '';
  },

  focusHotspot(el) {
    const component = el.components['focus-hotspot'];
    if (!component || !component.data.enabled) return;
    if (!this.isInteractive()) return;
    if (this.focusedEl === el) return;

    if (!this.overviewCameraState) {
      this.overviewCameraState = this._captureCameraState();
    }
    // Switching hotspot-to-hotspot: unhide the previous one first.
    this._restoreFocusedVisibility();
    this.focusedEl = el;
    this._setHovered(null);

    // The editor camera controls run the glide in viewer mode too (#1848).
    // controls.focus() honors an author-set focus-camera-pose vantage and
    // falls back to bbox framing.
    const controls = window.AFRAME?.INSPECTOR?.controls;
    if (controls && controls.focus) controls.focus(el.object3D);

    if (component.isGhost()) {
      component.resetMaterials();
      el.setAttribute('visible', false);
    }

    useStore.getState().setFocusedHotspot({
      entityId: el.id || el.object3D.uuid,
      // The layer name is the title: one name per thing, set where every
      // other layer gets its name.
      title: el.getAttribute('data-layer-name') || '',
      description: component.data.description
    });
  },

  returnToOverview() {
    const cameraState = this.overviewCameraState;
    this.clearFocus();
    const controls = window.AFRAME?.INSPECTOR?.controls;
    if (cameraState && controls && controls.focusCameraState) {
      controls.focusCameraState(cameraState);
    }
  },

  // Drop all visitor-interaction state without moving the camera.
  clearFocus() {
    this._restoreFocusedVisibility();
    this.focusedEl = null;
    this.overviewCameraState = null;
    if (useStore.getState().focusedHotspot) {
      useStore.getState().setFocusedHotspot(null);
    }
  },

  _restoreFocusedVisibility() {
    const el = this.focusedEl;
    if (!el) return;
    // Unhide unconditionally: the ghost test reads live materials, which
    // the author may have changed while it was hidden.
    if (el.components['focus-hotspot']) el.setAttribute('visible', true);
  },

  _captureCameraState() {
    const camera = this.sceneEl.camera;
    if (!camera) return null;
    camera.updateMatrixWorld();
    const position = new THREE.Vector3();
    camera.getWorldPosition(position);
    const rotation = new THREE.Euler().setFromRotationMatrix(
      camera.matrixWorld,
      camera.rotation.order
    );
    return {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
      zoom: camera.fov || 60,
      type: camera.type
    };
  }
});
