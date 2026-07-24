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
import { isSolidFloorHit } from '../../../lib/nav-experimental/cursorAnchor.js';
import { ProbeTargets } from '../../../lib/nav-experimental/probeTargets.js';

const CLICK_MOVE_THRESHOLD = 4; // px — a larger press→release move is a drag
const MIN_VERTEX_SPACING = 0.05; // m — reject a click ~on the previous vertex
let shapeLayerCounter = 1; // distinguishes drawn shapes in the SceneGraph

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
    if (isSolidFloorHit(hits[i])) return hits[i].point.clone();
  }
  // No solid surface under the cursor — fall back to the y=0 ground plane
  // (empty ground / the environment sit at y=0), or null on a full miss (the
  // ray points at/above the horizon).
  const hit = new THREE.Vector3();
  return pickRaycaster.ray.intersectPlane(groundPlane, hit) ? hit : null;
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
      lineWidth: style.lineWidth
    });
    scene.appendChild(previewEl);
    previewElRef.current = previewEl;

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

    const onPointerMove = (e) => {
      if (committingRef.current) return;
      const point = pickSurfaceOrNull(e.clientX, e.clientY, probeTargets);
      if (!point) {
        collapseTrailing();
        readoutsRef.current && readoutsRef.current.clear();
        return;
      }
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
      const point = pickSurfaceOrNull(e.clientX, e.clientY, probeTargets);
      if (!point) return; // horizon click — no-op
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

    function commitShape() {
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
      const children = verts.map((v) => {
        const p = toLocal(v);
        return {
          element: 'a-entity',
          class: 'hideFromSceneGraph',
          components: {
            'shape-vertex': '',
            position: `${p.x} ${p.y} ${p.z}`
          }
        };
      });
      AFRAME.INSPECTOR.execute('entitycreate', {
        element: 'a-entity',
        components: {
          shape: { lineColor: style.lineColor, lineWidth: style.lineWidth },
          'data-layer-name': `Shape • Polyline ${shapeLayerCounter++}`
        },
        children
      });
      // Persist the sticky style (last-*drawn*) so the next shape matches.
      setLastShapeStyle({
        lineColor: style.lineColor,
        lineWidth: style.lineWidth
      });
    }

    function finish() {
      if (committingRef.current) return;
      committingRef.current = true;
      const enough = verticesRef.current.length >= 2;
      if (enough) commitShape();
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
      canvas.style.cursor = null;
      setShapeDrawActive(false);
      // Auto-finish anything still in progress: commit if ≥2 vertices, else
      // discard. Guarded against the finish()-triggered re-entry above.
      if (!committingRef.current) {
        committingRef.current = true;
        if (verticesRef.current.length >= 2) commitShape();
        teardown();
      }
      probeTargets.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);
}
