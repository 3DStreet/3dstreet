/* global THREE */
// How an open group is shown, and in what order.
//
// While a group is open for editing, a white outline is drawn around its
// members' bounds (whatever is selected inside it has its own selection box)
// and a scrim darkens the scene outside the box's outline on screen. Both
// appear in the same task as the change of open group, so they are on screen
// in the next frame. The treatment of objects outside the group
// (`attenuation`) is costlier and follows: it is enabled after the first
// render that shows the outline and scrim, one animation frame later. A
// switch between open groups keeps the outside faded throughout: the new
// group's treatment replaces the old one's in the same task.
// Every change of open group makes pending work for the previous one
// obsolete: it is cancelled, and anything that still runs checks the scope
// generation it was scheduled for.
//
// Each step leaves a `performance` mark carrying that generation, so how long
// entry takes can be measured in any build.

import Events from '../Events';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { getGroupBounds } from './groupBounds.js';
import { isHiddenInHierarchy, isUserGroup } from './groupModel.js';
import { projectBoxSilhouette } from './projectBox.js';
import { ScopeScrim } from './scopeOverlay.js';

export const SCOPE_MARKS = Object.freeze({
  open: 'group-scope:open',
  outlinedFrame: 'group-scope:outlined-frame',
  attenuationEnabled: 'group-scope:attenuation-enabled',
  firstAttenuatedFrame: 'group-scope:first-attenuated-frame'
});
const ALL_MARKS = Object.values(SCOPE_MARKS);

function mark(name, generation) {
  performance.mark(name, { detail: { generation } });
}

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
      parentInverse: new THREE.Matrix4()
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
 * The outline and scrim of the open group, and the schedule of its outside
 * treatment. `lines` supplies the viewport's screen-space line helpers:
 * `createLineMaterial(color)` and `setLinePositions(lines, positions)`.
 */
export class ScopePresentation {
  constructor(inspector, scope, editorFrame, lines) {
    this.inspector = inspector;
    this.scope = scope;
    this.editorFrame = editorFrame;
    this.lines = lines;
    this.scrim = new ScopeScrim();
    this.outline = null;
    this.outlineBox = null;
    this.presented = false;
    // What the scrim was last built from; see scrimOutdated().
    this.drawnFrom = null;
    // The scope generation the last render window presented.
    this.windowGeneration = null;
    // Entry work scheduled for the current scope, until it has run.
    this.pending = null;
    // The treatment of objects outside the open group: `apply(groupEl,
    // generation)` and `restore()`. None until one is provided.
    this.attenuation = null;

    this.onScopeChanged = (detail) => this.scopeChanged(detail.generation);
    Events.on('groupscopechanged', this.onScopeChanged);
    this.unregisterFrame = editorFrame.register(
      (context) => {
        this.present(context.camera);
        this.windowGeneration = this.scope.generation;
      },
      // After the live bounds (20) and the markers (30), so the outline and
      // the scrim use this frame's box. Placing catches nothing per item, so a
      // persistent defect is dropped after a few frames rather than the first.
      { order: 40, maxConsecutiveThrows: 5 }
    );
  }

  dispose() {
    this.cancelPending();
    Events.off('groupscopechanged', this.onScopeChanged);
    this.unregisterFrame();
    this.scrim.dispose();
    if (this.outline) {
      this.outline.removeFromParent();
      this.outline.geometry.dispose();
    }
  }

  /** The innermost open group, if it is in the scene and shown. */
  innermostScope() {
    const stack = this.scope.openStack;
    if (!stack.length) return null;
    const groupEl = document.getElementById(stack[stack.length - 1]);
    return isUserGroup(groupEl) &&
      groupEl.isConnected &&
      !isHiddenInHierarchy(groupEl)
      ? groupEl
      : null;
  }

  // -------------------------------------------------------------- entry

  scopeChanged(generation) {
    this.cancelPending();
    const groupEl = this.innermostScope();
    if (!groupEl) {
      this.attenuation?.restore();
      this.clear();
      return;
    }
    for (const name of ALL_MARKS) performance.clearMarks(name);
    mark(SCOPE_MARKS.open, generation);

    // Show the outline and scrim now, from the camera and group as they are.
    const camera = this.inspector.camera;
    camera.updateMatrixWorld();
    groupEl.object3D.updateWorldMatrix(true, false);
    this.present(camera);

    // A switch from one open group to another, with the outside already
    // faded: fade the new outside in the same step, so nothing outside is
    // ever drawn at full strength in between.
    if (this.attenuation?.enabled) {
      this.attenuation.switchTo(groupEl, generation);
      mark(SCOPE_MARKS.attenuationEnabled, generation);
      return;
    }
    this.attenuation?.restore();

    const pending = { generation, unregisterAfter: null, frameRequest: null };
    pending.unregisterAfter = this.editorFrame.register(
      () => this.afterRender(pending),
      { phase: 'after' }
    );
    this.pending = pending;
  }

  // At the end of a render: once one has shown this scope's outline and
  // scrim, the outside treatment is due on the next animation frame.
  afterRender(pending) {
    if (this.windowGeneration !== pending.generation) return;
    pending.unregisterAfter();
    pending.unregisterAfter = null;
    mark(SCOPE_MARKS.outlinedFrame, pending.generation);
    pending.frameRequest = requestAnimationFrame(() =>
      this.enableAttenuation(pending.generation)
    );
  }

  enableAttenuation(generation) {
    // Scheduled for a scope that has since changed: obsolete.
    if (generation !== this.scope.generation) return;
    const groupEl = this.innermostScope();
    if (!groupEl) return;
    this.pending = null;
    this.attenuation?.apply(groupEl, generation);
    mark(SCOPE_MARKS.attenuationEnabled, generation);
  }

  /** The first render drawn with the outside treated has ended. */
  firstAttenuatedFrame(generation) {
    mark(SCOPE_MARKS.firstAttenuatedFrame, generation);
  }

  cancelPending() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.unregisterAfter?.();
    if (pending.frameRequest !== null) {
      cancelAnimationFrame(pending.frameRequest);
    }
  }

  // -------------------------------------------------------------- drawing

  /** Draw the outline and scrim of the open group as `camera` sees it. */
  present(camera) {
    const groupEl = this.innermostScope();
    if (!groupEl) {
      this.clear();
      return;
    }
    this.presented = true;
    const box = getGroupBounds(groupEl);
    const matrixWorld = groupEl.object3D.matrixWorld;
    this.poseOutline(box, matrixWorld);

    const rect = this.inspector.container.getBoundingClientRect();
    if (!this.scrimOutdated(camera, rect, box, matrixWorld)) return;
    // No member geometry yet: nothing to leave uncovered.
    const outline = box
      ? projectBoxSilhouette(box, matrixWorld, camera, rect.width, rect.height)
      : null;
    this.scrim.show(rect, outline);
  }

  clear() {
    if (!this.presented) return;
    this.presented = false;
    this.drawnFrom = null;
    if (this.outline) this.outline.visible = false;
    this.scrim.hide();
  }

  // Is the scrim out of date: has the camera, the canvas, the box or the
  // group's placement changed since it was built? Records the new state.
  scrimOutdated(camera, rect, box, matrixWorld) {
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
      from = this.drawnFromScratch ||= {
        camera: new THREE.Matrix4(),
        projection: new THREE.Matrix4(),
        group: new THREE.Matrix4(),
        box: new THREE.Box3()
      };
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
