/* global AFRAME, THREE */
// managed-intersection — prototype successor to the legacy `intersection`
// component (#438, #1029, #1224).
//
// Instead of hand-tuned dimensions and a rotated frame, a managed
// intersection derives its geometry from the managed streets whose endpoint
// nodes meet it: place the entity, and every managed-street endpoint within
// `snapRadius` becomes a connecting arm. From 2+ arms it generates the
// roadway surface (edge lines intersected, corners rounded with curb-return
// fillets), sidewalk corner wedges, and per-arm treatments (crosswalks,
// stop signs / signals). Two collinear arms degenerate to a seam band — a
// crosswalk joint between two streets.
//
// Fixes the legacy component's biggest editing hazard (#1029): the entity
// lives at rotation 0 0 0 with Y up; all generated geometry is built in the
// local XZ ground plane.
//
// Everything generated is presentation output, rebuilt from the connected
// streets on every change: the THREE meshes hang off setObject3D (never
// serialized) and the treatment entities carry the `autocreated` class (
// skipped on save, same as the legacy component and street generators).
// The ONE way streets are modified: with trimStreets on (default), an
// overlapping street is shortened so its node sits at the mouth — otherwise
// the street's sidewalks and everything cloned along them (trees, lamps,
// pedestrians) run through the junction. Trim only, never extend, and the
// mouth is a fixed point in space for a node sliding along its centerline,
// so the pass converges instead of creeping (see
// docs/managed-intersection.md and managed-intersection-utils.js).
//
// Geometry math lives in src/tested/managed-intersection-utils.js
// (unit-tested, DOM-free).

import { computeIntersectionGeometry } from '../tested/managed-intersection-utils.js';
import { getTravelledWaySegments } from './street-layout-utils';
import {
  BASE_SURFACE_DEPTH,
  CURB_HEIGHT
} from '../tested/street-segment-utils';

// Roadway slab: 1cm above the street segments' top surface. With trimStreets
// on (the default) connecting streets stop flush at the mouth, so this is a
// near-invisible lip; with trimming off an overlapping street's surface stays
// hidden but its lane markings (MARKING_SURFACE_OFFSET above the segment
// surface) will poke through — see docs/managed-intersection.md.
const SURFACE_TOP = BASE_SURFACE_DEPTH + 0.01;
// Sidewalk corner wedges: same top as the streets' own sidewalk segments
// (elevation one curb step), so trimmed sidewalks continue seamlessly into
// the corner.
const WEDGE_TOP = BASE_SURFACE_DEPTH + CURB_HEIGHT;
const SIGNATURE_PRECISION = 3;
// Trim tolerance: node-to-mouth gaps smaller than this are left alone, which
// is what stops the trim pass from chasing float noise across rebuilds.
const TRIM_EPSILON = 0.05;
const MIN_TRIMMED_STREET_LENGTH = 4;
const UP_AXIS = new THREE.Vector3(0, 1, 0);

// Same "counts as sidewalk" list as the streetmix parsers (kept local so this
// ESM component never touches the CJS parser bundle): contiguous runs of
// these at a street's outer edges form the curb band; what's between is the
// curb-to-curb roadway the intersection surface and crosswalks span.
const CURBSIDE_TYPES = [
  'utilities',
  'scooter-drop-zone',
  'bikeshare',
  'flex-zone-curb',
  'transit-shelter',
  'brt-station',
  'street-vendor'
];
function isCurbsideType(type) {
  return (
    !!type && (type.startsWith('sidewalk') || CURBSIDE_TYPES.includes(type))
  );
}

// Flat crosswalk mixins reused from the legacy intersection (the raised GLB
// variant is not supported by the prototype). Image crosswalks are wider
// planes, matching the legacy per-mixin transforms. The mixin plane is 2m
// wide, so a band's plan width is 2 * widthScale. Exported for the plan
// (DXF/PDF) exporter, which redraws the same bands as linework.
export const CROSSWALK_MIXINS = {
  'crosswalk-zebra': { widthScale: 1 },
  'crosswalk-rainbow': { widthScale: 1.5 },
  'crosswalk-double': { widthScale: 1.5 },
  'crosswalk-mural': { widthScale: 1.5 },
  'crosswalk-piano': { widthScale: 1.5 }
};
// How far the crosswalk band's center sits inside each mouth (meters along
// the arm toward the intersection center). Shared with the plan exporter.
export const CROSSWALK_INSET = 1.6;

