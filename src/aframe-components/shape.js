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

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import useStore from '../store.js';
import { polygonAreaXZ, polygonCentroidXZ } from './polygonMath.js';

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
    lineWidth: { type: 'number', default: 0.15 },
    // A closed shape is a polygon: the derive adds a wrap segment (last→first)
    // and the area label shows. Default false so every existing/open shape
    // stays open; a non-default `true` serializes and round-trips (default is
    // stripped on save, so an open shape carries no `closed` key).
    closed: { type: 'boolean', default: false },
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

    // Play this shape (and its vertex children) so an `animation` on a vertex
    // runs. Honoured by the editor at open()/reload; a freshly created shape is
    // paused by the create command, so the animation begins after a reopen —
    // re-derivation itself is pause-independent (the system tick). Not
    // serialized, so it is re-applied on every load here.
    this.el.setAttribute('data-no-pause', '');

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

    // The entity-create command pauses the new entity immediately after init;
    // play it once loaded so a child `animation` runs right away rather than
    // only after a reload (the editor re-plays [data-no-pause] elements on
    // open, which covers the reload path). Re-derivation itself never depends
    // on this — the system tick observes positions regardless of pause.
    this.el.addEventListener(
      'loaded',
      () => {
        if (!this.destroyed) this.el.play();
      },
      { once: true }
    );
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
    const radius = this.data.lineWidth;

    this.clearGroup(this.lineGroup);
    this.clearGroup(this.vertexGroup);
    this.clearGroup(this.overlayGroup);
    this.clearGroup(this.fillGroup);

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
    const closed = this.data.closed && verts.length >= 3;
    if (closed) {
      this._addSegment(
        verts[verts.length - 1].object3D.position,
        verts[0].object3D.position,
        radius
      );
      this._addFill(verts);
    }

    this._updateArea(verts, closed);
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
  // Rings are guaranteed simple — the draw tool rejects any placement whose edge
  // would cross an existing one — so the triangulation is well defined; concave
  // rings are handled. Callers gate on `closed`: an open polyline has no defined
  // interior, and filling one would let a click in empty space between its
  // endpoints select it while the sidebar reports zero area.
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
