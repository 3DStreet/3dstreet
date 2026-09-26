/* global AFRAME, THREE, STREET */
// build-area: visitor building on a closed shape (Visitor Build).
//
// A role component for a closed `shape`, the way `drive-controls` is a role
// for a car and `focus-hotspot` for a block: a closed shape that carries it
// becomes a surface visitors may build on while playing in the Viewer. The
// author picks a palette of catalog mixins per area and an object cap; a
// visitor drags palette cards onto the shape's interior (or taps a card to
// drop at the centre of the view), moves and rotates what they placed with
// the standard gizmo, deletes, undoes. Placed objects are CHILDREN of the
// shape entity: "dropped onto the shape" is the parent relation, the shape's
// interior is the clamp, and the child count is the cap.
//
// Play mutates the live scene here, as it already does elsewhere (animated
// traffic, a driven car, crash markers), but nothing is persisted: visitor
// objects carry `data-viewer-added` (a DOM-only marker the serializer never
// writes), are stripped on Stop and Reset, and the saved scene can only be
// written by its author anyway. The visitor keeps their work by opening it
// in a fresh editor tab (sceneHandoff.js, the JSON-in-hash loader), where
// it is an ordinary unsaved draft.
//
// The system is the single owner of the session state: it registers the
// playable capability, mirrors `buildSessionActive` / `buildPlacedCount`
// into the store for React and the viewport, resolves drops to an area
// (ray → the shape's fill plane → point-in-ring), executes the create
// commands and strips visitor objects at the play boundaries. Entry point
// doc: docs/visitor-build.md.
import useStore from '../../store.js';
import {
  parsePalette,
  canPlace,
  pointInRingXZ,
  mergePalettes
} from './build-area-rules.js';

export const VISITOR_ADDED_ATTR = 'data-viewer-added';

AFRAME.registerComponent('build-area', {
  schema: {
    enabled: { default: true },
    // Comma-separated catalog mixin ids visitors may place here. Empty =
    // nothing to build with, so the area is not playable.
    palette: { type: 'string', default: '' },
    // Cap on visitor-placed objects in this area; 0 = unlimited.
    maxObjects: { type: 'int', default: 20, min: 0 },
    // Whether visitors may rotate (yaw) what they placed.
    allowRotate: { default: true }
  },

  init() {
    this.system.register(this);
  },

  update() {
    this.system.refresh();
  },

  remove() {
    this.system.unregister(this);
  },

  // A buildable area is an enabled component on a closed shape with at
  // least one palette entry. Read live so the playable check and the
  // dock follow the author's edits immediately.
  isBuildable() {
    const shape = this.el.components?.shape;
    return (
      !!this.data.enabled &&
      !!shape?.data?.closed &&
      parsePalette(this.data.palette).length > 0
    );
  },

  // World-space ring of the shape's vertices ({x, y, z}), the polygon a
  // drop must land inside. Empty until the shape has its vertices.
  worldRing() {
    const shape = this.el.components?.shape;
    const verts = shape?.getVertexEls ? shape.getVertexEls() : [];
    const ring = [];
    const v = new THREE.Vector3();
    for (const vertEl of verts) {
      vertEl.object3D.getWorldPosition(v);
      ring.push({ x: v.x, y: v.y, z: v.z });
    }
    return ring;
  },

  visitorObjects() {
    return Array.from(this.el.children).filter(
      (child) => child.hasAttribute && child.hasAttribute(VISITOR_ADDED_ATTR)
    );
  },

  containsWorldPoint(point) {
    return pointInRingXZ(point, this.worldRing());
  }
});

