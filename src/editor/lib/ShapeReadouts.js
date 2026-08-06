/* global THREE */

// On-canvas length + angle readouts for a shape. One renderer drives both the
// live draw preview (a single active segment/corner) and a selected shape (all
// segments/corners, or a hovered one on large shapes). Labels are CSS2D DOM
// billboards (so the degree glyph renders); the angle "arc" is thin in-scene
// tube geometry lying in the x/z plane, so it reads at any camera angle and
// shows which corner is being measured.
//
// Everything is attached under the shape entity's object3D and torn down in
// dispose() — CSS2DObjects detached, arc geometries disposed, the group
// removed. (measure-line famously leaks its store subscription and never
// detaches its CSS2DObject; this renderer must not repeat that.)

import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  segmentLength,
  includedAngleDeg,
  angleLabelDir,
  distanceToSegmentXZ,
  formatLength,
  formatAngle
} from './shapeMeasure';

const ARC_RADIUS = 0.6; // metres — fixed world radius of the angle arc
const ARC_TUBE_RADIUS = 0.03;
const ARC_STEPS = 20;
const LABEL_OFFSET = 1.35; // angle label sits just outside the arc
const ARC_COLOR = 0x4c8dff;
const EPS = 1e-4;

export default class ShapeReadouts {
  constructor(el) {
    this.el = el;
    this.units = 'metric';
    this.group = new THREE.Group();
    this.group.name = 'shapeReadouts';
    if (el.object3D) el.object3D.add(this.group);
    this.arcMaterial = new THREE.MeshBasicMaterial({
      color: ARC_COLOR,
      depthTest: false,
      depthWrite: false, // always-on-top readout must not occlude the gizmo etc.
      transparent: true,
      opacity: 0.9
    });
    this.labels = []; // { obj: CSS2DObject, div: HTMLElement }
    this.arcs = []; // THREE.Mesh
  }

  setUnits(units) {
    this.units = units || 'metric';
  }

  // --- public render entry points -----------------------------------------

  // Draw mode: label only the active segment (prevIdx -> idx) and, if a corner
  // exists, the angle at prevIdx. `vertices` are THREE.Vector3 local to el.
  renderActive(vertices) {
    this.clear();
    const n = vertices.length;
    if (n < 2) return;
    const b = vertices[n - 1];
    const a = vertices[n - 2];
    this._addLengthLabel(a, b);
    if (n >= 3) this._addAngle(vertices[n - 3], a, b);
  }

  // Select mode: all segments/corners up to maxVertices, else the segment
  // nearest hoverPoint (a THREE.Vector3 in el-local space) only. When `closed`,
  // the ring has a wrap segment (last→first) and a corner at EVERY vertex
  // (indices 0 and n-1 gain a second adjacent segment), so all indexing wraps
  // mod n.
  //
  // `pinnedSegments` names segments that must be labelled whatever the cap
  // says.
  renderAll(
    vertices,
    maxVertices,
    hoverPoint,
    closed = false,
    pinnedSegments = null
  ) {
    this.clear();
    const n = vertices.length;
    if (n < 2) return;
    const ring = closed && n >= 3;
    // Number of segments and corners: a closed ring has n of each; an open
    // polyline has n-1 segments and n-2 interior corners.
    const segCount = ring ? n : n - 1;

    // Pinned segments are labelled unconditionally, and FIRST. An on-canvas
    // control stands beside these captions, so they cannot inherit an early
    // exit that the rest of the label set legitimately takes. The in-range
    // filter keeps this method total for any caller.
    const pinned = new Set();
    if (pinnedSegments) {
      for (const i of pinnedSegments) {
        if (i >= 0 && i < segCount) pinned.add(i);
      }
    }
    for (const i of pinned) {
      this._addLengthLabel(vertices[i], vertices[(i + 1) % n]);
    }

    if (n <= maxVertices) {
      for (let i = 0; i < segCount; i++) {
        if (pinned.has(i)) continue; // already drawn above
        this._addLengthLabel(vertices[i], vertices[(i + 1) % n]);
      }
      const cornerStart = ring ? 0 : 1;
      const cornerEnd = ring ? n : n - 1; // exclusive
      for (let i = cornerStart; i < cornerEnd; i++) {
        this._addAngle(
          vertices[(i + n - 1) % n],
          vertices[i],
          vertices[(i + 1) % n]
        );
      }
      return;
    }
    // Above the label cap it is hover-only: with no hover
    // point yet, show nothing beyond the pins rather than dumping all ~2N
    // labels — that dump is the exact jank the cap exists to prevent.
    if (!hoverPoint) return;
    // hover: nearest segment + the angle at its nearer endpoint. Search wraps
    // over the wrap segment too when closed (best can be n-1, whose end is
    // vertices[0] via mod n — never vertices[n]).
    let best = -1;
    let bestDist = Infinity;
    let bestT = 0;
    for (let i = 0; i < segCount; i++) {
      const { distance, t } = distanceToSegmentXZ(
        hoverPoint,
        vertices[i],
        vertices[(i + 1) % n]
      );
      if (distance < bestDist) {
        bestDist = distance;
        best = i;
        bestT = t;
      }
    }
    if (best < 0) return;
    if (!pinned.has(best)) {
      this._addLengthLabel(vertices[best], vertices[(best + 1) % n]);
    }
    const corner = bestT < 0.5 ? best : (best + 1) % n;
    // On a closed ring every corner is valid; on an open line skip the two
    // endpoints (no interior angle there).
    if (ring || (corner > 0 && corner < n - 1)) {
      this._addAngle(
        vertices[(corner + n - 1) % n],
        vertices[corner],
        vertices[(corner + 1) % n]
      );
    }
  }

