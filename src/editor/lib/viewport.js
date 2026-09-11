import { TransformControls } from './TransformControls.js';
import { ShapeVertexControls } from './ShapeVertexControls.js';
import { StreetNodeControls } from './gizmos/StreetNodeControls.js';
import { SegmentWidthControls } from './gizmos/SegmentWidthControls.js';
import { computeRibbonOutline } from '@/tested/street-path-utils.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import InfiniteGridHelper from './InfiniteGridHelper.js';
import {
  ExperimentalControls,
  isStreetLevelNav
} from './nav-experimental/index.js';

import { copyCameraPosition } from './cameras';
import { initRaycaster } from './raycaster';
import { isManagedStreetSegment } from './entity';
import { captureNavDiscovery } from './navAnalytics.js';
import Events from './Events';
import { isBatched, syncBatchedSubtree } from '../../batch-models';
import useStore from '@/store';
import { auth } from '@shared/services/firebase';
import { pickLoadCameraState } from '@/tested/scene-camera-pose.js';
// variables used by OrientedBoxHelper
const auxEuler = new THREE.Euler();
const auxPosition = new THREE.Vector3();
const auxLocalPosition = new THREE.Vector3();
const origin = new THREE.Vector3();
const auxScale = new THREE.Vector3();
const auxQuaternion = new THREE.Quaternion();
const identityQuaternion = new THREE.Quaternion();
const auxMatrix = new THREE.Matrix4();
const tempBox3 = new THREE.Box3();
const auxLocalBbox = new THREE.Box3();
const tempVector3Size = new THREE.Vector3();
const tempVector3Center = new THREE.Vector3();

// Selection / hover lines are drawn with three's screen-space "fat" lines:
// WebGL ignores LineBasicMaterial.linewidth (always 1px), so the helper
// keeps its stock 1px LineSegments only as the data source and renders a
// LineSegments2 twin at HIGHLIGHT_LINE_PX. LineMaterial needs the viewport
// size to convert pixels to clip space; every material is registered so
// the resize handler can refresh them.
const HIGHLIGHT_LINE_PX = 2;
const fatLineMaterials = new Set();
function createFatLineMaterial(color) {
  const material = new LineMaterial({
    color,
    linewidth: HIGHLIGHT_LINE_PX,
    transparent: true,
    depthTest: false
  });
  fatLineMaterials.add(material);
  return material;
}
// CSS pixels, deliberately: the renderer draws at devicePixelRatio, so
// HIGHLIGHT_LINE_PX comes out as CSS pixels, not device pixels. Guarded
// against a not-yet-laid-out container (0 would divide by zero in the
// shader and hide the lines until the first resize).
function setFatLineResolution(width, height) {
  const w = Math.max(1, width || 0);
  const h = Math.max(1, height || 0);
  fatLineMaterials.forEach((m) => m.resolution.set(w, h));
}
// Set a LineSegments2's segments from flat xyz pairs. When the segment
// count is unchanged the existing interleaved instance buffer is written in
// place (the box case: 12 segments, updated on every drag frame); otherwise
// the geometry is rebuilt.
function setFatLinePositions(lines, positions) {
  const buffer = lines.geometry.attributes.instanceStart?.data;
  if (buffer && buffer.array.length === positions.length) {
    buffer.array.set(positions);
    buffer.needsUpdate = true;
    lines.geometry.computeBoundingBox();
    lines.geometry.computeBoundingSphere();
    return;
  }
  lines.geometry.dispose();
  lines.geometry = new LineSegmentsGeometry().setPositions(positions);
}
// Expand an indexed LineSegments geometry (BoxHelper's 8 verts / 12 edges)
// into flat segment pairs, into `out` (sized idx.length * 3).
function indexedLinePairs(geometry, out) {
  const pos = geometry.attributes.position.array;
  const idx = geometry.index.array;
  for (let i = 0; i < idx.length; i++) {
    out[i * 3] = pos[idx[i] * 3];
    out[i * 3 + 1] = pos[idx[i] * 3 + 1];
    out[i * 3 + 2] = pos[idx[i] * 3 + 2];
  }
  return out;
}
const boxPairsScratch = new Float32Array(24 * 3);

// Edge-angle threshold for a curved ribbon's selection outline: high enough
// that the small bends between ring stations on the side walls don't draw as
// tick marks, low enough that the top/side corners (90°) always do.
const RIBBON_OUTLINE_THRESHOLD_DEG = 30;

