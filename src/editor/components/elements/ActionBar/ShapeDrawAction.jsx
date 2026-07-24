/* global AFRAME, THREE */

// Shape draw tool: click to lay down polyline vertices on the ground plane
// with live length + angle readouts, finish with Enter / double-click, cancel
// with Esc, step back with Backspace. Generalises the Ruler (RulerAction.jsx)
// from two fixed points to an N-vertex open polyline, and adds the readout
// layer (ShapeReadouts).
//
// Draw state lives in refs, never useState: the deactivation auto-finish runs
// from the effect cleanup, a closure over the last render — a useState vertex
// array would be read stale there. The listener effect is keyed only on
// isActive so it doesn't tear down/re-add mid-draw.

import { useEffect, useRef } from 'react';
import useStore from '@/store';
import ShapeReadouts from '../../../lib/ShapeReadouts';
import { segmentsIntersectXZ } from '../../../lib/shapeMeasure';
import {
  isSolidFloorHit,
  worldHitNormal
} from '../../../lib/nav-experimental/cursorAnchor.js';
import { ProbeTargets } from '../../../lib/nav-experimental/probeTargets.js';
import { BLOCK_SLOPE_MIN_DEGREES } from '../../../lib/nav-experimental/constants.js';

const CLICK_MOVE_THRESHOLD = 4; // px — a larger press→release move is a drag
const MIN_VERTEX_SPACING = 0.05; // m — reject a click ~on the previous vertex
const CLOSE_PX_TOLERANCE = 12; // px — cursor this close to the first vertex arms
// the close gesture (Open mode). Screen-space, not world metres, so it is
// scale-invariant — matches the ruler/draw click-vs-drag pixel basis.
const INVALID_COLOR = '#ff3b30'; // preview recolour when a placement would cross
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
    // plan-view area (KD-12) is always faithful — no wall-drawn degenerate area.
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
// plan-view area is exact. (An option to follow the surface for every vertex
// instead is a later, per-shape choice — TASK-103.)
const kPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function pickKPlaneOrNull(clientX, clientY, k) {
  const canvas = AFRAME.scenes[0]?.canvas;
  const camera = AFRAME.INSPECTOR?.camera;
  if (!canvas || !camera) return null;
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    (2 * (clientX - rect.left)) / rect.width - 1,
    -((2 * (clientY - rect.top)) / rect.height - 1)
  );
  pickRaycaster.setFromCamera(ndc, camera);
  kPlane.constant = -k; // plane y + constant = 0  →  constant = -k
  const hit = new THREE.Vector3();
  return pickRaycaster.ray.intersectPlane(kPlane, hit) ? hit : null;
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
  const closingArmedRef = useRef(false); // cursor is over the first vertex (Open)
  const highlightRef = useRef(null); // first-vertex close-target marker
  const setLastShapeStyle = useStore.getState().setLastShapeStyle;
  const setShapeDrawActive = useStore.getState().setShapeDrawActive;

  useEffect(() => {
    if (!isActive) return undefined;
    const scene = AFRAME.scenes[0];
    const canvas = scene?.canvas;
    if (!canvas) return undefined;

    // --- activate ---------------------------------------------------------
    committingRef.current = false;
    verticesRef.current = [];
    committedElsRef.current = [];
    placedLastRef.current = false;
    invalidRef.current = false;
    closingArmedRef.current = false;
    // Polygon (auto-closing) is the default draw mode; Open polyline is opt-in.
    const isPolygon = () => useStore.getState().shapeDrawMode !== 'open';
    setShapeDrawActive(true);
    // Deselect on entry: nothing should stay selected while drawing (its
    // on-select readouts would linger over the new shape, and a stray
    // Backspace could otherwise target it).
    if (AFRAME.INSPECTOR?.selectedEntity) {
      AFRAME.INSPECTOR.selectEntity(null);
    }

    // Curated + cached raycast target list (excludes map layers; keeps tiles).
    // Reused from the nav floor probes; recomputes only on scene-graph change.
    const probeTargets = new ProbeTargets(scene);

    const style = useStore.getState().lastShapeStyle;
    const previewEl = document.createElement('a-entity');
    previewEl.id = 'shapeDrawPreview';
    previewEl.classList.add('hideFromSceneGraph');
    previewEl.setAttribute('shape', {
      lineColor: style.lineColor,
      lineWidth: style.lineWidth,
      // Polygon mode previews the closed ring (+ live area) through the cursor;
      // Open mode previews an open polyline. The cursor is a real trailing
      // vertex, so with `closed` the preview is a (committed+1)-gon and area
      // shows from the 2nd committed vertex on (the cursor being the 3rd).
      closed: isPolygon()
    });
    scene.appendChild(previewEl);
    previewElRef.current = previewEl;

    // First-vertex close-target marker (Open mode): a flat ring highlighted when
    // the cursor is within CLOSE_PX_TOLERANCE of the first vertex. Tool-owned,
    // created once, hidden by default, disposed on cleanup.
    const highlightGeo = new THREE.TorusGeometry(0.5, 0.06, 8, 24);
    const highlightMat = new THREE.MeshBasicMaterial({
      color: 0x00ffcc,
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
      readoutsRef.current.setUnits(useStore.getState().unitsPreference);
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

    const refreshReadouts = (cursor) => {
      const r = readoutsRef.current;
      if (!r) return;
      r.setUnits(useStore.getState().unitsPreference); // track live unit toggles
      const active = verticesRef.current.map(
        (v) => new THREE.Vector3(v.x, v.y, v.z)
      );
      if (cursor) active.push(new THREE.Vector3(cursor.x, cursor.y, cursor.z));
      r.renderActive(active);
    };

    // Recolour the preview red on an invalid (self-intersecting) placement, and
    // back to the style colour when valid. Idempotent — only touches the
    // attribute on a real flip — so every path (move, miss, close, mode switch)
    // can call it freely without churning setAttribute or leaving it stuck red.
    const setInvalid = (bad) => {
      if (invalidRef.current === bad) return;
      invalidRef.current = bad;
      const pEl = previewElRef.current;
      if (!pEl) return;
      pEl.setAttribute(
        'shape',
        'lineColor',
        bad ? INVALID_COLOR : style.lineColor
      );
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

    // Committed non-closing ring edges [v_i, v_{i+1}] for i = 0..n-2.
    const committedEdges = () => {
      const verts = verticesRef.current;
      const edges = [];
      for (let i = 0; i < verts.length - 1; i++) {
        edges.push([verts[i], verts[i + 1]]);
      }
      return edges;
    };

    // Does segment a→b cross any of `edges`? segmentsIntersectXZ returns false
    // for a shared endpoint, so adjacent edges are excluded automatically.
    const edgesCross = (a, b, edges) => {
      for (const [c, d] of edges) {
        if (segmentsIntersectXZ(a, b, c, d)) return true;
      }
      return false;
    };

    // Would placing `point` as the next vertex create a self-intersection?
    // Tests the new segment (last→point) and, in Polygon mode, the live closing
    // edge (point→first) against the committed edges. A triangle can never
    // cross (all candidate edges are adjacent), so this only fires from n≥3.
    const placementCrosses = (point) => {
      const verts = verticesRef.current;
      const n = verts.length;
      if (n < 3) return false;
      const edges = committedEdges();
      if (edgesCross(verts[n - 1], point, edges)) return true;
      if (isPolygon() && edgesCross(point, verts[0], edges)) return true;
      return false;
    };

    // Would closing the current open ring (last→first) create a crossing?
    const closeCrosses = () => {
      const verts = verticesRef.current;
      const n = verts.length;
      if (n < 3) return false;
      return edgesCross(verts[n - 1], verts[0], committedEdges());
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
    };

    const removeLastVertex = () => {
      const verts = verticesRef.current;
      if (!verts.length) return;
      verts.pop();
      const el = committedElsRef.current.pop();
      if (el && el.parentNode) el.parentNode.removeChild(el);
    };

    const onPointerDown = (e) => {
      if (committingRef.current) return;
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

    // Arm the Open-mode close gesture when the cursor is within
    // CLOSE_PX_TOLERANCE px of the first vertex (≥3 committed so a close is
    // meaningful). Snaps the trailing vertex onto the first so the preview draws
    // the closing edge, and highlights the target. Returns true when armed.
    const tryArmClose = (clientX, clientY) => {
      if (isPolygon()) return false;
      const verts = verticesRef.current;
      if (verts.length < 3) return false;
      const scr = worldToScreen(verts[0]);
      if (!scr) return false;
      if (Math.hypot(clientX - scr.x, clientY - scr.y) > CLOSE_PX_TOLERANCE) {
        return false;
      }
      return true;
    };

    const onPointerMove = (e) => {
      if (committingRef.current) return;
      const point = pickForNextVertex(e.clientX, e.clientY);
      if (!point) {
        collapseTrailing();
        readoutsRef.current && readoutsRef.current.clear();
        setInvalid(false); // never leave the preview stuck red on a miss
        updateHighlight(false);
        closingArmedRef.current = false;
        return;
      }
      // Open-mode close-gesture arming.
      if (tryArmClose(e.clientX, e.clientY)) {
        closingArmedRef.current = true;
        updateHighlight(true);
        setTrailing(verticesRef.current[0]); // preview the closing edge
        setInvalid(closeCrosses());
        refreshReadouts(verticesRef.current[0]);
        return;
      }
      closingArmedRef.current = false;
      updateHighlight(false);
      setInvalid(placementCrosses(point));
      setTrailing(point);
      refreshReadouts(point);
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
      // Open-mode close: commit the committed ring as a polygon (do not add the
      // duplicate first vertex). Rejected if the closing edge would cross.
      if (!isPolygon() && closingArmedRef.current) {
        if (closeCrosses()) return;
        finish(true);
        return;
      }
      const point = pickForNextVertex(e.clientX, e.clientY);
      if (!point) return; // horizon click — no-op
      if (placementCrosses(point)) return; // reject a self-intersecting placement
      const verts = verticesRef.current;
      if (verts.length) {
        const last = verts[verts.length - 1];
        const d = Math.hypot(
          point.x - last.x,
          point.y - last.y,
          point.z - last.z
        );
        if (d < MIN_VERTEX_SPACING) return; // reject zero-length segment
      }
      addCommittedVertex(point);
      placedLastRef.current = true;
      setInvalid(false);
      setTrailing(point);
      refreshReadouts(point);
    };

    const onDblClick = () => {
      if (committingRef.current) return;
      // The first release of a native double-click already placed a vertex if
      // it passed the spacing guard; retract only that one, then finish.
      if (placedLastRef.current) removeLastVertex();
      finish();
    };

    const onKeyDown = (e) => {
      if (isTextFieldFocused()) return;
      if (e.key === 'Enter') {
        finish();
      } else if (e.key === 'Escape') {
        cancel();
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        removeLastVertex();
        refreshReadouts(null);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        !e.shiftKey &&
        (e.key === 'z' || e.key === 'Z')
      ) {
        // Mid-draw undo steps back a pending vertex; it must not reach the
        // editor undo stack (which would pop an unrelated entity).
        e.preventDefault();
        e.stopPropagation();
        removeLastVertex();
        refreshReadouts(null);
      } else if (
        (e.ctrlKey || e.metaKey) &&
        ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) ||
          e.key === 'y' ||
          e.key === 'Y')
      ) {
        // Mid-draw redo (Ctrl+Shift+Z / Ctrl+Y): swallow so it can't redo an
        // unrelated previously-undone editor command while drawing. No-op.
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // --- finish / cancel --------------------------------------------------
    function teardown() {
      const pEl = previewElRef.current;
      previewEl.removeEventListener('loaded', onPreviewLoaded);
      if (readoutsRef.current) {
        readoutsRef.current.dispose();
        readoutsRef.current = null;
      }
      if (pEl && pEl.parentNode) pEl.parentNode.removeChild(pEl);
      previewElRef.current = null;
      trailingElRef.current = null;
      committedElsRef.current = [];
      verticesRef.current = [];
    }

    function commitShape(closed) {
      const verts = verticesRef.current;
      const style = useStore.getState().lastShapeStyle;
      // Vertices are picked in world space, but entitycreate parents the shape
      // to the editor's default parent (#street-container) and treats child
      // positions as LOCAL to it. Convert so the committed shape lands exactly
      // where the world-space preview showed it, even if that parent is offset
      // (e.g. a geospatial scene).
      const parentEl = document.getElementById('street-container');
      const parentObj = parentEl && parentEl.object3D;
      if (parentObj) parentObj.updateMatrixWorld();
      const toLocal = (v) => {
        const w = new THREE.Vector3(v.x, v.y, v.z);
        return parentObj ? parentObj.worldToLocal(w) : w;
      };
      const localVerts = verts.map(toLocal);
      // Place the shape entity at the vertices' centroid and store each vertex
      // RELATIVE to it — so the entity's origin sits on the shape (its centre),
      // not at the parent origin far away. That makes the standard transform
      // gizmo attach on the shape and rotate/scale about its centre, consistent
      // with other scene elements. (Whole-shape move is a deliberate later
      // refinement; basic transform controls are fine now.)
      const centroid = new THREE.Vector3();
      localVerts.forEach((p) => centroid.add(p));
      centroid.multiplyScalar(1 / Math.max(1, localVerts.length));
      const children = localVerts.map((p) => ({
        element: 'a-entity',
        class: 'hideFromSceneGraph',
        components: {
          'shape-vertex': '',
          position: `${p.x - centroid.x} ${p.y - centroid.y} ${p.z - centroid.z}`
        }
      }));
      // `closed` is written only when true, so an open shape's saved JSON keeps
      // no `closed` key (the serializer strips schema defaults).
      const shapeComponent = closed
        ? {
            lineColor: style.lineColor,
            lineWidth: style.lineWidth,
            closed: true
          }
        : { lineColor: style.lineColor, lineWidth: style.lineWidth };
      const layerNoun = closed ? 'Polygon' : 'Polyline';
      AFRAME.INSPECTOR.execute('entitycreate', {
        element: 'a-entity',
        components: {
          shape: shapeComponent,
          position: `${centroid.x} ${centroid.y} ${centroid.z}`,
          'data-layer-name': `Shape • ${layerNoun} ${shapeLayerCounter++}`
        },
        children
      });
      // Persist the sticky style (last-*drawn*) so the next shape matches.
      setLastShapeStyle({
        lineColor: style.lineColor,
        lineWidth: style.lineWidth
      });
    }

    // forceClosed === true → commit closed (the Open-mode close gesture);
    // undefined → derive from the current mode (Polygon commits closed, Open
    // commits open). Either way a shape with < 3 vertices commits open (a line).
    function finish(forceClosed) {
      if (committingRef.current) return;
      committingRef.current = true;
      const verts = verticesRef.current;
      const wantClosed =
        forceClosed === true || (forceClosed === undefined && isPolygon());
      const commitClosed = wantClosed && verts.length >= 3;
      if (verts.length >= 2) commitShape(commitClosed);
      teardown();
      // Returns to the translate tool; this emits transformmodechange which
      // flips newToolMode to 'off' and re-runs this effect's cleanup — the
      // committing guard makes that re-entry a no-op.
      changeTransformMode('translate');
      // EntityCreateCommand selects the created parent, so the on-select
      // readouts (ShapeSidebar) light up with no extra wiring.
    }

    function cancel() {
      if (committingRef.current) return;
      committingRef.current = true;
      teardown();
      changeTransformMode('translate');
    }

    // React to a mid-draw mode switch: re-point the preview's `closed`, and
    // reset the close-arm / highlight / invalid state (the candidate-edge set
    // differs between modes). Guarded on `readoutsRef.current` — set in
    // onPreviewLoaded — so it never touches a pre-`loaded` or torn-down preview.
    const unsubMode = useStore.subscribe(
      (s) => s.shapeDrawMode,
      () => {
        const pEl = previewElRef.current;
        if (pEl && readoutsRef.current) {
          pEl.setAttribute('shape', 'closed', isPolygon());
        }
        closingArmedRef.current = false;
        updateHighlight(false);
        setInvalid(false);
      }
    );

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    window.addEventListener('keydown', onKeyDown, true);

    // --- deactivate (cleanup) --------------------------------------------
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('keydown', onKeyDown, true);
      previewEl.removeEventListener('loaded', onPreviewLoaded);
      unsubMode();
      canvas.style.cursor = null;
      setShapeDrawActive(false);
      // Auto-finish anything still in progress: commit if ≥2 vertices (closed
      // when Polygon mode + ≥3), else discard. Guarded against the
      // finish()-triggered re-entry above.
      if (!committingRef.current) {
        committingRef.current = true;
        if (verticesRef.current.length >= 2) {
          commitShape(isPolygon() && verticesRef.current.length >= 3);
        }
        teardown();
      }
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
