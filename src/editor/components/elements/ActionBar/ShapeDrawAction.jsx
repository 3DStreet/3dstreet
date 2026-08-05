/* global AFRAME, THREE */

// Shape draw tool: click to lay down polyline vertices on the ground plane
// with live length + angle readouts, finish with Enter / Esc / double-click,
// step back with Backspace. Generalises the Ruler (RulerAction.jsx) from two
// fixed points to an N-vertex open polyline, and adds the readout layer
// (ShapeReadouts).
//
// No exit discards placed work: Enter, Esc, double-click and switching tools
// all commit through finish(). Recovery is Backspace before finishing and
// Ctrl+Z (EntityCreateCommand) after, so no keystroke can destroy an arbitrary
// amount of unrecoverable work. Esc and Enter differ only over the un-clicked
// trailing cursor point — Enter takes it, Esc drops it — which is the same
// "back out one level" Esc means everywhere else in the editor.
//
// Closure is refused on TWO questions, not one: the closing edge must not cross
// a committed edge, AND the ring it completes must enclose a region — a ring of
// exactly zero area (three collinear points, say) crosses nothing and still has
// no interior to fill, measure or extrude. Both live in closureRefused, which
// every closedness decision in this file goes through.
//
// The two draw modes select how closure HAPPENS, not what the shape ends up as:
// auto-close treats the ring as closed by default and drops to open whenever
// closure is refused, while manual close stays open until the first vertex is
// clicked. Either can therefore produce an open or a closed shape. Letting a
// ring stay open is what allows a click to never be refused merely because
// closure would be — which in turn is what makes stars, combs and deep
// concavities near the first vertex drawable in their natural order.
//
// The preview draws the committed vertices PLUS the trailing cursor vertex, and
// judges its closedness on that ring. Enter commits that same ring, cursor
// vertex included, so what is on screen is what you get — with the one
// documented exception that the preview additionally requires the edge OUT to
// the cursor to be clean, so preview and commit can disagree about closedness
// right at a crossing (see syncPreviewClosed). Esc drops the cursor vertex, so
// it commits a ring one shorter — which may therefore differ in closedness from
// the preview. That difference is the point of the key, not a discrepancy: Esc
// means "without the point I haven't clicked".
//
// Draw state lives in refs, never useState: the deactivation auto-finish runs
// from the effect cleanup, a closure over the last render — a useState vertex
// array would be read stale there. The listener effect is keyed only on
// isActive so it doesn't tear down/re-add mid-draw.

import { useEffect, useRef } from 'react';
import useStore from '@/store';
import ShapeReadouts from '../../../lib/ShapeReadouts';
import {
  ringEnclosesArea,
  segmentsIntersectXZ
} from '../../../lib/shapeMeasure';
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