// Note on structure: the inherited BoxHelper (a 1px LineSegments) is kept
// purely as the box's DATA source — its constructor, setFromObject and
// update() write the 8 corner positions we then copy into the fat-line
// twin (`fatBox`) that actually renders. Its own material is invisible for
// the helper's whole life; that is intentional, not a bug.
class OrientedBoxHelper extends THREE.BoxHelper {
  constructor(object, color = 0xffff00, fill = false) {
    super(object, color);
    this.helperColor = color;
    this.material.visible = false;
    this.fatMaterial = createFatLineMaterial(color);
    this.fatBox = new LineSegments2(
      new LineSegmentsGeometry(),
      this.fatMaterial
    );
    this.fatBox.raycast = function () {};
    this.add(this.fatBox);
    if (fill) {
      // Mesh with BoxGeometry and Semi-transparent Material
      const boxFillGeometry = new THREE.BoxGeometry(1, 1, 1);
      const boxFillMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.3,
        depthTest: false
      });
      const boxFill = new THREE.Mesh(boxFillGeometry, boxFillMaterial);
      this.boxFill = boxFill;
      this.add(boxFill);
    }
  }

  // --- Curved-lane conforming highlight -------------------------------
  // A curved street segment's AABB covers the whole sweep of the curve, so
  // the box hover/selection highlight reads as a giant unrelated rectangle.
  // When the tracked entity carries a `street-ribbon` geometry (a curved
  // lane surface) — or is a path-following managed street, whose segments
  // do — render translucent overlays of the actual ribbon meshes instead of
  // the box. Straight entities keep the box exactly as before.

  getConformingSourceMeshes() {
    const el = this.object?.el;
    if (!el || typeof el.getAttribute !== 'function') return null;
    if (el.getAttribute('geometry')?.primitive === 'street-ribbon') {
      const mesh = el.getObject3D('mesh');
      return mesh ? [mesh] : null;
    }
    if (el.components?.['managed-street']?.streetCurve) {
      const meshes = [];
      el.querySelectorAll(':scope > [street-segment]').forEach((segEl) => {
        if (segEl.getAttribute('geometry')?.primitive === 'street-ribbon') {
          const mesh = segEl.getObject3D('mesh');
          if (mesh) meshes.push(mesh);
        }
      });
      return meshes.length > 0 ? meshes : null;
    }
    return null;
  }

  // A selected path-following street draws one silhouette of its outer
  // edges along the curve — not every segment's outline (#1218 follow-up).
  // Returns { street, sampler, lateralCenter, width, y, sEnd, closed, rev }
  // or null when the tracked entity isn't a curved street.
  getStreetOutlineSpec() {
    const el = this.object?.el;
    const street = el?.components?.['managed-street'];
    const curve = street?.streetCurve;
    if (!curve) return null;
    let min = Infinity;
    let max = -Infinity;
    let y = 0;
    el.querySelectorAll(':scope > [street-segment]').forEach((segEl) => {
      const w = segEl.components['street-segment']?.data.width || 0;
      const pos = segEl.object3D.position;
      min = Math.min(min, pos.x - w / 2);
      max = Math.max(max, pos.x + w / 2);
      y = Math.max(y, pos.y);
    });
    if (!(max > min)) return null;
    return {
      sampler: curve.sampler,
      lateralCenter: (min + max) / 2,
      width: max - min,
      y,
      sEnd: street.data.length,
      closed: !!curve.closed,
      rev: curve.rev
    };
  }

  updateStreetOutline(spec) {
    if (!this.outlineLines) {
      this.outlineLines = new LineSegments2(
        new LineSegmentsGeometry(),
        this.fatMaterial
      );
      this.outlineLines.raycast = function () {};
      this.add(this.outlineLines);
    }
    this.outlineLines.visible = true;
    const key = [spec.rev, spec.lateralCenter, spec.width, spec.y, spec.sEnd]
      .map((v) => (typeof v === 'number' ? v.toFixed(3) : v))
      .join('|');
    if (this.outlineLines.userData.key === key) return;
    this.outlineLines.userData.key = key;
    const { left, right } = computeRibbonOutline(spec.sampler, {
      lateralCenter: spec.lateralCenter,
      width: spec.width,
      sEnd: spec.sEnd
    });
    const pts = [];
    const push = (a, b) =>
      pts.push(a.x, a.y + spec.y, a.z, b.x, b.y + spec.y, b.z);
    const n = left.length;
    for (let i = 0; i + 1 < n; i++) {
      push(left[i], left[i + 1]);
      push(right[i], right[i + 1]);
    }
    if (spec.closed) {
      push(left[n - 1], left[0]);
      push(right[n - 1], right[0]);
    } else {
      push(left[0], right[0]);
      push(left[n - 1], right[n - 1]);
    }
    setFatLinePositions(this.outlineLines, pts);
  }

  updateConformingHighlight() {
    const streetSpec = this.boxFill ? null : this.getStreetOutlineSpec();
    const sources = streetSpec ? null : this.getConformingSourceMeshes();
    const showBox = !sources && !streetSpec;
    // BoxHelper's constructor runs update() before our fields exist
    if (!this.fatBox) return;
    this.fatBox.visible = showBox;
    if (this.boxFill) this.boxFill.visible = showBox;
    if (this.outlineLines) this.outlineLines.visible = false;
    if (streetSpec) {
      if (this.conformGroup) this.conformGroup.visible = false;
      this.updateStreetOutline(streetSpec);
      return;
    }
    if (!sources) {
      if (this.conformGroup) this.conformGroup.visible = false;
      return;
    }
    if (!this.conformGroup) {
      this.conformGroup = new THREE.Group();
      this.add(this.conformGroup);
      // The hover helper fills its box, so its conforming overlay is a
      // translucent fill of the ribbon. The selection helper draws lines
      // only, so its overlay is the ribbon's outline: a tinted fill reads as
      // a surface-colour change rather than a selection.
      this.conformMaterial = this.boxFill
        ? new THREE.MeshBasicMaterial({
            color: this.helperColor,
            transparent: true,
            opacity: 0.3,
            depthTest: false
          })
        : this.fatMaterial;
      this.conformInverse = new THREE.Matrix4();
    }
    this.conformGroup.visible = true;
    while (this.conformGroup.children.length < sources.length) {
      const overlay = this.boxFill
        ? new THREE.Mesh(undefined, this.conformMaterial)
        : new LineSegments2(new LineSegmentsGeometry(), this.conformMaterial);
      overlay.matrixAutoUpdate = false;
      overlay.raycast = function () {}; // never pickable
      this.conformGroup.add(overlay);
    }
    while (this.conformGroup.children.length > sources.length) {
      const overlay = this.conformGroup.children.pop();
      this.conformGroup.remove(overlay);
      if (overlay.isLineSegments2) overlay.geometry?.dispose();
    }
    // The helper's own matrix was just set to the tracked object's world
    // pose (see update()); overlays borrow each source mesh's geometry and
    // compensate so they land exactly on the mesh in world space.
    this.conformInverse.copy(this.matrix).invert();
    sources.forEach((source, i) => {
      const overlay = this.conformGroup.children[i];
      if (overlay.isLineSegments2) {
        // Outline edges are derived per source geometry and cached on the
        // overlay; the ribbon re-meshes (new geometry object) on every
        // curve/width change, which is what invalidates the cache.
        if (overlay.userData.sourceGeometry !== source.geometry) {
          const edges = new THREE.EdgesGeometry(
            source.geometry,
            RIBBON_OUTLINE_THRESHOLD_DEG
          );
          setFatLinePositions(overlay, edges.attributes.position.array);
          edges.dispose();
          overlay.userData.sourceGeometry = source.geometry;
        }
      } else {
        overlay.geometry = source.geometry;
      }
      source.updateWorldMatrix(true, false);
      overlay.matrix.multiplyMatrices(this.conformInverse, source.matrixWorld);
    });
  }

  update() {
    // Bounding box is created axis-aligned AABB.
    // If there's any rotation the box will have the wrong size.
    // It undoes the local entity rotation and then restores so box has the expected size.
    // We also undo the parent world rotation.

    // tempBox3 is module-level and shared across all helper instances; reset it so
    // that if we skip both bbox branches below (e.g. a detached object with no
    // parent) we don't reuse the previous helper's box left over in it.
    tempBox3.makeEmpty();

    // Skip the position/rotation zeroing for splat entities as it interferes with
    // how Spark's SplatMesh handles matrix updates
    const isSplatEntity = this.object?.el?.hasAttribute('splat');

    // this.object.parent is null when the tracked object has been detached from
    // the scene graph (deleted/undo'd) while still hovered or selected; the
    // parent-relative rezeroing below would then throw on matrixWorld.
    const hasParent = this.object?.parent != null;

    if (this.object !== undefined && hasParent && !isSplatEntity) {
      auxEuler.copy(this.object.rotation);
      auxLocalPosition.copy(this.object.position);
      this.object.rotation.set(0, 0, 0);
      this.object.position.set(0, 0, 0);

      this.object.parent.matrixWorld.decompose(
        auxPosition,
        auxQuaternion,
        auxScale
      );
      auxMatrix.compose(origin, identityQuaternion, auxScale);
      this.object.parent.matrixWorld.copy(auxMatrix);
      tempBox3.setFromObject(this.object);

      // Batched entities have their original mesh tree stripped at batch time, so
      // setFromObject finds no geometry under them. batch-models stashes a per-entity-local
      // AABB — apply the entity's now-zeroed-rotation matrixWorld and union it in.
      const cachedBbox = this.object._batchLocalBbox;
      if (cachedBbox) {
        this.object.updateWorldMatrix(false, false);
        auxLocalBbox.copy(cachedBbox).applyMatrix4(this.object.matrixWorld);
        tempBox3.union(auxLocalBbox);
      }

      if (!this.object.el?.getObject3D('mesh') && !cachedBbox) {
        // For a group of several models to include the group origin.
        tempBox3.expandByPoint(this.object.position);
      }

      if (this.boxFill) {
        tempBox3.getSize(tempVector3Size);
        tempBox3.getCenter(tempVector3Center);
        this.boxFill.position.copy(tempVector3Center);
        this.boxFill.scale.copy(tempVector3Size);
      }
    } else if (this.object !== undefined && isSplatEntity) {
      const splatComponent = this.object.el.components['splat'];
      const splatBox = splatComponent?.getBoundingBox?.();
      if (splatBox) {
        tempBox3.copy(splatBox);
        // Transform the box to world space
        tempBox3.applyMatrix4(this.object.matrixWorld);
      } else {
        tempBox3.setFromObject(this.object);
      }
    }

    if (!tempBox3.isEmpty()) {
      const min = tempBox3.min;
      const max = tempBox3.max;

      const position = this.geometry.attributes.position;
      const array = position.array;

      array[0] = max.x;
      array[1] = max.y;
      array[2] = max.z;
      array[3] = min.x;
      array[4] = max.y;
      array[5] = max.z;
      array[6] = min.x;
      array[7] = min.y;
      array[8] = max.z;
      array[9] = max.x;
      array[10] = min.y;
      array[11] = max.z;
      array[12] = max.x;
      array[13] = max.y;
      array[14] = min.z;
      array[15] = min.x;
      array[16] = max.y;
      array[17] = min.z;
      array[18] = min.x;
      array[19] = min.y;
      array[20] = min.z;
      array[21] = max.x;
      array[22] = min.y;
      array[23] = min.z;

      position.needsUpdate = true;

      this.geometry.computeBoundingSphere();
      if (this.fatBox) {
        setFatLinePositions(
          this.fatBox,
          indexedLinePairs(this.geometry, boxPairsScratch)
        );
      }
    }

    // Restore rotations (skip for splat entities since we didn't modify them).
    if (this.object !== undefined && hasParent && !isSplatEntity) {
      this.object.parent.matrixWorld.compose(
        auxPosition,
        auxQuaternion,
        auxScale
      );
      this.object.rotation.copy(auxEuler);
      this.object.position.copy(auxLocalPosition);
    }

    // Update helper position for all objects
    if (this.object !== undefined) {
      this.object.getWorldQuaternion(this.quaternion);
      this.object.getWorldPosition(this.position);
      this.updateMatrix();
    }

    // After the box (and this helper's own world pose) are settled, swap in
    // the conforming overlay for curved street surfaces.
    this.updateConformingHighlight();
  }

  dispose() {
    super.dispose();
    if (this.boxFill) {
      this.boxFill.geometry.dispose();
      this.boxFill.material.dispose();
    }
    if (this.conformMaterial && this.conformMaterial !== this.fatMaterial) {
      // hover overlay geometries are borrowed from the live meshes — only
      // the shared material is ours to dispose
      this.conformMaterial.dispose();
    }
    this.fatBox.geometry.dispose();
    this.outlineLines?.geometry.dispose();
    this.conformGroup?.children.forEach((o) => {
      if (o.isLineSegments2) o.geometry.dispose();
    });
    fatLineMaterials.delete(this.fatMaterial);
    this.fatMaterial.dispose();
  }
}

