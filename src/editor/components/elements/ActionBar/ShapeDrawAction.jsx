/* global AFRAME, THREE */

// Shape draw tool: click to lay down polyline vertices on the ground plane
// with live length + angle readouts, finish with Enter / Esc (or double-click
// to place a last point and finish), step back with Backspace. Generalises the removed Ruler tool from two
// fixed points to an N-vertex open polyline, and adds the readout layer
// (ShapeReadouts). Which readouts show follows the editor's display
// preferences (shapeToolPrefs.js), read at every render.
//
// Angle snap, when on, quantises the direction from the last vertex to the
// pointer (the first side to the scene's axes, or the open group's, unless
// alignment is off) and places the pointer's perpendicular foot on that ray; a
// guide line shows the snapped direction. The close is still judged by the
// pointer being over the first vertex — never by the snapped point — and while
// it is armed the last vertex is shown slid along its own side to where both
// closing corners are snapped. Every way of finishing commits exactly that
// previewed ring, or the shape open when no such ring exists. The geometry is
// in shapeSnap.js, the rules in shapeDrawRules.js.
//
// No exit discards placed work: Enter, Esc, double-click and switching tools
// all commit through finish(). Recovery is Backspace before finishing and
// Ctrl+Z (EntityCreateCommand) after, so no keystroke can destroy an arbitrary
// amount of unrecoverable work. Enter and Esc are the same key: both finish
// WITHOUT the un-clicked trailing cursor point, as in every other polyline
// tool (pen tools, CAD polylines). Placing a final point and finishing in one
// gesture is the double-click.
//
// Closure is refused on TWO questions, not one: the closing edge must not cross
// a committed edge, AND the ring it completes must enclose a region — a ring of
// exactly zero area (three collinear points, say) crosses nothing and still has
// no interior to fill, measure or extrude. Both live in closePlan
// (shapeDrawRules.js), which every closedness decision in this file goes
// through.
//
// Shapes always draw OPEN; the only way to close one is the first-vertex
// gesture (isPointerOverFirstVertex). Letting a ring stay open is what allows a
// click never to be refused merely because closure would be — which in turn is
// what makes stars, combs and deep concavities near the first vertex drawable
// in their natural order. Why a placement is not refused over the provisional
// closing edge: see placementVerdict.
//
// The preview draws the committed vertices PLUS the trailing cursor vertex;
// finishing drops the cursor vertex, so the committed shape is the preview
// minus the rubber-band point.
//
// Draw state lives in refs, never useState: the deactivation auto-finish runs
// from the effect cleanup, a closure over the last render — a useState vertex
// array would be read stale there. The listener effect is keyed only on
// isActive so it doesn't tear down/re-add mid-draw.

import { useEffect, useRef } from 'react';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import useStore from '@/store';
import ShapeReadouts from '../../../lib/ShapeReadouts';
import {
  closePlan,
  commitOutcome,
  placementVerdict,
  previewRefused
} from '../../../lib/shapeDrawRules.js';
import {
  headingDeg,
  snapHeading,
  snapPlacement
} from '../../../lib/shapeSnap.js';
import { shapeDrawMessage } from '../../../lib/shapeDrawMessages.js';
import {
  SHAPE_TOOL_SETTINGS_ATTR,
  SNAP_OFF
} from '../../../lib/shapeToolPrefs.js';
import {
  createFatLineMaterial,
  setFatLinePositions
} from '../../../lib/fatLines.js';
import { intersectPlaneOrNull } from '../../../lib/intersectPlaneOrNull.js';
// px — a larger press→release move is a drag. Shared with the vertex-editing
// tool: it is one rule in both places, so the two must not drift apart.
import { CLICK_MOVE_THRESHOLD } from '../../../lib/shapeEditRules.js';
import {
  isSolidFloorHit,
  worldHitNormal
} from '../../../lib/nav-experimental/cursorAnchor.js';
import { ProbeTargets } from '../../../lib/nav-experimental/probeTargets.js';
import { BLOCK_SLOPE_MIN_DEGREES } from '../../../lib/nav-experimental/constants.js';
import { getShapeStyle } from '../../../lib/shapeStyle.js';
import { nextMoveGizmo } from '../../../lib/transformModes.js';
import { STREET_CONTAINER_ID } from '../../../lib/groups/groupModel.js';
import { groupMessage } from '../../../lib/groups/groupMessages.js';
import {
  beginPlacement,
  hideDrawingExtent,
  localPoseUnder,
  placeDefinition,
  resolvePlacement,
  showDrawingExtent
} from '../../../lib/groups/groupPlacement.js';

// m — reject a click ~on the PREVIOUS vertex. Distinct from the editor's
// MIN_EDIT_VERTEX_SEPARATION (shapeEditRules.js), which holds the same number
// but measures against every vertex; the two are separate constants so tuning
// one does not silently retune the other.
const MIN_DRAW_VERTEX_SPACING = 0.05;
// px — a pointer this close to the first vertex arms the close gesture.
// Screen-space, not world metres, so it is scale-invariant — matches the
// ruler/draw click-vs-drag pixel basis.
const CLOSE_PX_TOLERANCE = 12;
// The tool's own marks — the close-target ring and the snap guide.
const TOOL_ACCENT_COLOR = 0x00ffcc;
let shapeLayerCounter = 1; // distinguishes drawn shapes in the SceneGraph