AFRAME.registerSystem('build-area', {
  init() {
    this.areas = new Set();
    this._active = false;
    this._historyMark = 0;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._hit = new THREE.Vector3();

    const refresh = () => this.refresh();
    this.sceneEl.addEventListener('play-mode-start', () => {
      // Visitor objects live for one session; anything placed later is
      // undone back to here on Stop so the author's own undo stack (an
      // editor-origin Start) survives the preview intact.
      this._historyMark = this._history()?.undos?.length || 0;
      this.refresh();
    });
    this.sceneEl.addEventListener('play-mode-stop', () => {
      this.clearVisitorObjects();
      this.refresh();
    });
    this.sceneEl.addEventListener('play-mode-reset', () => {
      // Reset is a fresh run: same session, empty areas.
      this.clearVisitorObjects();
      this.refresh();
    });
    this.sceneEl.addEventListener('mode-changed', refresh);
    this.sceneEl.addEventListener('newScene', () => {
      this.areas.clear();
      this.refresh();
    });

    // Keep the dock's counter live off the DOM rather than off each command
    // path (create, delete, undo, redo all change it).
    const observer = new MutationObserver(() => {
      if (this._active) this._syncCount();
    });
    observer.observe(this.sceneEl, { childList: true, subtree: true });

    // Playable capability: a buildable area is something for Start to do.
    // Deferred to scene `loaded`: mode-manager registers after this system.
    const registerPlayable = () => {
      this.sceneEl.systems['mode-manager']?.registerPlayableCheck(
        'build-area',
        () => this.getBuildableAreas().length > 0
      );
    };
    if (this.sceneEl.hasLoaded) {
      registerPlayable();
    } else {
      this.sceneEl.addEventListener('loaded', registerPlayable, { once: true });
    }
  },

  register(component) {
    this.areas.add(component);
    this.refresh();
  },

  unregister(component) {
    this.areas.delete(component);
    this.refresh();
  },

  _history() {
    return window.AFRAME?.INSPECTOR?.history || null;
  },

  // Read off the DOM, not this.areas, so a component still initialising
  // (attribute set this tick) is counted the moment its shape is closed.
  getBuildableAreas() {
    return Array.from(this.sceneEl.querySelectorAll('[build-area]'))
      .map((el) => el.components?.['build-area'])
      .filter((c) => c && c.isBuildable());
  },

  // Union of every buildable area's palette: one dock for the scene.
  getPalette() {
    return mergePalettes(this.getBuildableAreas().map((c) => c.data));
  },

  // Live only during an active play session in control mode `viewer`
  // with at least one buildable area: not in idle viewer mode, not in the
  // editor (where the author edits the same shapes with the full tools)
  // and not while drive/fly own the camera.
  isActive() {
    return (
      !!this.sceneEl.systems['play-mode']?.isPlaying &&
      this.sceneEl.systems['mode-manager']?.getMode() === 'viewer' &&
      !useStore.getState().isInspectorEnabled &&
      this.getBuildableAreas().length > 0
    );
  },

  refresh() {
    const active = this.isActive();
    if (active !== this._active) {
      this._active = active;
      useStore.getState().setBuildSessionActive(active);
    }
    this._syncCount();
  },

  placedCount() {
    return this.sceneEl.querySelectorAll(`[${VISITOR_ADDED_ATTR}]`).length;
  },

  _syncCount() {
    const count = this._active ? this.placedCount() : 0;
    if (useStore.getState().buildPlacedCount !== count) {
      useStore.getState().setBuildPlacedCount(count);
    }
  },

  // Strip every visitor object and drop the commands that created or
  // moved them from the undo stack (their entities are gone). Selection
  // is cleared first so the gizmo never holds a removed object.
  clearVisitorObjects() {
    const inspector = window.AFRAME?.INSPECTOR;
    const placed = Array.from(
      this.sceneEl.querySelectorAll(`[${VISITOR_ADDED_ATTR}]`)
    );
    if (!placed.length) return;
    if (
      inspector?.selectedEntity &&
      placed.includes(inspector.selectedEntity)
    ) {
      inspector.selectEntity(null);
    }
    for (const el of placed) {
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    const history = this._history();
    if (history) {
      history.undos.length = Math.min(history.undos.length, this._historyMark);
      history.redos = [];
    }
    this._syncCount();
  },

  // Resolve a screen point to the buildable area under it: cast the
  // pointer ray to each area's fill plane (the shape's vertex height) and
  // test the hit against the shape's world ring. Independent of the fill
  // mesh so an author who turned `selectInside` off (big zone, editor
  // clicks) still gets drops. Returns { area, point } (world) or null.
  pickArea(clientX, clientY) {
    const canvas = this.sceneEl.canvas;
    const camera = this.sceneEl.camera;
    if (!canvas || !camera) return null;
    const rect = canvas.getBoundingClientRect();
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this._raycaster.setFromCamera(this._ndc, camera);
    let best = null;
    for (const area of this.getBuildableAreas()) {
      const ring = area.worldRing();
      if (ring.length < 3) continue;
      this._plane.constant = -ring[0].y;
      const hit = this._raycaster.ray.intersectPlane(this._plane, this._hit);
      if (!hit) continue;
      if (!pointInRingXZ(hit, ring)) continue;
      const distance = hit.distanceTo(this._raycaster.ray.origin);
      if (!best || distance < best.distance) {
        best = { area, point: hit.clone(), distance };
      }
    }
    return best;
  },

  // Fallback target for tap-to-place: the area under the centre of the
  // view, else the first buildable area at its ring centroid.
  pickDefaultTarget() {
    const canvas = this.sceneEl.canvas;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const centre = this.pickArea(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2
      );
      if (centre) return centre;
    }
    const area = this.getBuildableAreas()[0];
    if (!area) return null;
    const ring = area.worldRing();
    if (ring.length < 3) return null;
    const point = new THREE.Vector3();
    for (const p of ring) point.add(new THREE.Vector3(p.x, p.y, p.z));
    point.divideScalar(ring.length);
    return { area, point, distance: 0 };
  },

  /**
   * Place a palette mixin at a screen point (drop) or at the default
   * target (tap). Refuses, with a toast, a point outside every area, a
   * mixin the target area does not offer, and a full area. Returns the
   * new entity or null.
   */
  placeMixin(mixinId, clientX, clientY) {
    if (!this._active) return null;
    const target =
      clientX === undefined
        ? this.pickDefaultTarget()
        : this.pickArea(clientX, clientY);
    if (!target) {
      this._notice('outside');
      return null;
    }
    const { area, point } = target;
    if (!parsePalette(area.data.palette).includes(mixinId)) {
      this._notice('palette');
      return null;
    }
    if (!canPlace(area.visitorObjects().length, area.data.maxObjects)) {
      this._notice('full');
      return null;
    }
    const local = area.el.object3D.worldToLocal(point.clone());
    const name =
      (Array.isArray(STREET?.catalog) &&
        STREET.catalog.find((item) => item.id === mixinId)?.name) ||
      mixinId;
    const definition = {
      parentEl: area.el,
      mixin: mixinId,
      'data-layer-name': name,
      [VISITOR_ADDED_ATTR]: '',
      // The gizmo may move and yaw a visitor object, never scale it or move
      // it to another parent (command-layer guards, transformGuard.js).
      'data-transform-no-scale': '',
      'data-transform-no-reparent': '',
      components: {
        position: { x: local.x, y: local.y, z: local.z },
        rotation: { x: 0, y: 0, z: 0 }
      }
    };
    if (!area.data.allowRotate) {
      definition['data-transform-yaw-only'] = '';
    }
    const before = new Set(area.visitorObjects());
    window.AFRAME?.INSPECTOR?.execute('entitycreate', definition);
    const created = area.visitorObjects().find((el) => !before.has(el)) || null;
    return created;
  },

  /**
   * Called by the viewport when a gizmo drag on a visitor object ends:
   * an object dragged outside its area's ring snaps back to where the
   * drag started (one undoable step, like any other gizmo move).
   */
  onGizmoRelease(el, preDragValues) {
    if (!this._active || !el?.hasAttribute?.(VISITOR_ADDED_ATTR)) return;
    const area = el.parentEl?.components?.['build-area'];
    if (!area || !preDragValues?.position) return;
    const world = new THREE.Vector3();
    el.object3D.getWorldPosition(world);
    if (area.containsWorldPoint(world)) return;
    window.AFRAME?.INSPECTOR?.execute('entityupdate', {
      entity: el,
      component: 'position',
      value: preDragValues.position
    });
    this._notice('keepInside');
  },

  // Visitor-facing refusals are surfaced by the palette dock (BuildPalette
  // .jsx), which owns the localized copy; scene code only names the reason:
  // 'outside' | 'palette' | 'full' | 'keepInside'.
  _notice(reason) {
    this.sceneEl.emit('build-area-notice', { reason }, false);
  }
});