  // --- internals ----------------------------------------------------------

  _addLengthLabel(a, b) {
    const len = segmentLength(a, b);
    if (len < EPS) return; // zero-length segment carries no readout
    const mid = new THREE.Vector3(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      (a.z + b.z) / 2
    );
    this._makeLabel(formatLength(len, this.units), mid);
  }

  _addAngle(u, v, w) {
    const deg = includedAngleDeg(u, v, w);
    if (deg === null) return; // degenerate corner — suppressed, never NaN
    // Scale the arc to the shorter adjacent segment so it never overshoots the
    // corner it annotates (fixed 0.6 m arcs overlap / cross the neighbour on
    // small shapes or a zoomed-in draw).
    const la = Math.hypot(u.x - v.x, u.z - v.z);
    const lb = Math.hypot(w.x - v.x, w.z - v.z);
    const radius = Math.min(ARC_RADIUS, 0.4 * Math.min(la, lb));
    if (radius >= 0.03) this._makeArc(u, v, w, radius);
    const dir = angleLabelDir(u, v, w);
    const labelR = Math.max(radius, 0.15); // keep the number clear of the corner
    const pos = v.clone().addScaledVector(dir, labelR * LABEL_OFFSET);
    this._makeLabel(formatAngle(deg), pos);
  }

  _makeArc(u, v, w, radius) {
    const a = new THREE.Vector3(u.x - v.x, 0, u.z - v.z);
    const b = new THREE.Vector3(w.x - v.x, 0, w.z - v.z);
    if (a.lengthSq() < EPS || b.lengthSq() < EPS) return;
    a.normalize();
    b.normalize();
    const axis = a.clone().cross(b);
    if (axis.lengthSq() < 1e-8) return; // straight/collinear — no arc drawn
    axis.normalize();
    const theta = Math.acos(Math.max(-1, Math.min(1, a.dot(b))));
    const pts = [];
    const q = new THREE.Quaternion();
    for (let i = 0; i <= ARC_STEPS; i++) {
      q.setFromAxisAngle(axis, (theta * i) / ARC_STEPS);
      pts.push(a.clone().applyQuaternion(q).multiplyScalar(radius).add(v));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geometry = new THREE.TubeGeometry(
      curve,
      ARC_STEPS,
      ARC_TUBE_RADIUS,
      6,
      false
    );
    const mesh = new THREE.Mesh(geometry, this.arcMaterial);
    mesh.renderOrder = 999;
    // The inspector raycaster maps a hit to its entity via hit.object.el with
    // no parent walk. Without this, clicking the arc would
    // silently fail to select the shape.
    mesh.el = this.el;
    this.group.add(mesh);
    this.arcs.push(mesh);

    // Two radii from the vertex out THROUGH the arc (10% past it) — a
    // protractor look that pins exactly where the vertex is and which angle is
    // being read. Overshooting the arc (rather than meeting it) keeps it from
    // reading as a filled triangle.
    this._addRadius(v, a, radius * 1.2);
    this._addRadius(v, b, radius * 1.2);
  }

  // A thin always-on-top tube from vertex `v` outward along unit dir `dir` for
  // `length` (one arm of the angle protractor). Thinner than the arc so the
  // two together don't read as a solid triangle.
  _addRadius(v, dir, length) {
    const geometry = new THREE.CylinderGeometry(
      ARC_TUBE_RADIUS * 0.5,
      ARC_TUBE_RADIUS * 0.5,
      length,
      6
    );
    const mesh = new THREE.Mesh(geometry, this.arcMaterial);
    mesh.position.copy(v).addScaledVector(dir, length / 2);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    mesh.renderOrder = 999;
    mesh.el = this.el;
    this.group.add(mesh);
    this.arcs.push(mesh); // disposed with the arcs in clear()
  }

  // The chip's rendered HEIGHT is depended on elsewhere: shapeEditRules'
  // CAPTION_HALF_PX is half of it, and is what stands an insert button clear of
  // the caption it is anchored to. Changing the font size, the line-height or
  // the vertical padding below therefore has to be carried across to that
  // constant — nothing here will fail if it is not, the button simply drifts
  // into or away from the label.
  _makeLabel(text, pos) {
    const div = document.createElement('div');
    div.className = 'label shape-readout-label';
    div.style.color = '#fff';
    div.style.fontFamily = 'sans-serif';
    div.style.fontSize = '12px';
    div.style.padding = '2px 4px';
    div.style.backgroundColor = 'rgba(0, 0, 0, 0.6)';
    div.style.borderRadius = '3px';
    div.style.pointerEvents = 'none';
    div.textContent = text;
    const obj = new CSS2DObject(div);
    obj.position.copy(pos);
    this.group.add(obj);
    this.labels.push({ obj, div });
  }

  // Remove all rendered labels/arcs but keep the group + material for reuse.
  clear() {
    for (const { obj, div } of this.labels) {
      this.group.remove(obj);
      if (div && div.parentNode) div.parentNode.removeChild(div);
    }
    this.labels.length = 0;
    for (const mesh of this.arcs) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.arcs.length = 0;
  }

  // Full teardown — call on deselect / tool exit / entity removal.
  dispose() {
    this.clear();
    if (this.el && this.el.object3D && this.group.parent) {
      this.el.object3D.remove(this.group);
    }
    this.arcMaterial.dispose();
    this.el = null;
  }
}