// A hit steeper than this reads as a wall / façade / cliff — not a drawable
// floor. Same threshold (TH-47) the WASD controls use to decide walkable floor
// vs a blocking wall, so "where you can draw" matches "where you can walk":
// sloping roads / textured terrain draw fine, vertical building faces don't.
const WALL_SLOPE_RAD = (BLOCK_SLOPE_MIN_DEGREES * Math.PI) / 180;

// Surface pick: cast the cursor ray at the real scene geometry and return the
// nearest SOLID-FLOOR hit — reusing the nav floor-probe machinery rather than
// rolling our own. Placing vertices on the true surface (not the y=0 plane) is
// what makes the line visible: 3DStreet road/sidewalk surfaces sit 0.1–0.2 m
// above y=0, so a y=0 vertex is buried under them and the normal-depth line is
// occluded.
//
// `isSolidFloorHit` (cursorAnchor.js) accepts a street-segment / building /
// tiles surface and rejects **scatter** (trees, signs, people, vehicles,
// fences) AND **editor chrome** (camera, gizmos, grid, the inspector cursor —
// they carry no owning `.el`, so they reject for free). That chrome rejection
// is the fix for the regression where a naive whole-scene raycast planted the
// vertex at the camera. `ProbeTargets` is the curated, cached target list
// (the #1855 perf work — excludes map layers, keeps Google tiles). Same
// classification the nav floor probe and double-click teleport use.
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pickRaycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pickSurfaceOrNull(clientX, clientY, probeTargets) {
  const canvas = AFRAME.scenes[0]?.canvas;
  const camera = AFRAME.INSPECTOR?.camera;
  const sceneObj = AFRAME.scenes[0]?.object3D;
  if (!canvas || !camera || !sceneObj) return null;
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    (2 * (clientX - rect.left)) / rect.width - 1,
    -((2 * (clientY - rect.top)) / rect.height - 1)
  );
  pickRaycaster.setFromCamera(ndc, camera);
  const targets = probeTargets ? probeTargets.targets() : [sceneObj];
  const hits = pickRaycaster.intersectObjects(targets, true);
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (!isSolidFloorHit(hit)) continue; // scatter / editor chrome
    // Reject walls (near-vertical façades/cliffs) the same way WASD does, and
    // KEEP WALKING the ray past them: pointing at a building wall falls
    // through to the ground behind it rather than snapping to the wall or
    // refusing. Roofs and sloping roads (slope < 45°) stay drawable. This also
    // guarantees every vertex sits on a nearly-flat surface, so the x/z
    // plan-view area is always faithful — no wall-drawn degenerate area.
    const ny = worldHitNormal(hit).y;
    const slopeRad = Math.acos(Math.max(-1, Math.min(1, ny)));
    if (slopeRad >= WALL_SLOPE_RAD) continue; // wall — fall through to the floor behind
    return hit.point.clone();
  }
  // No drawable floor under the cursor — fall back to the y=0 ground plane
  // (empty ground / the environment sit at y=0), or null on a full miss (the
  // ray points at/above the horizon).
  const hit = new THREE.Vector3();
  return pickRaycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
}

// Pick against a horizontal plane at height `k`. The FIRST vertex is placed on
// the real surface (pickSurfaceOrNull), establishing k; every subsequent
// vertex plots on the y = k plane. So the whole shape is flat at the height of
// its first point — it sits at the real surface height (works where y=0 is
// nowhere near the ground, e.g. geospatial scenes), yet is planar, so the x/z
// plan-view area is exact. (Following the surface per-vertex instead, rather
// than staying planar, is a possible later per-shape option.)
const kPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pickKPlaneOrNull(clientX, clientY, k) {
  kPlane.constant = -k; // plane y + constant = 0  →  constant = -k
  return intersectPlaneOrNull(clientX, clientY, kPlane);
}

// Project a world point to client (screen) px via the inspector camera + canvas
// rect — the inverse of the ndc math above. Returns {x,y} or null if the point
// is behind the camera. Used to measure cursor-to-first-vertex distance in
// screen space for the close gesture.
const projVec = new THREE.Vector3();
function worldToScreen(worldPoint) {
  const canvas = AFRAME.scenes[0]?.canvas;
  const camera = AFRAME.INSPECTOR?.camera;
  if (!canvas || !camera) return null;
  projVec.set(worldPoint.x, worldPoint.y, worldPoint.z).project(camera);
  if (projVec.z > 1) return null; // behind the camera / beyond the far plane
  const rect = canvas.getBoundingClientRect();
  return {
    x: rect.left + ((projVec.x + 1) / 2) * rect.width,
    y: rect.top + ((1 - projVec.y) / 2) * rect.height
  };
}

// Is `el` one of the Shape Tool section's controls? A native dropdown keeps
// focus after it is dismissed without a pick, and while it has focus the
// drawing keys go to it.
function isShapeToolSettingsControl(el) {
  return !!el?.closest?.(`[${SHAPE_TOOL_SETTINGS_ATTR}]`);
}

