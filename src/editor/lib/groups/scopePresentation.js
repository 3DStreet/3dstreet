/* global THREE */
// How an open group is shown, and in what order.
//
// While a group is open for editing, a white outline is drawn around its
// members' bounds (whatever is selected inside it has its own selection box)
// and a scrim darkens the scene outside the box's outline on screen. Both
// appear in the same task as the change of open group, so they are on screen
// in the next frame. The scene itself is drawn as it is: nothing outside the
// group is faded, which would cost a blended draw of the whole outside every
// frame.

import Events from '../Events';
import { FRAME_ORDER, PER_ITEM_PASS_MAX_THROWS } from '../editorFrame.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { getGroupBounds } from './groupBounds.js';
import { isHiddenInHierarchy, isUserGroup } from './groupModel.js';
import { projectBoxSilhouette } from './projectBox.js';
import { ScopeScrim } from './scopeScrim.js';

const OUTLINE_COLOR = 0xffffff;
// Corner pairs of a box's twelve edges; corner i has max x when i & 1, max y
// when i & 2 and max z when i & 4.
const BOX_EDGES = [
  0, 1, 1, 3, 3, 2, 2, 0, 4, 5, 5, 7, 7, 6, 6, 4, 0, 4, 1, 5, 2, 6, 3, 7
];

let scratch = null;
function tmp() {
  if (!scratch) {
    scratch = {
      positions: new Float32Array(BOX_EDGES.length * 3),
      parentInverse: new THREE.Matrix4(),
      // For drawnBox: the box it builds, the group's inverse placement, the
      // half-size of the cube around each point, and the point being carried.
      drawn: new THREE.Box3(),
      toLocal: new THREE.Matrix4(),
      point: new THREE.Vector3(),
      half: 0,
      visit: null
    };
    const s = scratch;
    s.visit = (x, y, z) => {
      s.point.set(x, y, z).applyMatrix4(s.toLocal);
      s.point.subScalar(s.half);
      s.drawn.expandByPoint(s.point);
      s.point.addScalar(2 * s.half);
      s.drawn.expandByPoint(s.point);
    };
  }
  return scratch;
}

function writeBoxEdges(box, out) {
  for (let i = 0; i < BOX_EDGES.length; i++) {
    const corner = BOX_EDGES[i];
    out[i * 3] = corner & 1 ? box.max.x : box.min.x;
    out[i * 3 + 1] = corner & 2 ? box.max.y : box.min.y;
    out[i * 3 + 2] = corner & 4 ? box.max.z : box.min.z;
  }
  return out;
}

function noRaycast() {}

/**
 * The outline and scrim of the open group. `lines` supplies the viewport's screen-space line helpers:
 * `createLineMaterial(color)` and `setLinePositions(lines, positions)`.
 */
export class ScopePresentation {
  constructor(inspector, controller, editorFrame, lines) {
    this.inspector = inspector;
    this.controller = controller;
    this.editorFrame = editorFrame;
    this.lines = lines;
    this.scrim = new ScopeScrim();
    this.outline = null;
    this.outlineBox = null;
    this.presented = false;
    // A drawing in progress that the outline and scrim take in (see
    // setDrawingExtent). Presentation only: the group's stored bounds, and
    // so its center and handles, never see it.
    this.drawingExtent = null;
    // What the scrim was last built from (see recordScrimInputs), and the
    // record reused for it.
    this.drawnFrom = null;
    this.drawnFromScratch = {
      camera: new THREE.Matrix4(),
      projection: new THREE.Matrix4(),
      group: new THREE.Matrix4(),
      box: new THREE.Box3()
    };

    this.onScopeChanged = () => this.scopeChanged();
    Events.on('groupscopechanged', this.onScopeChanged);
    this.unregisterFrame = editorFrame.register(
      (context) => this.present(context.camera),
      // After the bounds and the markers, so the outline and the scrim use
      // this frame's box. Placing catches nothing per item, so a persistent
      // defect is dropped after a few frames rather than the first.
      {
        order: FRAME_ORDER.openGroupOutline,
        maxConsecutiveThrows: PER_ITEM_PASS_MAX_THROWS
      }
    );
  }

  dispose() {
    Events.off('groupscopechanged', this.onScopeChanged);
    this.unregisterFrame();
    this.scrim.dispose();
    if (this.outline) {
      this.outline.removeFromParent();
      this.outline.geometry.dispose();
    }
  }

  /** The innermost open group, if it is in the scene and shown. */
  shownInnermostGroup() {
    const stack = this.controller.openStack;
    if (!stack.length) return null;
    const groupEl = document.getElementById(stack[stack.length - 1]);
    return isUserGroup(groupEl) &&
      groupEl.isConnected &&
      !isHiddenInHierarchy(groupEl)
      ? groupEl
      : null;
  }

  // -------------------------------------------------------------- entry

  scopeChanged() {
    const groupEl = this.shownInnermostGroup();
    if (!groupEl) {
      this.clear();
      return;
    }
    // Show the outline and scrim now, from the camera and group as they are.
    const camera = this.inspector.camera;
    camera.updateMatrixWorld();
    groupEl.object3D.updateWorldMatrix(true, false);
    this.present(camera);
  }

  // -------------------------------------------------------------- drawing