// m — reject a click ~on the PREVIOUS vertex. Distinct from the editor's
// MIN_EDIT_VERTEX_SEPARATION (shapeEditRules.js), which holds the same number
// but measures against every vertex; the two are separate constants so tuning
// one does not silently retune the other.
const MIN_DRAW_VERTEX_SPACING = 0.05;
const CLOSE_PX_TOLERANCE = 12; // px — cursor this close to the first vertex arms
// the close gesture (manual-close mode). Screen-space, not world metres, so it is
// scale-invariant — matches the ruler/draw click-vs-drag pixel basis.
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
  const closingArmedRef = useRef(false); // cursor is over the first vertex
  const highlightRef = useRef(null); // first-vertex close-target marker
  const previewClosedRef = useRef(false); // preview currently drawn as a ring
  const lastPointRef = useRef(null); // last valid cursor point, for re-syncing
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
    previewClosedRef.current = false; // matches the preview's initial `closed`
    lastPointRef.current = null;
    // Auto-close is the default draw mode; manual close is opt-in.
    const isAutoClose = () => useStore.getState().shapeDrawMode !== 'manual';
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
      // Starts open — with no vertices there is nothing to close. The preview's
      // closedness is then driven per cursor-move by syncPreviewClosed, which
      // keeps it showing exactly what committing right now would produce. The
      // cursor is a real trailing vertex, so when closed the preview is a
      // (committed+1)-gon and area shows from the 2nd committed vertex on.
      closed: false
    });
    scene.appendChild(previewEl);
    previewElRef.current = previewEl;

    // First-vertex close-target marker (manual-close mode): a flat ring shown when
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
    // Only the new segment (last→point) is tested — it is a permanent edge, so
    // a crossing there can never be undone by drawing on. A triangle can never
    // cross (all candidate edges are adjacent), so this only fires from n≥3.
    //
    // The provisional closing edge is deliberately NOT tested here. It is
    // discarded the moment another vertex is placed, so rejecting a click over
    // it would enforce "every intermediate ring is simple" — far stronger than
    // the "the finished ring is simple" that fill and extrusion need, and it
    // makes whole families of perfectly simple polygons (stars, combs, deep
    // concavities near the first vertex) impossible to draw in their natural
    // vertex order. Closure is handled by letting the shape be open instead:
    // see closureLegalAt / syncPreviewClosed.
    const placementCrosses = (point) => {
      const verts = verticesRef.current;
      const n = verts.length;
      if (n < 3) return false;
      return edgesCross(verts[n - 1], point, committedEdges());
    };

    // Would a click at `point` be accepted as the next vertex? Used both by the
    // click path and by Enter, which takes the pending cursor point — Enter must
    // never create a vertex a click could not.
    const canPlace = (point) => {
      if (placementCrosses(point)) return false;
      const verts = verticesRef.current;
      if (!verts.length) return true;
      const last = verts[verts.length - 1];
      const d = Math.hypot(
        point.x - last.x,
        point.y - last.y,
        point.z - last.z
      );
      return d >= MIN_DRAW_VERTEX_SPACING;
    };

    // Would closing the current committed ring (last→first) be refused?
    //
    // Two questions, not one. The closing edge must not cross a committed edge,
    // AND the ring it completes must enclose a region — a ring of exactly zero
    // area (three collinear points, say) crosses nothing and still has no
    // interior to fill, measure or extrude. Closure is gated on this and
    // PLACEMENT deliberately is not: an open polyline has no interior to
    // require, and refusing a click collinear with the two before it would make
    // whole families of legal shapes undrawable.
    const closureRefused = () => {
      const verts = verticesRef.current;
      if (verts.length < 3) return false;
      return (
        closureCrossesFrom(verts[verts.length - 1]) || !ringEnclosesArea(verts)
      );
    };

    // Would a closing edge from `point` back to the first vertex cross a
    // committed edge? Adjacent edges share an endpoint and are excluded by
    // segmentsIntersectXZ.
    const closureCrossesFrom = (point) =>
      edgesCross(point, verticesRef.current[0], committedEdges());

    // Should the PREVIEWED ring be drawn closed? The preview is the committed
    // vertices plus the trailing cursor vertex, so 2 committed already make a
    // 3-corner ring. Both of the ring's new edges must be clean — the one out
    // to the cursor and the one closing back — or the preview would draw a ring
    // that crosses itself, and the fill and area label would be computed from a
    // self-intersecting contour.
    // The enclosure test takes the committed vertices PLUS the cursor point,
    // because that is the ring the preview draws; judging the committed array
    // instead would make the preview's closedness lag the cursor by a vertex.
    const previewClosesAt = (point) =>
      verticesRef.current.length >= 2 &&
      !placementCrosses(point) &&
      !closureCrossesFrom(point) &&
      ringEnclosesArea([...verticesRef.current, point]);

    // Should the COMMITTED ring be drawn closed? Used when there is no cursor
    // (the pointer has left the ground), where the preview's trailing vertex has
    // collapsed onto the last committed one.
    //
    // Literally the negation of closureRefused, and written that way rather
    // than as its own conjunction: both names are wanted at their call sites,
    // but the RULE has one home, so a third closure condition cannot be added
    // to one and missed on the other.
    const committedRingCloses = () =>
      verticesRef.current.length >= 3 && !closureRefused();

    // Drive the preview's closedness. Note this tracks the ring the user can
    // SEE — committed vertices plus the cursor — while commitsClosed() judges
    // the ring that will actually be created, which is one vertex shorter. The
    // two therefore answer slightly different questions and can disagree near a
    // crossing; the preview is a live hint, not a contract. Only writes on a
    // change: setAttribute re-derives the shape.
    const syncPreviewClosed = (point) => {
      const closed =
        isAutoClose() &&
        (point ? previewClosesAt(point) : committedRingCloses());
      if (closed === previewClosedRef.current) return;
      const pEl = previewElRef.current;
      if (!pEl || !pEl.components || !pEl.components.shape) return;
      pEl.setAttribute('shape', 'closed', closed);
      previewClosedRef.current = closed;
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
      // Dropping an edge can make a previously illegal closure legal again.
      syncPreviewClosed(lastPointRef.current);
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

    // Arm the manual close gesture when the cursor is within CLOSE_PX_TOLERANCE
    // px of the first vertex (≥3 committed so a close is meaningful). Snaps the
    // trailing vertex onto the first so the preview draws the closing edge, and
    // highlights the target. Returns true when armed. Auto-close mode has no
    // such gesture — closure there is already the default.
    const tryArmClose = (clientX, clientY) => {
      if (isAutoClose()) return false;
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
        // The trailing vertex has collapsed onto the last committed one, so the
        // ring the preview shows is the committed ring.
        lastPointRef.current = null;
        syncPreviewClosed(null);
        return;
      }
      lastPointRef.current = point;
      // Manual-close gesture arming.
      if (tryArmClose(e.clientX, e.clientY)) {
        closingArmedRef.current = true;
        updateHighlight(true);
        setTrailing(verticesRef.current[0]); // preview the closing edge
        setInvalid(closureRefused());
        refreshReadouts(verticesRef.current[0]);
        // While armed there is no pending corner: the trailing vertex is
        // snapped onto the first one, so the preview shows closure, not a new
        // corner. Clearing this keeps Enter honest — it closes the ring like
        // the click would, instead of dropping a stray vertex beside vertex 0.
        lastPointRef.current = null;
        return;
      }
      closingArmedRef.current = false;
      updateHighlight(false);
      setInvalid(placementCrosses(point));
      syncPreviewClosed(point);
      setTrailing(point);
      refreshReadouts(point);
    };

    // Cursor off the canvas: there is no pending point any more, so drop it and
    // collapse the preview to the committed ring — the same state a pick-miss
    // leaves. Without this, reaching for a toolbar button and then pressing
    // Enter would commit a vertex at wherever the mouse last crossed the edge.
    const onPointerLeave = () => {
      if (committingRef.current) return;
      lastPointRef.current = null;
      collapseTrailing();
      readoutsRef.current && readoutsRef.current.clear();
      setInvalid(false);
      updateHighlight(false);
      closingArmedRef.current = false;
      syncPreviewClosed(null);
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
      // Manual close: commit the committed ring as a polygon (do not add the
      // duplicate first vertex). Refused outright if the ring would not be a
      // legal one — closure was asked for explicitly here, so quietly handing back
      // an open shape (what auto-close mode does) would answer a different
      // question than the one the click asked.
      if (!isAutoClose() && closingArmedRef.current) {
        if (closureRefused()) return;
        finish(false); // closing onto the first vertex, not onto the cursor
        return;
      }
      const point = pickForNextVertex(e.clientX, e.clientY);
      if (!point) return; // horizon click — no-op
      if (!canPlace(point)) return; // crossing, or on top of the previous vertex
      addCommittedVertex(point);
      placedLastRef.current = true;
      setInvalid(false);
      // The committed edge set just grew, so closure legality may have flipped;
      // resync now rather than waiting for the next cursor move.
      syncPreviewClosed(point);
      setTrailing(point);
      refreshReadouts(point);
    };

    const onDblClick = () => {
      if (committingRef.current) return;
      // Usually a no-op: the double-click's second release lands within
      // MIN_DRAW_VERTEX_SPACING of the vertex the first one placed, so it is rejected
      // and there is nothing to retract. It only bites zoomed far enough out
      // that a few pixels of jitter exceed that spacing in world units — then
      // the second release really did place a vertex, and this removes it.
      if (placedLastRef.current) removeLastVertex();
      finish(false);
    };

    const onKeyDown = (e) => {
      if (isTextFieldFocused()) return;
      if (e.key === 'Enter') {
        finish(true); // commit the shape as previewed, cursor vertex included
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        removeLastVertex();
        // Clear any red/armed preview state — the removed vertex changed the
        // candidate-edge set; the next pointermove recomputes it.
        setInvalid(false);
        updateHighlight(false);
        closingArmedRef.current = false;
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
        // Clear any red/armed preview state — the removed vertex changed the
        // candidate-edge set; the next pointermove recomputes it.
        setInvalid(false);
        updateHighlight(false);
        closingArmedRef.current = false;
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
      finish(false);
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

    // Does the shape commit as a closed ring? Never if the ring would cross
    // itself or enclose nothing — auto-close mode then commits an open polyline
    // rather than refusing to finish. Given a legal closure, auto-close closes by default
    // and manual close closes only via the first-vertex gesture. Under 3
    // vertices there is no ring.
    const commitsClosed = () => {
      if (verticesRef.current.length < 3) return false;
      if (closureRefused()) return false;
      return isAutoClose() || closingArmedRef.current;
    };

    // `takePending` decides what happens to the trailing cursor vertex — the one
    // the preview draws but no click has placed.
    //
    // Enter takes it. The preview IS committed-vertices-plus-cursor, so taking
    // it makes Enter commit exactly the shape on screen: same corners, same
    // closedness, same area. Only if a click there would have been accepted —
    // Enter must not create a vertex the mouse could not.
    //
    // Esc, double-click and switching tools drop it, which is what makes Esc an
    // ordinary "back out one level" rather than a departure: it discards the
    // un-clicked point and keeps every placed one, exactly as the Ruler discards
    // its pending point. No placed work is ever lost either way.
    function finish(takePending) {
      if (committingRef.current) return;
      committingRef.current = true;
      if (takePending) {
        const pending = lastPointRef.current;
        if (pending && canPlace(pending)) addCommittedVertex(pending);
      }
      const verts = verticesRef.current;
      const commitClosed = commitsClosed();
      if (verts.length >= 2) commitShape(commitClosed);
      teardown();
      // Returns to the translate tool; this emits transformmodechange which
      // flips newToolMode to 'off' and re-runs this effect's cleanup — the
      // committing guard makes that re-entry a no-op.
      changeTransformMode('translate');
      // EntityCreateCommand selects the created parent, so the on-select
      // readouts (ShapeSidebar) light up with no extra wiring.
    }

    // React to a mid-draw mode switch: re-evaluate the preview's `closed` from
    // the cursor's last position under the new mode, and reset the close-arm /
    // highlight / invalid state.
    const unsubMode = useStore.subscribe(
      (s) => s.shapeDrawMode,
      () => {
        syncPreviewClosed(lastPointRef.current);
        closingArmedRef.current = false;
        updateHighlight(false);
        setInvalid(false);
      }
    );

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    // --- deactivate (cleanup) --------------------------------------------
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      previewEl.removeEventListener('loaded', onPreviewLoaded);
      unsubMode();
      canvas.style.cursor = null;
      setShapeDrawActive(false);
      // Auto-finish anything still in progress: commit if ≥2 vertices, on the
      // same terms as finish(). Guarded against the finish()-triggered re-entry
      // above.
      if (!committingRef.current) {
        committingRef.current = true;
        if (verticesRef.current.length >= 2) {
          commitShape(commitsClosed());
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
