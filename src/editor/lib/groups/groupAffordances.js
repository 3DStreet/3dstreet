/* global THREE */
// Canvas affordances for user groups that are not part of the scene: the
// center marker, and the analytic pick volumes (the selected group's box, the
// markers, the innermost open group's volume).
//
// None of them is a scene object the entity raycaster or the navigation probes
// can hit. Markers live in the inspector's helper scene with a no-op raycast,
// and the pick volumes are ray/box tests, so camera navigation and placement
// never land on an editor affordance.
//
// The set of user groups is re-queried, not tracked per element: structural
// changes mark it dirty and the next editor frame rebuilds it with one query.
// That covers a removed subtree whose descendants never report their own
// removal to the scene.

import Events from '../Events';
import {
  getGroupBounds,
  getGroupCenter,
  readStoredCenter
} from './groupBounds.js';
import { isHiddenInHierarchy, isUserGroup } from './groupModel.js';
import { rayHitsGroupBox } from './groupTransformMath.js';

// The marker is a small white sphere with six axis stubs, sized in screen
// pixels so an empty group can be found at any distance.
const MARKER_RADIUS_PX = 6;
// Each stub runs from the sphere's surface outward by one sphere diameter.
const MARKER_STUB_DIAMETERS = 1;
// Half the side of the marker's pick cube, in sphere radii: larger than the
// sphere, so the marker is easy to hit, and inside the stubs' reach.
const MARKER_PICK_RADII = 2;
// Drawn over the transform gizmo (which sits at 210-215), so the pad below a
// selected group's center never hides its marker.
const MARKER_RENDER_ORDER = 999;
const MARKER_OPACITY = 0.75;
const MARKER_OPACITY_HOVERED = 1;

let scratch = null;
function tmp() {
  if (!scratch) {
    scratch = {
      center: new THREE.Vector3(),
      camera: new THREE.Vector3(),
      origin: new THREE.Vector3(),
      cube: new THREE.Box3(),
      placed: new THREE.Matrix4(),
      inverse: new THREE.Matrix4()
    };
  }
  return scratch;
}

/**
 * World length of `pixels` screen pixels at `worldPos`, seen by `camera` in a
 * viewport `viewportHeight` pixels tall. With no layout yet (height 0) it
 * falls back to one world unit per pixel-size unit, which keeps tests and a
 * not-yet-shown canvas deterministic.
 */
export function screenSpaceSize(camera, worldPos, pixels, viewportHeight) {
  if (!camera || !viewportHeight) return pixels / MARKER_RADIUS_PX;
  let worldPerPixel;
  if (camera.isOrthographicCamera) {
    worldPerPixel = (camera.top - camera.bottom) / camera.zoom / viewportHeight;
  } else {
    const distance = camera.getWorldPosition(tmp().camera).distanceTo(worldPos);
    const vFov = THREE.MathUtils.degToRad(camera.fov);
    worldPerPixel = (2 * Math.tan(vFov / 2) * distance) / viewportHeight;
  }
  return Math.max(worldPerPixel * pixels, 1e-6);
}

/**
 * Distance along `ray` into a solid volume (a local box placed by `matrix`),
 * 0 when the ray starts inside it, or null for a miss.
 */
function volumeDistance(ray, box, matrix) {
  const distance = rayHitsGroupBox(ray, box, matrix);
  if (distance === null) return null;
  const t = tmp();
  t.inverse.copy(matrix).invert();
  t.origin.copy(ray.origin).applyMatrix4(t.inverse);
  return box.containsPoint(t.origin) ? 0 : distance;
}

/** Does `groupEl` have no entity inside it that is shown? */
function hasNoShownMember(groupEl) {
  const descendants = groupEl.querySelectorAll('*');
  for (let i = 0; i < descendants.length; i++) {
    const node = descendants[i];
    if (node.isEntity && !isHiddenInHierarchy(node)) return false;
  }
  return true;
}

