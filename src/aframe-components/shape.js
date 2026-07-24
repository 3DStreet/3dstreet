/* global AFRAME, THREE */

// `shape` renders a polyline through its `shape-vertex` child entities. The
// ordered child positions are the sole source of truth; the line/vertex meshes
// are derived and set via setObject3D (never serialized). See DESIGN-NOTES for
// the data model.
//
// Re-derivation has three triggers:
//   - structural (a vertex attaches/detaches) — the child calls requestRederive
//   - position change — observed by the `shape` SYSTEM tick below (a system
//     tick runs while the scene is playing, independent of entity pause, so it
//     works in the paused editor where an entity tick would not)
//   - an explicit `updateEvent`, if the shape opts into event-driven updates
//     instead of the per-frame dirty-check

const UP = new THREE.Vector3(0, 1, 0);
const MIN_SEGMENT_LENGTH = 1e-6;

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
    lineWidth: { type: 'number', default: 0.15 }
    // Note: an event-driven opt-out of the system dirty-check (a shape could
    // re-derive on a named event instead of being polled) is intentionally not
    // exposed as a schema property here — the system tick covers everything at
    // this stage. The hooks below already honour `this.data.updateEvent`, so it
    // can be reintroduced as a schema prop when the editing UI wants it.
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

    this.material = new THREE.MeshStandardMaterial({
      color: this.data.lineColor,
      roughness: 0.8,
      metalness: 0.0
    });

    // Unlit, translucent, always-on-top material for the x-ray overlay copy.
    this.overlayMaterial = new THREE.MeshBasicMaterial({
      color: this.data.lineColor,
      transparent: true,
      opacity: OVERLAY_OPACITY,
      depthTest: false
    });

    this.el.sceneEl.systems.shape.register(this);

    // Play this shape (and its vertex children) so an `animation` on a vertex
    // runs. Honoured by the editor at open()/reload; a freshly created shape is
    // paused by the create command, so the animation begins after a reopen —
    // re-derivation itself is pause-independent (the system tick). Not
    // serialized, so it is re-applied on every load here.
    this.el.setAttribute('data-no-pause', '');

    // Suppress the whole-entity transform gizmo. It attaches to the shape's
    // object3D, which sits at the shape origin (the first vertex), not the
    // centroid — a confusing affordance. Whole-shape move is a deliberate,
    // correctly-placed affordance for a later phase.
    this.el.setAttribute('data-no-transform', '');

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
    this.clearGroup(this.lineGroup);
    this.clearGroup(this.vertexGroup);
    this.clearGroup(this.overlayGroup);
    this.material.dispose();
    this.overlayMaterial.dispose();
    if (this.el.getObject3D('mesh')) this.el.removeObject3D('mesh');
    if (this.el.getObject3D('shapeVertices')) {
      this.el.removeObject3D('shapeVertices');
    }
    if (this.el.getObject3D('shapeLineOverlay')) {
      this.el.removeObject3D('shapeLineOverlay');
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
      const start = verts[i].object3D.position;
      const end = verts[i + 1].object3D.position;
      this.direction.subVectors(end, start);
      const length = this.direction.length();
      if (length < MIN_SEGMENT_LENGTH) continue;

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
    }
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
