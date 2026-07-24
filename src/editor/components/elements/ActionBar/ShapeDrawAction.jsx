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

const CLICK_MOVE_THRESHOLD = 4; // px — a larger press→release move is a drag
const MIN_VERTEX_SPACING = 0.05; // m — reject a click ~on the previous vertex

// Ground-plane pick that signals a miss as null (the shared
// pickPointOnGroundPlane collapses a miss to the world origin, which is
// ambiguous with a genuine origin click).
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const pickRaycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function pickGroundOrNull(clientX, clientY) {
  const canvas = AFRAME.scenes[0]?.canvas;
  const camera = AFRAME.INSPECTOR?.camera;
  if (!canvas || !camera) return null;
  const rect = canvas.getBoundingClientRect();
  ndc.set(
    (2 * (clientX - rect.left)) / rect.width - 1,
    -((2 * (clientY - rect.top)) / rect.height - 1)
  );
  pickRaycaster.setFromCamera(ndc, camera);
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
      downXYRef.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e) => {
      const point = pickGroundOrNull(e.clientX, e.clientY);
      if (!point) {
        collapseTrailing();
        readoutsRef.current && readoutsRef.current.clear();
        return;
      }
      setTrailing(point);
      refreshReadouts(point);
    };

    const onPointerUp = (e) => {
      const down = downXYRef.current;
      downXYRef.current = null;
      placedLastRef.current = false;
      if (down) {
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (moved > CLICK_MOVE_THRESHOLD) return; // a drag (orbit/pan)
      }
      const point = pickGroundOrNull(e.clientX, e.clientY);
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
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        // Mid-draw undo steps back a pending vertex; it must not reach the
        // editor undo stack (which would pop an unrelated entity).
        e.preventDefault();
        e.stopPropagation();
        removeLastVertex();
        refreshReadouts(null);
      }
    };

    // --- finish / cancel --------------------------------------------------
    function teardown() {
      const pEl = previewElRef.current;
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
      const children = verts.map((v) => ({
        element: 'a-entity',
        class: 'hideFromSceneGraph',
        components: {
          'shape-vertex': '',
          position: `${v.x} ${v.y} ${v.z}`
        }
      }));
      AFRAME.INSPECTOR.execute('entitycreate', {
        element: 'a-entity',
        components: {
          shape: { lineColor: style.lineColor, lineWidth: style.lineWidth },
          'data-layer-name': 'Shape • Polyline'
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);
}