AFRAME.registerComponent('managed-intersection', {
  schema: {
    // Comma-separated managed-street element ids to connect. Empty (the
    // default) auto-connects every managed street with an endpoint node
    // within snapRadius.
    streets: { type: 'string', default: '' },
    snapRadius: { type: 'number', default: 20 },
    curbRadius: { type: 'number', default: 3 },
    crosswalk: {
      type: 'string',
      default: 'crosswalk-zebra',
      oneOf: ['none', ...Object.keys(CROSSWALK_MIXINS)]
    },
    trafficControl: {
      type: 'string',
      default: 'none',
      oneOf: ['none', 'stop', 'signal']
    },
    showSidewalkCorners: { type: 'boolean', default: true },
    // Shorten connecting streets so their nodes sit exactly at the mouth:
    // the street body (surface, sidewalks, AND everything generated along
    // them — trees, lamps, pedestrians) stops at the intersection edge
    // instead of running underneath it. Trim only — a street stopping short
    // of the intersection is never extended. The mouth geometry is anchored
    // in space (see managed-intersection-utils.js), so trimming converges
    // instead of creeping. Note: trimming edits the street's
    // position/length for real; deleting the intersection later does not
    // grow the streets back (drag their endpoint nodes to reconnect).
    trimStreets: { type: 'boolean', default: true },
    // Radius of the placeholder pad shown while fewer than 2 streets connect.
    placeholderRadius: { type: 'number', default: 6 }
  },

  init: function () {
    this.autoChildren = [];
    this.generatedGeometries = [];
    this.lastSignature = null;
    this.refresh = this.refresh.bind(this);

    // Same command-layer guard as managed-street: the intersection's size IS
    // the connected streets' geometry, an object3D scale would desync it.
    this.el.setAttribute('data-transform-no-scale', '');

    // Streets flatten geospatial terrain under their footprint by default;
    // intersections join in with the same opt-out-preserving guard (#1476).
    if (!this.el.hasAttribute('geo-flatten')) {
      this.el.setAttribute('geo-flatten', 'mode: auto');
    }

    // The connected streets are edited through many routes (gizmos,
    // properties panel, undo, AI chat, load order) with no single event to
    // subscribe to, so change detection is a throttled signature watch. It
    // runs on an interval rather than tick because the editor keeps A-Frame
    // ticks paused while the inspector is open — exactly when streets are
    // being dragged around.
    this.watchInterval = setInterval(() => {
      if (!this.el.isConnected) return;
      const signature = this.computeSignature();
      if (signature !== this.lastSignature) {
        this.refresh();
      }
    }, 400);

    // Reusable temporaries for arm collection.
    this._vec = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._inv = new THREE.Matrix4();
  },

  update: function () {
    // Defer so streets created in the same tick (scene load) are initialized.
    setTimeout(() => {
      if (this.el.isConnected) {
        this.lastSignature = null; // force
        this.refresh();
      }
    }, 0);
  },

  getCandidateStreets: function () {
    const explicit = this.data.streets
      .split(',')
      .map((s) => s.trim().replace(/^#/, ''))
      .filter(Boolean);
    const all = Array.from(
      this.el.sceneEl.querySelectorAll('a-entity[managed-street]')
    ).filter((street) => {
      const ms = street.components['managed-street'];
      if (!ms) return false;
      if (ms.data.path) return false; // curved streets have no straight nodes
      return explicit.length === 0 || explicit.includes(street.id);
    });
    return all;
  },

  computeSignature: function () {
    const parts = [];
    const selfM = this.el.object3D.matrixWorld.elements;
    parts.push(selfM.map((v) => v.toFixed(SIGNATURE_PRECISION)).join(','));
    this.getCandidateStreets().forEach((street) => {
      const m = street.object3D.matrixWorld.elements;
      const ms = street.components['managed-street'].data;
      const align = street.getAttribute('street-align') || {};
      const segs = getTravelledWaySegments(street)
        .map((seg) => {
          const d = seg.getAttribute('street-segment') || {};
          return `${d.type}:${d.width}`;
        })
        .join('|');
      parts.push(
        [
          street.id,
          m.map((v) => v.toFixed(SIGNATURE_PRECISION)).join(','),
          ms.length,
          align.width,
          align.length,
          segs
        ].join(';')
      );
    });
    return parts.join('\n');
  },

  /**
   * Walk the managed streets and turn every endpoint node within snapRadius
   * into an arm in the intersection's local ground plane: node point,
   * outward unit direction, and lateral extents (roadway + full travelled
   * way) along the arm's normal. A street's node position replicates the
   * street-gizmo endpoint math: local (centerlineX, 0, z(align)).
   */
  collectArms: function () {
    const arms = [];
    const obj = this.el.object3D;
    obj.updateWorldMatrix(true, false);
    this._inv.copy(obj.matrixWorld).invert();

    this.getCandidateStreets().forEach((street) => {
      const ms = street.components['managed-street'];
      const segments = getTravelledWaySegments(street);
      if (segments.length === 0) return;
      const entries = segments
        .map((seg) => seg.getAttribute('street-segment'))
        .filter(Boolean);
      const totalWidth = entries.reduce((sum, e) => sum + (e.width || 0), 0);
      if (totalWidth <= 0.1) return;

      const align = street.getAttribute('street-align') || {};
      const widthAlign = align.width || 'center';
      const lengthAlign = align.length || 'start';
      const length = ms.data.length;
      const centerX =
        widthAlign === 'left'
          ? totalWidth / 2
          : widthAlign === 'right'
            ? -totalWidth / 2
            : 0;
      const zByKey =
        lengthAlign === 'middle'
          ? { start: -length / 2, end: length / 2 }
          : lengthAlign === 'end'
            ? { start: 0, end: length }
            : { start: -length, end: 0 };

      street.object3D.updateWorldMatrix(true, false);

      // Nearest endpoint node in intersection-local space.
      let best = null;
      ['start', 'end'].forEach((key) => {
        this._vec.set(centerX, 0, zByKey[key]);
        street.object3D.localToWorld(this._vec);
        this._vec.applyMatrix4(this._inv);
        const dist = Math.hypot(this._vec.x, this._vec.z);
        if (!best || dist < best.dist) {
          best = { key, dist, point: { x: this._vec.x, z: this._vec.z } };
        }
      });
      if (!best || best.dist > this.data.snapRadius) return;

      // Outward direction: street local +Z runs start→end, so the street
      // extends along +Z from its start node and along -Z from its end node.
      this._dir.set(0, 0, best.key === 'start' ? 1 : -1);
      this._dir.transformDirection(street.object3D.matrixWorld);
      this._dir.transformDirection(this._inv);
      this._dir.y = 0;
      if (this._dir.lengthSq() < 1e-6) return; // vertical street, ignore
      this._dir.normalize();
      const dir = { x: this._dir.x, z: this._dir.z };
      const n = { x: -dir.z, z: dir.x };

      // Lateral extents relative to the node. Segments are laid out along
      // street-local +X in DOM order, spanning [-W/2, +W/2] around the
      // travelled-way center (which is where the node sits for every
      // street-align width mode). Strip the contiguous curbside band at each
      // edge to get the curb-to-curb roadway.
      let cursor = -totalWidth / 2;
      const spans = entries.map((e) => {
        const span = {
          type: e.type,
          from: cursor,
          to: cursor + (e.width || 0)
        };
        cursor = span.to;
        return span;
      });
      let lo = 0;
      let hi = spans.length - 1;
      while (lo <= hi && isCurbsideType(spans[lo].type)) lo++;
      while (hi >= lo && isCurbsideType(spans[hi].type)) hi--;
      let roadMinX = -totalWidth / 2;
      let roadMaxX = totalWidth / 2;
      if (lo <= hi) {
        roadMinX = spans[lo].from;
        roadMaxX = spans[hi].to;
      }

      // Map street-local X onto the arm's normal: whether local +X points
      // along +n or -n depends on which endpoint faces the intersection.
      this._dir.set(1, 0, 0);
      this._dir.transformDirection(street.object3D.matrixWorld);
      this._dir.transformDirection(this._inv);
      const flip = this._dir.x * n.x + this._dir.z * n.z < 0;
      const road = flip
        ? { min: -roadMaxX, max: -roadMinX }
        : { min: roadMinX, max: roadMaxX };
      const full = { min: -totalWidth / 2, max: totalWidth / 2 };

      arms.push({
        id: street.id || '',
        el: street,
        point: best.point,
        dir,
        road,
        full,
        // Trim-pass metadata: which endpoint this arm is, and the street's
        // node math inputs (see applyStreetTrims).
        endKey: best.key,
        length,
        lengthAlign,
        centerX
      });
    });
    return arms;
  },

  refresh: function () {
    this.clearGenerated();

    const arms = this.collectArms();
    let geometry = null;
    if (arms.length >= 2) {
      const crosswalkOn = this.data.crosswalk !== 'none';
      geometry = computeIntersectionGeometry(arms, {
        curbRadius: Math.max(0, this.data.curbRadius),
        // With crosswalks on, push the mouths out so the ~2m band lands on
        // straight edge past the fillet tangents.
        minSetback: crosswalkOn ? 3.2 : 1,
        mouthMargin: crosswalkOn ? 3.0 : 0.3
      });
    }

    if (geometry) {
      this.buildSurfaces(geometry);
      this.buildTreatments(geometry, arms);
      this.applyStreetTrims(geometry, arms);
    } else {
      this.buildPlaceholder();
    }

    // Latest computed geometry (null while the placeholder pad shows), read
    // by the plan exporter (planModel.js) so DXF/PDF linework always matches
    // the rendered intersection.
    this.lastGeometry = geometry;

    this.lastSignature = this.computeSignature();
    this.el.emit('intersection-refreshed', { armCount: arms.length }, false);
  },

  // --- street trimming ------------------------------------------------------

  /**
   * Shorten every overlapping connected street so its node lands exactly on
   * the mouth, keeping its FAR endpoint (and rotation) fixed — the same
   * origin-rebuild math as the street endpoint gizmo, but sliding the node
   * along the existing centerline. mouth.t is the node→mouth distance along
   * the arm, so it is exactly the overlap depth; ≤ 0 means the street stops
   * short (a gap), which is deliberately left alone — trim never extends,
   * so dragging a street away from an intersection doesn't fight the watch.
   *
   * Stability: the mouth is a fixed point in space for a node sliding along
   * its centerline (see managed-intersection-utils.js), so after one trim
   * the next rebuild computes mouth.t ≈ 0 and the pass no-ops.
   */
  applyStreetTrims: function (geometry, arms) {
    if (!this.data.trimStreets) return;
    geometry.mouths.forEach((mouth) => {
      const arm = arms[mouth.arm];
      const delta = mouth.t;
      if (!(delta > TRIM_EPSILON)) return;
      const street = arm.el;
      const newLength = Math.round((arm.length - delta) * 1000) / 1000;
      if (newLength < MIN_TRIMMED_STREET_LENGTH) return;

      // New node point: slid `delta` along the arm, in street-parent space.
      this._vec.set(
        arm.point.x + arm.dir.x * delta,
        0,
        arm.point.z + arm.dir.z * delta
      );
      this.el.object3D.localToWorld(this._vec);
      street.object3D.parent.worldToLocal(this._vec);

      // Rebuild the street origin so this node lands at its endpoint slot
      // for the new length (assumes an upright street in its parent, like
      // the endpoint gizmo does).
      const zByKey =
        arm.lengthAlign === 'middle'
          ? { start: -newLength / 2, end: newLength / 2 }
          : arm.lengthAlign === 'end'
            ? { start: 0, end: newLength }
            : { start: -newLength, end: 0 };
      this._dir.set(arm.centerX, 0, zByKey[arm.endKey]);
      const rotY = THREE.MathUtils.degToRad(
        street.getAttribute('rotation')?.y || 0
      );
      this._dir.applyAxisAngle(UP_AXIS, rotY);

      const pos = street.getAttribute('position');
      street.setAttribute('position', {
        x: Math.round((this._vec.x - this._dir.x) * 1000) / 1000,
        y: pos.y,
        z: Math.round((this._vec.z - this._dir.z) * 1000) / 1000
      });
      street.setAttribute('managed-street', 'length', newLength);
    });
  },

  // --- materials (created lazily once, reused across refreshes) -----------

  getAsphaltMaterial: function () {
    if (this.asphaltMaterial) return this.asphaltMaterial;
    const img = document.getElementById('asphalt-texture');
    if (img) {
      const texture = new THREE.TextureLoader().load(img.src);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(0.25, 0.25); // ~1 tile per 4m, like the legacy box
      texture.colorSpace = THREE.SRGBColorSpace;
      this.asphaltTexture = texture;
      this.asphaltMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 1
      });
    } else {
      this.asphaltMaterial = new THREE.MeshStandardMaterial({
        color: 0x555555,
        roughness: 1
      });
    }
    return this.asphaltMaterial;
  },

  getSidewalkMaterial: function () {
    if (this.sidewalkMaterial) return this.sidewalkMaterial;
    const img = document.getElementById('seamless-sidewalk');
    if (img) {
      const texture = new THREE.TextureLoader().load(img.src);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(0.5, 0.5); // match the legacy intersection curbs
      texture.colorSpace = THREE.SRGBColorSpace;
      this.sidewalkTexture = texture;
      this.sidewalkMaterial = new THREE.MeshStandardMaterial({
        map: texture,
        roughness: 0.8,
        color: 0xcccccc
      });
    } else {
      this.sidewalkMaterial = new THREE.MeshStandardMaterial({
        color: 0xbbbbbb,
        roughness: 0.8
      });
    }
    return this.sidewalkMaterial;
  },

  // --- mesh building -------------------------------------------------------

  // Polygon points are intersection-local {x,z}; THREE.Shape lives in XY, so
  // build with y = -z and rotate the mesh -90° about X: (x, y, 0) → (x, 0, -y)
  // puts the shape back on the ground plane with the extrusion running up.
  makeSlab: function (points, top, material) {
    const shape = new THREE.Shape(
      points.map((p) => new THREE.Vector2(p.x, -p.z))
    );
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: top,
      bevelEnabled: false
    });
    this.generatedGeometries.push(geom);
    const mesh = new THREE.Mesh(geom, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  },

  buildSurfaces: function (geometry) {
    const group = new THREE.Group();
    group.add(
      this.makeSlab(geometry.surface, SURFACE_TOP, this.getAsphaltMaterial())
    );
    if (this.data.showSidewalkCorners) {
      geometry.corners.forEach((corner) => {
        if (!corner.wedge) return;
        group.add(
          this.makeSlab(corner.wedge, WEDGE_TOP, this.getSidewalkMaterial())
        );
      });
    }
    this.el.setObject3D('managed-intersection', group);
  },

  buildPlaceholder: function () {
    const radius = Math.max(1, this.data.placeholderRadius);
    const geom = new THREE.CylinderGeometry(radius, radius, SURFACE_TOP, 48);
    this.generatedGeometries.push(geom);
    const mesh = new THREE.Mesh(geom, this.getAsphaltMaterial());
    mesh.position.y = SURFACE_TOP / 2;
    mesh.receiveShadow = true;
    const group = new THREE.Group();
    group.add(mesh);
    this.el.setObject3D('managed-intersection', group);
  },

  // --- treatment entities (crosswalks, traffic control) --------------------

  addAutoChild: function (components, layerName) {
    const child = document.createElement('a-entity');
    child.classList.add('autocreated');
    child.setAttribute('data-layer-name', layerName);
    child.setAttribute('data-no-transform', '');
    child.setAttribute('data-ignore-raycaster', '');
    Object.entries(components).forEach(([name, value]) => {
      child.setAttribute(name, value);
    });
    this.autoChildren.push(child);
    this.el.appendChild(child);
    return child;
  },

  armLabel: function (arm, index) {
    const layerName = arm.el?.getAttribute('data-layer-name');
    return layerName || arm.id || `Arm ${index + 1}`;
  },

  buildTreatments: function (geometry, arms) {
    const crosswalkDef = CROSSWALK_MIXINS[this.data.crosswalk];
    geometry.mouths.forEach((mouth, i) => {
      const label = this.armLabel(arms[mouth.arm], i);
      if (crosswalkDef) {
        this.addCrosswalk(mouth, crosswalkDef, label);
      }
      if (this.data.trafficControl === 'stop') {
        this.addStopSign(mouth, label);
      } else if (this.data.trafficControl === 'signal') {
        this.addSignals(mouth, label);
      }
    });
  },

  addCrosswalk: function (mouth, def, label) {
    // ~2m band just inside the mouth, spanning the roadway. The mixin plane
    // is 2×12m in local XY; the -90° X pitch lays it flat with its 12m axis
    // along local -Z, so the wrapper's yaw points -Z along the mouth line.
    const center = {
      x: mouth.center.x - mouth.dir.x * CROSSWALK_INSET,
      z: mouth.center.z - mouth.dir.z * CROSSWALK_INSET
    };
    const yaw = THREE.MathUtils.radToDeg(
      Math.atan2(-mouth.normal.x, -mouth.normal.z)
    );
    const wrapper = this.addAutoChild(
      {
        position: `${center.x.toFixed(3)} ${(SURFACE_TOP + 0.02).toFixed(3)} ${center.z.toFixed(3)}`,
        rotation: `0 ${yaw.toFixed(2)} 0`
      },
      `Crosswalk • ${label}`
    );
    const plane = document.createElement('a-entity');
    plane.classList.add('autocreated');
    plane.setAttribute('mixin', this.data.crosswalk);
    plane.setAttribute('rotation', '-90 0 0');
    plane.setAttribute(
      'scale',
      `${def.widthScale} ${(mouth.width / 12).toFixed(4)} 1`
    );
    plane.setAttribute('data-no-transform', '');
    plane.setAttribute('data-ignore-raycaster', '');
    wrapper.appendChild(plane);
  },

  // Traffic control stands on the right-hand side of the incoming approach
  // (right-hand traffic): heading toward the intersection along -dir, the
  // right side is the arm's -normal side.
  controlPost: function (mouth, lateralExtra, alongExtra) {
    const side = -1; // -normal = approach right
    const lateral = mouth.width / 2 + lateralExtra;
    return {
      x:
        mouth.center.x +
        mouth.normal.x * side * lateral +
        mouth.dir.x * alongExtra,
      z:
        mouth.center.z +
        mouth.normal.z * side * lateral +
        mouth.dir.z * alongExtra
    };
  },

  // Yaw that faces the model toward the incoming traffic on this arm.
  approachYaw: function (mouth) {
    return THREE.MathUtils.radToDeg(Math.atan2(mouth.dir.x, mouth.dir.z));
  },

  addStopSign: function (mouth, label) {
    const p = this.controlPost(mouth, 0.8, 0.5);
    this.addAutoChild(
      {
        position: `${p.x.toFixed(3)} ${WEDGE_TOP.toFixed(3)} ${p.z.toFixed(3)}`,
        rotation: `0 ${this.approachYaw(mouth).toFixed(2)} 0`,
        mixin: 'stop_sign'
      },
      `Stop Sign • ${label}`
    );
  },

  addSignals: function (mouth, label) {
    // Same pairing as the legacy component: a right-corner signal for this
    // approach, and a left-corner signal (mast pointing back over the road).
    const yaw = this.approachYaw(mouth);
    const right = this.controlPost(mouth, 0.8, 0.5);
    this.addAutoChild(
      {
        position: `${right.x.toFixed(3)} ${WEDGE_TOP.toFixed(3)} ${right.z.toFixed(3)}`,
        rotation: `0 ${yaw.toFixed(2)} 0`,
        mixin: 'signal_right'
      },
      `Signal Right • ${label}`
    );
    const left = {
      x:
        mouth.center.x +
        mouth.normal.x * (mouth.width / 2 + 0.8) +
        mouth.dir.x * 0.5,
      z:
        mouth.center.z +
        mouth.normal.z * (mouth.width / 2 + 0.8) +
        mouth.dir.z * 0.5
    };
    this.addAutoChild(
      {
        position: `${left.x.toFixed(3)} ${WEDGE_TOP.toFixed(3)} ${left.z.toFixed(3)}`,
        rotation: `0 ${yaw.toFixed(2)} 0`,
        mixin: 'signal_left'
      },
      `Signal Left • ${label}`
    );
  },

  // --- lifecycle -----------------------------------------------------------

  clearGenerated: function () {
    this.autoChildren.forEach((child) => {
      if (child.parentNode) child.parentNode.removeChild(child);
    });
    this.autoChildren = [];
    if (this.el.getObject3D('managed-intersection')) {
      this.el.removeObject3D('managed-intersection');
    }
    this.generatedGeometries.forEach((geom) => geom.dispose());
    this.generatedGeometries = [];
  },

  remove: function () {
    clearInterval(this.watchInterval);
    this.clearGenerated();
    this.asphaltMaterial?.dispose();
    this.sidewalkMaterial?.dispose();
    this.asphaltTexture?.dispose();
    this.sidewalkTexture?.dispose();
  }
});