// The tool's settings are in the right panel, so picking the tool shows it —
// on every activation, since the tool ends after each shape — unless the user
// has turned that off.
function openShapeToolPanelIfWanted() {
  const state = useStore.getState();
  if (!state.shapeToolSettings.openPanelOnSelect) return;
  state.setPanelsVisible(true);
  state.setRightPanelTab('properties');
}

// The snapped direction, drawn from the last vertex while snap is on. It runs
// GUIDE_OVERSHOOT times the side being placed, so it reaches past the pointer,
// and never shorter than GUIDE_MIN_LENGTH_M.
//
// Created once and kept, toggled by `visible`, like the group outline: a fat
// line sets its own resolution from the renderer on every draw, so one created
// late draws at the right width. Never raycastable — a fat line's raycast
// needs a camera, and the scene (which holds the editor's helpers) is probed
// by camera-less raycasters.
const GUIDE_OVERSHOOT = 2;
const GUIDE_MIN_LENGTH_M = 1;
let snapGuideLine = null;

const snapGuide = {
  // Into the current inspector's helpers, once per activation (a fresh
  // inspector re-parents it).
  attach() {
    if (!snapGuideLine) {
      snapGuideLine = new LineSegments2(
        new LineSegmentsGeometry(),
        createFatLineMaterial(TOOL_ACCENT_COLOR)
      );
      snapGuideLine.name = 'shapeDrawSnapGuide';
      snapGuideLine.raycast = function () {};
    }
    snapGuideLine.visible = false;
    const helpers = AFRAME.INSPECTOR?.sceneHelpers;
    if (helpers && snapGuideLine.parent !== helpers) {
      helpers.add(snapGuideLine);
    }
  },
  show(from, heading, placedLength) {
    if (!snapGuideLine) return;
    const length = Math.max(GUIDE_OVERSHOOT * placedLength, GUIDE_MIN_LENGTH_M);
    const rad = (heading * Math.PI) / 180;
    setFatLinePositions(snapGuideLine, [
      from.x,
      from.y,
      from.z,
      from.x + length * Math.cos(rad),
      from.y,
      from.z + length * Math.sin(rad)
    ]);
    snapGuideLine.visible = true;
  },
  hide() {
    if (snapGuideLine) snapGuideLine.visible = false;
  }
};

// The heading of the axes a first side snaps to: the +x axis of the group the
// shape will land in, else the world's (0). The two conditions are the ones
// under which placeDefinition keeps the shape in the group — the group still
// takes children, and a pose under it exists without distortion — tested at
// the first vertex, near where the shape's own position will be.
const frameMatrix = new THREE.Matrix4();
const frameAxis = new THREE.Vector3();
function firstSideAxisHeading(ticket, firstVertex) {
  const groupEl = ticket ? resolvePlacement(ticket) : null;
  if (!groupEl || !firstVertex) return 0;
  frameMatrix.makeTranslation(firstVertex.x, firstVertex.y, firstVertex.z);
  if (!localPoseUnder(groupEl, frameMatrix)) return 0;
  groupEl.object3D.updateWorldMatrix(true, false);
  frameAxis.set(1, 0, 0).transformDirection(groupEl.object3D.matrixWorld);
  return headingDeg({ x: 0, z: 0 }, { x: frameAxis.x, z: frameAxis.z });
}

function isTextFieldFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  );
}

// Ctrl/Cmd+Z, and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y.
const isUndoChord = (e) =>
  (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z');
const isRedoChord = (e) =>
  (e.ctrlKey || e.metaKey) &&
  ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
    e.key === 'y' ||
    e.key === 'Y');
const isUndoRedoChord = (e) => isUndoChord(e) || isRedoChord(e);

