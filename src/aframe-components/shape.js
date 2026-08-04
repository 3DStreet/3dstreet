/* global AFRAME, THREE */

// `shape` renders a polyline through its `shape-vertex` child entities. The
// ordered child positions are the sole source of truth; the line/vertex meshes
// are derived and set via setObject3D (never serialized). See DESIGN-NOTES for
// the data model.
//
// A shape can be `closed` (a polygon): the derive adds one wrap segment back to
// the first vertex, and the component computes and shows the enclosed x/z area
// on an always-on DOM label. Area machinery is selection-independent, so it is
// owned here (not by the editor's on-select readout layer).
//
// Re-derivation has three triggers:
//   - structural (a vertex attaches/detaches) — the child calls requestRederive
//   - position change — observed by the `shape` SYSTEM tick below (a system
//     tick runs while the scene is playing, independent of entity pause, so it
//     works in the paused editor where an entity tick would not)
//   - an explicit `updateEvent`, if the shape opts into event-driven updates
//     instead of the per-frame dirty-check
//
// The shape is NOT kept playing while the inspector is open. Re-derivation does
// not need it (the system tick above is what observes positions), and an
// entity whose vertices are being animated cannot also be edited by hand — the
// animation would fight the drag. So a vertex `animation` runs in the published
// scene and is inert in the editor, which is the behaviour direct editing wants.

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import useStore from '../store.js';
import {
  polygonAreaXZ,
  polygonCentroidXZ,
  ringSelfIntersects
} from './polygonMath.js';

const UP = new THREE.Vector3(0, 1, 0);
const MIN_SEGMENT_LENGTH = 1e-6;

// 1 m² in ft² (3.28084²). Inlined here rather than importing the editor's
// formatArea (aframe-components must not depend on editor/lib) — the same
// pattern measure-line uses for its own length formatting.
const FT2_PER_M2 = 10.7639;

// X-ray overlay: a second copy of the line drawn semi-transparent and always
// on top (depthTest off), so the line stays visible where scene geometry — a
// building wall — occludes the solid line behind it.
const OVERLAY_OPACITY = 0.3;
const OVERLAY_RENDER_ORDER = 999;

// The colour a shape takes while an editing tool is signalling that what the
// user is doing would produce an invalid shape. Applied straight to the
// materials, never through setAttribute, so it cannot be saved into a scene —
// see setInvalidSignal below.
const INVALID_COLOR = '#ff3b30';

// The system owns the per-frame position observation for every shape, so it
// keeps running even when the shapes' entities are paused (as they are in the
// editor). Shapes that set `updateEvent` opt out and re-derive on their event.
AFRAME.registerSystem('shape', {
  init: function () {
    this.shapes = new Set();
  },

  register: function (shape) {
    this.shapes.add(shape);
  },

  unregister: function (shape) {
    this.shapes.delete(shape);
  },

  tick: function () {
    this.shapes.forEach((shape) => {
      if (shape.data.updateEvent) return;
      if (shape.positionsChanged()) {
        shape.rederive();
      }
    });
  }
});