/**
 * Transform controls stuff mostly.
 */
export function Viewport(inspector) {
  // Initialize raycaster and picking in differentpmodule.
  const mouseCursor = initRaycaster(inspector);
  const sceneEl = inspector.sceneEl;

  sceneEl.addEventListener('camera-set-active', (event) => {
    // If we're in edit mode, save the newly active camera and activate when exiting.
    if (inspector.opened) {
      inspector.cameras.original = event.detail.cameraEl;
    }
  });

  // Helpers.
  const sceneHelpers = inspector.sceneHelpers;
  const grid = new InfiniteGridHelper(1, 10, new THREE.Color(0xffffff), 500);
  grid.visible = true;
  sceneHelpers.add(grid);

  // Origin indicator with RGB axis cylinders
  const originIndicator = new THREE.Group();

  // Create cylinder geometry for axes (1m length, thin radius)
  const axisGeometry = new THREE.CylinderGeometry(0.01, 0.01, 1, 8);

  // X-axis (red) - points in +X direction
  const xAxisMaterial = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    transparent: true,
    opacity: 0.8,
    depthTest: false
  });
  const xAxis = new THREE.Mesh(axisGeometry, xAxisMaterial);
  xAxis.rotation.z = -Math.PI / 2; // Rotate to point along X axis
  xAxis.position.x = 0.5; // Move half length to start at origin
  originIndicator.add(xAxis);

  // Y-axis (green) - points in +Y direction
  const yAxisMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.8,
    depthTest: false
  });
  const yAxis = new THREE.Mesh(axisGeometry, yAxisMaterial);
  yAxis.position.y = 0.5; // Move half length to start at origin
  originIndicator.add(yAxis);

  // Z-axis (blue) - points in +Z direction
  const zAxisMaterial = new THREE.MeshBasicMaterial({
    color: 0x0000ff,
    transparent: true,
    opacity: 0.8,
    depthTest: false
  });
  const zAxis = new THREE.Mesh(axisGeometry, zAxisMaterial);
  zAxis.rotation.x = Math.PI / 2; // Rotate to point along Z axis
  zAxis.position.z = 0.5; // Move half length to start at origin
  originIndicator.add(zAxis);

  originIndicator.visible = true;
  sceneHelpers.add(originIndicator);

  const selectionBox = new OrientedBoxHelper(undefined, 0x1faaf2);
  selectionBox.visible = false;
  sceneHelpers.add(selectionBox);

  // hoverBox BoxHelper version
  const hoverBox = new OrientedBoxHelper(undefined, 0xff0000, true);
  hoverBox.visible = false;
  sceneHelpers.add(hoverBox);

  // A street bending along / straightening off its path re-meshes segments
  // in place — no mouseenter or entityupdate fires, so a helper snapshotted
  // before the change keeps showing the stale (box vs conforming) highlight.
  // The event bubbles from the street; refresh whichever helpers are live.
  sceneEl.addEventListener('street-curve-changed', () => {
    if (hoverBox.visible && hoverBox.object) hoverBox.update();
    if (selectionBox.visible && selectionBox.object) selectionBox.update();
  });

  Events.on('raycastermouseenter', (el) => {
    // update hoverBox to match el.object3D bounding box
    //
    // Hover-highlight parity (KD-27). Street-level OFF: the hover box is
    // driven from the same getIntersectedEl() result a single-click selects
    // (the `el` payload), so hover already matches selection — there is NO
    // divergence to fix.
    // Street-level ON: "what a click does" IS navigate (teleport), so the
    // hover box must preview the Phase-4 TELEPORT category — driven from the
    // SAME raw cursor intersection navigateDoubleClick classifies off (NOT
    // the segment-remapped getIntersectedEl). So hovering a car-in-lane shows
    // the car (Category C) and a pixel aside shows the lane (Category A),
    // matching WE-7 by construction. The teleport ships with ?streetview=on
    // (raycaster.js gates the dblclick reroute the same way), so the preview
    // follows the same flag — at parity, hover matches plain selection.
    let target = el;
    if (isStreetLevelNav()) {
      const cursorComp =
        inspector.cursor && inspector.cursor.components
          ? inspector.cursor.components.cursor
          : null;
      const raw = cursorComp ? cursorComp.intersectedEl : null;
      if (raw) target = raw;
    }
    if (!target || target === inspector.selectedEntity) return;
    hoverBox.visible = true;
    hoverBox.setFromObject(target.object3D);
  });

  Events.on('raycastermouseleave', (el) => {
    hoverBox.visible = false;
  });

  function updateHelpers(object) {
    object.traverse((node) => {
      if (inspector.helpers[node.uuid] && inspector.helpers[node.uuid].update) {
        inspector.helpers[node.uuid].update();
      }
    });
  }

  const camera = inspector.camera;
  const transformControls = new TransformControls(camera, inspector.container);
  transformControls.size = 0.75;

  // A second helper, alongside the transform controls: vertex handles for the selected
  // shape. It reads the inspector camera fresh each frame rather than being
  // handed one, so it needs no entry in the cameratoggle handler below.
  const shapeVertexControls = new ShapeVertexControls();
  // Hung on the inspector for the same reason `inspector.controls` is (see the
  // assignment further down this file): a second editor surface — the shape
  // properties panel — needs to know which vertex is sub-selected and which
  // side has an insert button open, so that it can keep the right length
  // captions on screen and mark the right one. It reads the live values through
  // getActiveVertex() and getRevealedSide(), and only through them, the way
  // `inspector.controls` is consumed through methods rather than fields.
  //
  // Ownership, stated exactly: this object is the only owner of both, and the
  // only writer of the active vertex. The revealed side is written from outside
  // through exactly one entry, activateSide(), which the panel calls because
  // only it can resolve a clicked caption back to the two vertices it runs
  // between — it built the caption. It delegates internally to revealSide() when
  // the press has no hover behind it. Both validate against this layer's own
  // vertex list and refuse a pair they cannot resolve, so there is still no
  // state here that this layer would have to defend, no copy to keep in step and
  // nothing to invalidate.
  inspector.shapeVertexControls = shapeVertexControls;

  // --- Street gizmos (#1096 #1218) --------------------------------------
  // Additive handles for managed streets and their segments, always on.
  // attachControlsForSelection() below is the single routing table deciding
  // which controls attach to the current selection.
  const streetNodeControls = new StreetNodeControls(
    camera,
    inspector.container
  );
  const segmentWidthControls = new SegmentWidthControls(
    camera,
    inspector.container
  );

  // Pose snapshot taken on the gizmo's mouseDown, BEFORE TransformControls
  // mutates the object. The undo command can't capture this itself:
  // getAttribute('position') returns the live object3D values, which are
  // already post-mutation by the time objectChange fires (#1663).
  let transformPreDragValues = null;

  transformControls.addEventListener('objectChange', () => {
    const object = transformControls.object;
    if (object === undefined) {
      return;
    }

    const mode = transformControls.mode;

    // Trim to 3 decimals.
    if (mode === 'translate') {
      object.position.set(
        parseFloat(object.position.x.toFixed(3)),
        parseFloat(object.position.y.toFixed(3)),
        parseFloat(object.position.z.toFixed(3))
      );
    } else if (mode === 'rotate') {
      object.rotation.set(
        parseFloat(object.rotation.x.toFixed(3)),
        parseFloat(object.rotation.y.toFixed(3)),
        parseFloat(object.rotation.z.toFixed(3))
      );
    } else if (mode === 'scale') {
      object.scale.set(
        parseFloat(object.scale.x.toFixed(3)),
        parseFloat(object.scale.y.toFixed(3)),
        parseFloat(object.scale.z.toFixed(3))
      );
    }

    // The entityupdate command below fires componentchanged, which the scene-level
    // batch-models listener catches — but A-Frame throttles componentchanged to 200ms,
    // so during a continuous drag a batched-descendant slot would only catch up at
    // ~5Hz. Push the slot directly here for smooth per-frame updates.
    syncBatchedSubtree(object.el);

    selectionBox.setFromObject(object);

    updateHelpers(object);

    // Emit update event for watcher.
    let component;
    let value;
    if (mode === 'translate') {
      component = 'position';
      value = `${object.position.x} ${object.position.y} ${object.position.z}`;
    } else if (mode === 'rotate') {
      component = 'rotation';
      const d = THREE.MathUtils.radToDeg;
      value = `${d(object.rotation.x)} ${d(object.rotation.y)} ${d(
        object.rotation.z
      )}`;
    } else if (mode === 'scale') {
      component = 'scale';
      value = `${object.scale.x} ${object.scale.y} ${object.scale.z}`;
    }

    inspector.execute('entityupdate', {
      component: component,
      entity: transformControls.object.el,
      value: value,
      oldValue: transformPreDragValues?.[component]
    });
  });

  transformControls.addEventListener('mouseDown', () => {
    const object = transformControls.object;
    if (object) {
      const d = THREE.MathUtils.radToDeg;
      transformPreDragValues = {
        position: `${object.position.x} ${object.position.y} ${object.position.z}`,
        rotation: `${d(object.rotation.x)} ${d(object.rotation.y)} ${d(
          object.rotation.z
        )}`,
        scale: `${object.scale.x} ${object.scale.y} ${object.scale.z}`
      };
    }
    controls.enabled = false;
    hoverBox.visible = false; // if we start to move a group with a child hovered at the same time
  });

  transformControls.addEventListener('mouseUp', () => {
    controls.enabled = true;
  });

  shapeVertexControls.addEventListener('mouseDown', () => {
    controls.enabled = false;
  });

  shapeVertexControls.addEventListener('mouseUp', () => {
    controls.enabled = true;
  });

  // The street gizmos report the whole drag once on mouseUp via 'commitDrag'
  // — turned into a single undo step here. Width bars mutate attributes live
  // during the drag; endpoint nodes preview with an outline and apply on
  // release (#1942).
  [streetNodeControls, segmentWidthControls].forEach((streetControls) => {
    streetControls.addEventListener('mouseDown', () => {
      controls.enabled = false;
      hoverBox.visible = false;
    });
    streetControls.addEventListener('mouseUp', () => {
      controls.enabled = true;
    });
    streetControls.addEventListener('objectChange', () => {
      const object = streetControls.object;
      if (!object) return;
      selectionBox.setFromObject(object);
      updateHelpers(object);
    });
    streetControls.addEventListener('commitDrag', (evt) => {
      const changed = evt.changes.filter((c) => c.value !== c.oldValue);
      if (changed.length === 0) return;
      const commands = changed.map((c) => [
        'entityupdate',
        { entity: evt.entity, ...c }
      ]);
      if (commands.length === 1) {
        inspector.execute('entityupdate', commands[0][1]);
      } else {
        inspector.execute('multi', commands);
      }
    });
  });

  sceneHelpers.add(transformControls.getHelper());
  // Added once, here — attach()/detach() only arm and disarm it, they do not
  // re-add it.
  sceneHelpers.add(shapeVertexControls);
  sceneHelpers.add(streetNodeControls);
  sceneHelpers.add(segmentWidthControls);

  Events.on('entityupdate', (detail) => {
    const object = detail.entity.object3D;
    if (inspector.selected === object) {
      selectionBox.setFromObject(inspector.selected);
      hoverBox.visible = false;
    }
  });

  // Controls need to be added *after* main logic.
  // ExperimentalControls is the only viewport control class since the legacy
  // THREE.EditorControls (`?nav=classic`) was retired in #1956.
  const controls = new ExperimentalControls(camera, inspector.container);
  inspector.controls = controls; // used by ActionBar zoom/reset buttons
  // Attach the tilt-threshold tuning component (T = TH-03, exposed via the
  // nav-experimental-tuning A-Frame component — KD-32) so T is
  // live-tweakable during feel-testing.
  sceneEl.setAttribute('nav-experimental-tuning', '');
  controls.center.set(0, 1.6, 0);
  controls.rotationSpeed = 0.0035;
  controls.zoomSpeed = 0.05;
  controls.setAspectRatio(sceneEl.canvas.width / sceneEl.canvas.height);
  controls.addEventListener('change', () => {
    Events.emit('camerachanged');
  });

  sceneEl.addEventListener('newScene', (event) => {
    // Load fly-in target. The scene's entities already exist here, so the
    // viewer-start system can report the Viewer Start entity's pose; the
    // legacy snapshot pose is its fallback (and Start's, via the system).
    const {
      snapshotCameraState = null,
      editorCameraState = null,
      urlCameraState = null,
      authorId = null
    } = event.detail || {};
    const viewerStart = sceneEl.systems['viewer-start'];
    viewerStart?.setFallbackStartPose(snapshotCameraState);
    const params = new URLSearchParams(window.location.search);
    controls.newSceneCameraZoom(
      pickLoadCameraState({
        urlCameraState,
        viewerLaunch:
          params.get('viewer') === 'true' || params.get('embed') === 'true',
        isOwner: !authorId || authorId === auth.currentUser?.uid,
        startCameraState:
          viewerStart?.getStartCameraState() || snapshotCameraState,
        editorCameraState
      })
    );
  });

  Events.on('cameratoggle', (data) => {
    // Plan View intercept (KD-26): when
    // experimental nav is on and the user triggered Plan View (which
    // cameras.js dispatched as `orthotop`), revert the camera swap and
    // delegate to the experimental controls' animated tween instead. The
    // brief revert happens before any frame renders, so there is no
    // visual flicker. Other ortho-toggle paths (left/right/etc.) are
    // unaffected by the intercept.
    if (
      data.value === 'orthotop' &&
      typeof controls.handlePlanViewRequest === 'function'
    ) {
      const perspective = inspector.cameras && inspector.cameras.perspective;
      if (perspective) {
        sceneEl.camera = perspective;
        inspector.camera = perspective;
        transformControls.camera = perspective;
        streetNodeControls.camera = perspective;
        segmentWidthControls.camera = perspective;
        controls.setCamera(perspective);
        updateAspectRatio();
        controls.handlePlanViewRequest();
        return;
      }
    }
    controls.setCamera(data.camera);
    transformControls.camera = data.camera;
    streetNodeControls.camera = data.camera;
    segmentWidthControls.camera = data.camera;
    updateAspectRatio();
  });

  function enableControls() {
    mouseCursor.enable();
    transformControls.enabled = true;
    streetNodeControls.enabled = true;
    segmentWidthControls.enabled = true;
    controls.enabled = true;
  }
  enableControls();

  Events.on('inspectorcleared', () => {
    controls.center.set(0, 0, 0);
  });

  function detachAllTransformControls() {
    transformControls.detach();
    streetNodeControls.detach();
    segmentWidthControls.detach();
  }

  function attachStockGizmo(el) {
    transformControls.attach(el.object3D);
    // Selecting a no-scale entity while in scale mode: fall back to
    // translate so the gizmo never scales it.
    if (
      transformControls.mode === 'scale' &&
      el.hasAttribute('data-transform-no-scale')
    ) {
      transformControls.setMode('translate');
      transformControls.showX = true;
      transformControls.showY = true;
      transformControls.showZ = true;
    }
  }

  // Single routing table for which controls attach to the current selection.
  // The stock TransformControls gizmo attaches to every transformable entity,
  // and the managed-street endpoint nodes (#1096) are ADDITIVE handles layered
  // on top of it. The one exception is a managed street's segments (#1806):
  // they get ONLY their width bars (#1218), no stock gizmo, because
  // street-align owns segment transforms.
  function attachControlsForSelection() {
    detachAllTransformControls();
    const el = inspector.selectedEntity;
    if (
      !el ||
      !inspector.cursor.isPlaying ||
      el.hasAttribute('data-no-transform')
    ) {
      return;
    }
    // Segments of a managed street are the one selection that gets NO stock
    // gizmo (#1806): street-align owns segment transforms, so any move/rotate
    // applied here would be silently reset by the next street re-layout.
    // Their handles are the width bars (plus sidebar width/elevation and the
    // reorder buttons); the selection highlight box still shows.
    if (isManagedStreetSegment(el)) {
      segmentWidthControls.attach(el);
      return;
    }
    attachStockGizmo(el);
    if (el.components['managed-street']) {
      streetNodeControls.attach(el);
    }
  }

  Events.on('transformmodechange', (mode) => {
    // Some entities opt out of scale (`data-transform-no-scale`) — shapes and
    // managed streets, whose size is owned by their own editing affordances
    // (vertex handles; segment widths). Fall back to translate for those.
    if (
      mode === 'scale' &&
      inspector.selectedEntity?.hasAttribute?.('data-transform-no-scale')
    ) {
      mode = 'translate';
    }
    transformControls.setMode(mode);
    // Restrict rotation to the Y axis only.
    if (mode === 'rotate') {
      transformControls.showX = false;
      transformControls.showY = true;
      transformControls.showZ = false;
    } else {
      transformControls.showX = true;
      transformControls.showY = true;
      transformControls.showZ = true;
    }

    // If there's a selected entity, reattach the appropriate controls
    if (inspector.selectedEntity) {
      attachControlsForSelection();
    }
  });

  Events.on('translationsnapchanged', (dist) => {
    transformControls.setTranslationSnap(dist);
  });

  Events.on('rotationsnapchanged', (dist) => {
    transformControls.setRotationSnap(dist);
  });

  Events.on('transformspacechanged', (space) => {
    transformControls.setSpace(space);
  });

  // Torn down and re-armed on every selection change, so the listener never
  // outlives the selection that installed it or doubles up on reselect.
  let detachShapeRederiveListener = null;

  Events.on('objectselect', (object) => {
    hoverBox.visible = false;
    selectionBox.visible = false;
    detachAllTransformControls();
    // Not part of detachAllTransformControls(): the router calls that at the
    // top of attachControlsForSelection(), which runs AFTER the shape branch
    // below has armed the vertex handles — folding this in would disarm them.
    shapeVertexControls.detach();

    if (detachShapeRederiveListener) {
      detachShapeRederiveListener();
      detachShapeRederiveListener = null;
    }

    if (object && object.el) {
      // Must precede the getObject3D('mesh') branch: a shape HAS a `mesh` slot,
      // so it would otherwise take the generic immediate-sizing path — which is
      // wrong while that slot is still empty.
      if (object.el.components && object.el.components.shape) {
        shapeVertexControls.attach(object.el);
        // A shape installs its (empty) mesh group at init and fills it a frame
        // later, so sizing the box now measures nothing — and an empty Box3
        // leaves OrientedBoxHelper holding its previous geometry, i.e. the last
        // selection's box parked at this shape's position. Re-size on the
        // shape's own re-derive instead, the same shape of fix as the
        // async-glTF branch below. Staying subscribed for the life of the
        // selection (rather than one-shot) also keeps the box honest when a
        // vertex moves underneath it.
        const el = object.el;
        const onRederived = () => {
          if (object.parent === null) return; // detached before the frame landed
          selectionBox.setFromObject(object);
          selectionBox.visible = true;
        };
        el.addEventListener('shape-geometry-changed', onRederived);
        detachShapeRederiveListener = () =>
          el.removeEventListener('shape-geometry-changed', onRederived);
        // Size now only if there IS geometry. On a freshly-created shape there
        // isn't, and sizing from an empty Box3 would leave the helper showing
        // the previous selection's box at this shape's transform for a frame —
        // the exact artefact this branch exists to prevent. The event covers it.
        const meshGroup = el.getObject3D('mesh');
        if (meshGroup && meshGroup.children.length > 0) {
          selectionBox.setFromObject(object);
          selectionBox.visible = true;
        }
      } else if (object.el.getObject3D('mesh') || isBatched(object.el)) {
        // Batched entities have no mesh tree but OrientedBoxHelper falls back to the
        // cached _batchLocalBbox, so we can size the selection immediately.
        selectionBox.setFromObject(object);
        selectionBox.visible = true;
      } else if (object.el.hasAttribute('gltf-model')) {
        const listener = (event) => {
          if (event.target !== object.el) return; // we got an event for a child, ignore
          object.el.removeEventListener('model-loaded', listener);
          // Some models have a wrong bounding box if we don't wait a bit
          setTimeout(() => {
            if (object.parent === null) return; // entity was detached before timeout fired
            selectionBox.setFromObject(object);
            selectionBox.visible = true;
          }, 20);
        };
        object.el.addEventListener('model-loaded', listener);
      } else if (!object.el.isScene && object.el.id !== 'street-container') {
        selectionBox.setFromObject(object);
        selectionBox.visible = true;
      }

      attachControlsForSelection();
    }
  });

  Events.on('objectfocus', (object) => {
    // Feature-discovery: count the first focus-on-entity (double-click,
    // F-key, or sidebar focus button all route through this event).
    captureNavDiscovery('focus');
    controls.focus(object);
  });

  // Cursor-aware double-click navigation (KD-23; street-level nav only —
  // raycaster.js only emits this with the street-level flag on).
  Events.on('nav-experimental:doubleclick', (payload) => {
    if (controls.navigateDoubleClick) {
      controls.navigateDoubleClick(payload);
    }
  });

  // Restore the camera to a snapshot's captured pose (#1605).
  Events.on('cameraposefocus', (cameraState) => {
    controls.focusCameraState(cameraState);
  });

  Events.on('geometrychanged', (object) => {
    if (object !== null) {
      selectionBox.setFromObject(object);
    }
  });

  Events.on('entityupdate', (detail) => {
    const object = detail.entity.object3D;
    if (object instanceof THREE.PerspectiveCamera) {
      object.updateProjectionMatrix();
    }

    updateHelpers(object);
  });

  function updateAspectRatio() {
    if (!inspector.opened) return;
    // Modifying aspect for perspective camera is done by aframe a-scene.resize function
    // when the perspective camera is the active camera, so we actually do it a second time here,
    // but we need to modify it ourself when we switch from ortho camera to perspective camera (updateAspectRatio() is called in cameratoggle handler).
    const camera = inspector.camera;
    const aspect =
      inspector.container.offsetWidth / inspector.container.offsetHeight;
    if (camera.isPerspectiveCamera) {
      camera.aspect = aspect;
    } else if (camera.isOrthographicCamera) {
      const frustumSize = camera.top - camera.bottom;
      camera.left = (-frustumSize * aspect) / 2;
      camera.right = (frustumSize * aspect) / 2;
      camera.top = frustumSize / 2;
      camera.bottom = -frustumSize / 2;
    }

    controls.setAspectRatio(aspect); // for zoom in/out to work correctly for orthographic camera
    camera.updateProjectionMatrix();

    const cameraHelper = inspector.helpers[camera.uuid];
    if (cameraHelper) cameraHelper.update();
    setFatLineResolution(
      inspector.container.offsetWidth,
      inspector.container.offsetHeight
    );
  }
  setFatLineResolution(
    inspector.container.offsetWidth,
    inspector.container.offsetHeight
  );

  inspector.sceneEl.addEventListener('rendererresize', updateAspectRatio);

  Events.on('gridvisibilitychanged', (showGrid) => {
    grid.visible = showGrid;
    originIndicator.visible = showGrid;
  });

  Events.on('togglegrid', () => {
    grid.visible = !grid.visible;
    originIndicator.visible = grid.visible;
  });

  useStore.subscribe(
    (state) => state.isInspectorEnabled,
    (isEnabled) => {
      const modeManager = AFRAME.scenes[0].systems['mode-manager'];
      if (isEnabled) {
        modeManager?.setMode('editor');
        enableControls();
        AFRAME.scenes[0].camera = inspector.camera;
        Array.prototype.slice
          .call(document.querySelectorAll('.a-enter-vr,.rs-base'))
          .forEach((element) => {
            element.style.display = 'none';
          });
        if (inspector.config.copyCameraPosition) {
          copyCameraPosition(
            inspector.cameras.original.object3D,
            inspector.cameras.perspective,
            controls
          );
        }
      } else {
        // The Viewer keeps the editor's camera and controls so
        // viewing feels identical to editing (#1848) — same pose, same
        // pan/orbit/zoom. Only selection and transform tools turn off.
        // Features that need a scene-driven camera (drive mode, WebXR)
        // borrow the rig via mode-manager and give it back.
        mouseCursor.disable();
        transformControls.enabled = false;
        streetNodeControls.enabled = false;
        segmentWidthControls.enabled = false;
        controls.enabled = true;
        // The Viewer is always perspective — leave an ortho editing view.
        if (inspector.camera.isOrthographicCamera) {
          Events.emit('cameraperspectivetoggle');
        }
        Array.prototype.slice
          .call(document.querySelectorAll('.a-enter-vr,.rs-base'))
          .forEach((element) => {
            element.style.display = 'block';
          });
        modeManager?.setMode('viewer');
      }
    }
  );
}