  /** Draw the outline and scrim of the open group as `camera` sees it. */
  present(camera) {
    const groupEl = this.shownInnermostGroup();
    if (!groupEl) {
      this.clear();
      return;
    }
    this.presented = true;
    const matrixWorld = groupEl.object3D.matrixWorld;
    const box = this.drawnBox(groupEl, getGroupBounds(groupEl));
    this.poseOutline(box, matrixWorld);

    const rect = this.inspector.container.getBoundingClientRect();
    if (!this.recordScrimInputs(camera, rect, box, matrixWorld)) return;
    // No member geometry yet: nothing to leave uncovered.
    const outline = box
      ? projectBoxSilhouette(box, matrixWorld, camera, rect.width, rect.height)
      : null;
    this.scrim.show(rect, outline);
  }

  /**
   * Have the outline and scrim of group `groupId` also take in the points
   * `forEachPoint(visit)` gives, as `visit(x, y, z)` in world space, each with
   * a cube of half-size `pad` (world distance) around it: a tool's drawing,
   * which is not yet a member of the group. Returns a handle for
   * clearDrawingExtent. Nothing else follows the drawing.
   */
  setDrawingExtent(groupId, forEachPoint, pad) {
    this.drawingExtent = { groupId, forEachPoint, pad };
    return this.drawingExtent;
  }

  /** Stop following the drawing `handle` was returned for, if still current. */
  clearDrawingExtent(handle) {
    if (handle && this.drawingExtent === handle) this.drawingExtent = null;
  }

  // The box to draw for the group: its stored bounds, or when a drawing in it
  // is being followed, those bounds (or an empty box) grown to take in each
  // point, with a cube of its pad around it. The pad is what gives a lone
  // point or a flat run of points a volume: the preview's tubes and spheres
  // have a radius, and a box with no volume has no opening in the scrim. The
  // result is a scratch box, valid until the next call.
  drawnBox(groupEl, stored) {
    const extent = this.drawingExtent;
    if (!extent || extent.groupId !== groupEl.id) return stored;
    const matrixWorld = groupEl.object3D.matrixWorld;
    // Singular placement: keep the stored box, as the bounds do.
    if (Math.abs(matrixWorld.determinant()) < 1e-12) return stored;
    const t = tmp();
    t.toLocal.copy(matrixWorld).invert();
    // At least `pad` in world on every axis, however the group is scaled.
    const e = matrixWorld.elements;
    const smallestScale = Math.min(
      Math.hypot(e[0], e[1], e[2]),
      Math.hypot(e[4], e[5], e[6]),
      Math.hypot(e[8], e[9], e[10])
    );
    t.half = extent.pad / smallestScale;
    if (stored) t.drawn.copy(stored);
    else t.drawn.makeEmpty();
    extent.forEachPoint(t.visit);
    return t.drawn.isEmpty() ? stored : t.drawn;
  }

  clear() {
    if (!this.presented) return;
    this.presented = false;
    this.drawnFrom = null;
    if (this.outline) this.outline.visible = false;
    this.scrim.hide();
  }

  // Record what the scrim is built from (the camera, the canvas, the box and
  // the group's placement), and return whether any of it changed since it was
  // last built.
  recordScrimInputs(camera, rect, box, matrixWorld) {
    let from = this.drawnFrom;
    if (
      from &&
      from.camera.equals(camera.matrixWorld) &&
      from.projection.equals(camera.projectionMatrix) &&
      from.group.equals(matrixWorld) &&
      (box ? from.hasBox && from.box.equals(box) : !from.hasBox) &&
      from.left === rect.left &&
      from.top === rect.top &&
      from.width === rect.width &&
      from.height === rect.height
    ) {
      return false;
    }
    if (!from) {
      from = this.drawnFromScratch;
      this.drawnFrom = from;
    }
    from.camera.copy(camera.matrixWorld);
    from.projection.copy(camera.projectionMatrix);
    from.group.copy(matrixWorld);
    from.hasBox = !!box;
    if (box) from.box.copy(box);
    from.left = rect.left;
    from.top = rect.top;
    from.width = rect.width;
    from.height = rect.height;
    return true;
  }

  ensureOutline() {
    if (!this.outline) {
      const outline = new LineSegments2(
        new LineSegmentsGeometry(),
        this.lines.createLineMaterial(OUTLINE_COLOR)
      );
      outline.name = 'group-scope-outline';
      outline.matrixAutoUpdate = false;
      outline.raycast = noRaycast;
      outline.visible = false;
      this.inspector.sceneHelpers.add(outline);
      this.outline = outline;
      this.outlineBox = new THREE.Box3();
      this.outlineBox.makeEmpty();
    }
    return this.outline;
  }

  // The outline follows the group's placement (its scale included) as of this
  // frame, and is posed after three's own matrix update, so it updates its own
  // world matrix.
  poseOutline(box, matrixWorld) {
    if (!box) {
      if (this.outline) this.outline.visible = false;
      return;
    }
    const outline = this.ensureOutline();
    if (!this.outlineBox.equals(box)) {
      this.lines.setLinePositions(outline, writeBoxEdges(box, tmp().positions));
      this.outlineBox.copy(box);
    }
    outline.matrix.copy(matrixWorld);
    if (outline.parent) {
      const parentInverse = tmp().parentInverse;
      parentInverse.copy(outline.parent.matrixWorld).invert();
      outline.matrix.premultiply(parentInverse);
    }
    outline.visible = true;
    outline.updateMatrixWorld(true);
  }
}