AFRAME.registerComponent('shape', {
  schema: {
    lineColor: { type: 'color', default: '#ffe600' },
    // min: 0 — the properties panel clamps to it, and a negative radius would
    // build inside-out spheres with no cylinders between them.
    lineWidth: { type: 'number', default: 0.15, min: 0 },
    // A closed shape is a polygon: the derive adds a wrap segment (last→first)
    // and the area label shows. Default false so every existing/open shape
    // stays open; a non-default `true` serializes and round-trips (default is
    // stripped on save, so an open shape carries no `closed` key).
    closed: { type: 'boolean', default: false },
    // Whether clicking inside a closed shape selects it. On by default, since
    // the outline alone is impractically thin to hit. Turning it off is the
    // escape valve for a shape big enough that its interior would swallow
    // clicks meant for whatever it covers — the outline still selects it.
    // Only meaningful when `closed`; an open polyline has no interior.
    selectInside: { type: 'boolean', default: true },
    // Event-driven opt-out of the system dirty-check: set to an event name and
    // the shape re-derives on that event instead of being polled every frame
    // (the hooks below honour it). Empty by default → the system tick polls,
    // which covers the editor at this stage. It's an internal wiring prop, not
    // a user setting, so `hidden` keeps it out of the properties panel while
    // still being settable programmatically via setAttribute.
    updateEvent: { type: 'string', default: '', hidden: true }
  },

  init: function () {
    this.destroyed = false;
    this.rafId = null;
    // Both belong to the editor-facing API at the bottom of this file.
    this._editGesture = false;
    this._invalidSignal = false;
    this.positionCache = new Map();
    this.direction = new THREE.Vector3();
    this.tmpQuaternion = new THREE.Quaternion();

    this.requestRederive = this.requestRederive.bind(this);

    this.lineGroup = new THREE.Group();
    this.vertexGroup = new THREE.Group();
    this.overlayGroup = new THREE.Group();
    // Name the line group the conventional `mesh` slot: the editor's selection
    // box helper (OrientedBoxHelper) expands the box to include the entity's
    // ORIGIN for any entity that has no `mesh` object3D — which, for a shape
    // whose vertices sit far from its local origin, blows the box out to (0,0,0)
    // (spuriously spanning y=0 and stretching in x/z). Having a `mesh` slot
    // makes the helper bound the actual geometry instead.
    this.el.setObject3D('mesh', this.lineGroup);
    this.el.setObject3D('shapeVertices', this.vertexGroup);
    this.el.setObject3D('shapeLineOverlay', this.overlayGroup);
    // Interior pick surface for closed shapes. Without it a polygon is
    // selectable only by its thin outline tubes, which is impractical to hit.
    // Kept in its own slot rather than folded into `mesh` so the fill can
    // become a real, visible fill later by swapping the material alone.
    this.fillGroup = new THREE.Group();
    this.el.setObject3D('shapeFill', this.fillGroup);
    // Both of these are editor affordances, not part of the model: the fill is
    // an invisible click target and the overlay is the see-through-walls twin.
    // The GLB exporter hides objects marked this way, so neither ends up as
    // dead weight (or an invisible occluder) in an exported or AR-Ready scene.
    this.fillGroup.userData.source = 'INSPECTOR';
    this.overlayGroup.userData.source = 'INSPECTOR';

    this.material = new THREE.MeshStandardMaterial({
      color: this.data.lineColor,
      roughness: 0.8,
      metalness: 0.0
    });

    // Invisible-but-raycastable fill. `colorWrite: false` draws nothing while
    // leaving the mesh in the render list and — importantly — in the raycaster,
    // which skips meshes only via `visible`, never via material. DoubleSide so
    // ring winding and camera side can't make the pick fail.
    this.fillMaterial = new THREE.MeshBasicMaterial({
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      colorWrite: false
    });

    // Unlit, translucent, always-on-top material for the x-ray overlay copy.
    this.overlayMaterial = new THREE.MeshBasicMaterial({
      color: this.data.lineColor,
      transparent: true,
      opacity: OVERLAY_OPACITY,
      depthTest: false,
      depthWrite: false // always-on-top overlay must not occlude the gizmo etc.
    });

    // --- always-on area label (closed shapes only) ----------------------
    // The enclosed-area readout must show whenever the shape is closed, whether
    // or not it is selected — so it lives here, not in the editor's on-select
    // ShapeReadouts layer. Created once, mutated in place: it lives in its OWN
    // object3D slot, never the per-frame-cleared line/vertex/overlay groups (a
    // CSS2DObject has no geometry and would be orphaned by clearGroup).
    this.area = 0; // enclosed x/z area in m² (0 when open / < 3 vertices)
    this.units = useStore.getState().unitsPreference;
    this.areaLabelDiv = document.createElement('div');
    this.areaLabelDiv.className = 'label shape-area-label';
    this.areaLabelDiv.style.color = '#fff';
    this.areaLabelDiv.style.fontFamily = 'sans-serif';
    this.areaLabelDiv.style.fontSize = '12px';
    this.areaLabelDiv.style.padding = '2px 4px';
    this.areaLabelDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    this.areaLabelDiv.style.borderRadius = '3px';
    this.areaLabelDiv.style.pointerEvents = 'none';
    this.areaLabelObject = new CSS2DObject(this.areaLabelDiv);
    this.areaLabelObject.visible = false;
    this.areaLabelGroup = new THREE.Group();
    this.areaLabelGroup.add(this.areaLabelObject);
    this.el.setObject3D('shapeAreaLabel', this.areaLabelGroup);
    // Selector-subscribe (the store is wrapped in subscribeWithSelector): fires
    // only when unitsPreference changes, and just re-formats the existing area.
    this._unsubUnits = useStore.subscribe(
      (s) => s.unitsPreference,
      (units) => {
        this.units = units;
        this._updateAreaLabelText();
      }
    );

    this.el.sceneEl.systems.shape.register(this);

    // Whole-shape transform: the standard gizmo is enabled and behaves like any
    // other scene element, because the draw tool places the shape entity at its
    // vertices' centroid (vertices stored relative), so the gizmo attaches on
    // the shape and translates/rotates about its centre. (Vertices are hidden +
    // non-selectable, so there is no per-point gizmo — intended.)
    //
    // SCALE is disabled (`data-transform-no-scale`): scaling desyncs the
    // length/area readouts, which read the shape's intrinsic (unscaled) local
    // geometry. Translate and the editor's Y-only rotation both preserve the
    // readouts, so they stay enabled. A richer "move shape" affordance could
    // re-enable scale later (with readouts that fold in world scale).
    this.el.setAttribute('data-transform-no-scale', '');

    if (this.data.updateEvent) {
      this.el.addEventListener(this.data.updateEvent, this.requestRederive);
    }

    this.requestRederive();
  },

  update: function (oldData) {
    if (
      oldData.lineColor !== undefined &&
      oldData.lineColor !== this.data.lineColor
    ) {
      this.material.color.set(this.data.lineColor);
      this.overlayMaterial.color.set(this.data.lineColor);
    }

    if (oldData.updateEvent !== this.data.updateEvent) {
      if (oldData.updateEvent) {
        this.el.removeEventListener(oldData.updateEvent, this.requestRederive);
      }
      if (this.data.updateEvent) {
        this.el.addEventListener(this.data.updateEvent, this.requestRederive);
      }
    }

    if (
      oldData.lineWidth !== undefined &&
      oldData.lineWidth !== this.data.lineWidth
    ) {
      this.requestRederive();
    }

    if (oldData.closed !== undefined && oldData.closed !== this.data.closed) {
      this.requestRederive();
    }

    if (
      oldData.selectInside !== undefined &&
      oldData.selectInside !== this.data.selectInside
    ) {
      this.requestRederive();
    }
  },

  remove: function () {
    this.destroyed = true;
    if (this.el.sceneEl && this.el.sceneEl.systems.shape) {
      this.el.sceneEl.systems.shape.unregister(this);
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.data.updateEvent) {
      this.el.removeEventListener(this.data.updateEvent, this.requestRederive);
    }
    // Tear down the area label + its store subscription (measure-line leaks
    // exactly this subscription — do not repeat that here).
    if (this._unsubUnits) {
      this._unsubUnits();
      this._unsubUnits = null;
    }
    if (this.areaLabelObject) {
      this.areaLabelGroup.remove(this.areaLabelObject);
      if (this.areaLabelDiv && this.areaLabelDiv.parentNode) {
        this.areaLabelDiv.parentNode.removeChild(this.areaLabelDiv);
      }
      this.areaLabelObject = null;
    }
    this.clearGroup(this.lineGroup);
    this.clearGroup(this.vertexGroup);
    this.clearGroup(this.overlayGroup);
    this.clearGroup(this.fillGroup);
    this.material.dispose();
    this.overlayMaterial.dispose();
    this.fillMaterial.dispose();
    if (this.el.getObject3D('mesh')) this.el.removeObject3D('mesh');
    if (this.el.getObject3D('shapeVertices')) {
      this.el.removeObject3D('shapeVertices');
    }
    if (this.el.getObject3D('shapeLineOverlay')) {
      this.el.removeObject3D('shapeLineOverlay');
    }
    if (this.el.getObject3D('shapeFill')) {
      this.el.removeObject3D('shapeFill');
    }
    if (this.el.getObject3D('shapeAreaLabel')) {
      this.el.removeObject3D('shapeAreaLabel');
    }
  },

  // Child entities in DOM order that carry the shape-vertex marker. Guarded
  // against text/non-entity nodes.
  getVertexEls: function () {
    const result = [];
    const children = this.el.children;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.components && child.components['shape-vertex']) {
        result.push(child);
      }
    }
    return result;
  },

  // True when any vertex has moved, been added, or been removed since the last
  // check. Seeds the cache for new vertices (a missing entry counts as changed
  // rather than dereferencing undefined) and prunes removed ones.
  positionsChanged: function () {
    const verts = this.getVertexEls();
    let changed = false;
    const seen = new Set();

    for (let i = 0; i < verts.length; i++) {
      const el = verts[i];
      seen.add(el);
      const pos = el.object3D.position;
      const cached = this.positionCache.get(el);
      if (!cached) {
        this.positionCache.set(el, pos.clone());
        changed = true;
      } else if (!cached.equals(pos)) {
        cached.copy(pos);
        changed = true;
      }
    }

    if (this.positionCache.size !== seen.size) {
      this.positionCache.forEach((_value, el) => {
        if (!seen.has(el)) {
          this.positionCache.delete(el);
          changed = true;
        }
      });
    }

    return changed;
  },

  requestRederive: function () {
    if (this.destroyed || this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      if (this.destroyed) return;
      this.rederive();
    });
  },

  rederive: function () {
    if (this.destroyed) return;

    const verts = this.getVertexEls();
    // The schema's min only binds the properties panel; a negative width can
    // still arrive by setAttribute or from a hand-edited scene.
    const radius = Math.max(0, this.data.lineWidth);

    // Closedness and ring simplicity are decided BEFORE the groups are cleared,
    // because holding the fill means not clearing it: clearGroup disposes the
    // geometry, so deciding later and merely skipping the rebuild would leave
    // the fill gone rather than held.
    //
    // A self-crossing ring has no well-defined interior: the triangulated cap
    // comes out arbitrary and the shoelace area is meaningless. So a crossing
    // ring gets no fill and reports zero area, with the label hidden. That is
    // core behaviour, not an editor affordance — it must hold for a shape
    // loaded from a saved scene, or one whose `closed` checkbox is ticked on a
    // polyline that already crosses, exactly as it does for a live edit.
    const closed = this.data.closed && verts.length >= 3;
    const selfIntersecting =
      closed && ringSelfIntersects(verts.map((v) => v.object3D.position));
    // While an edit gesture is in flight, a crossing ring HOLDS its last valid
    // fill and area instead of dropping them: the interior stays clickable and
    // the area label freezes at its last meaningful value rather than flicking
    // to zero for the few frames a drag spends across an edge. The outline
    // still tracks the drag — only these two are frozen.
    const holdFill = this._editGesture && selfIntersecting;

    this.clearGroup(this.lineGroup);
    this.clearGroup(this.vertexGroup);
    this.clearGroup(this.overlayGroup);
    if (!holdFill) this.clearGroup(this.fillGroup);

    // Sphere caps at each vertex — also smooth the joints between segments.
    for (let i = 0; i < verts.length; i++) {
      const pos = verts[i].object3D.position;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 12, 12),
        this.material
      );
      sphere.position.copy(pos);
      // The inspector raycaster maps a hit to an entity via the hit object's
      // own `.el` (it does not walk up parents), so each leaf mesh needs the
      // back-pointer or clicking the line would not select the shape.
      sphere.el = this.el;
      this.vertexGroup.add(sphere);
      this._addOverlayMesh(sphere);
    }

    // One cylinder per segment, oriented from the default +Y to the segment
    // direction. Zero-length segments are skipped to avoid a NaN quaternion.
    for (let i = 0; i < verts.length - 1; i++) {
      this._addSegment(
        verts[i].object3D.position,
        verts[i + 1].object3D.position,
        radius
      );
    }

    // Closed polygon: one wrap segment back to the first vertex (same style,
    // same joints). Only meaningful with ≥ 3 vertices — a 2-vertex "closed"
    // shape renders as an open line (the wrap would coincide with the segment).
    if (closed) {
      this._addSegment(
        verts[verts.length - 1].object3D.position,
        verts[0].object3D.position,
        radius
      );
      if (this.data.selectInside && !selfIntersecting) this._addFill(verts);
    }

    if (!holdFill) this._updateArea(verts, closed && !selfIntersecting);

    // The geometry only exists from here — init installs empty groups and the
    // first derive lands a frame later. Anything sizing itself to this shape
    // (the editor's selection box) needs to know when that happened, and on
    // every later re-derive too. Non-bubbling: a shape's vertex children must
    // not look like their parent re-deriving.
    this.el.emit('shape-geometry-changed', null, false);
  },

  // Build one segment cylinder (start→end) plus its x-ray overlay twin, oriented
  // from +Y to the segment direction. Skips a zero-length segment (NaN guard).
  _addSegment: function (start, end, radius) {
    this.direction.subVectors(end, start);
    const length = this.direction.length();
    if (length < MIN_SEGMENT_LENGTH) return;

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, length, 8),
      this.material
    );
    mesh.position.set(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2,
      (start.z + end.z) / 2
    );
    this.tmpQuaternion.setFromUnitVectors(UP, this.direction.normalize());
    mesh.setRotationFromQuaternion(this.tmpQuaternion);
    mesh.el = this.el;
    this.lineGroup.add(mesh);
    this._addOverlayMesh(mesh);
  },

  // Build the interior pick surface for a closed ring: a triangulated cap in the
  // x/z plane, matching the area the shape reports. Drawn invisibly (see
  // fillMaterial) but fully raycastable, so a click anywhere inside the polygon
  // selects it rather than requiring a hit on the outline.
  //
  // Callers gate on `closed`: an open polyline has no defined interior, and
  // filling one would let a click in empty space between its endpoints select it
  // while the sidebar reports zero area.
  //
  // Assumes a simple (non-self-intersecting), planar ring — what the draw tool
  // produces. `closed` is also a properties-panel checkbox and vertices can be
  // animated, so neither holds absolutely: a self-crossing ring triangulates
  // arbitrarily, and a non-planar one gets its cap at the first vertex's height.
  // Both degrade this pick surface only — the outline still renders correctly.
  _addFill: function (verts) {
    // THREE.Shape is a 2D (x, y) construct. Map the ring's x/z plan-view onto it
    // with z negated so the shape's winding survives the rotation below, then
    // lay the resulting geometry flat by rotating +Z up to +Y.
    const points = [];
    for (let i = 0; i < verts.length; i++) {
      const pos = verts[i].object3D.position;
      points.push(new THREE.Vector2(pos.x, -pos.z));
    }

    const geometry = new THREE.ShapeGeometry(new THREE.Shape(points));
    geometry.rotateX(-Math.PI / 2);

    const mesh = new THREE.Mesh(geometry, this.fillMaterial);
    // All vertices share one height (the draw tool picks later vertices on the
    // plane of the first), so the cap sits at that height.
    mesh.position.y = verts[0].object3D.position.y;
    // Same reason as the sphere/cylinder leaves: the inspector raycaster reads
    // the hit object's own `.el` and does not walk up parents.
    mesh.el = this.el;
    // This cap exists only so the shape can be clicked; it is not a surface in
    // the scene. Consumers that resolve "what is physically under the cursor" —
    // double-click-to-navigate especially — must see through it to the ground
    // beneath, or a polygon drawn over a road would swallow the whole footprint.
    mesh.userData.selectionOnly = true;
    this.fillGroup.add(mesh);
    // Deliberately no x-ray overlay twin — an always-on-top interior surface
    // would wash out everything drawn inside the shape's footprint.
  },

  // Recompute the enclosed area + reposition the area label. Runs on every
  // re-derive so area tracks a vertex moving/added/removed (and an animation).
  _updateArea: function (verts, closed) {
    if (!closed) {
      this.area = 0;
      if (this.areaLabelObject) this.areaLabelObject.visible = false;
      return;
    }
    // Vertices are read in the entity's local frame — the same frame the meshes
    // and the label object live in — so the area (translation-invariant) and
    // the centroid position are consistent with the geometry with no world/
    // local offset. Read y from an actual vertex (0 for a committed centred
    // shape, but k for the preview entity sitting at the scene origin).
    const pts = verts.map((v) => v.object3D.position);
    this.area = polygonAreaXZ(pts);
    if (this.areaLabelObject) {
      const c = polygonCentroidXZ(pts);
      this.areaLabelObject.position.set(c.x, pts[0].y, c.z);
      this.areaLabelObject.visible = true;
      this._updateAreaLabelText();
    }
  },

  // Format `this.area` into the label per the units preference. Uses a literal
  // ² (renders natively in the DOM label). Inlined rather than importing the
  // editor's formatArea (core must not depend on editor/lib).
  _updateAreaLabelText: function () {
    if (!this.areaLabelObject) return;
    const text =
      this.units === 'imperial'
        ? `${(this.area * FT2_PER_M2).toFixed(2)}ft²`
        : `${this.area.toFixed(2)}m²`;
    this.areaLabelDiv.textContent = text;
  },

  // Add a translucent, always-on-top twin of `mesh` to the overlay group, so
  // the line reads through occluding geometry (a building wall). Own geometry
  // (not shared) so the group's clearGroup can dispose it uniformly.
  _addOverlayMesh: function (mesh) {
    const twin = new THREE.Mesh(mesh.geometry.clone(), this.overlayMaterial);
    twin.position.copy(mesh.position);
    twin.quaternion.copy(mesh.quaternion);
    twin.renderOrder = OVERLAY_RENDER_ORDER;
    twin.el = this.el; // coincident with the solid mesh — keep it selectable
    this.overlayGroup.add(twin);
  },

  // --- Editor-facing API — not model state -----------------------------
  //
  // The four methods below exist for the editor's drawing and vertex-editing
  // tools; nothing in the component or in a published scene calls them, and
  // none of them touches the schema, so none of their effects can be saved.
  // They live here rather than in the editor because the alternative is the
  // editor reaching into `el.components.shape.material` from outside, and
  // because keeping the writes on this side is what lets ONE method
  // (setInvalidSignal(false)) own restoring every channel they touch.
  //
  // A maintainer reading these cold should not mistake them for part of the
  // data model: they are transient presentation, and the shape is fully
  // described without them.

  // Enter/leave an editing gesture (one pointer drag). While one is in flight,
  // a ring that has gone self-crossing holds its last valid fill and area
  // rather than dropping them every frame — see rederive(). Leaving asks for a
  // re-derive so committed state settles immediately rather than on the next
  // vertex move.
  beginEditGesture: function () {
    this._editGesture = true;
  },

  endEditGesture: function () {
    this._editGesture = false;
    this.requestRederive();
  },

  // Turn the whole shape the invalid colour, or restore it. Clearing is the
  // SINGLE restore owner for both channels the signal touches — the line colour
  // and the x-ray overlay's opacity, which setInvalidPulse drives while the
  // signal is on. Restores from `this.data.lineColor`, read at clear time, so
  // the user's own colour comes back however it changed meanwhile and no
  // snapshot can go stale or leak across an abandoned gesture.
  setInvalidSignal: function (invalid) {
    this._invalidSignal = !!invalid;
    if (invalid) {
      this.material.color.set(INVALID_COLOR);
      this.overlayMaterial.color.set(INVALID_COLOR);
    } else {
      this.material.color.set(this.data.lineColor);
      this.overlayMaterial.color.set(this.data.lineColor);
      this.overlayMaterial.opacity = OVERLAY_OPACITY;
    }
  },

  // Second channel of the invalid signal: the overlay's opacity, so the state
  // reads by MOTION and stays unmistakable on a shape whose own colour is
  // already the invalid red. `phase` is the opacity to show, in 0..1 — the
  // caller owns the frequency, the easing and the band it oscillates between,
  // and this is only the write. A no-op unless the signal is set, so a stale
  // call can never strand the overlay at an arbitrary opacity.
  setInvalidPulse: function (phase) {
    if (!this._invalidSignal) return;
    this.overlayMaterial.opacity = phase;
  },

  // --- end editor-facing API -------------------------------------------

  // Dispose and detach every mesh in a group (the shared material is not
  // disposed here — remove() owns it).
  clearGroup: function (group) {
    for (let i = group.children.length - 1; i >= 0; i--) {
      const child = group.children[i];
      if (child.geometry) child.geometry.dispose();
      group.remove(child);
    }
  }
});