let sharedParts = null;
function markerParts() {
  if (!sharedParts) {
    const points = [];
    const inner = 1;
    const outer = 1 + 2 * MARKER_STUB_DIAMETERS;
    for (const axis of ['x', 'y', 'z']) {
      for (const sign of [1, -1]) {
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        a[axis] = inner * sign;
        b[axis] = outer * sign;
        points.push(a, b);
      }
    }
    const material = (opacity) => ({
      color: 0xffffff,
      transparent: true,
      opacity,
      depthTest: false
    });
    sharedParts = {
      sphere: new THREE.SphereGeometry(1, 16, 12),
      stubs: new THREE.BufferGeometry().setFromPoints(points),
      normal: {
        mesh: new THREE.MeshBasicMaterial(material(MARKER_OPACITY)),
        line: new THREE.LineBasicMaterial(material(MARKER_OPACITY))
      },
      hovered: {
        mesh: new THREE.MeshBasicMaterial(material(MARKER_OPACITY_HOVERED)),
        line: new THREE.LineBasicMaterial(material(MARKER_OPACITY_HOVERED))
      }
    };
  }
  return sharedParts;
}

function noRaycast() {}

// A group that can show a marker: in the scene and not hidden.
function isShownGroup(el) {
  return isUserGroup(el) && el.isConnected && !isHiddenInHierarchy(el);
}

function buildMarker() {
  const parts = markerParts();
  const marker = new THREE.Group();
  marker.name = 'group-center-marker';
  const sphere = new THREE.Mesh(parts.sphere, parts.normal.mesh);
  const stubs = new THREE.LineSegments(parts.stubs, parts.normal.line);
  for (const part of [marker, sphere, stubs]) {
    part.raycast = noRaycast;
    part.renderOrder = MARKER_RENDER_ORDER;
  }
  marker.add(sphere, stubs);
  marker.userData.sphere = sphere;
  marker.userData.stubs = stubs;
  return marker;
}

/**
 * Markers and pick volumes for the user groups of one scene.
 *
 * `controller` (the scope controller) supplies the current state:
 * `selected()` (the selected entity) and `openElements()` (the open groups,
 * outermost first).
 */
export class GroupAffordances {
  constructor(inspector, controller) {
    this.inspector = inspector;
    this.controller = controller;
    this.groups = [];
    this.emptyGroups = new Set();
    this.markers = new Map();
    this.dirty = true;
    this.hoveredMarkerGroup = null;
    this.markerScratch = [];

    this.markDirty = () => {
      this.dirty = true;
    };
    const sceneEl = inspector.sceneEl;
    sceneEl.addEventListener('child-attached', this.markDirty);
    sceneEl.addEventListener('child-detached', this.markDirty);
    sceneEl.addEventListener('newScene', this.markDirty);
    Events.on('historychanged', this.markDirty);
  }

  dispose() {
    const sceneEl = this.inspector.sceneEl;
    sceneEl.removeEventListener('child-attached', this.markDirty);
    sceneEl.removeEventListener('child-detached', this.markDirty);
    sceneEl.removeEventListener('newScene', this.markDirty);
    Events.off('historychanged', this.markDirty);
    for (const marker of this.markers.values()) marker.removeFromParent();
    this.markers.clear();
  }

  /** Pixel height of the canvas the markers are sized for. */
  viewportHeight() {
    return this.inspector.container?.clientHeight || 0;
  }

  rebuildIfDirty() {
    if (!this.dirty) return;
    this.dirty = false;
    const found = this.inspector.sceneEl.querySelectorAll('.user-group');
    this.groups = Array.from(found);
    this.emptyGroups.clear();
    for (const groupEl of this.groups) {
      if (hasNoShownMember(groupEl)) this.emptyGroups.add(groupEl);
    }
    const known = new Set(this.groups);
    for (const [groupEl, marker] of this.markers) {
      if (!known.has(groupEl) || !groupEl.isConnected) {
        marker.removeFromParent();
        this.markers.delete(groupEl);
      }
    }
  }

  /**
   * The groups that show a center marker: every shown empty group, the
   * selected group, and the innermost open group when it has no member
   * geometry to box.
   */
  markerGroups(out = []) {
    out.length = 0;
    for (const groupEl of this.emptyGroups) {
      if (isShownGroup(groupEl)) out.push(groupEl);
    }
    const selected = this.controller.selected();
    if (isShownGroup(selected) && !out.includes(selected)) out.push(selected);
    const open = this.controller.openElements();
    const innermost = open[open.length - 1];
    if (
      isShownGroup(innermost) &&
      !out.includes(innermost) &&
      getGroupBounds(innermost) === null
    ) {
      out.push(innermost);
    }
    return out;
  }