export function useShapeDrawTool(changeTransformMode, isActive) {
  const verticesRef = useRef([]); // committed world positions [{x,y,z}]
  const committedElsRef = useRef([]); // matching shape-vertex a-entities
  const previewElRef = useRef(null);
  const trailingElRef = useRef(null);
  const readoutsRef = useRef(null);
  const downXYRef = useRef(null);
  const placedLastRef = useRef(false);
  const committingRef = useRef(false);
  const invalidRef = useRef(false); // preview currently recoloured invalid (red)
  const armedRef = useRef(false); // pointer is over the first vertex
  const highlightRef = useRef(null); // first-vertex close-target marker
  // The snapped heading shown for the side being placed, and the step it was
  // snapped at, so a pointer on a boundary keeps it rather than flickering.
  // Dropped whenever a vertex is placed or removed: it never carries over to
  // another side.
  const heldHeadingRef = useRef(null);
  const setShapeDrawActive = useStore.getState().setShapeDrawActive;

  useEffect(() => {
    if (!isActive) return undefined;
    const scene = AFRAME.scenes[0];
    const canvas = scene?.canvas;
    if (!canvas) return undefined;

    // Where the shape goes is fixed now, as the tool starts, like every other
    // way of adding an item: the innermost group open at this moment, or null
    // when none is (the shape is then created at the top level).
    const ticket = beginPlacement();
    let extentHandle = null;

    // --- activate ---------------------------------------------------------
    committingRef.current = false;
    verticesRef.current = [];
    committedElsRef.current = [];
    placedLastRef.current = false;
    invalidRef.current = false;
    armedRef.current = false;
    heldHeadingRef.current = null;
    setShapeDrawActive(true);
    openShapeToolPanelIfWanted();
    // Deselect on entry: nothing should stay selected while drawing (its
    // on-select readouts would linger over the new shape, and a stray
    // Backspace could otherwise target it).
    if (AFRAME.INSPECTOR?.selectedEntity) {
      AFRAME.INSPECTOR.selectEntity(null);
    }

    snapGuide.attach();

    // Curated + cached raycast target list (excludes map layers; keeps tiles).
    // Reused from the nav floor probes; recomputes only on scene-graph change.
    const probeTargets = new ProbeTargets(scene);

    // Read once per activation, and shared with commitShape below, so the
    // committed shape always matches the preview it was drawn as.
    const style = getShapeStyle();
    const previewEl = document.createElement('a-entity');
    previewEl.id = 'shapeDrawPreview';
    previewEl.classList.add('hideFromSceneGraph');
    previewEl.setAttribute('shape', {
      lineColor: style.lineColor,
      lineWidth: style.lineWidth,
      // The preview carries the sticky fill too, so what is previewed is what
      // commits — a sticky opacity of 0 previews unfilled. A fill only shows
      // once the preview is closed with 3+ vertices, and the cursor counts as
      // one of them (see below), so it appears from the 2nd committed corner.
      // setInvalidSignal deliberately leaves the fill alone, so the invalid-red
      // signal never overwrites these and nothing needs restoring.
      fillColor: style.fillColor,
      fillOpacity: style.fillOpacity,
      // The preview is always open: closure happens only at commit, via the
      // first-vertex gesture, which snaps the trailing vertex onto the first so
      // the closing edge is visible without the shape being closed.
      closed: false
    });
    scene.appendChild(previewEl);
    previewElRef.current = previewEl;

    // While drawing in an open group, its outline and scrim take in the
    // drawing, which is not yet a member of the group. From the first placed
    // point, with the trailing cursor point; the preview sits at the scene
    // root, so its positions are world positions.
    if (ticket) {
      const forEachDrawingPoint = (visit) => {
        const verts = effectiveVertices();
        for (let i = 0; i < verts.length; i++) {
          visit(verts[i].x, verts[i].y, verts[i].z);
        }
        const trailing = trailingElRef.current?.object3D?.position;
        if (verts.length && trailing) visit(trailing.x, trailing.y, trailing.z);
      };
      extentHandle = showDrawingExtent(
        ticket.parentId,
        forEachDrawingPoint,
        style.lineWidth
      );
    }

    // First-vertex close-target marker (manual-close mode): a flat ring shown when
    // the cursor is within CLOSE_PX_TOLERANCE of the first vertex. Tool-owned,
    // created once, hidden by default, disposed on cleanup.
    const highlightGeo = new THREE.TorusGeometry(0.5, 0.06, 8, 24);
    const highlightMat = new THREE.MeshBasicMaterial({
      color: TOOL_ACCENT_COLOR,
      depthTest: false,
      transparent: true,
      opacity: 0.9
    });
    const highlightMesh = new THREE.Mesh(highlightGeo, highlightMat);
    highlightMesh.rotation.x = Math.PI / 2; // lie flat in the x/z plane
    highlightMesh.renderOrder = 1000;
    highlightMesh.visible = false;
    scene.object3D.add(highlightMesh);
    highlightRef.current = {
      mesh: highlightMesh,
      geo: highlightGeo,
      mat: highlightMat
    };

    const trailingEl = document.createElement('a-entity');
    trailingEl.setAttribute('shape-vertex', '');
    trailingEl.classList.add('hideFromSceneGraph');
    previewEl.appendChild(trailingEl);
    trailingElRef.current = trailingEl;

    const onPreviewLoaded = () => {
      // Guard against a draw that finished before 'loaded' fired — teardown
      // has already nulled the ref and detached the element.
      if (previewElRef.current !== previewEl) return;
      readoutsRef.current = new ShapeReadouts(previewEl);
      const state = useStore.getState();
      readoutsRef.current.setUnits(state.unitsPreference);
      readoutsRef.current.setDisplay(state.shapeToolSettings);
    };
    previewEl.addEventListener('loaded', onPreviewLoaded);

    canvas.style.cursor = 'crosshair';

    // --- gesture handlers -------------------------------------------------
    const setTrailing = (point) => {
      const tEl = trailingElRef.current;
      if (!tEl || !tEl.object3D) return;
      tEl.object3D.position.set(point.x, point.y, point.z);
    };

    const collapseTrailing = () => {
      // On a miss, park the trailing vertex on the last committed one so the
      // derive skips the zero-length rubber-band segment (blanks it).
      const verts = verticesRef.current;
      if (verts.length) setTrailing(verts[verts.length - 1]);
    };

    // `polyline` is world points, the active segment last; `options` as
    // ShapeReadouts.renderActive. Units and display preferences are re-read on
    // every render, so a change made mid-draw shows on the next one.
    const refreshReadouts = (polyline, options) => {
      const r = readoutsRef.current;
      if (!r) return;
      const state = useStore.getState();
      r.setUnits(state.unitsPreference);
      r.setDisplay(state.shapeToolSettings);
      r.renderActive(
        polyline.map((v) => new THREE.Vector3(v.x, v.y, v.z)),
        options
      );
    };

    // Recolour the preview red on an invalid (self-intersecting) placement, and
    // back to the style colour when valid. Idempotent — only acts on a real
    // flip — so every path (move, miss, close, mode switch) can call it freely
    // without leaving the preview stuck red.
    //
    // Goes through the shape's own invalid signal rather than writing
    // `lineColor`: that property serializes, so a save mid-draw would have
    // baked the red in, and the restore would have used the draw tool's own
    // colour rather than the shape's. Unlike setAttribute, a direct method call
    // is not queued until the component inits, so this no-ops before then —
    // leaving the flag unrecorded so the first call after init still lands.
    const setInvalid = (bad) => {
      if (invalidRef.current === bad) return;
      const shape = previewElRef.current?.components?.shape;
      if (!shape) return;
      invalidRef.current = bad;
      shape.setInvalidSignal(bad);
    };

    // Show/hide the first-vertex close marker, positioning it on the first
    // committed vertex when shown.
    const updateHighlight = (show) => {
      const h = highlightRef.current;
      if (!h) return;
      if (show) {
        const v0 = verticesRef.current[0];
        if (v0) h.mesh.position.set(v0.x, v0.y, v0.z);
      }
      h.mesh.visible = show;
    };

    const settings = () => useStore.getState().shapeToolSettings;
    const snapIsOn = () => settings().snapStep !== SNAP_OFF;

    // How closing the committed ring resolves, at the snap step in force now.
    // Computed afresh by every reader — the preview on each armed move and
    // every commit path — so none can see a stale answer. It runs only while
    // armed, and is cheap: under a millisecond for a 50-vertex shape at a 1°
    // step, the worst case.
    const closePlanNow = () =>
      closePlan(
        verticesRef.current,
        settings().snapStep,
        MIN_DRAW_VERTEX_SPACING
      );

    // The ring the armed preview shows (its last vertex slid, with snap on),
    // or null when not armed or the close is refused. Rewritten by every
    // syncArmed call; display state only — commits recompute the plan.
    let armedRing = null;

    // The vertices as the preview shows them.
    const effectiveVertices = () => armedRing ?? verticesRef.current;

    // Show the last committed vertex where the effective ring has it.
    const syncLastVertexDisplay = () => {
      const n = verticesRef.current.length;
      if (!n) return;
      const el = committedElsRef.current[n - 1];
      const v = effectiveVertices()[n - 1];
      if (el?.object3D && v) el.object3D.position.set(v.x, v.y, v.z);
    };

    // Arm or disarm the close, and bring everything that shows it into line:
    // the close marker, the red refusal, the slid last vertex, the guide and
    // the armed readouts. Runs on EVERY call, unchanged value or not — a step
    // changed while armed calls it again to repaint.
    const syncArmed = (armed) => {
      armedRef.current = armed;
      const plan = armed ? closePlanNow() : null;
      armedRing = plan && !plan.refused ? plan.ring : null;
      updateHighlight(armed);
      setInvalid(!!plan?.refused);
      syncLastVertexDisplay();
      if (plan) {
        snapGuide.hide();
        renderArmedReadouts(plan);
      }
    };

    // Where a pointer at `raw` places the next vertex: `raw` itself unless
    // snap applies, else the foot on the snapped ray from the last vertex.
    // The first vertex is never snapped, and the first side only when it is
    // aligned to axes.
    const placementFor = (raw) => {
      const verts = verticesRef.current;
      const n = verts.length;
      const { snapStep: step, alignToAxes } = settings();
      if (step === SNAP_OFF || !n || (n === 1 && !alignToAxes)) {
        return { point: raw, heading: null };
      }
      const last = verts[n - 1];
      const base =
        n === 1
          ? firstSideAxisHeading(ticket, verts[0])
          : headingDeg(verts[n - 2], last);
      const held = heldHeadingRef.current;
      const heading = snapHeading({
        rawHeading: headingDeg(last, raw),
        base,
        step,
        excludeReverse: n > 1,
        currentHeading: held?.step === step ? held.heading : null
      });
      return { point: snapPlacement({ last, raw, heading }), heading };
    };

    const addCommittedVertex = (point) => {
      verticesRef.current.push({ x: point.x, y: point.y, z: point.z });
      const el = document.createElement('a-entity');
      el.setAttribute('shape-vertex', '');
      el.classList.add('hideFromSceneGraph');
      el.setAttribute('position', `${point.x} ${point.y} ${point.z}`);
      // Insert BEFORE the trailing (rubber-band) vertex so DOM order — the
      // shape's geometry truth — stays [committed…, trailing].
      previewEl.insertBefore(el, trailingElRef.current);
      committedElsRef.current.push(el);
      heldHeadingRef.current = null;
    };

    const removeLastVertex = () => {
      const verts = verticesRef.current;
      if (!verts.length) return;
      verts.pop();
      const el = committedElsRef.current.pop();
      if (el && el.parentNode) el.parentNode.removeChild(el);
      heldHeadingRef.current = null;
    };

    const onPointerDown = (e) => {
      if (committingRef.current) return;
      // A canvas press hands the drawing keys back from a tool-section
      // control that kept focus (a dropdown dismissed without a pick).
      const focused = document.activeElement;
      if (isShapeToolSettingsControl(focused)) focused.blur();
      downXYRef.current = { x: e.clientX, y: e.clientY };
    };

    // The FIRST vertex is picked off the real surface (establishing the shape's
    // height k); every later vertex is picked on the y = k plane, so the shape
    // is planar at k. Flat by construction → no floor→roof jump possible and
    // the x/z area is exact.
    const pickForNextVertex = (clientX, clientY) => {
      const verts = verticesRef.current;
      if (!verts.length) {
        return pickSurfaceOrNull(clientX, clientY, probeTargets);
      }
      return pickKPlaneOrNull(clientX, clientY, verts[0].y);
    };

    // True when at least three vertices are placed (so a close is meaningful)
    // and the pointer is within CLOSE_PX_TOLERANCE screen px of the first.
    const isPointerOverFirstVertex = (clientX, clientY) => {
      const verts = verticesRef.current;
      if (verts.length < 3) return false;
      const scr = worldToScreen(verts[0]);
      if (!scr) return false;
      if (Math.hypot(clientX - scr.x, clientY - scr.y) > CLOSE_PX_TOLERANCE) {
        return false;
      }
      return true;
    };

    // The armed preview's readouts: the closing side, the side the close slid
    // (when it moved), both closing corners, and — when snap refuses the
    // close — why, naming snap only when turning it off would let it close.
    function renderArmedReadouts(plan) {
      const ring = effectiveVertices();
      const n = ring.length;
      // The ring with its first vertex repeated, so index n closes it.
      const closedPolyline = [...ring, ring[0]];
      const last = n - 1;
      const slidSide = n - 2; // last-but-one → last vertex
      const closingCorners = [
        [last - 1, last, n], // at the last vertex
        [last, 0, 1] // at the first vertex
      ];
      let notice = null;
      if (plan.refused && snapIsOn()) {
        const unsnapped = closePlan(
          verticesRef.current,
          SNAP_OFF,
          MIN_DRAW_VERTEX_SPACING
        );
        notice = shapeDrawMessage(
          unsnapped.refused ? 'closeRefused' : 'snapCloseRefused'
        );
      }
      refreshReadouts(closedPolyline, {
        extraSegments: plan.adjusted ? [slidSide] : [],
        corners: closingCorners,
        notice
      });
    }

    // A snap step changed from the keyboard while armed sends no pointer
    // event, so the armed preview is repainted here. Only a repaint: every
    // commit computes its own plan at the step then in force.
    const repaintArmed = () => {
      if (armedRef.current) syncArmed(true);
    };

    const onPointerMove = (e) => {
      if (committingRef.current) return;
      const raw = pickForNextVertex(e.clientX, e.clientY);
      if (!raw) {
        collapseTrailing();
        readoutsRef.current && readoutsRef.current.clear();
        syncArmed(false); // also never leaves the preview stuck red on a miss
        snapGuide.hide();
        return;
      }
      // Close-gesture arming, on the POINTER — the snapped point is generally
      // on no ray through the first vertex.
      if (isPointerOverFirstVertex(e.clientX, e.clientY)) {
        setTrailing(verticesRef.current[0]); // preview the closing edge
        syncArmed(true);
        return;
      }
      if (armedRef.current) syncArmed(false);
      else updateHighlight(false);
      const { point, heading } = placementFor(raw);
      heldHeadingRef.current =
        heading === null ? null : { step: settings().snapStep, heading };
      const verts = verticesRef.current;
      const n = verts.length;
      const verdict = placementVerdict(verts, point, MIN_DRAW_VERTEX_SPACING);
      setTrailing(point);
      // The live corner is at the last placed vertex.
      refreshReadouts([...verts, point], {
        corners: n >= 2 ? [[n - 2, n - 1, n]] : []
      });
      setInvalid(previewRefused(snapIsOn(), verdict));
      if (heading !== null) {
        const last = verts[n - 1];
        snapGuide.show(
          last,
          heading,
          Math.hypot(point.x - last.x, point.z - last.z)
        );
      } else {
        snapGuide.hide();
      }
    };

    // Cursor off the canvas: collapse the preview to the committed ring — the
    // same state a pick-miss leaves.
    const onPointerLeave = () => {
      if (committingRef.current) return;
      collapseTrailing();
      readoutsRef.current && readoutsRef.current.clear();
      syncArmed(false);
      snapGuide.hide();
    };

    const onPointerUp = (e) => {
      if (committingRef.current) return;
      const down = downXYRef.current;
      downXYRef.current = null;
      placedLastRef.current = false;
      if (down) {
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (moved > CLICK_MOVE_THRESHOLD) return; // a drag (orbit/pan)
      }
      // Close gesture: commit the committed ring as a polygon (do not add the
      // duplicate first vertex). Refused outright if the ring would not be a
      // legal one — closure was asked for explicitly here, so quietly handing
      // back an open shape would answer a different question than the one the
      // click asked.
      if (armedRef.current) {
        if (closePlanNow().refused) return;
        // This release also bubbles to the viewport raycaster's empty-space
        // click handler, which would deselect the polygon the create command
        // is about to select (the first vertex is not a raycastable entity).
        // Mark the press as consumed by a viewport tool, exactly as the gizmos
        // do, so the shape stays selected (raycaster.js handleEmptySpaceClick).
        if (AFRAME.INSPECTOR) AFRAME.INSPECTOR.gizmoCapturedPress = true;
        finish(); // closing onto the first vertex
        return;
      }
      const raw = pickForNextVertex(e.clientX, e.clientY);
      if (!raw) return; // horizon click — no-op
      // The same placement the preview showed for this pointer.
      const { point } = placementFor(raw);
      const verdict = placementVerdict(
        verticesRef.current,
        point,
        MIN_DRAW_VERTEX_SPACING
      );
      // A crossing, or on top of the previous vertex.
      if (verdict.crosses || verdict.tooClose) return;
      addCommittedVertex(point);
      placedLastRef.current = true;
      setInvalid(false);
      setTrailing(point);
      // The corner just made, at the previous vertex, keeps its angle; the
      // guide was for the side now placed, so it goes until the pointer moves.
      const n = verticesRef.current.length;
      refreshReadouts([...verticesRef.current, point], {
        corners: n >= 3 ? [[n - 3, n - 2, n - 1]] : []
      });
      snapGuide.hide();
    };

    const onDblClick = () => {
      if (committingRef.current) return;
      // Usually a no-op: the double-click's second release lands within
      // MIN_DRAW_VERTEX_SPACING of the vertex the first one placed, so it is rejected
      // and there is nothing to retract. It only bites zoomed far enough out
      // that a few pixels of jitter exceed that spacing in world units — then
      // the second release really did place a vertex, and this removes it.
      if (placedLastRef.current) removeLastVertex();
      finish();
    };

    // Step back one vertex. The armed state and the guide are cleared first:
    // the removed vertex changes both, and a pointer resting still sends no
    // move to clear them. The next pointermove recomputes the preview.
    const stepBack = () => {
      syncArmed(false);
      snapGuide.hide();
      removeLastVertex();
      collapseTrailing();
      setInvalid(false);
      refreshReadouts(verticesRef.current);
    };

    const onKeyDown = (e) => {
      // A focused field keeps its keys — except undo/redo on a dropdown,
      // which has no text to undo: there the chord would otherwise reach the
      // editor's global undo and could undo the previous shape.
      if (
        isTextFieldFocused() &&
        !(isUndoRedoChord(e) && document.activeElement?.tagName === 'SELECT')
      ) {
        return;
      }
      if (e.key === 'Enter') {
        finish();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        stepBack();
      } else if (isUndoChord(e)) {
        // Mid-draw undo steps back a pending vertex; it must not reach the
        // editor undo stack (which would pop an unrelated entity).
        e.preventDefault();
        e.stopPropagation();
        stepBack();
      } else if (isRedoChord(e)) {
        // Mid-draw redo (Ctrl+Shift+Z / Ctrl+Y): swallow so it can't redo an
        // unrelated previously-undone editor command while drawing. No-op.
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // Escape finishes, like Enter — but it has to be taken on keyUP, in the
    // capture phase, and stopped there. The editor's global shortcut deselects
    // the selected entity on Escape keyup; finishing on keydown would create
    // and select the shape and then have that keyup immediately deselect it,
    // so Esc and Enter would leave the editor in different states.
    //
    // Esc committing rather than discarding is a deliberate departure from the
    // rest of the editor, where Escape backs out (the Ruler drops its pending
    // point; an inline rename reverts). A ruler holds one click and is
    // transient; a polyline can hold twenty, with no mid-draw undo beyond
    // Backspace, so discarding on a keystroke that sits next to Enter is a
    // bad trade.
    const onKeyUp = (e) => {
      if (e.key !== 'Escape') return;
      if (isTextFieldFocused()) return;
      e.stopPropagation();
      finish();
    };

    // --- finish -----------------------------------------------------------
    function teardown() {
      const pEl = previewElRef.current;
      previewEl.removeEventListener('loaded', onPreviewLoaded);
      if (readoutsRef.current) {
        readoutsRef.current.dispose();
        readoutsRef.current = null;
      }
      if (pEl && pEl.parentNode) pEl.parentNode.removeChild(pEl);
      // The outline and scrim go back to the group's own bounds, which take in
      // the shape once it has been built.
      hideDrawingExtent(extentHandle);
      extentHandle = null;
      previewElRef.current = null;
      trailingElRef.current = null;
      committedElsRef.current = [];
      verticesRef.current = [];
    }

    function commitShape(closed, verts) {
      // `style` is the activation-time read above — one read per activation, so
      // preview and commit cannot disagree. See docs/shapes.md#sticky-style.
      //
      // It cannot go stale for a SECOND shape either: every commit path is a
      // deactivation or is immediately followed by one (finish() returns to
      // Move; the cleanup path IS the deactivation), and this effect
      // is keyed on isActive — so it re-runs and re-reads before another shape
      // can be drawn. A future "stay active after commit" change breaks that and
      // would have to move the read.

      // The definition of a shape through `points`, which are positions in the
      // frame the entity is created in. The entity sits at their centroid and
      // each vertex is stored RELATIVE to it — so the entity's origin sits on
      // the shape (its centre), not at the parent origin far away. That makes
      // the standard transform gizmo attach on the shape and rotate/scale about
      // its centre, consistent with other scene elements.
      const definitionThrough = (points) => {
        const centroid = new THREE.Vector3();
        points.forEach((p) => centroid.add(p));
        centroid.multiplyScalar(1 / Math.max(1, points.length));
        const children = points.map((p) => ({
          element: 'a-entity',
          class: 'hideFromSceneGraph',
          components: {
            'shape-vertex': '',
            position: `${p.x - centroid.x} ${p.y - centroid.y} ${p.z - centroid.z}`
          }
        }));
        // All four appearance props are written whether or not the shape
        // closes: an open polyline has no interior today, but `closed` is
        // togglable in the panel, and omitting the fill props would make
        // closing it later reveal a schema-default fill instead of the one it
        // was drawn with. Writing default-valued props costs nothing in the
        // saved file — the serializer diffs the live component data against the
        // schema defaults.
        //
        // `closed` is written only when true, so an open shape's saved JSON
        // keeps no `closed` key (the serializer strips schema defaults).
        const shapeComponent = {
          lineColor: style.lineColor,
          lineWidth: style.lineWidth,
          fillColor: style.fillColor,
          fillOpacity: style.fillOpacity,
          ...(closed ? { closed: true } : {})
        };
        return {
          element: 'a-entity',
          components: {
            shape: shapeComponent,
            position: `${centroid.x} ${centroid.y} ${centroid.z}`,
            'data-layer-name': layerName
          },
          children
        };
      };
      // Named once, so a shape that falls back to the top level keeps the
      // number it was given.
      const layerName = `Shape • ${closed ? 'Polygon' : 'Polyline'} ${shapeLayerCounter++}`;

      // The shape goes into the group open when the tool started, or else the
      // top level, at the world position it was drawn at. The definition is
      // built from the world points and re-posed under its parent (the top
      // level's container is offset in a geospatial scene); its vertices stay
      // world-axis offsets from the centroid, which is right because the
      // entity's resulting world rotation is the identity.
      const worldDefinition = definitionThrough(
        verts.map((v) => new THREE.Vector3(v.x, v.y, v.z))
      );
      let placed = ticket && placeDefinition(worldDefinition, ticket);
      if (placed?.refusal) {
        // The group is gone, or can no longer take the shape without
        // distorting it. What was drawn is the user's work: it is added at the
        // top level, where it was drawn, and the user is told.
        STREET.notify.infoMessage(groupMessage('drawnShapeAtTopLevel'));
      }
      if (!placed || placed.refusal) {
        // Marked as required there, like a group placement, so a group still
        // open does not add a notice that the shape is outside it.
        placed = placeDefinition(worldDefinition, {
          parentId: STREET_CONTAINER_ID
        });
      }
      AFRAME.INSPECTOR.execute(
        'entitycreate',
        placed.refusal ? worldDefinition : placed.definition
      );
    }

    // What every exit commits. Closed only via the first-vertex gesture — the
    // close armed — and only as the ring the armed preview showed, at the step
    // in force now; a refused close, or no close, commits the placed vertices
    // open. The armed flag is read BEFORE disarming.
    const commitPending = () => {
      const plan = armedRef.current ? closePlanNow() : null;
      const { closed, vertices } = commitOutcome({
        vertices: verticesRef.current,
        plan
      });
      if (vertices.length >= 2) commitShape(closed, vertices);
      syncArmed(false);
      snapGuide.hide();
    };

    // Every exit (Enter, Esc, double-click, switching tools) drops the
    // un-clicked trailing cursor vertex and keeps every placed one, exactly as
    // the Ruler discarded its pending point. No placed work is ever lost.
    function finish() {
      if (committingRef.current) return;
      committingRef.current = true;
      commitPending();
      teardown();
      // Returns to Move, as `m` would from here; this emits
      // transformmodechange which flips newToolMode to 'off' and re-runs this
      // effect's cleanup — the committing guard makes that re-entry a no-op.
      changeTransformMode(nextMoveGizmo('off'));
      // EntityCreateCommand selects the created parent, so the on-select
      // readouts (ShapeSidebar) light up with no extra wiring.
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    const unsubscribeStep = useStore.subscribe(
      (state) => state.shapeToolSettings.snapStep,
      repaintArmed
    );

    // --- deactivate (cleanup) --------------------------------------------
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      unsubscribeStep();
      previewEl.removeEventListener('loaded', onPreviewLoaded);
      canvas.style.cursor = null;
      setShapeDrawActive(false);
      // Auto-finish anything still in progress: commit if ≥2 vertices, on the
      // same terms as finish(). Guarded against the finish()-triggered re-entry
      // above.
      if (!committingRef.current) {
        committingRef.current = true;
        commitPending();
        teardown();
      }
      snapGuide.hide();
      // Dispose the close-target marker.
      const h = highlightRef.current;
      if (h) {
        scene.object3D.remove(h.mesh);
        h.geo.dispose();
        h.mat.dispose();
        highlightRef.current = null;
      }
      probeTargets.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);
}