  /** The marker's world position: the group's center, or its origin. */
  markerPosition(groupEl, out) {
    if (this.emptyGroups.has(groupEl)) {
      if (!readStoredCenter(groupEl, out)) out.set(0, 0, 0);
    } else {
      getGroupCenter(groupEl, out);
    }
    return out.applyMatrix4(groupEl.object3D.matrixWorld);
  }

  markerRadius(camera, worldPos) {
    return screenSpaceSize(
      camera,
      worldPos,
      MARKER_RADIUS_PX,
      this.viewportHeight()
    );
  }

  /** Distance along `ray` into `groupEl`'s marker pick cube, or null. */
  markerDistance(groupEl, ray, camera) {
    const t = tmp();
    const position = this.markerPosition(groupEl, t.center);
    const half = this.markerRadius(camera, position) * MARKER_PICK_RADII;
    t.cube.min.set(-half, -half, -half);
    t.cube.max.set(half, half, half);
    t.placed.makeTranslation(position.x, position.y, position.z);
    return volumeDistance(ray, t.cube, t.placed);
  }

  /** Distance along `ray` into `groupEl`'s box, or its marker if it has none. */
  groupVolumeDistance(groupEl, ray, camera) {
    const box = getGroupBounds(groupEl);
    if (!box) return this.markerDistance(groupEl, ray, camera);
    return volumeDistance(ray, box, groupEl.object3D.matrixWorld);
  }

  /**
   * Append the analytic pick targets along `ray` to `out` (unsorted):
   * markers, the selected closed group's box, and the innermost open group's
   * volume.
   */
  collectHits(ray, camera, out) {
    this.rebuildIfDirty();
    const selected = this.controller.selected();
    const open = this.controller.openElements();
    for (const groupEl of this.markerGroups(this.markerScratch)) {
      const distance = this.markerDistance(groupEl, ray, camera);
      if (distance !== null) {
        out.push({ el: groupEl, distance, kind: 'marker' });
      }
    }
    if (
      isUserGroup(selected) &&
      selected.isConnected &&
      !open.includes(selected) &&
      !isHiddenInHierarchy(selected)
    ) {
      const box = getGroupBounds(selected);
      const distance = box
        ? volumeDistance(ray, box, selected.object3D.matrixWorld)
        : null;
      if (distance !== null) {
        out.push({ el: selected, distance, kind: 'proxy' });
      }
    }
    const innermost = open[open.length - 1];
    if (innermost && !isHiddenInHierarchy(innermost)) {
      const distance = this.groupVolumeDistance(innermost, ray, camera);
      if (distance !== null) {
        out.push({ el: innermost, distance, kind: 'scope' });
      }
    }
    return out;
  }

  /** Is any analytic target live, so a click or hover must consult them? */
  hasTargets() {
    this.rebuildIfDirty();
    return this.markerGroups(this.markerScratch).length > 0;
  }

  setHoveredMarker(groupEl) {
    this.hoveredMarkerGroup = groupEl || null;
  }

  /** Editor-frame pass: place, size and show the markers for this frame. */
  updateMarkers(context) {
    this.rebuildIfDirty();
    const wanted = this.markerGroups(this.markerScratch);
    for (const [groupEl, marker] of this.markers) {
      if (!wanted.includes(groupEl)) marker.visible = false;
    }
    if (wanted.length === 0) return;
    const parts = markerParts();
    const camera = context?.camera || this.inspector.camera;
    const t = tmp();
    for (const groupEl of wanted) {
      let marker = this.markers.get(groupEl);
      if (!marker) {
        marker = buildMarker();
        this.markers.set(groupEl, marker);
        this.inspector.sceneHelpers.add(marker);
      }
      const position = this.markerPosition(groupEl, t.center);
      marker.position.copy(position);
      marker.scale.setScalar(this.markerRadius(camera, position));
      const look =
        groupEl === this.hoveredMarkerGroup ? parts.hovered : parts.normal;
      marker.userData.sphere.material = look.mesh;
      marker.userData.stubs.material = look.line;
      marker.visible = true;
      marker.updateMatrixWorld(true);
    }
  }
}
